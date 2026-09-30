import { ChevronDown, Info, TriangleAlert } from "lucide-react-native";
import type { TFunction } from "i18next";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { ProviderSnapshotEntry, ProviderStatus } from "@getpaseo/protocol/agent-types";
import type { ProviderMentionDefaults } from "@getpaseo/protocol/provider-config";
import { getProviderIcon } from "@/components/provider-icons";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { DropdownTrigger } from "@/components/ui/dropdown-trigger";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { extractFailureReason } from "@/price-table/pricing";
import { useHostFeatureAvailability } from "@/runtime/host-features";
import { settingsStyles } from "@/styles/settings";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import {
  MENTION_DEFAULTS_FIELDS,
  applyMentionDefaultsPick,
  buildMentionDefaultsProviderModel,
  type MentionDefaultsField,
  type MentionDefaultsFieldModel,
  type MentionDefaultsFieldView,
  type MentionDefaultsPickNotice,
  type MentionDefaultsSummary,
} from "./mention-defaults-model";

const NOTICE_DURATION_MS = 4000;

const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedInfo = withUnistyles(Info);
const ThemedTriangleAlert = withUnistyles(TriangleAlert);
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);

const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const warningColorMapping = (theme: Theme) => ({ color: theme.colors.statusWarning });

interface FieldCopyKeys {
  title: string;
  accessibilityLabel: string;
}

const FIELD_COPY_KEYS = {
  model: {
    title: "settings.host.mentionDefaults.model",
    accessibilityLabel: "settings.host.mentionDefaults.modelAccessibilityLabel",
  },
  thinkingOptionId: {
    title: "settings.host.mentionDefaults.thinking",
    accessibilityLabel: "settings.host.mentionDefaults.thinkingAccessibilityLabel",
  },
  modeId: {
    title: "settings.host.mentionDefaults.mode",
    accessibilityLabel: "settings.host.mentionDefaults.modeAccessibilityLabel",
  },
} as const satisfies Record<MentionDefaultsField, FieldCopyKeys>;

type SaveMentionDefaults = (provider: string, next: ProviderMentionDefaults) => Promise<void>;

interface FieldNote {
  key: string;
  tone: "muted" | "warning" | "danger";
  text: string;
}

function defaultOptionLabel(t: TFunction, defaultLabel: string | null): string {
  return defaultLabel
    ? t("settings.host.mentionDefaults.defaultWithValue", { value: defaultLabel })
    : t("settings.host.mentionDefaults.default");
}

function triggerLabel(t: TFunction, view: MentionDefaultsFieldView): string {
  switch (view.kind) {
    case "unresolved":
      return view.storedValue ?? t("settings.host.mentionDefaults.default");
    case "unsupported":
      return t("settings.host.mentionDefaults.unsupported");
    case "default":
      return defaultOptionLabel(t, view.defaultLabel);
    case "set":
      return view.label;
    case "stale":
      return view.storedValue;
  }
}

function summaryText(t: TFunction, summary: MentionDefaultsSummary): string {
  switch (summary.kind) {
    case "loading":
      return t("settings.host.mentionDefaults.summaryLoading");
    case "unavailable":
      return t("settings.host.mentionDefaults.summaryUnavailable");
    case "allDefault":
      return t("settings.host.mentionDefaults.summaryAllDefault");
    case "values": {
      const othersDefault = summary.othersDefault
        ? [t("settings.host.mentionDefaults.summaryOthersDefault")]
        : [];
      return [...summary.parts, ...othersDefault].join(" · ");
    }
  }
}

function noticeText(t: TFunction, notice: MentionDefaultsPickNotice): string {
  if (notice.kind === "thinkingUnsupported") {
    return t("settings.host.mentionDefaults.thinkingUnsupported", { model: notice.modelLabel });
  }
  return notice.defaultLabel
    ? t("settings.host.mentionDefaults.thinkingReset", { value: notice.defaultLabel })
    : t("settings.host.mentionDefaults.thinkingResetNoLabel");
}

interface FieldNotesInput {
  t: TFunction;
  field: MentionDefaultsField;
  view: MentionDefaultsFieldView;
  status: ProviderStatus;
  notice: MentionDefaultsPickNotice | null;
}

interface StaleValue {
  storedValue: string;
  fallbackLabel: string | null;
}

function staleText(t: TFunction, view: StaleValue): string {
  if (view.fallbackLabel === null) {
    return t("settings.host.mentionDefaults.staleIgnored", { value: view.storedValue });
  }
  return t("settings.host.mentionDefaults.staleWithFallback", {
    value: view.storedValue,
    fallback: view.fallbackLabel,
  });
}

function fieldNotes(input: FieldNotesInput): FieldNote[] {
  const { t, field, view } = input;
  const notes: FieldNote[] = [];
  if (view.kind === "stale") {
    notes.push({ key: "stale", tone: "warning", text: staleText(t, view) });
  }
  if (field === "model" && input.status === "error") {
    notes.push({
      key: "catalogError",
      tone: "danger",
      text: t("settings.host.mentionDefaults.catalogError"),
    });
  }
  if (field === "thinkingOptionId" && input.notice) {
    notes.push({ key: "notice", tone: "muted", text: noticeText(t, input.notice) });
  }
  return notes;
}

/** 选择后短暂显示的联动提示；再次选择时重新计时。 */
function useFlashNotice(): [
  MentionDefaultsPickNotice | null,
  (notice: MentionDefaultsPickNotice) => void,
] {
  const [notice, setNotice] = useState<MentionDefaultsPickNotice | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );
  const show = useCallback((next: MentionDefaultsPickNotice) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setNotice(next);
    timerRef.current = setTimeout(() => setNotice(null), NOTICE_DURATION_MS);
  }, []);
  return [notice, show];
}

/** 一次保存的状态；失败时留着要写的值，重试原样再写一次。 */
type SaveStatus =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "failed"; message: string; next: ProviderMentionDefaults };

interface SaveState {
  status: SaveStatus;
  run: (next: ProviderMentionDefaults) => void;
  retry: () => void;
}

function useMentionDefaultsSave(provider: string, onSave: SaveMentionDefaults): SaveState {
  const [status, setStatus] = useState<SaveStatus>({ kind: "idle" });
  const run = useCallback(
    (next: ProviderMentionDefaults) => {
      setStatus({ kind: "saving" });
      onSave(provider, next)
        .then(() => setStatus({ kind: "idle" }))
        .catch((error: unknown) => {
          console.error("[MentionDefaults] Failed to save mention defaults", error);
          const message = extractFailureReason(error) || String(error);
          setStatus({ kind: "failed", message, next });
        });
    },
    [onSave, provider],
  );
  const retry = useCallback(() => {
    if (status.kind === "failed") run(status.next);
  }, [run, status]);
  return { status, run, retry };
}

export function MentionDefaultsSection({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const supportsAgentMentions = useHostFeatureAvailability(serverId, "agentMentions");
  if (supportsAgentMentions === null) return null;

  return (
    <SettingsSection
      title={t("settings.host.mentionDefaults.title")}
      info={t("settings.host.mentionDefaults.info")}
      testID="mention-defaults-section"
    >
      {supportsAgentMentions ? (
        <MentionDefaultsCard serverId={serverId} />
      ) : (
        <View style={settingsStyles.card}>
          <View style={settingsStyles.row}>
            <Text style={settingsStyles.rowTitle}>
              {t("settings.host.mentionDefaults.hostOutdated")}
            </Text>
          </View>
        </View>
      )}
    </SettingsSection>
  );
}

function MentionDefaultsCard({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const { config, patchConfig } = useDaemonConfig(serverId);
  const snapshot = useProvidersSnapshot(serverId);
  const entries = useMemo(
    () => snapshot.entries?.filter((entry) => entry.enabled !== false) ?? null,
    [snapshot.entries],
  );
  // daemon 整体替换 mentionDefaults，所以每次都写整份。
  const save = useCallback<SaveMentionDefaults>(
    async (provider, next) => {
      await patchConfig({ providers: { [provider]: { mentionDefaults: next } } });
    },
    [patchConfig],
  );

  if (!config || !entries) {
    return (
      <View style={[settingsStyles.card, styles.loadingCard]}>
        <ThemedLoadingSpinner uniProps={mutedColorMapping} />
      </View>
    );
  }

  const toolsOff = config.mcp.injectIntoAgents === false;
  return (
    <View style={settingsStyles.card} testID="mention-defaults-card">
      {toolsOff ? (
        <View style={[settingsStyles.row, styles.noticeRow]} testID="mention-defaults-tools-off">
          <ThemedInfo size={ICON_SIZE.sm} uniProps={mutedColorMapping} />
          <Text style={[settingsStyles.rowHint, styles.noticeText]}>
            {t("settings.host.mentionDefaults.toolsOff")}
          </Text>
        </View>
      ) : null}
      {entries.length === 0 ? (
        <View style={[settingsStyles.row, toolsOff && settingsStyles.rowBorder]}>
          <Text style={settingsStyles.rowHint}>
            {t("settings.host.mentionDefaults.noProviders")}
          </Text>
        </View>
      ) : null}
      {entries.map((entry, index) => (
        <MentionDefaultsProviderRow
          key={entry.provider}
          serverId={serverId}
          entry={entry}
          stored={config.providers[entry.provider]?.mentionDefaults}
          bordered={toolsOff || index > 0}
          onSave={save}
        />
      ))}
    </View>
  );
}

interface ProviderRowProps {
  serverId: string;
  entry: ProviderSnapshotEntry;
  stored: ProviderMentionDefaults | undefined;
  bordered: boolean;
  onSave: SaveMentionDefaults;
}

function MentionDefaultsProviderRow({
  serverId,
  entry,
  stored,
  bordered,
  onSave,
}: ProviderRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [notice, showNotice] = useFlashNotice();
  const {
    status: saveStatus,
    run: runSave,
    retry: retrySave,
  } = useMentionDefaultsSave(entry.provider, onSave);
  const model = useMemo(() => buildMentionDefaultsProviderModel(entry, stored), [entry, stored]);
  const providerLabel = entry.label ?? entry.provider;
  const isSaving = saveStatus.kind === "saving";

  const handleToggle = useCallback(() => setExpanded((current) => !current), []);
  const handlePick = useCallback(
    (field: MentionDefaultsField, value: string | null) => {
      const result = applyMentionDefaultsPick({ entry, stored, field, value });
      if (result.notice) showNotice(result.notice);
      runSave(result.next);
    },
    [entry, runSave, showNotice, stored],
  );
  const handleResetAll = useCallback(() => runSave({}), [runSave]);

  return (
    <View testID={`mention-defaults-row-${entry.provider}`}>
      <ProviderRowHeader
        serverId={serverId}
        provider={entry.provider}
        label={providerLabel}
        summary={model.summary}
        hasStale={model.hasStale}
        expanded={expanded}
        bordered={bordered}
        onToggle={handleToggle}
      />
      {expanded ? (
        <View style={styles.fields}>
          {MENTION_DEFAULTS_FIELDS.map((field, index) => (
            <MentionDefaultsFieldRow
              key={field}
              provider={entry.provider}
              providerLabel={providerLabel}
              field={field}
              fieldModel={model.fields[field]}
              status={model.status}
              notice={field === "thinkingOptionId" ? notice : null}
              disabled={isSaving}
              bordered={index > 0}
              onPick={handlePick}
            />
          ))}
          <ProviderRowFooter
            provider={entry.provider}
            hasOverrides={model.hasOverrides}
            isSaving={isSaving}
            failureMessage={saveStatus.kind === "failed" ? saveStatus.message : null}
            onResetAll={handleResetAll}
            onRetry={retrySave}
          />
        </View>
      ) : null}
    </View>
  );
}

interface ProviderRowHeaderProps {
  serverId: string;
  provider: string;
  label: string;
  summary: MentionDefaultsSummary;
  hasStale: boolean;
  expanded: boolean;
  bordered: boolean;
  onToggle: () => void;
}

function ProviderRowHeader({
  serverId,
  provider,
  label,
  summary,
  hasStale,
  expanded,
  bordered,
  onToggle,
}: ProviderRowHeaderProps) {
  const { t } = useTranslation();
  const providerIcon = getProviderIcon(provider, serverId);
  const ThemedProviderIcon = useMemo(() => withUnistyles(providerIcon), [providerIcon]);
  const rowStyle = useCallback(
    ({ pressed, hovered }: PressableStateCallbackType & { hovered?: boolean }) => [
      settingsStyles.row,
      bordered && settingsStyles.rowBorder,
      hovered && styles.headerHovered,
      pressed && styles.headerPressed,
    ],
    [bordered],
  );
  const accessibilityState = useMemo(() => ({ expanded }), [expanded]);

  return (
    <Pressable
      style={rowStyle}
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      accessibilityLabel={t("settings.host.mentionDefaults.rowAccessibilityLabel", {
        provider: label,
      })}
      testID={`mention-defaults-toggle-${provider}`}
    >
      <View style={styles.headerContent}>
        <View style={settingsStyles.rowIconFrame}>
          <ThemedProviderIcon size={ICON_SIZE.md} uniProps={foregroundColorMapping} />
        </View>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle} numberOfLines={1}>
            {label}
          </Text>
          <View style={styles.summaryRow}>
            {hasStale ? (
              <ThemedTriangleAlert size={ICON_SIZE.xs} uniProps={warningColorMapping} />
            ) : null}
            <Text
              style={[settingsStyles.rowHint, styles.summaryText, hasStale && styles.warningText]}
              numberOfLines={1}
              testID={`mention-defaults-summary-${provider}`}
            >
              {summaryText(t, summary)}
            </Text>
          </View>
        </View>
      </View>
      <View style={expanded ? styles.chevronOpen : undefined}>
        <ThemedChevronDown size={ICON_SIZE.sm} uniProps={mutedColorMapping} />
      </View>
    </Pressable>
  );
}

interface FieldRowProps {
  provider: string;
  providerLabel: string;
  field: MentionDefaultsField;
  fieldModel: MentionDefaultsFieldModel;
  status: ProviderStatus;
  notice: MentionDefaultsPickNotice | null;
  disabled: boolean;
  bordered: boolean;
  onPick: (field: MentionDefaultsField, value: string | null) => void;
}

function MentionDefaultsFieldRow({
  provider,
  providerLabel,
  field,
  fieldModel,
  status,
  notice,
  disabled,
  bordered,
  onPick,
}: FieldRowProps) {
  const { t } = useTranslation();
  const { view } = fieldModel;
  const notes = fieldNotes({ t, field, view, status, notice });
  const label = triggerLabel(t, view);
  const isStale = view.kind === "stale";
  const isDisabled = disabled || status !== "ready" || view.kind === "unsupported";

  return (
    <View style={[settingsStyles.row, styles.fieldRow, bordered && settingsStyles.rowBorder]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{t(FIELD_COPY_KEYS[field].title)}</Text>
        {notes.map((note) => (
          <Text key={note.key} style={noteStyle(note.tone)}>
            {note.text}
          </Text>
        ))}
      </View>
      <DropdownMenu>
        <DropdownTrigger
          disabled={isDisabled}
          tone={isStale ? "warning" : undefined}
          accessibilityRole="button"
          accessibilityLabel={t(FIELD_COPY_KEYS[field].accessibilityLabel, {
            provider: providerLabel,
          })}
          testID={`mention-defaults-${provider}-${field}`}
        >
          {status === "loading" ? <ThemedLoadingSpinner uniProps={mutedColorMapping} /> : null}
          {isStale ? (
            <ThemedTriangleAlert size={ICON_SIZE.xs} uniProps={warningColorMapping} />
          ) : null}
          <Text style={styles.triggerText} numberOfLines={1}>
            {label}
          </Text>
        </DropdownTrigger>
        <DropdownMenuContent
          side="bottom"
          align="end"
          minWidth={220}
          maxWidth={360}
          maxHeight={360}
          scrollable
        >
          <FieldMenuItem
            field={field}
            value={null}
            label={defaultOptionLabel(t, fieldModel.defaultLabel)}
            selected={view.kind === "default"}
            onPick={onPick}
          />
          <DropdownMenuSeparator />
          {isStale ? (
            <DropdownMenuItem selected>
              {t("settings.host.mentionDefaults.unavailableOption", { value: view.storedValue })}
            </DropdownMenuItem>
          ) : null}
          {fieldModel.options.map((option) => (
            <FieldMenuItem
              key={option.id}
              field={field}
              value={option.id}
              label={option.label}
              selected={fieldModel.selectedId === option.id}
              onPick={onPick}
            />
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </View>
  );
}

function noteStyle(tone: FieldNote["tone"]) {
  if (tone === "danger") return settingsStyles.rowError;
  if (tone === "warning") return [settingsStyles.rowHint, styles.warningText];
  return settingsStyles.rowHint;
}

interface FieldMenuItemProps {
  field: MentionDefaultsField;
  value: string | null;
  label: string;
  selected: boolean;
  onPick: (field: MentionDefaultsField, value: string | null) => void;
}

function FieldMenuItem({ field, value, label, selected, onPick }: FieldMenuItemProps) {
  const handleSelect = useCallback(() => onPick(field, value), [field, onPick, value]);
  return (
    <DropdownMenuItem selected={selected} onSelect={handleSelect}>
      {label}
    </DropdownMenuItem>
  );
}

interface ProviderRowFooterProps {
  provider: string;
  hasOverrides: boolean;
  isSaving: boolean;
  failureMessage: string | null;
  onResetAll: () => void;
  onRetry: () => void;
}

function ProviderRowFooter({
  provider,
  hasOverrides,
  isSaving,
  failureMessage,
  onResetAll,
  onRetry,
}: ProviderRowFooterProps) {
  const { t } = useTranslation();
  if (!failureMessage && !hasOverrides) return null;
  return (
    <View style={styles.footer}>
      {failureMessage ? (
        <View style={styles.failure}>
          <Text
            accessibilityRole="alert"
            style={[settingsStyles.rowError, styles.failureText]}
            testID={`mention-defaults-save-error-${provider}`}
          >
            {t("settings.host.mentionDefaults.saveFailed", { error: failureMessage })}
          </Text>
          <Button variant="outline" size="sm" onPress={onRetry} disabled={isSaving}>
            {t("settings.host.mentionDefaults.retry")}
          </Button>
        </View>
      ) : null}
      {hasOverrides ? (
        <Button variant="ghost" size="sm" onPress={onResetAll} disabled={isSaving}>
          {t("settings.host.mentionDefaults.resetAll")}
        </Button>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  loadingCard: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 56,
  },
  noticeRow: {
    justifyContent: "flex-start",
    gap: theme.spacing[2],
  },
  noticeText: {
    flex: 1,
    marginTop: 0,
  },
  headerContent: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  headerHovered: {
    backgroundColor: theme.colors.surface2,
  },
  headerPressed: {
    backgroundColor: theme.colors.surface3,
  },
  summaryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    marginTop: theme.spacing[0.5],
  },
  summaryText: {
    flexShrink: 1,
    marginTop: 0,
  },
  warningText: {
    color: theme.colors.statusWarning,
  },
  chevronOpen: {
    transform: [{ rotate: "180deg" }],
  },
  // 展开的设置行对齐到 provider 名称的文字线：行内边距 + 图标框 + 图标与名称的间距。
  fields: {
    paddingLeft: theme.spacing[4] + 28 + theme.spacing[3],
  },
  fieldRow: {
    paddingLeft: 0,
  },
  triggerText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    maxWidth: 240,
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    flexWrap: "wrap",
    gap: theme.spacing[2],
    paddingRight: theme.spacing[4],
    paddingBottom: theme.spacing[3],
  },
  failure: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  failureText: {
    flex: 1,
    marginTop: 0,
  },
}));
