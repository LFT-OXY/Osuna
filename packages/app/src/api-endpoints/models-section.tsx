import React, { useCallback, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  Pressable,
  ScrollView,
  View,
  type NativeSyntheticEvent,
  type PressableStateCallbackType,
  type TextInputKeyPressEventData,
} from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  Eraser,
  Gauge,
  Plus,
  Route,
  RotateCw,
  Search,
  SlidersHorizontal,
} from "lucide-react-native";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSubTrigger,
  type MenuPageDefinition,
} from "@/components/ui/dropdown-menu";
import { RowActionsMenuTrigger } from "@/components/ui/row-actions-menu-trigger";
import { AdaptiveTextInput } from "@/components/adaptive-text-input";
import { Alert } from "@/components/ui/alert";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { Button } from "@/components/ui/button";
import { FormTextInput } from "@/components/ui/form-field";
import { mutedIconColorMapping } from "@/components/ui/icon-color";
import { StatusBadge } from "@/components/ui/status-badge";
import { Switch } from "@/components/ui/switch";
import { Text } from "@/components/ui/text";
import { useIsCompactFormFactor } from "@/constants/layout";
import { settingsStyles } from "@/styles/settings";
import { ICON_SIZE } from "@/styles/theme";
import {
  buildModelEntries,
  familySelectAllState,
  groupModelEntries,
  setFamilySelected,
  setModelSelected,
  typedModelIds,
  type ModelEntry,
  type ModelFamilyGroup,
  type ModelSource,
} from "./internal/endpoint-models";
import { MODEL_FAMILIES, type ModelFamilyId } from "./internal/model-families";
import { ModelFamilyIcon } from "./model-family-icon";
import {
  contextTag,
  filterModelIds,
  hasFinishedTests,
  isNamedFree,
  offersFreeOnly,
  splitAroundId,
  testTook,
  wasAsked,
  type CliTestMethod,
  type ModelTestState,
  type ModelTests,
  type OfferedCliTest,
} from "./internal/model-tests";
import { relativeAgo } from "./reopen-hints-copy";
import { headerProblemText } from "./request-extras-copy";
import { formatLabel } from "./model-settings-sheet";
import type {
  ApiEndpointModelTestResult,
  ApiEndpointRequestFormat,
} from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import type { CatalogForgetState, ModelFetchState } from "./use-endpoint-detail";
import type { ModelTestRun } from "./use-model-tests";

/*
 * 接口详情页的「模型」区：搜索行，下面左栏家族目录、右栏当前家族的模型，每行一个小开关。
 * 两栏在固定高度里各自滚动，加载、失败、空、无结果都占同样的高度，切换时不跳。
 */

const ThemedSearch = withUnistyles(Search);
// FormTextInput 会压平 style 拆成外框与文字，Unistyles 样式在 Web 上压平后没有值，所以用普通对象。
const ADD_MODEL_INPUT_STYLE = { flex: 1 };
const FAMILY_ICON_SIZE = ICON_SIZE.md;

interface ApiEndpointModelsSectionProps {
  source: ModelSource;
  fetchState: ModelFetchState;
  forgetState: CatalogForgetState;
  now: Date;
  onFetch: () => void;
  // 「丢掉拉回的清单」；老主机不认，为 null。
  onForget: (() => void) | null;
  onChange: (next: Pick<ModelSource, "models" | "manualModels">) => void;
  // 一次可加几个（逗号分隔）；返回失败原因，成功为 null；添加行据此收起或留在原处显示原因。
  onAdd: (modelIds: string[]) => Promise<string | null>;
  // 模型行菜单的「模型设置」；老主机没有，为 null。
  onOpenSettings: ((modelId: string) => void) | null;
  // 模型行菜单的「只用这种格式」与行上的格式小标；老主机或这家只有一种格式的地址时为 null。
  formatPins: ModelFormatPins | null;
  // 卡片顶上的一行（「接口名显示方式」，照 magpie 放在模型名字上面）；没有为 null。
  header: ReactNode | null;
  // 测试模型、筛选与小标；老主机没有，为 null。
  modelTests: ModelTestsControl | null;
}

/** 「测试模型」：结果只在页面内存里；factsOf 给免费与上下文小标用的显示名与上下文。 */
export interface ModelTestsControl {
  tests: ModelTests;
  run: ModelTestRun;
  onTestAll: () => void;
  onTestOne: (modelId: string) => void;
  // 「按 Claude Code / Codex 的样子测」：这家提供的测法（老主机为空），与测一个模型。
  testsAs: OfferedCliTest[];
  onTestOneAs: (input: { modelId: string; method: CliTestMethod }) => void;
  onCancel: () => void;
  factsOf: (modelId: string) => { name: string | undefined; context: number | undefined };
}

/**
 * 模型行上直接设「只用这种格式」（照 magpie 模型行右键的 Asked on…）：可选的格式（不含「自动」），
 * 每个模型存着的格式（null 为自动），与设一个格式（null 回到自动）。
 */
export interface ModelFormatPins {
  formats: ApiEndpointRequestFormat[];
  pinOf: (modelId: string) => ModelFormatPin | null;
  onPin: (modelId: string, format: ApiEndpointRequestFormat | null) => void;
}

/** 一个模型存着的格式；isVoid 为这家已没有那种地址、不起作用。 */
export interface ModelFormatPin {
  format: ApiEndpointRequestFormat;
  isVoid: boolean;
}

function useFamilyName(): (family: ModelFamilyId) => string {
  const { t } = useTranslation();
  return useCallback(
    (family: ModelFamilyId) =>
      MODEL_FAMILIES.find((candidate) => candidate.id === family)?.name ??
      t(`settings.apiEndpoints.models.family.${family}`),
    [t],
  );
}

export function ApiEndpointModelsSection({
  source,
  fetchState,
  forgetState,
  now,
  onFetch,
  onForget,
  onChange,
  onAdd,
  onOpenSettings,
  formatPins,
  header,
  modelTests,
}: ApiEndpointModelsSectionProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [activeFamily, setActiveFamily] = useState<ModelFamilyId | null>(null);
  const [isAddOpen, setIsAddOpen] = useState(false);
  // 窄窗口里两栏会把家族名和模型名都截短：家族改成上面一行可横滑的标签，模型在下面占满宽。
  const isCompact = useIsCompactFormFactor();
  const entries = useMemo(() => buildModelEntries(source), [source]);
  const filters = useModelFilters({ entries, modelTests });
  const { nameOf, shownEntries } = filters;
  const groups = useMemo(() => groupModelEntries(shownEntries, query), [shownEntries, query]);
  const active = groups.find((group) => group.family === activeFamily) ?? groups[0] ?? null;
  const selectedCount = entries.filter((entry) => entry.selected).length;
  const isFetching = fetchState.status === "fetching";
  const isForgetting = forgetState.status === "forgetting";
  const fetchedAt = source.catalog?.fetchedAt;

  const openAdd = useCallback(() => setIsAddOpen(true), []);
  const closeAdd = useCallback(() => setIsAddOpen(false), []);
  const handleToggleModel = useCallback(
    (entry: ModelEntry, selected: boolean) =>
      onChange({
        models: setModelSelected({ models: source.models, entry, selected }),
        manualModels: source.manualModels,
      }),
    [onChange, source],
  );
  const handleSelectFamily = useCallback(
    (group: ModelFamilyGroup, selected: boolean) =>
      onChange({
        models: setFamilySelected({ models: source.models, group, selected }),
        manualModels: source.manualModels,
      }),
    [onChange, source],
  );

  const caption = useMemo(
    () => <ModelsCaption isForgetting={isForgetting} fetchedAt={fetchedAt} now={now} />,
    [fetchedAt, isForgetting, now],
  );
  const trailing = useMemo(
    () => (
      <ModelsActions
        isCompact={isCompact}
        isFetching={isFetching}
        isForgetting={isForgetting}
        onFetch={onFetch}
        onAdd={openAdd}
        onForget={fetchedAt && onForget ? onForget : null}
        modelTests={modelTests}
        canTest={selectedCount > 0}
      />
    ),
    [
      fetchedAt,
      isCompact,
      isFetching,
      isForgetting,
      modelTests,
      onFetch,
      onForget,
      openAdd,
      selectedCount,
    ],
  );

  let body: React.ReactNode;
  if (entries.length === 0) {
    body = <ModelsEmptyState fetchState={fetchState} />;
  } else if (!active) {
    body = (
      <CenteredMessage testID="api-endpoint-models-no-matches">
        {query.trim() === ""
          ? t("settings.apiEndpoints.models.tests.noFilterMatches")
          : t("settings.apiEndpoints.models.noMatches", { query: query.trim() })}
      </CenteredMessage>
    );
  } else {
    body = (
      <View style={isCompact ? styles.columnsCompact : styles.columns}>
        <ScrollView
          horizontal={isCompact}
          showsHorizontalScrollIndicator={false}
          style={isCompact ? styles.familyRowCompact : styles.familyColumn}
          contentContainerStyle={isCompact ? styles.familyRowContent : undefined}
          testID="api-endpoint-model-families"
        >
          {groups.map((group) => (
            <FamilyItem
              key={group.family}
              group={group}
              isActive={group.family === active.family}
              isCompact={isCompact}
              onPress={setActiveFamily}
            />
          ))}
        </ScrollView>
        <FamilyModels
          group={active}
          onToggle={handleToggleModel}
          onSelectAll={handleSelectFamily}
          onOpenSettings={onOpenSettings}
          formatPins={formatPins}
          modelTests={modelTests}
          nameOf={nameOf}
          isCompact={isCompact}
        />
      </View>
    );
  }

  return (
    <SettingsSection
      title={t("settings.apiEndpoints.models.title")}
      count={
        entries.length > 0
          ? t("settings.apiEndpoints.models.count", {
              selected: selectedCount,
              total: entries.length,
            })
          : undefined
      }
      caption={caption}
      trailing={trailing}
      testID="api-endpoint-models-section"
    >
      <View style={settingsStyles.card}>
        {header !== null ? <View style={styles.headerRow}>{header}</View> : null}
        <View style={styles.searchRow}>
          <ThemedSearch size={ICON_SIZE.md} uniProps={mutedIconColorMapping} />
          <AdaptiveTextInput
            style={styles.searchInput}
            onChangeText={setQuery}
            placeholder={
              entries.length > 0
                ? t("settings.apiEndpoints.models.searchPlaceholder", { total: entries.length })
                : t("settings.apiEndpoints.models.search")
            }
            accessibilityLabel={t("settings.apiEndpoints.models.search")}
            autoCapitalize="none"
            autoCorrect={false}
            editable={entries.length > 0}
            testID="api-endpoint-models-search"
          />
        </View>
        <ModelFiltersRow filters={filters} />
        {modelTests !== null ? (
          <TestRunRow run={modelTests.run} onCancel={modelTests.onCancel} />
        ) : null}
        {isAddOpen ? <AddModelRow existing={entries} onAdd={onAdd} onClose={closeAdd} /> : null}
        {forgetState.status === "failed" ? (
          <View style={[styles.inlineError, settingsStyles.rowBorder]}>
            <Alert
              variant="error"
              size="sm"
              title={t("settings.apiEndpoints.models.forgetFailed")}
              description={forgetState.message}
              testID="api-endpoint-models-forget-error"
            />
          </View>
        ) : null}
        {/* 已有清单时重新拉取失败：原因接在搜索行下面，清单照常可用。 */}
        {entries.length > 0 && fetchState.status === "failed" ? (
          <View style={[styles.inlineError, settingsStyles.rowBorder]}>
            <Alert
              variant="error"
              size="sm"
              title={t("settings.apiEndpoints.models.fetchFailed")}
              description={fetchState.message}
              testID="api-endpoint-models-fetch-error"
            />
          </View>
        ) : null}
        <View style={styles.body}>{body}</View>
      </View>
    </SettingsSection>
  );
}

/** 「只看免费」「只看能用」：只在有意义时出现（magpie），不在时不起作用。 */
function useModelFilters({
  entries,
  modelTests,
}: {
  entries: ModelEntry[];
  modelTests: ModelTestsControl | null;
}) {
  const [isFreeOnly, setIsFreeOnly] = useState(false);
  const [isWorkingOnly, setIsWorkingOnly] = useState(false);
  const nameOf = useCallback(
    (id: string) => entries.find((entry) => entry.id === id)?.label ?? modelTests?.factsOf(id).name,
    [entries, modelTests],
  );
  const offered = useMemo(() => {
    if (modelTests === null) return { showsFreeOnly: false, showsWorkingOnly: false };
    const ids = entries.map((entry) => entry.id);
    return {
      showsFreeOnly: offersFreeOnly({ ids, nameOf }),
      showsWorkingOnly: hasFinishedTests(modelTests.tests),
    };
  }, [entries, modelTests, nameOf]);
  // 筛选不在时不起作用：清单换了不再有免费的、或结果随页面清掉后，开关自然失效。
  const isFreeFilterOn = isFreeOnly && offered.showsFreeOnly;
  const isWorkingFilterOn = isWorkingOnly && offered.showsWorkingOnly;
  const shownEntries = useMemo(() => {
    const isAnyFilterOn = isFreeFilterOn || isWorkingFilterOn;
    if (modelTests === null || !isAnyFilterOn) return entries;
    const kept = new Set(
      filterModelIds({
        ids: entries.map((entry) => entry.id),
        nameOf,
        tests: modelTests.tests,
        isFreeOnly: isFreeFilterOn,
        isWorkingOnly: isWorkingFilterOn,
      }),
    );
    return entries.filter((entry) => kept.has(entry.id));
  }, [entries, isFreeFilterOn, isWorkingFilterOn, modelTests, nameOf]);
  return {
    nameOf,
    shownEntries,
    showsFreeOnly: offered.showsFreeOnly,
    showsWorkingOnly: offered.showsWorkingOnly,
    isFreeOnly,
    isWorkingOnly,
    setIsFreeOnly,
    setIsWorkingOnly,
  };
}

/** 「Models」标题下面一行：拉取时间；丢掉清单进行中写在这里（菜单选了就收起）。 */
function ModelsCaption({
  isForgetting,
  fetchedAt,
  now,
}: {
  isForgetting: boolean;
  fetchedAt: string | undefined;
  now: Date;
}) {
  const { t, i18n } = useTranslation();
  if (isForgetting) {
    return (
      <Text variant="caption" color="foregroundMuted" numberOfLines={1}>
        {t("settings.apiEndpoints.models.forgetting")}
      </Text>
    );
  }
  if (!fetchedAt) return null;
  return (
    <Text
      variant="caption"
      color="foregroundMuted"
      numberOfLines={1}
      testID="api-endpoint-models-fetched-at"
    >
      {fetchedCopy({
        t,
        ago: relativeAgo({ since: new Date(fetchedAt), now, locale: i18n.language }),
      })}
    </Text>
  );
}

/** 每种语言一整句：「刚刚拉取」「5分钟前拉取」，不是前缀拼上「刚刚」。 */
function fetchedCopy(input: { t: TFunction; ago: string | null }): string {
  if (input.ago === null) return input.t("settings.apiEndpoints.models.fetchedJustNow");
  return input.t("settings.apiEndpoints.models.fetchedAgo", { time: input.ago });
}

/**
 * 一行：测试模型、重新拉取、手动添加，次要的「丢掉拉回的清单」在 ⋯ 菜单里；窄窗口按钮只留图标。
 * 测试模型在没有已选模型或正在测时点不了（onTestAll 为 null）；showsTest 为 false 是老主机。
 */
function ModelsActions({
  isCompact,
  isFetching,
  isForgetting,
  onFetch,
  onAdd,
  onForget,
  modelTests,
  canTest,
}: {
  isCompact: boolean;
  isFetching: boolean;
  isForgetting: boolean;
  onFetch: () => void;
  onAdd: () => void;
  onForget: (() => void) | null;
  modelTests: ModelTestsControl | null;
  // 有已选模型才有可测的。
  canTest: boolean;
}) {
  const { t } = useTranslation();
  const testLabel = t("settings.apiEndpoints.models.tests.test");
  const isTesting = modelTests?.run.status === "running";
  const isTestBlocked = !canTest || isTesting;
  const fetchLabel = isFetching
    ? t("settings.apiEndpoints.models.fetching")
    : t("settings.apiEndpoints.models.refetch");
  return (
    <View style={styles.trailing}>
      {modelTests ? (
        <Button
          variant="ghost"
          size="sm"
          leftIcon={Gauge}
          loading={isTesting}
          disabled={isTestBlocked}
          onPress={modelTests.onTestAll}
          accessibilityLabel={testLabel}
          testID="api-endpoint-models-test"
        >
          {isCompact ? null : testLabel}
        </Button>
      ) : null}
      <Button
        variant="ghost"
        size="sm"
        leftIcon={RotateCw}
        loading={isFetching}
        disabled={isFetching}
        onPress={onFetch}
        accessibilityLabel={fetchLabel}
        testID="api-endpoint-models-refetch"
      >
        {isCompact ? null : fetchLabel}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        leftIcon={Plus}
        onPress={onAdd}
        accessibilityLabel={t("settings.apiEndpoints.models.add")}
        testID="api-endpoint-models-add"
      >
        {isCompact ? null : t("settings.apiEndpoints.models.add")}
      </Button>
      {onForget ? <ModelsMenu isBusy={isForgetting || isFetching} onForget={onForget} /> : null}
    </View>
  );
}

const ThemedEraser = withUnistyles(Eraser);

function ModelsMenu({ isBusy, onForget }: { isBusy: boolean; onForget: () => void }) {
  const { t } = useTranslation();
  const forgetLeading = useMemo(
    () => <ThemedEraser size={ICON_SIZE.md} uniProps={mutedIconColorMapping} />,
    [],
  );
  return (
    <DropdownMenu>
      <RowActionsMenuTrigger
        accessibilityLabel={t("settings.apiEndpoints.models.menu")}
        testID="api-endpoint-models-menu"
      />
      <DropdownMenuContent align="end" width={220}>
        <DropdownMenuItem
          leading={forgetLeading}
          onSelect={onForget}
          disabled={isBusy}
          testID="api-endpoint-models-forget"
        >
          {t("settings.apiEndpoints.models.forget")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ModelFiltersRow({ filters }: { filters: ReturnType<typeof useModelFilters> }) {
  const { t } = useTranslation();
  if (!filters.showsFreeOnly && !filters.showsWorkingOnly) return null;
  return (
    <View style={[styles.filtersRow, settingsStyles.rowBorder]}>
      {filters.showsFreeOnly ? (
        <FilterSwitch
          label={t("settings.apiEndpoints.models.tests.freeOnly")}
          value={filters.isFreeOnly}
          onChange={filters.setIsFreeOnly}
          testID="api-endpoint-models-free-only"
        />
      ) : null}
      {filters.showsWorkingOnly ? (
        <FilterSwitch
          label={t("settings.apiEndpoints.models.tests.workingOnly")}
          value={filters.isWorkingOnly}
          onChange={filters.setIsWorkingOnly}
          testID="api-endpoint-models-working-only"
        />
      ) : null}
    </View>
  );
}

function FilterSwitch({
  label,
  value,
  onChange,
  testID,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  testID: string;
}) {
  return (
    <View style={styles.filter}>
      <Switch value={value} onValueChange={onChange} accessibilityLabel={label} testID={testID} />
      <Text variant="caption" color="foregroundMuted" numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/** 测试的进度与取消，测完后是一句汇总；整批没成时原因留在这里。 */
function TestRunRow({ run, onCancel }: { run: ModelTestRun; onCancel: () => void }) {
  const { t } = useTranslation();
  if (run.status === "idle") return null;
  if (run.status === "failed") {
    return (
      <View style={[styles.inlineError, settingsStyles.rowBorder]}>
        <Alert
          variant="error"
          size="sm"
          title={t("settings.apiEndpoints.models.tests.failed")}
          description={run.message}
          testID="api-endpoint-models-test-error"
        />
      </View>
    );
  }
  const key = "settings.apiEndpoints.models.tests";
  let statusText: ReactNode;
  if (run.status === "running") {
    statusText = runningText({ t, run });
  } else if (run.status === "finished") {
    // 只有失败的个数用错误色（上游回了 404 也算失败，不是「没回应」）。
    const failedColor = run.failed > 0 ? "statusDanger" : "foregroundMuted";
    statusText = (
      <>
        {t(`${key}.summaryTested`, { total: run.total })}
        {" · "}
        <Text variant="caption" color={failedColor} testID="api-endpoint-models-test-failed-count">
          {t(`${key}.summaryFailed`, { failed: run.failed })}
        </Text>
      </>
    );
  } else {
    statusText = t(`${key}.cancelled`);
  }
  return (
    <View
      style={[styles.testRunRow, settingsStyles.rowBorder]}
      testID="api-endpoint-models-test-run"
    >
      <Text
        variant="caption"
        color="foregroundMuted"
        style={styles.flex}
        numberOfLines={1}
        testID="api-endpoint-models-test-status"
      >
        {statusText}
      </Text>
      {run.status === "running" ? (
        <Button
          variant="ghost"
          size="sm"
          onPress={onCancel}
          disabled={run.isCancelling}
          testID="api-endpoint-models-test-cancel"
        >
          {t("common.actions.cancel")}
        </Button>
      ) : null}
    </View>
  );
}

/** 进行中的一句：取消中；daemon 还没报要测哪些时不写个数。 */
function runningText(input: {
  t: TFunction;
  run: Extract<ModelTestRun, { status: "running" }>;
}): string {
  const { t, run } = input;
  const key = "settings.apiEndpoints.models.tests";
  if (run.isCancelling) return t(`${key}.cancelling`);
  if (run.total === null) return t(`${key}.starting`);
  return t(`${key}.progress`, { done: run.done, total: run.total });
}

function ModelsEmptyState({ fetchState }: { fetchState: ModelFetchState }) {
  const { t } = useTranslation();
  if (fetchState.status === "fetching") {
    return (
      <CenteredMessage testID="api-endpoint-models-loading">
        {t("settings.apiEndpoints.models.loading")}
      </CenteredMessage>
    );
  }
  if (fetchState.status === "failed") {
    return (
      <View style={styles.centered}>
        <View style={styles.reason}>
          <Alert
            variant="error"
            size="sm"
            title={t("settings.apiEndpoints.models.fetchFailed")}
            description={fetchState.message}
            testID="api-endpoint-models-failed"
          />
        </View>
      </View>
    );
  }
  return (
    <CenteredMessage testID="api-endpoint-models-empty">
      {t("settings.apiEndpoints.models.empty")}
    </CenteredMessage>
  );
}

// 卡片级的加载与空状态只是一行短字（docs/design.md「Loading」）。
function CenteredMessage({ testID, children }: { testID: string; children: string }) {
  return (
    <View style={styles.centered} testID={testID}>
      <Text color="foregroundMuted" style={styles.centeredText}>
        {children}
      </Text>
    </View>
  );
}

function FamilyItem({
  group,
  isActive,
  isCompact,
  onPress,
}: {
  group: ModelFamilyGroup;
  isActive: boolean;
  isCompact: boolean;
  onPress: (family: ModelFamilyId) => void;
}) {
  const familyName = useFamilyName();
  const handlePress = useCallback(() => onPress(group.family), [group.family, onPress]);
  const itemStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.familyItem,
      (isActive || hovered) && styles.familyItemActive,
      pressed && styles.familyItemPressed,
    ],
    [isActive],
  );
  const accessibilityState = useMemo(() => ({ selected: isActive }), [isActive]);
  return (
    <Pressable
      style={itemStyle}
      onPress={handlePress}
      accessibilityRole="tab"
      accessibilityState={accessibilityState}
      testID={`api-endpoint-model-family-${group.family}`}
    >
      <ModelFamilyIcon family={group.family} size={FAMILY_ICON_SIZE} />
      <Text
        style={isCompact ? null : styles.flex}
        numberOfLines={1}
        weight={isActive ? "medium" : undefined}
      >
        {familyName(group.family)}
      </Text>
      <Text variant="caption" color="foregroundMuted">
        {`${group.selected}/${group.total}`}
      </Text>
    </Pressable>
  );
}

function FamilyModels({
  group,
  onToggle,
  onSelectAll,
  onOpenSettings,
  formatPins,
  modelTests,
  nameOf,
  isCompact,
}: {
  group: ModelFamilyGroup;
  onToggle: (entry: ModelEntry, selected: boolean) => void;
  onSelectAll: (group: ModelFamilyGroup, selected: boolean) => void;
  onOpenSettings: ((modelId: string) => void) | null;
  formatPins: ModelFormatPins | null;
  modelTests: ModelTestsControl | null;
  nameOf: (id: string) => string | undefined;
  isCompact: boolean;
}) {
  const { t } = useTranslation();
  const familyName = useFamilyName();
  const selectAll = familySelectAllState(group);
  const handleSelectAll = useCallback(
    () => onSelectAll(group, selectAll === "selectAll"),
    [group, onSelectAll, selectAll],
  );
  return (
    <View style={styles.modelColumn} testID="api-endpoint-family-models">
      <View style={styles.familyHeader}>
        <ModelFamilyIcon family={group.family} size={FAMILY_ICON_SIZE} />
        <Text weight="medium" numberOfLines={1}>
          {familyName(group.family)}
        </Text>
        <Text variant="caption" color="foregroundMuted" style={styles.flex} numberOfLines={1}>
          {t("settings.apiEndpoints.models.familyCount", {
            selected: group.selected,
            total: group.total,
          })}
        </Text>
        <Button
          variant="ghost"
          size="sm"
          onPress={handleSelectAll}
          testID="api-endpoint-family-select-all"
        >
          {selectAll === "selectAll"
            ? t("settings.apiEndpoints.models.selectAll")
            : t("settings.apiEndpoints.models.selectNone")}
        </Button>
      </View>
      <ScrollView style={styles.flex} testID="api-endpoint-family-model-list">
        {group.matches.map((entry) => (
          <ModelRow
            key={entry.id}
            entry={entry}
            onToggle={onToggle}
            onOpenSettings={onOpenSettings}
            formatPins={formatPins}
            modelTests={modelTests}
            name={nameOf(entry.id)}
            isCompact={isCompact}
          />
        ))}
      </ScrollView>
    </View>
  );
}

function ModelRow({
  entry,
  onToggle,
  onOpenSettings,
  formatPins,
  modelTests,
  name,
  isCompact,
}: {
  entry: ModelEntry;
  onToggle: (entry: ModelEntry, selected: boolean) => void;
  onOpenSettings: ((modelId: string) => void) | null;
  formatPins: ModelFormatPins | null;
  modelTests: ModelTestsControl | null;
  name: string | undefined;
  isCompact: boolean;
}) {
  const { t } = useTranslation();
  const handleChange = useCallback((value: boolean) => onToggle(entry, value), [entry, onToggle]);
  const pinned = formatPins?.pinOf(entry.id) ?? null;
  const test = modelTests?.tests[entry.id] ?? null;
  const showsMarkInline = test !== null && !isCompact;
  return (
    <View style={styles.modelItem} testID={`api-endpoint-model-${entry.id}`}>
      <View style={styles.modelRow}>
        <ModelNameGroup entry={entry} name={name} modelTests={modelTests} />
        {/* 窄窗口里结果挪到名字下面一行，名字不被挤短。 */}
        {showsMarkInline ? <ModelTestMark modelId={entry.id} state={test} /> : null}
        {entry.goneUpstream ? (
          <Text
            variant="caption"
            color="foregroundExtraMuted"
            numberOfLines={1}
            testID={`api-endpoint-model-gone-${entry.id}`}
          >
            {t("settings.apiEndpoints.models.goneUpstream")}
          </Text>
        ) : null}
        {pinned !== null ? (
          <Text
            variant="caption"
            color={pinned.isVoid ? "statusWarning" : "foregroundMuted"}
            numberOfLines={1}
            testID={`api-endpoint-model-format-${entry.id}`}
          >
            {t(
              pinned.isVoid
                ? "settings.apiEndpoints.modelSettings.formatTagVoid"
                : "settings.apiEndpoints.modelSettings.formatTag",
              { format: formatLabel(t, pinned.format) },
            )}
          </Text>
        ) : null}
        <Switch
          value={entry.selected}
          onValueChange={handleChange}
          accessibilityLabel={t("settings.apiEndpoints.models.modelSwitch", { model: entry.id })}
          testID={`api-endpoint-model-switch-${entry.id}`}
        />
        {onOpenSettings ? (
          <ModelRowMenu
            modelId={entry.id}
            onOpenSettings={onOpenSettings}
            onTest={modelTests?.onTestOne ?? null}
            testsAs={modelTests?.testsAs ?? []}
            onTestAs={modelTests?.onTestOneAs ?? null}
            isTesting={modelTests?.run.status === "running"}
            formatPins={formatPins}
            pinned={pinned}
          />
        ) : null}
      </View>
      {test !== null ? (
        <ModelTestBelow modelId={entry.id} state={test} isCompact={isCompact} />
      ) : null}
    </View>
  );
}

/** 模型名，后面是「免费」与上下文小标（老主机没有）。 */
function ModelNameGroup({
  entry,
  name,
  modelTests,
}: {
  entry: ModelEntry;
  name: string | undefined;
  modelTests: ModelTestsControl | null;
}) {
  const { t } = useTranslation();
  const isFree = modelTests !== null && isNamedFree([entry.id, name]);
  let context: string | null = null;
  if (modelTests !== null) {
    const facts = modelTests.factsOf(entry.id);
    context = contextTag({ context: facts.context, name });
  }
  return (
    <View style={styles.modelNameGroup}>
      <Text
        color={entry.selected ? "foreground" : "foregroundMuted"}
        style={styles.modelName}
        numberOfLines={1}
        selectable
      >
        {entry.id}
      </Text>
      {isFree ? (
        <View testID={`api-endpoint-model-free-${entry.id}`}>
          <StatusBadge
            size="xs"
            variant="success"
            label={t("settings.apiEndpoints.models.tests.free")}
          />
        </View>
      ) : null}
      {context !== null ? (
        <View testID={`api-endpoint-model-context-${entry.id}`}>
          <StatusBadge size="xs" label={context} />
        </View>
      ) : null}
    </View>
  );
}

/** 名字下面一行：窄窗口里的测试结果，与失败的原因。 */
function ModelTestBelow({
  modelId,
  state,
  isCompact,
}: {
  modelId: string;
  state: ModelTestState;
  isCompact: boolean;
}) {
  const { t } = useTranslation();
  const result = state.status === "done" ? state.result : null;
  let reason: string | null = null;
  if (result !== null && !result.ok) reason = failureReason({ t, result });
  if (!isCompact && reason === null) return null;
  return (
    <View style={styles.modelBelow}>
      {isCompact ? <ModelTestMark modelId={modelId} state={state} /> : null}
      {reason !== null ? <ReasonText modelId={modelId} reason={reason} /> : null}
    </View>
  );
}

const ThemedGauge = withUnistyles(Gauge);

/** 红绿点，后面是走的格式与耗时；还在测时是灰点。 */
function ModelTestMark({ modelId, state }: { modelId: string; state: ModelTestState }) {
  const { t } = useTranslation();
  const key = "settings.apiEndpoints.models.tests";
  let text = t(`${key}.testing`);
  let dotStyle = styles.dotWaiting;
  let dotKind = "testing";
  if (state.status === "done") {
    const { result } = state;
    dotStyle = result.ok ? styles.dotOk : styles.dotFailed;
    dotKind = result.ok ? "ok" : "failed";
    text = markText({ t, result });
  }
  return (
    <View style={styles.testMark} testID={`api-endpoint-model-test-${modelId}`}>
      <View
        style={[styles.dot, dotStyle]}
        testID={`api-endpoint-model-test-dot-${modelId}-${dotKind}`}
      />
      <Text variant="caption" color="foregroundMuted" numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

/** 原因本身：已禁用、超时、连不上、没有地址用界面语言说；上游的原文照登。 */
function failureCause(t: TFunction, result: ApiEndpointModelTestResult): string {
  const { error } = result;
  const key = "settings.apiEndpoints.models.tests";
  switch (error?.code) {
    case "model_disabled":
      return t(`${key}.disabledReason`, { pattern: error.params?.pattern ?? "" });
    case "upstream_timeout":
      return t(`${key}.timeout`, { seconds: error.params?.seconds ?? "" });
    case "upstream_unreachable":
      return t(`${key}.unreachable`);
    case "batch_timeout":
      return t(`${key}.batchTimeout`);
    case "no_format":
      return t(`${key}.noFormat`);
    case "cli_sample_missing":
      return t(`${key}.claudeCodeSampleMissing`);
    case "invalid_header": {
      const reason = error.params?.reason === "value" ? "value" : "name";
      return headerProblemText(t, { reason, name: error.params?.name ?? "" });
    }
    default:
      return error?.message || t(`${key}.noAnswer`);
  }
}

/** 失败行的原因（照 magpie）：「格式 · 状态码 · 原因」，没发请求的只写原因；模型名不在连字符处折行。 */
function failureReason(input: { t: TFunction; result: ApiEndpointModelTestResult }): string {
  const { t, result } = input;
  const parts: string[] = [];
  if (result.format !== null) parts.push(formatLabel(t, result.format));
  if (result.status !== null) parts.push(String(result.status));
  parts.push(failureCause(t, result));
  return parts.join(" · ");
}

/**
 * 点后面的一句：已禁用就写已禁用；答上的写走的格式（失败的格式与状态码在原因那一行，照 magpie）；
 * 真发过请求的才写耗时。
 */
function markText(input: { t: TFunction; result: ApiEndpointModelTestResult }): string {
  const { t, result } = input;
  const key = "settings.apiEndpoints.models.tests";
  if (result.error?.code === "model_disabled") return t(`${key}.disabled`);
  const parts: string[] = [];
  // 只有答上的格式写在这里。
  const answeredFormat = result.ok ? result.format : null;
  if (answeredFormat !== null) parts.push(formatLabel(t, answeredFormat));
  if (wasAsked(result)) {
    const took = testTook(result.durationMs);
    parts.push(t(`${key}.took.${took.unit}`, { value: took.value }));
  }
  return parts.join(" · ");
}

/** 原因原文照登（复制出来一字不差）；Web 上模型名整段不折行，原生端照常折。 */
function ReasonText({ modelId, reason }: { modelId: string; reason: string }) {
  const pieces = useMemo(() => splitAroundId({ text: reason, id: modelId }), [modelId, reason]);
  return (
    <Text
      variant="caption"
      color="statusDanger"
      numberOfLines={2}
      selectable
      testID={`api-endpoint-model-test-reason-${modelId}`}
    >
      {pieces.map((piece) =>
        piece.isId ? (
          <Text key={piece.offset} variant="caption" color="statusDanger" style={styles.keepWhole}>
            {piece.text}
          </Text>
        ) : (
          <React.Fragment key={piece.offset}>{piece.text}</React.Fragment>
        ),
      )}
    </Text>
  );
}

const ThemedSlidersHorizontal = withUnistyles(SlidersHorizontal);
const ThemedRoute = withUnistyles(Route);

const FORMAT_PAGE = "format";
// 宽到「只用这种格式」带图标与它的值（如「自动」）在一行里放得下，不截断。
const MODEL_MENU_WIDTH = 300;

/** 格式的名字；不起作用的标出来，没设为「自动」。 */
function pinnedFormatLabel(t: TFunction, pinned: ModelFormatPin | null): string {
  if (pinned === null) return t("settings.apiEndpoints.modelSettings.formatAutomatic");
  const label = formatLabel(t, pinned.format);
  if (!pinned.isVoid) return label;
  return t("settings.apiEndpoints.modelSettings.formatNotInEffect", { format: label });
}

/** 模型行的 ⋯ 菜单：「模型设置」，这家有两种以上格式的地址时还有「只用这种格式」一页。 */
function ModelRowMenu({
  modelId,
  onOpenSettings,
  onTest,
  testsAs,
  onTestAs,
  isTesting,
  formatPins,
  pinned,
}: {
  modelId: string;
  onOpenSettings: (modelId: string) => void;
  // 「测试这个」；老主机没有，为 null。
  onTest: ((modelId: string) => void) | null;
  testsAs: OfferedCliTest[];
  onTestAs: ((input: { modelId: string; method: CliTestMethod }) => void) | null;
  isTesting: boolean;
  formatPins: ModelFormatPins | null;
  pinned: ModelFormatPin | null;
}) {
  const { t } = useTranslation();
  const handleOpen = useCallback(() => onOpenSettings(modelId), [modelId, onOpenSettings]);
  const handleTest = useCallback(() => onTest?.(modelId), [modelId, onTest]);
  const testLeading = useMemo(
    () => <ThemedGauge size={ICON_SIZE.md} uniProps={mutedIconColorMapping} />,
    [],
  );
  const formatLeading = useMemo(
    () => <ThemedRoute size={ICON_SIZE.md} uniProps={mutedIconColorMapping} />,
    [],
  );
  const leading = useMemo(
    () => <ThemedSlidersHorizontal size={ICON_SIZE.md} uniProps={mutedIconColorMapping} />,
    [],
  );
  const formatTitle = t("settings.apiEndpoints.modelSettings.format");
  const pages = useMemo<MenuPageDefinition[] | undefined>(() => {
    if (formatPins === null) return undefined;
    // 没有「自动」一行：再点勾着的那个即回到自动（docs/menus.md）。作废的格式这家已没有地址，照样列出、勾着，好在这里取消。
    const isListed = pinned === null || formatPins.formats.includes(pinned.format);
    const formats = isListed ? formatPins.formats : [...formatPins.formats, pinned.format];
    return [
      {
        id: FORMAT_PAGE,
        title: formatTitle,
        content: formats.map((format) => (
          <FormatPinItem
            key={format}
            modelId={modelId}
            format={format}
            selected={format === pinned?.format}
            isVoid={format === pinned?.format && pinned.isVoid}
            onPin={formatPins.onPin}
          />
        )),
      },
    ];
  }, [formatPins, formatTitle, modelId, pinned]);
  const pinnedLabel = pinnedFormatLabel(t, pinned);
  const testAsItems: ReactNode[] = [];
  if (onTestAs !== null) {
    for (const offered of testsAs) {
      testAsItems.push(
        <TestAsItem
          key={offered.method}
          modelId={modelId}
          offered={offered}
          isTesting={isTesting}
          onTestAs={onTestAs}
        />,
      );
    }
  }
  return (
    <DropdownMenu>
      <RowActionsMenuTrigger
        accessibilityLabel={t("settings.apiEndpoints.modelSettings.rowMenu", { model: modelId })}
        testID={`api-endpoint-model-menu-${modelId}`}
      />
      <DropdownMenuContent align="end" width={MODEL_MENU_WIDTH} pages={pages}>
        <DropdownMenuItem
          leading={leading}
          onSelect={handleOpen}
          testID={`api-endpoint-model-settings-open-${modelId}`}
        >
          {t("settings.apiEndpoints.modelSettings.menu")}
        </DropdownMenuItem>
        {onTest ? (
          <DropdownMenuItem
            leading={testLeading}
            onSelect={handleTest}
            disabled={isTesting}
            testID={`api-endpoint-model-test-one-${modelId}`}
          >
            {t("settings.apiEndpoints.models.tests.testOne")}
          </DropdownMenuItem>
        ) : null}
        {testAsItems}
        {pages ? (
          <DropdownMenuSubTrigger
            id={FORMAT_PAGE}
            value={pinnedLabel}
            leading={formatLeading}
            testID={`api-endpoint-model-format-menu-${modelId}`}
          >
            {formatTitle}
          </DropdownMenuSubTrigger>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// 每种 CLI 测法的菜单文字。
const TEST_AS_LABEL_KEYS: Record<CliTestMethod, string> = {
  claude_code: "settings.apiEndpoints.models.tests.testAsClaudeCode",
  codex: "settings.apiEndpoints.models.tests.testAsCodex",
};

/** 现在测不了的原因：认得的用界面语言说，否则照 daemon 的原文。 */
function testAsUnavailableReason(input: {
  t: TFunction;
  unavailable: NonNullable<OfferedCliTest["unavailable"]>;
}): string {
  const { t, unavailable } = input;
  if (unavailable.code === "cli_sample_missing") {
    return t("settings.apiEndpoints.models.tests.claudeCodeSampleMissing");
  }
  return unavailable.message;
}

/** 「按 Claude Code / Codex 的样子测」一项；测不了时点不了，下面写明原因（照 magpie 的行菜单）。 */
function TestAsItem({
  modelId,
  offered,
  isTesting,
  onTestAs,
}: {
  modelId: string;
  offered: OfferedCliTest;
  isTesting: boolean;
  onTestAs: (input: { modelId: string; method: CliTestMethod }) => void;
}) {
  const { t } = useTranslation();
  const { method, unavailable } = offered;
  const handleSelect = useCallback(
    () => onTestAs({ modelId, method }),
    [method, modelId, onTestAs],
  );
  const leading = useMemo(
    () => <ThemedGauge size={ICON_SIZE.md} uniProps={mutedIconColorMapping} />,
    [],
  );
  const labelKey = TEST_AS_LABEL_KEYS[method];
  let description: string | undefined;
  if (unavailable !== null) description = testAsUnavailableReason({ t, unavailable });
  return (
    <DropdownMenuItem
      leading={leading}
      onSelect={handleSelect}
      disabled={isTesting || unavailable !== null}
      description={description}
      explainsFully
      testID={`api-endpoint-model-test-as-${method}-${modelId}`}
    >
      {t(labelKey)}
    </DropdownMenuItem>
  );
}

function FormatPinItem({
  modelId,
  format,
  selected,
  isVoid,
  onPin,
}: {
  modelId: string;
  format: ApiEndpointRequestFormat;
  selected: boolean;
  isVoid: boolean;
  onPin: (modelId: string, format: ApiEndpointRequestFormat | null) => void;
}) {
  const { t } = useTranslation();
  const handleSelect = useCallback(
    () => onPin(modelId, selected ? null : format),
    [format, modelId, onPin, selected],
  );
  return (
    <DropdownMenuItem
      selected={selected}
      onSelect={handleSelect}
      testID={`api-endpoint-model-format-pin-${modelId}-${format}`}
    >
      {pinnedFormatLabel(t, { format, isVoid })}
    </DropdownMenuItem>
  );
}

type AddModelStatus = { kind: "idle" } | { kind: "adding" } | { kind: "failed"; reason: string };

function AddModelRow({
  existing,
  onAdd,
  onClose,
}: {
  existing: ModelEntry[];
  onAdd: (modelIds: string[]) => Promise<string | null>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<AddModelStatus>({ kind: "idle" });
  const isAdding = status.kind === "adding";
  // 逗号或换行分开的几个一次加（照 magpie）；都已手动加过时没什么可加。
  const typedIds = useMemo(() => typedModelIds(draft), [draft]);
  const hasNew = typedIds.some((id) => !existing.some((entry) => entry.id === id && entry.manual));
  const canAdd = !isAdding && hasNew;
  const handleAdd = useCallback(() => {
    if (!canAdd) return;
    setStatus({ kind: "adding" });
    void (async () => {
      const failure = await onAdd(typedIds);
      if (failure === null) onClose();
      else setStatus({ kind: "failed", reason: failure });
    })();
  }, [canAdd, onAdd, onClose, typedIds]);
  const handleKeyPress = useCallback(
    (event: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
      if (event.nativeEvent.key === "Escape" && !isAdding) onClose();
    },
    [isAdding, onClose],
  );
  return (
    <View style={[styles.addRow, settingsStyles.rowBorder]}>
      <View style={styles.addRowControls}>
        <FormTextInput
          size="sm"
          autoFocus
          initialValue=""
          onChangeText={setDraft}
          onSubmitEditing={handleAdd}
          onKeyPress={handleKeyPress}
          editable={!isAdding}
          placeholder={t("settings.apiEndpoints.models.addPlaceholder")}
          accessibilityLabel={t("settings.apiEndpoints.models.add")}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          style={ADD_MODEL_INPUT_STYLE}
          testID="api-endpoint-models-add-input"
        />
        <Button
          variant="default"
          size="sm"
          onPress={handleAdd}
          disabled={!canAdd}
          testID="api-endpoint-models-add-submit"
        >
          {isAdding
            ? t("settings.apiEndpoints.models.adding")
            : t("settings.apiEndpoints.models.addSubmit")}
        </Button>
        <Button variant="ghost" size="sm" onPress={onClose} disabled={isAdding}>
          {t("common.actions.cancel")}
        </Button>
      </View>
      {status.kind === "failed" ? (
        <View testID="api-endpoint-models-add-error">
          <Text variant="caption" color="statusDanger">
            {t("settings.apiEndpoints.detail.saveFailed")}
          </Text>
          {status.reason ? (
            <Text variant="caption" color="statusDanger" selectable>
              {status.reason}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

// 两栏的固定高度：200+ 个模型时右栏在里面滚，左栏不撑出卡片。
// 418 让右栏最后一行露出半行，看得出还能往下滚。
const MODELS_BODY_HEIGHT = 418;

const styles = StyleSheet.create((theme) => ({
  flex: {
    flex: 1,
    minWidth: 0,
  },
  trailing: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flexShrink: 1,
  },
  headerRow: {
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.borderCardRow,
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minHeight: 40,
    paddingHorizontal: theme.spacing[4],
  },
  // 卡片里的无边框输入：焦点只靠光标，不画外框。
  searchInput: {
    flex: 1,
    minWidth: 0,
    paddingVertical: theme.spacing[2],
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    outlineColor: "transparent",
    outlineWidth: 0,
  },
  addRow: {
    gap: theme.spacing[1.5],
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
  },
  addRowControls: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  inlineError: {
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
  },
  body: {
    height: MODELS_BODY_HEIGHT,
    borderTopWidth: 1,
    borderTopColor: theme.colors.borderCardRow,
  },
  columns: {
    flex: 1,
    flexDirection: "row",
  },
  familyColumn: {
    width: 220,
    flexGrow: 0,
    flexShrink: 0,
    borderRightWidth: 1,
    borderRightColor: theme.colors.borderCardRow,
    padding: theme.spacing[2],
  },
  columnsCompact: {
    flex: 1,
  },
  familyRowCompact: {
    flexGrow: 0,
    flexShrink: 0,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.borderCardRow,
  },
  familyRowContent: {
    gap: theme.spacing[1],
    padding: theme.spacing[2],
  },
  familyItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minHeight: 34,
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.radius.md,
  },
  familyItemActive: {
    backgroundColor: theme.colors.surface2,
  },
  familyItemPressed: {
    backgroundColor: theme.colors.surface3,
  },
  modelColumn: {
    flex: 1,
    minWidth: 0,
  },
  familyHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minHeight: 44,
    paddingLeft: theme.spacing[4],
    paddingRight: theme.spacing[2],
  },
  modelItem: {
    paddingHorizontal: theme.spacing[4],
  },
  modelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    minHeight: 36,
  },
  modelNameGroup: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
  },
  modelName: {
    flexShrink: 1,
    minWidth: 0,
  },
  modelBelow: {
    gap: theme.spacing[0.5],
    paddingBottom: theme.spacing[2],
    marginTop: -theme.spacing[1],
  },
  testMark: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
    flexShrink: 0,
  },
  keepWhole: {
    _web: {
      whiteSpace: "nowrap",
    },
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: theme.borderRadius.full,
  },
  dotWaiting: {
    backgroundColor: theme.colors.foregroundExtraMuted,
  },
  dotOk: {
    backgroundColor: theme.colors.statusSuccess,
  },
  dotFailed: {
    backgroundColor: theme.colors.statusDanger,
  },
  filtersRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: theme.spacing[6],
    rowGap: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
  },
  filter: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  testRunRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minHeight: 40,
    paddingHorizontal: theme.spacing[4],
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[6],
  },
  centeredText: {
    textAlign: "center",
  },
  reason: {
    width: "100%",
    maxWidth: 520,
  },
}));
