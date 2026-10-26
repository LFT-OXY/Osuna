import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { type LayoutChangeEvent, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet } from "react-native-unistyles";
import {
  ACCOUNT_LIMIT_MAX,
  ACCOUNT_LIMIT_MIN,
  isWholeAccountWindow,
  type ProviderAccount,
  type ProviderAccountWindow,
} from "@getpaseo/protocol/provider-account/rpc-schemas";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { useIsCompactFormFactor } from "@/constants/layout";

/*
 * 「设上限」：这个号每个窗口一个 1–99 的百分比输入框，可清空（清空是不设，按 98% 换走）。
 * 只列整个号的窗口：ID 带「:」的是某个模型或功能自己的窗口，主机换号时不看它（rotation-rules.ts）。
 * 保存中、保存失败都留在框里；成功由 view.tsx 关掉。
 */

const KEY = "settings.providers.accounts.limits";
const SHEET_WIDTH = 440;
const UNMEASURED_SNAP_POINTS = ["50%"];
// 手机上正文以外的高度：把手、标题栏、正文上下留白、底部按钮栏（同风险提示）。
const COMPACT_SHEET_CHROME_HEIGHT = 192;
const MAX_SNAP_PERCENT = 90;
// 普通对象：FormTextInput 拆样式时要读得到值。
// 窄窗口 md 尺寸下也装得下各语言的「默认 98」（最长是俄文）。
const INPUT_STYLE = { width: 128 };

export interface ProviderAccountLimitsSheetProps {
  account: ProviderAccount;
  saving: boolean;
  // 上次保存失败的原因。
  error: string | null;
  onSave: (limits: Record<string, number>) => void;
  onClose: () => void;
}

/** 能设上限的窗口：读到过额度，且是整个号的窗口。 */
export function limitWindows(account: ProviderAccount): ProviderAccountWindow[] {
  if (account.usage.status !== "read") return [];
  return account.usage.windows.filter(isWholeAccountWindow);
}

type Drafts = Record<string, string>;

/** 每个框：空是不设；1–99 的整数是上限；别的不能存。 */
function parseDrafts(drafts: Drafts): Record<string, number> | null {
  const limits: Record<string, number> = {};
  for (const [id, text] of Object.entries(drafts)) {
    const trimmed = text.trim();
    if (trimmed === "") continue;
    if (!/^\d+$/.test(trimmed)) return null;
    const value = Number(trimmed);
    if (value < ACCOUNT_LIMIT_MIN || value > ACCOUNT_LIMIT_MAX) return null;
    limits[id] = value;
  }
  return limits;
}

/** 一个框里的字不能存：不是空的，也不是 1–99 的整数。 */
function invalidDraft(text: string): boolean {
  return parseDrafts({ single: text }) === null;
}

export function ProviderAccountLimitsSheet(props: ProviderAccountLimitsSheetProps) {
  const { account, saving, error, onSave, onClose } = props;
  const { t } = useTranslation();
  const windows = useMemo(() => limitWindows(account), [account]);
  const [drafts, setDrafts] = useState<Drafts>(() =>
    Object.fromEntries(
      windows.map((window) => [window.id, account.limits?.[window.id]?.toString() ?? ""]),
    ),
  );
  const { height: windowHeight } = useWindowDimensions();
  const { bottom: safeAreaBottom } = useSafeAreaInsets();
  const [bodyHeight, setBodyHeight] = useState<number | null>(null);
  const handleBodyLayout = useCallback(
    (event: LayoutChangeEvent) => setBodyHeight(event.nativeEvent.layout.height),
    [],
  );
  const snapPoints = useMemo(() => {
    if (bodyHeight === null || windowHeight <= 0) return UNMEASURED_SNAP_POINTS;
    const needed = COMPACT_SHEET_CHROME_HEIGHT + bodyHeight + safeAreaBottom;
    return [`${Math.min(MAX_SNAP_PERCENT, Math.ceil((needed / windowHeight) * 100))}%`];
  }, [bodyHeight, safeAreaBottom, windowHeight]);
  const email = account.email ?? t("settings.providers.accounts.unknownEmail");
  const header = useMemo<SheetHeader>(() => ({ title: t(`${KEY}.title`, { email }) }), [email, t]);
  const parsed = useMemo(() => parseDrafts(drafts), [drafts]);
  const changeDraft = useCallback(
    (windowId: string, text: string) => setDrafts((current) => ({ ...current, [windowId]: text })),
    [],
  );
  const save = useCallback(() => {
    if (parsed) onSave(parsed);
  }, [onSave, parsed]);
  const footer = useMemo(
    () => (
      <View style={styles.actions}>
        <Button variant="secondary" size="sm" onPress={onClose} testID="account-limits-cancel">
          {t("common.actions.cancel")}
        </Button>
        <Button
          variant="default"
          size="sm"
          onPress={save}
          disabled={saving || parsed === null || windows.length === 0}
          loading={saving}
          testID="account-limits-save"
        >
          {saving ? t(`${KEY}.saving`) : t(`${KEY}.save`)}
        </Button>
      </View>
    ),
    [onClose, parsed, save, saving, t, windows.length],
  );
  return (
    <AdaptiveModalSheet
      header={header}
      visible
      onClose={onClose}
      footer={footer}
      desktopMaxWidth={SHEET_WIDTH}
      snapPoints={snapPoints}
      testID="account-limits"
    >
      <View style={styles.body} onLayout={handleBodyLayout}>
        <Text style={styles.hint}>{t(`${KEY}.hint`)}</Text>
        {windows.length === 0 ? (
          <Text style={styles.hint} testID="account-limits-no-windows">
            {t(`${KEY}.noWindows`)}
          </Text>
        ) : null}
        {windows.map((window) => (
          <LimitField
            key={window.id}
            window={window}
            value={drafts[window.id] ?? ""}
            editable={!saving}
            onChange={changeDraft}
          />
        ))}
        {error ? (
          <Text style={styles.error} testID="account-limits-error">
            {t(`${KEY}.saveFailed`, { reason: error })}
          </Text>
        ) : null}
      </View>
    </AdaptiveModalSheet>
  );
}

function LimitField(props: {
  window: ProviderAccountWindow;
  value: string;
  editable: boolean;
  onChange: (windowId: string, text: string) => void;
}) {
  const { window, value, editable, onChange } = props;
  const { t } = useTranslation();
  const change = useCallback((text: string) => onChange(window.id, text), [onChange, window.id]);
  const invalid = invalidDraft(value);
  // 表单尺寸：桌面 sm、窄窗口 md（docs/forms.md）。
  const isCompact = useIsCompactFormFactor();
  return (
    <Field
      label={window.label}
      error={invalid ? t(`${KEY}.invalid`) : null}
      testID={`account-limits-field-${window.id}`}
    >
      <View style={styles.inputRow}>
        <FormTextInput
          initialValue={value}
          onChangeText={change}
          placeholder={t(`${KEY}.placeholder`)}
          keyboardType="number-pad"
          inputMode="numeric"
          autoCorrect={false}
          editable={editable}
          invalid={invalid}
          size={isCompact ? "md" : "sm"}
          style={INPUT_STYLE}
          accessibilityLabel={t(`${KEY}.inputLabel`, { window: window.label })}
          testID={`account-limits-input-${window.id}`}
        />
        <Text style={styles.unit}>%</Text>
      </View>
    </Field>
  );
}

const styles = StyleSheet.create((theme) => ({
  body: {
    gap: theme.spacing[4],
  },
  hint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  error: {
    color: theme.colors.statusDanger,
    fontSize: theme.fontSize.sm,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  unit: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  actions: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
}));
