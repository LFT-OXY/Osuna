import React, { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Pressable,
  ScrollView,
  View,
  type NativeSyntheticEvent,
  type PressableStateCallbackType,
  type TextInputKeyPressEventData,
} from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Plus, RotateCw, Search } from "lucide-react-native";
import { AdaptiveTextInput } from "@/components/adaptive-text-input";
import { Alert } from "@/components/ui/alert";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { Button } from "@/components/ui/button";
import { FormTextInput } from "@/components/ui/form-field";
import { mutedIconColorMapping } from "@/components/ui/icon-color";
import { Switch } from "@/components/ui/switch";
import { Text } from "@/components/ui/text";
import { useIsCompactFormFactor } from "@/constants/layout";
import { settingsStyles } from "@/styles/settings";
import { ICON_SIZE } from "@/styles/theme";
import { formatTimeAgo } from "@/utils/time";
import {
  buildModelEntries,
  familySelectAllState,
  groupModelEntries,
  setFamilySelected,
  setModelSelected,
  type ModelEntry,
  type ModelFamilyGroup,
  type ModelSource,
} from "./internal/endpoint-models";
import { MODEL_FAMILIES, type ModelFamilyId } from "./internal/model-families";
import { ModelFamilyIcon } from "./model-family-icon";
import type { ModelFetchState } from "./use-endpoint-detail";

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
  now: Date;
  onFetch: () => void;
  onChange: (next: Pick<ModelSource, "models" | "manualModels">) => void;
  // 返回失败原因，成功为 null；添加行据此收起或留在原处显示原因。
  onAdd: (modelId: string) => Promise<string | null>;
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
  now,
  onFetch,
  onChange,
  onAdd,
}: ApiEndpointModelsSectionProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [activeFamily, setActiveFamily] = useState<ModelFamilyId | null>(null);
  const [isAddOpen, setIsAddOpen] = useState(false);
  // 窄窗口里两栏会把家族名和模型名都截短：家族改成上面一行可横滑的标签，模型在下面占满宽。
  const isCompact = useIsCompactFormFactor();
  const entries = useMemo(() => buildModelEntries(source), [source]);
  const groups = useMemo(() => groupModelEntries(entries, query), [entries, query]);
  const active = groups.find((group) => group.family === activeFamily) ?? groups[0] ?? null;
  const selectedCount = entries.filter((entry) => entry.selected).length;
  const isFetching = fetchState.status === "fetching";
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

  const trailing = useMemo(
    () => (
      <View style={isCompact ? styles.trailingCompact : styles.trailing}>
        {fetchedAt ? (
          <Text variant="caption" color="foregroundMuted" numberOfLines={isCompact ? undefined : 1}>
            {t("settings.apiEndpoints.models.fetchedAt", {
              time: formatTimeAgo(new Date(fetchedAt), now),
            })}
          </Text>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          leftIcon={RotateCw}
          loading={isFetching}
          disabled={isFetching}
          onPress={onFetch}
          testID="api-endpoint-models-refetch"
        >
          {isFetching
            ? t("settings.apiEndpoints.models.fetching")
            : t("settings.apiEndpoints.models.refetch")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          leftIcon={Plus}
          onPress={openAdd}
          testID="api-endpoint-models-add"
        >
          {t("settings.apiEndpoints.models.add")}
        </Button>
      </View>
    ),
    [fetchedAt, isCompact, isFetching, now, onFetch, openAdd, t],
  );

  let body: React.ReactNode;
  if (entries.length === 0) {
    body = <ModelsEmptyState fetchState={fetchState} />;
  } else if (!active) {
    body = (
      <CenteredMessage testID="api-endpoint-models-no-matches">
        {t("settings.apiEndpoints.models.noMatches", { query: query.trim() })}
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
      trailing={trailing}
      testID="api-endpoint-models-section"
    >
      <View style={settingsStyles.card}>
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
        {isAddOpen ? <AddModelRow existing={entries} onAdd={onAdd} onClose={closeAdd} /> : null}
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
}: {
  group: ModelFamilyGroup;
  onToggle: (entry: ModelEntry, selected: boolean) => void;
  onSelectAll: (group: ModelFamilyGroup, selected: boolean) => void;
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
          <ModelRow key={entry.id} entry={entry} onToggle={onToggle} />
        ))}
      </ScrollView>
    </View>
  );
}

function ModelRow({
  entry,
  onToggle,
}: {
  entry: ModelEntry;
  onToggle: (entry: ModelEntry, selected: boolean) => void;
}) {
  const { t } = useTranslation();
  const handleChange = useCallback((value: boolean) => onToggle(entry, value), [entry, onToggle]);
  return (
    <View style={styles.modelRow} testID={`api-endpoint-model-${entry.id}`}>
      <Text
        color={entry.selected ? "foreground" : "foregroundMuted"}
        style={styles.modelName}
        numberOfLines={1}
        selectable
      >
        {entry.id}
      </Text>
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
      <Switch
        value={entry.selected}
        onValueChange={handleChange}
        accessibilityLabel={t("settings.apiEndpoints.models.modelSwitch", { model: entry.id })}
        testID={`api-endpoint-model-switch-${entry.id}`}
      />
    </View>
  );
}

type AddModelStatus = { kind: "idle" } | { kind: "adding" } | { kind: "failed"; reason: string };

function AddModelRow({
  existing,
  onAdd,
  onClose,
}: {
  existing: ModelEntry[];
  onAdd: (modelId: string) => Promise<string | null>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<AddModelStatus>({ kind: "idle" });
  const trimmed = draft.trim();
  const isAdding = status.kind === "adding";
  const isAlreadyAdded = existing.some((entry) => entry.id === trimmed && entry.manual);
  const canAdd = !isAdding && trimmed.length > 0 && !isAlreadyAdded;
  const handleAdd = useCallback(() => {
    if (!canAdd) return;
    setStatus({ kind: "adding" });
    void (async () => {
      const failure = await onAdd(trimmed);
      if (failure === null) onClose();
      else setStatus({ kind: "failed", reason: failure });
    })();
  }, [canAdd, onAdd, onClose, trimmed]);
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
  // 窄窗口：放不下就换行，不截断「拉取于 …」。
  trailingCompact: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "flex-end",
    columnGap: theme.spacing[2],
    flexShrink: 1,
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
  modelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    minHeight: 36,
    paddingHorizontal: theme.spacing[4],
  },
  modelName: {
    flex: 1,
    minWidth: 0,
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
