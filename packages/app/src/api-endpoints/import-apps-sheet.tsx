// 从别的软件导入的窗口移植自 magpie（https://github.com/yetone/magpie，internal/gui/assets/app.js 的 openImportApps、renderImportApps、importAppRow）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。
import React, { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Text as RNText, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import {
  API_ENDPOINT_IMPORT_SOURCE_ERROR_CODES,
  type ApiEndpointImportItem,
  type ApiEndpointImportSource,
} from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { SettingsInfoTip } from "@/components/settings/headings/settings-info-tip";
import { Button } from "@/components/ui/button";
import { FormTextInput } from "@/components/ui/form-field";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { StatusBadge, type StatusBadgeVariant } from "@/components/ui/status-badge";
import { Switch } from "@/components/ui/switch";
import { Text } from "@/components/ui/text";
import { settingsStyles } from "@/styles/settings";
import { ICON_SIZE } from "@/styles/theme";
import { EndpointIcon } from "./endpoint-icon";
import {
  choosePick,
  importChoices,
  importItemHost,
  importItemStatusOf,
  importSkipReasonOf,
  importRequests,
  initialImportPicks,
  pickedCount,
  renamePick,
  setSourcePicks,
  sourcePickState,
  type ImportChoice,
  type ImportPick,
  type ImportPicks,
  type OfferedFingerprints,
} from "./internal/import-picks";
import type { ImportResult, ImportScanState } from "./use-import-apps";

/*
 * 从别的软件导入（照 magpie 的导入窗口 renderImportApps、importAppRow）：每个软件一节，每条一行，
 * 写明在那个软件里的哪儿、地址、打码的 key、模型数与状态；名称撞上的可就地改名，或选「两家都留」「替换原来那家」。
 * 纯 props，扫描与导入在 use-import-apps.ts。
 */

export interface ImportAppsSheetProps {
  scan: ImportScanState;
  // 从发现提示「查看」打开时提示里的那几条：只选上它们；从「导入」按钮打开时为 null。
  offered: OfferedFingerprints;
  onRetry: () => void;
  onImport: (picks: ReturnType<typeof importRequests>) => Promise<ImportResult>;
  onClose: () => void;
}

export function ImportAppsSheet({
  scan,
  offered,
  onRetry,
  onImport,
  onClose,
}: ImportAppsSheetProps) {
  const { t } = useTranslation();
  const [picks, setPicks] = useState<ImportPicks>({});
  // 每份新的扫描结果重新定默认选择（React 的「渲染时按 props 调整 state」）。
  const [seenAt, setSeenAt] = useState<number | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [failure, setFailure] = useState<ImportFailure | null>(null);
  if (scan.status === "ready" && scan.updatedAt !== seenAt) {
    setSeenAt(scan.updatedAt);
    setPicks(initialImportPicks({ sources: scan.sources, offered }));
  }
  const sources = scan.status === "ready" ? scan.sources : null;
  const count = pickedCount(picks);
  let countText = "";
  if (count > 0) countText = t("settings.apiEndpoints.import.selected", { count });
  const handleImport = useCallback(async () => {
    if (sources === null) return;
    setIsImporting(true);
    setFailure(null);
    const result = await onImport(importRequests({ sources, picks }));
    setIsImporting(false);
    if (result.status === "failed") {
      setFailure({ message: result.message, fingerprint: result.failedFingerprint });
    }
  }, [onImport, picks, sources]);
  const updatePick = useCallback(
    (fingerprint: string, next: ImportPick) =>
      setPicks((current) => ({ ...current, [fingerprint]: next })),
    [],
  );

  const header = useMemo<SheetHeader>(() => {
    const title = t("settings.apiEndpoints.import.title");
    return {
      title,
      titleAccessory: (
        <SettingsInfoTip
          title={title}
          info={t("settings.apiEndpoints.import.info")}
          side="bottom"
          testID="api-endpoint-import-info"
        />
      ),
    };
  }, [t]);

  const footer = useMemo(
    () => (
      <View style={styles.footer}>
        {failure ? (
          <Text
            variant="caption"
            color="statusDanger"
            selectable
            testID="api-endpoint-import-error"
          >
            {failure.message}
          </Text>
        ) : null}
        <View style={styles.actions}>
          <Text variant="caption" color="foregroundMuted" style={styles.grow}>
            {countText}
          </Text>
          <Button variant="secondary" size="sm" onPress={onClose} disabled={isImporting}>
            {t("common.actions.cancel")}
          </Button>
          <Button
            variant="default"
            size="sm"
            onPress={handleImport}
            disabled={count === 0}
            loading={isImporting}
            testID="api-endpoint-import-submit"
          >
            {t("settings.apiEndpoints.import.submit")}
          </Button>
        </View>
      </View>
    ),
    [count, countText, failure, handleImport, isImporting, onClose, t],
  );

  return (
    <AdaptiveModalSheet
      header={header}
      visible
      onClose={onClose}
      desktopMaxWidth={640}
      snapPoints={SNAP_POINTS}
      footer={footer}
      testID="api-endpoint-import-sheet"
    >
      {scan.status === "loading" ? (
        <Text color="foregroundMuted" testID="api-endpoint-import-loading">
          {t("settings.apiEndpoints.import.reading")}
        </Text>
      ) : null}
      {scan.status === "error" ? (
        <View style={styles.failed} testID="api-endpoint-import-scan-error">
          <Text color="statusDanger" selectable>
            {t("settings.apiEndpoints.import.scanFailed", { message: scan.message })}
          </Text>
          <Button variant="outline" size="sm" onPress={onRetry}>
            {t("settings.apiEndpoints.import.retry")}
          </Button>
        </View>
      ) : null}
      {sources ? (
        <View style={styles.body}>
          {sources.map((source) => (
            <ImportSourceSection
              key={source.id}
              source={source}
              picks={picks}
              failure={failure}
              onPicks={setPicks}
              onPick={updatePick}
            />
          ))}
        </View>
      ) : null}
    </AdaptiveModalSheet>
  );
}

/** 导入停在了哪一条、为什么；整个请求失败时 fingerprint 为 null。 */
interface ImportFailure {
  message: string;
  fingerprint: string | null;
}

function ImportSourceSection({
  source,
  picks,
  failure,
  onPicks,
  onPick,
}: {
  source: ApiEndpointImportSource;
  picks: ImportPicks;
  failure: ImportFailure | null;
  onPicks: (next: ImportPicks) => void;
  onPick: (fingerprint: string, next: ImportPick) => void;
}) {
  const { t } = useTranslation();
  const state = sourcePickState({ source, picks });
  const isAllOn = state.pickable > 0 && state.on === state.pickable;
  const handleAll = useCallback(
    (on: boolean) => onPicks(setSourcePicks({ source, picks, on })),
    [onPicks, picks, source],
  );
  const emptyText = sourceEmptyText({ t, source });
  // 能导入的条数；没找到、读不了时是「–」（magpie 的标签页数字）。
  const isReadable = source.found && source.error === null;
  const countLabel = isReadable ? String(state.pickable) : "–";
  return (
    <View style={styles.section} testID={`api-endpoint-import-source-${source.id}`}>
      <View style={styles.sectionHead}>
        <View style={styles.sectionTitle}>
          <View style={styles.sourceNameLine}>
            <RNText style={settingsStyles.sectionHeaderTitle}>{source.name}</RNText>
            <RNText
              style={[settingsStyles.sectionHeaderTitle, styles.sourceCount]}
              testID={`api-endpoint-import-source-${source.id}-count`}
            >
              {countLabel}
            </RNText>
          </View>
          <Text variant="caption" color="foregroundMuted" selectable>
            {source.path}
          </Text>
        </View>
        {state.pickable > 0 ? (
          <View style={styles.selectAll}>
            <Text variant="caption" color="foregroundMuted">
              {t("settings.apiEndpoints.import.selectAll")}
            </Text>
            <Switch
              value={isAllOn}
              onValueChange={handleAll}
              accessibilityLabel={t("settings.apiEndpoints.import.selectAllLabel", {
                app: source.name,
              })}
              testID={`api-endpoint-import-source-${source.id}-all`}
            />
          </View>
        ) : null}
      </View>
      {emptyText === null ? (
        <View style={settingsStyles.card}>
          {source.items.map((item, index) => (
            <ImportItemRow
              key={item.fingerprint}
              item={item}
              pick={picks[item.fingerprint] ?? null}
              failedBecause={failure?.fingerprint === item.fingerprint ? failure.message : null}
              hasRowAbove={index > 0}
              onPick={onPick}
            />
          ))}
        </View>
      ) : (
        <Text
          variant="caption"
          color={source.error ? "statusDanger" : "foregroundMuted"}
          selectable
          testID={`api-endpoint-import-source-${source.id}-empty`}
        >
          {emptyText}
        </Text>
      )}
    </View>
  );
}

/** 没有条目可列时的一句：没找到、读不了（按 daemon 说的原因）、里面什么都没有；有条目为 null。 */
function sourceEmptyText(input: { t: TFunction; source: ApiEndpointImportSource }): string | null {
  const { t, source } = input;
  if (!source.found) return t("settings.apiEndpoints.import.notFound");
  if (source.error) {
    const code = API_ENDPOINT_IMPORT_SOURCE_ERROR_CODES.find(
      (known) => known === source.error?.code,
    );
    if (code === undefined) return source.error.message;
    return t(`settings.apiEndpoints.import.sourceErrors.${code}`, {
      errno: source.error.params?.errno ?? "",
      node: source.error.params?.node ?? "",
    });
  }
  if (source.items.length === 0) return t("settings.apiEndpoints.import.noEntries");
  return null;
}

function ImportItemRow({
  item,
  pick,
  failedBecause,
  hasRowAbove,
  onPick,
}: {
  item: ApiEndpointImportItem;
  // 不能选的（读不了、已添加）为 null。
  pick: ImportPick | null;
  // 上次导入停在这一条时的原因。
  failedBecause: string | null;
  hasRowAbove: boolean;
  onPick: (fingerprint: string, next: ImportPick) => void;
}) {
  const { t } = useTranslation();
  const standing = itemStanding({ t, item, hasPick: pick !== null });
  const facts = itemFacts({ t, item });
  const handleToggle = useCallback(
    (on: boolean) => {
      if (pick) onPick(item.fingerprint, { ...pick, on });
    },
    [item.fingerprint, onPick, pick],
  );
  const testID = `api-endpoint-import-item-${item.ref}`;
  const showsChoice = pick !== null && importItemStatusOf(item) === "name_taken";
  return (
    <View style={[styles.item, hasRowAbove && settingsStyles.rowBorder]} testID={testID}>
      <View style={styles.itemTop}>
        <View style={settingsStyles.rowIconFrame}>
          <EndpointIcon
            icon={null}
            templateId={item.templateId}
            name={item.name}
            size={ICON_SIZE.md}
            initialVariant="label"
          />
        </View>
        <View style={styles.itemText}>
          <View style={styles.nameLine}>
            <Text weight="medium">{item.name}</Text>
            <StatusBadge label={standing.label} variant={standing.variant} size="xs" />
          </View>
          <View style={styles.facts}>
            {facts.map((fact, index) => (
              <Text
                key={fact.text}
                variant="caption"
                color="foregroundMuted"
                selectable
                style={fact.isUnbroken ? styles.unbroken : null}
              >
                {index > 0 ? `· ${fact.text}` : fact.text}
              </Text>
            ))}
          </View>
        </View>
        {pick ? (
          <Switch
            value={pick.on}
            onValueChange={handleToggle}
            accessibilityLabel={t("settings.apiEndpoints.import.pickLabel", { name: item.name })}
            testID={`${testID}-pick`}
          />
        ) : null}
      </View>
      {standing.notes.length > 0 || showsChoice || failedBecause !== null ? (
        <View style={styles.details}>
          {standing.notes.map((note) => (
            <Text key={note} variant="caption" color="foregroundMuted">
              {note}
            </Text>
          ))}
          {failedBecause !== null ? (
            <Text variant="caption" color="statusDanger" selectable testID={`${testID}-failed`}>
              {failedBecause}
            </Text>
          ) : null}
          {showsChoice && pick ? (
            <NameTakenChoice item={item} pick={pick} onPick={onPick} testID={testID} />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function NameTakenChoice({
  item,
  pick,
  onPick,
  testID,
}: {
  item: ApiEndpointImportItem;
  pick: ImportPick;
  onPick: (fingerprint: string, next: ImportPick) => void;
  testID: string;
}) {
  const { t } = useTranslation();
  const choices = importChoices(item, pick);
  const options = useMemo<SegmentedControlOption<ImportChoice>[]>(
    () =>
      choices.map((choice) => ({
        value: choice,
        label: t(`settings.apiEndpoints.import.choices.${choice}`),
        testID: `${testID}-${choice}`,
      })),
    [choices, t, testID],
  );
  const handleChoice = useCallback(
    (choice: ImportChoice) => onPick(item.fingerprint, choosePick(pick, choice)),
    [item.fingerprint, onPick, pick],
  );
  const handleName = useCallback(
    (name: string) => onPick(item.fingerprint, renamePick({ item, pick, name })),
    [item, onPick, pick],
  );
  // 开关关着时淡下去：改名或选一种进来法会把它选上。
  return (
    <View style={[styles.choice, !pick.on && styles.choiceIdle]}>
      <FormTextInput
        initialValue={pick.name}
        onChangeText={handleName}
        accessibilityLabel={t("settings.apiEndpoints.import.nameLabel")}
        placeholder={t("settings.apiEndpoints.form.namePlaceholder")}
        autoCorrect={false}
        size="sm"
        testID={`${testID}-name`}
      />
      {/* 改了名只能新增一家：不用再选。 */}
      {choices.length > 1 ? (
        <SegmentedControl
          options={options}
          value={pick.choice}
          onValueChange={handleChoice}
          size="sm"
          testID={`${testID}-choice`}
        />
      ) : null}
    </View>
  );
}

/**
 * 这条的状态标记与说明（一次按状态分开）：读不了为什么、对上了哪家、在那个软件里关着。
 * 能导入的（新的、同一家 key 不同的）是绿色，名称撞上的是警告色，已添加与不能导入是灰色。
 */
interface ItemStanding {
  label: string;
  variant: StatusBadgeVariant;
  notes: string[];
}

function itemStanding(input: {
  t: TFunction;
  item: ApiEndpointImportItem;
  hasPick: boolean;
}): ItemStanding {
  const { t, item } = input;
  const cantImport = t("settings.apiEndpoints.import.status.cantImport");
  if (item.skip !== null) {
    const reason = importSkipReasonOf(item);
    return {
      label: cantImport,
      variant: "muted",
      notes: [t(`settings.apiEndpoints.import.skip.${reason}`)],
    };
  }
  const existing = item.existingName ?? "";
  const otherKey = item.otherKeyName ?? null;
  const notes: string[] = [];
  let label = cantImport;
  let variant: StatusBadgeVariant = "muted";
  switch (importItemStatusOf(item)) {
    case "new":
      label = t("settings.apiEndpoints.import.status.new");
      variant = "success";
      break;
    case "added":
      label = t("settings.apiEndpoints.import.status.added");
      notes.push(t("settings.apiEndpoints.import.notes.added", { name: existing }));
      break;
    case "name_taken":
      label = t("settings.apiEndpoints.import.status.nameTaken");
      variant = "warning";
      notes.push(t("settings.apiEndpoints.import.notes.nameTaken", { name: existing }));
      if (otherKey !== null) {
        notes.push(t("settings.apiEndpoints.import.notes.otherKey", { name: otherKey }));
      }
      break;
    case "other_key":
      label = t("settings.apiEndpoints.import.status.otherKey");
      variant = "success";
      notes.push(t("settings.apiEndpoints.import.notes.otherKey", { name: existing }));
      break;
    default:
      break;
  }
  if (input.hasPick && item.off === "turned_off") {
    notes.push(t("settings.apiEndpoints.import.notes.turnedOff"));
  }
  return { label, variant, notes };
}

/**
 * 名称下面的一行（照 magpie 的 sub）：在那个软件里的哪儿、主机、打码的 key、模型数，只在「·」处换行；
 * 打码的 key 整个不断开。
 */
interface ImportFact {
  text: string;
  // 整段不断开（打码的 key、模型数）。
  isUnbroken: boolean;
}

function itemFacts(input: { t: TFunction; item: ApiEndpointImportItem }): ImportFact[] {
  const { t, item } = input;
  const host = importItemHost(item);
  const facts: ImportFact[] = [];
  if (item.from !== null) facts.push({ text: item.from, isUnbroken: false });
  if (host !== null) facts.push({ text: host, isUnbroken: false });
  if (item.maskedKey !== null) facts.push({ text: item.maskedKey, isUnbroken: true });
  if (item.models.length > 0) {
    const text = t("settings.apiEndpoints.import.models", { count: item.models.length });
    facts.push({ text, isUnbroken: true });
  }
  return facts;
}

const SNAP_POINTS = ["90%"];

const styles = StyleSheet.create((theme) => ({
  body: {
    gap: theme.spacing[6],
  },
  failed: {
    gap: theme.spacing[3],
    alignItems: "flex-start",
  },
  section: {
    gap: theme.spacing[2],
  },
  sectionHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
  },
  sectionTitle: {
    flexShrink: 1,
    gap: theme.spacing[0.5],
  },
  sourceNameLine: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: theme.spacing[2],
  },
  selectAll: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  item: {
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
  },
  // 与 SettingsSection 标题后的数字同色。
  sourceCount: {
    color: theme.colors.foregroundExtraMuted,
  },
  itemTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[3],
  },
  itemText: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing[0.5],
  },
  nameLine: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: theme.spacing[2],
    rowGap: theme.spacing[1],
  },
  facts: {
    flexDirection: "row",
    flexWrap: "wrap",
    columnGap: theme.spacing[1],
  },
  // 整段不断开：放不下就整段换到下一行。
  unbroken: {
    flexShrink: 0,
  },
  // 与名称对齐：图标宽度加间距。
  details: {
    marginLeft: ICON_SIZE.md + theme.spacing[1] + theme.spacing[3],
    gap: theme.spacing[2],
  },
  choice: {
    gap: theme.spacing[2],
    alignItems: "flex-start",
  },
  choiceIdle: {
    opacity: 0.5,
  },
  footer: {
    flex: 1,
    gap: theme.spacing[2],
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  grow: {
    flex: 1,
  },
}));
