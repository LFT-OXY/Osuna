import React, { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type {
  ApiEndpointImportItem,
  ApiEndpointImportSource,
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
  importRequests,
  initialImportPicks,
  pickedCount,
  renamePick,
  setSourcePicks,
  sourcePickState,
  type ImportChoice,
  type ImportPick,
  type ImportPicks,
} from "./internal/import-picks";
import type { ImportResult, ImportScanState } from "./use-import-apps";

/*
 * 从别的软件导入（照 magpie 的导入窗口 renderImportApps、importAppRow）：每个软件一节，每条一行，
 * 写明在那个软件里的哪儿、地址、打码的 key、模型数与状态；名称撞上的可就地改名，或选「两家都留」「替换原来那家」。
 * 纯 props，扫描与导入在 use-import-apps.ts。
 */

export interface ImportAppsSheetProps {
  scan: ImportScanState;
  onRetry: () => void;
  onImport: (picks: ReturnType<typeof importRequests>) => Promise<ImportResult>;
  onClose: () => void;
}

export function ImportAppsSheet({ scan, onRetry, onImport, onClose }: ImportAppsSheetProps) {
  const { t } = useTranslation();
  const [picks, setPicks] = useState<ImportPicks>({});
  // 每份新的扫描结果重新定默认选择（React 的「渲染时按 props 调整 state」）。
  const [seenAt, setSeenAt] = useState<number | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  if (scan.status === "ready" && scan.updatedAt !== seenAt) {
    setSeenAt(scan.updatedAt);
    setPicks(initialImportPicks(scan.sources));
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
    if (result.status === "failed") setFailure(result.message);
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
            {failure}
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
              onPicks={setPicks}
              onPick={updatePick}
            />
          ))}
        </View>
      ) : null}
    </AdaptiveModalSheet>
  );
}

function ImportSourceSection({
  source,
  picks,
  onPicks,
  onPick,
}: {
  source: ApiEndpointImportSource;
  picks: ImportPicks;
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
  return (
    <View style={styles.section} testID={`api-endpoint-import-source-${source.id}`}>
      <View style={styles.sectionHead}>
        <View style={styles.sectionTitle}>
          <Text variant="label" weight="medium">
            {source.name}
          </Text>
          <Text variant="caption" color="foregroundMuted" selectable>
            {source.path}
          </Text>
        </View>
        {state.pickable > 1 ? (
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

/** 没有条目可列时的一句：没找到、读不了、里面什么都没有；有条目为 null。 */
function sourceEmptyText(input: { t: TFunction; source: ApiEndpointImportSource }): string | null {
  const { t, source } = input;
  if (!source.found) return t("settings.apiEndpoints.import.notFound");
  if (source.error?.code === "unreadable") return t("settings.apiEndpoints.import.unreadable");
  if (source.error) return t("settings.apiEndpoints.import.unparsable");
  if (source.items.length === 0) return t("settings.apiEndpoints.import.noEntries");
  return null;
}

function ImportItemRow({
  item,
  pick,
  hasRowAbove,
  onPick,
}: {
  item: ApiEndpointImportItem;
  // 不能选的（读不了、已添加）为 null。
  pick: ImportPick | null;
  hasRowAbove: boolean;
  onPick: (fingerprint: string, next: ImportPick) => void;
}) {
  const { t } = useTranslation();
  const badge = itemBadge({ t, item });
  const facts = itemFacts({ t, item });
  const handleToggle = useCallback(
    (on: boolean) => {
      if (pick) onPick(item.fingerprint, { ...pick, on });
    },
    [item.fingerprint, onPick, pick],
  );
  const testID = `api-endpoint-import-item-${item.ref}`;
  return (
    <View style={[styles.item, hasRowAbove && settingsStyles.rowBorder]} testID={testID}>
      <View style={styles.itemTop}>
        <View style={styles.iconFrame}>
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
            <StatusBadge label={badge.label} variant={badge.variant} size="xs" />
          </View>
          <Text variant="caption" color="foregroundMuted" selectable>
            {facts}
          </Text>
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
      <ItemDetails item={item} pick={pick} onPick={onPick} testID={testID} />
    </View>
  );
}

/** 状态、原因与名称撞上时的选择，缩进到名称下面。 */
function ItemDetails({
  item,
  pick,
  onPick,
  testID,
}: {
  item: ApiEndpointImportItem;
  pick: ImportPick | null;
  onPick: (fingerprint: string, next: ImportPick) => void;
  testID: string;
}) {
  const { t } = useTranslation();
  const status = importItemStatusOf(item);
  const notes = itemNotes({ t, item, hasPick: pick !== null });
  const showsChoice = pick !== null && status === "name_taken";
  if (notes.length === 0 && !showsChoice) return null;
  return (
    <View style={styles.details}>
      {notes.map((note) => (
        <Text key={note} variant="caption" color="foregroundMuted">
          {note}
        </Text>
      ))}
      {showsChoice && pick ? (
        <NameTakenChoice item={item} pick={pick} onPick={onPick} testID={testID} />
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
  return (
    <View style={styles.choice}>
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

function itemBadge(input: { t: TFunction; item: ApiEndpointImportItem }): {
  label: string;
  variant: StatusBadgeVariant;
} {
  const { t, item } = input;
  if (item.skip !== null) {
    return { label: t("settings.apiEndpoints.import.status.cantImport"), variant: "muted" };
  }
  switch (importItemStatusOf(item)) {
    case "new":
      return { label: t("settings.apiEndpoints.import.status.new"), variant: "success" };
    case "added":
      return { label: t("settings.apiEndpoints.import.status.added"), variant: "muted" };
    case "name_taken":
      return { label: t("settings.apiEndpoints.import.status.nameTaken"), variant: "warning" };
    case "other_key":
      return { label: t("settings.apiEndpoints.import.status.otherKey"), variant: "muted" };
    default:
      return { label: t("settings.apiEndpoints.import.status.cantImport"), variant: "muted" };
  }
}

/** 名称下面的一行：在那个软件里的哪儿、主机、打码的 key、模型数（照 magpie 的 sub）。 */
function itemFacts(input: { t: TFunction; item: ApiEndpointImportItem }): string {
  const { t, item } = input;
  const host = importItemHost(item);
  const facts: string[] = [];
  if (item.from !== null) facts.push(item.from);
  if (host !== null) facts.push(host);
  if (item.maskedKey !== null) facts.push(item.maskedKey);
  if (item.models.length > 0) {
    facts.push(t("settings.apiEndpoints.import.models", { count: item.models.length }));
  }
  return facts.join(" · ");
}

const SKIP_REASONS = [
  "sign_in",
  "no_base_url",
  "invalid_base_url",
  "points_at_osuna",
  "no_api_key",
  "gemini_unsupported",
  "no_azure_endpoint",
] as const;

/** 状态与原因的说明：读不了为什么、对上了哪家、在那个软件里关着。 */
function itemNotes(input: {
  t: TFunction;
  item: ApiEndpointImportItem;
  hasPick: boolean;
}): string[] {
  const { t, item } = input;
  if (item.skip !== null) {
    const reason = SKIP_REASONS.find((candidate) => candidate === item.skip) ?? "unknown";
    return [t(`settings.apiEndpoints.import.skip.${reason}`)];
  }
  const existing = item.existingName ?? "";
  const notes: string[] = [];
  switch (importItemStatusOf(item)) {
    case "added":
      notes.push(t("settings.apiEndpoints.import.notes.added", { name: existing }));
      break;
    case "name_taken":
      notes.push(t("settings.apiEndpoints.import.notes.nameTaken", { name: existing }));
      break;
    case "other_key":
      notes.push(t("settings.apiEndpoints.import.notes.otherKey", { name: existing }));
      break;
    default:
      break;
  }
  if (input.hasPick && item.off === "turned_off") {
    notes.push(t("settings.apiEndpoints.import.notes.turnedOff"));
  }
  return notes;
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
  itemTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[3],
  },
  iconFrame: {
    width: ICON_SIZE.md + theme.spacing[1],
    paddingTop: theme.spacing[0.5],
    alignItems: "center",
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
  // 与名称对齐：图标宽度加间距。
  details: {
    marginLeft: ICON_SIZE.md + theme.spacing[1] + theme.spacing[3],
    gap: theme.spacing[2],
  },
  choice: {
    gap: theme.spacing[2],
    alignItems: "flex-start",
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
