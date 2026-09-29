import { useCallback, useMemo, useRef, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import {
  Pressable,
  Text,
  View,
  type NativeSyntheticEvent,
  type PressableStateCallbackType,
  type TargetedEvent,
} from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { firstFontFamily } from "@/appearance/font-family-name";
import type { FontProbe } from "@/appearance/font-probe";
import { resolveMonoFontStack, resolveUiFontStack } from "@/appearance/font-stack";
import {
  Combobox,
  ComboboxItem,
  type ComboboxOption,
  type ComboboxProps,
} from "@/components/ui/combobox";
import { SelectFieldTrigger } from "@/components/ui/select-field";
import { useIsCompactFormFactor } from "@/constants/layout";
import { CODE_SURFACE_DATASET } from "@/styles/code-surface";
import { settingsStyles } from "@/styles/settings";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";

// 桌面端和 Web 端的字体选择器：展开时枚举本机字体，每项用自身字体渲染，也可以直接输入字体名。

export type FontPickerKind = "interface" | "code" | "terminal";

type FontWarning = "notInstalled" | "notMonospace";
type RenderOption = NonNullable<ComboboxProps["renderOption"]>;

interface FontPickerKindConfig {
  // 首项的文案：Interface font / Code font 是系统默认，Terminal font 是跟随代码字体。
  defaultLabelKey:
    | "settings.appearance.fonts.systemDefault"
    | "settings.appearance.fonts.followCodeFont";
  // 只列等宽字体，并在填了非等宽字体时提示。
  requireMonospace: boolean;
  // 触发按钮和列表项用来渲染字体的栈。
  resolveFontStack: (value: string) => string;
}

const FONT_PICKER_KINDS: Record<FontPickerKind, FontPickerKindConfig> = {
  interface: {
    defaultLabelKey: "settings.appearance.fonts.systemDefault",
    requireMonospace: false,
    resolveFontStack: resolveUiFontStack,
  },
  code: {
    defaultLabelKey: "settings.appearance.fonts.systemDefault",
    requireMonospace: true,
    resolveFontStack: resolveMonoFontStack,
  },
  terminal: {
    defaultLabelKey: "settings.appearance.fonts.followCodeFont",
    requireMonospace: true,
    resolveFontStack: resolveMonoFontStack,
  },
};

// 首项写入 ""：表示系统默认或跟随代码字体。
const DEFAULT_OPTION_ID = "";
const NO_FAMILIES: readonly string[] = [];
const TRIGGER_FRAME_STYLE = { flexGrow: 1, flexShrink: 1, maxWidth: 280 } as const;

// 只检查用户值里的第一个字体名；提示不阻止保存。
function resolveFontWarning(
  value: string,
  requireMonospace: boolean,
  probe: FontProbe,
): FontWarning | null {
  const family = firstFontFamily(value);
  if (family === null) return null;
  if (!probe.isInstalled(family)) return "notInstalled";
  if (requireMonospace && !probe.isMonospace(family)) return "notMonospace";
  return null;
}

interface FontFamilyOptionProps {
  family: string;
  kind: FontPickerKind;
  selected: boolean;
  active: boolean;
  onPress: () => void;
}

// 界面字体规则会覆盖所有文字的 font-family，带 data-pmono 的子树才能用自己的字体。
function FontFamilyOption({ family, kind, selected, active, onPress }: FontFamilyOptionProps) {
  const labelStyle = useMemo(
    () => inlineUnistylesStyle({ fontFamily: FONT_PICKER_KINDS[kind].resolveFontStack(family) }),
    [family, kind],
  );
  return (
    <View dataSet={CODE_SURFACE_DATASET}>
      <ComboboxItem
        testID={`font-family-option-${family}`}
        label={family}
        labelStyle={labelStyle}
        selected={selected}
        active={active}
        onPress={onPress}
      />
    </View>
  );
}

interface FontPickerTriggerProps {
  kind: FontPickerKind;
  value: string;
  defaultLabel: string;
  hovered: boolean;
  focused: boolean;
  active: boolean;
}

function FontPickerTrigger({
  kind,
  value,
  defaultLabel,
  hovered,
  focused,
  active,
}: FontPickerTriggerProps) {
  const isCompact = useIsCompactFormFactor();
  const labelStyle = useMemo(
    () =>
      value
        ? inlineUnistylesStyle({ fontFamily: FONT_PICKER_KINDS[kind].resolveFontStack(value) })
        : undefined,
    [kind, value],
  );
  return (
    <View dataSet={value ? CODE_SURFACE_DATASET : undefined}>
      <SelectFieldTrigger
        label={value || defaultLabel}
        labelStyle={labelStyle}
        isPlaceholder={false}
        placeholder={defaultLabel}
        hovered={hovered}
        focused={focused}
        active={active}
        size={isCompact ? "md" : "sm"}
      />
    </View>
  );
}

export interface FontPickerRowProps {
  kind: FontPickerKind;
  title: string;
  hint: string;
  accessibilityLabel: string;
  value: string;
  withBorder: boolean;
  probe: FontProbe;
  onChange: (value: string) => void;
}

export function FontPickerRow({
  kind,
  title,
  hint,
  accessibilityLabel,
  value,
  withBorder,
  probe,
  onChange,
}: FontPickerRowProps): ReactElement {
  const { t } = useTranslation();
  const anchorRef = useRef<View>(null);
  const [open, setOpen] = useState(false);
  const [triggerFocused, setTriggerFocused] = useState(false);
  const [families, setFamilies] = useState<readonly string[]>(NO_FAMILIES);
  const { requireMonospace, defaultLabelKey } = FONT_PICKER_KINDS[kind];
  const defaultLabel = t(defaultLabelKey);

  const listedFamilies = useMemo(
    () => (requireMonospace ? families.filter((family) => probe.isMonospace(family)) : families),
    [families, probe, requireMonospace],
  );
  const listedFamilySet = useMemo(() => new Set(listedFamilies), [listedFamilies]);
  const options = useMemo<ComboboxOption[]>(
    () => [
      { id: DEFAULT_OPTION_ID, label: defaultLabel },
      ...listedFamilies.map((family) => ({ id: family, label: family })),
    ],
    [defaultLabel, listedFamilies],
  );
  const warning = useMemo(
    () => resolveFontWarning(value, requireMonospace, probe),
    [probe, requireMonospace, value],
  );

  // 展开本身就是用户手势，Local Font Access API 的授权请求只在这里发起。
  const handlePress = useCallback(() => {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    const loadFamilies = async () => {
      const result = await probe.listFamilies();
      if (result.status === "available") setFamilies(result.families);
    };
    void loadFamilies();
  }, [open, probe]);
  const handleTriggerFocus = useCallback((_event: NativeSyntheticEvent<TargetedEvent>) => {
    setTriggerFocused(true);
  }, []);
  const handleTriggerBlur = useCallback((_event: NativeSyntheticEvent<TargetedEvent>) => {
    setTriggerFocused(false);
  }, []);

  const renderOption = useCallback<RenderOption>(
    ({ option, selected, active, onPress }) => {
      if (listedFamilySet.has(option.id)) {
        return (
          <FontFamilyOption
            family={option.id}
            kind={kind}
            selected={selected}
            active={active}
            onPress={onPress}
          />
        );
      }
      return (
        <ComboboxItem
          testID={
            option.id === DEFAULT_OPTION_ID
              ? "font-picker-default-option"
              : "font-picker-custom-option"
          }
          label={option.label}
          selected={selected}
          active={active}
          onPress={onPress}
        />
      );
    },
    [kind, listedFamilySet],
  );

  return (
    <View style={[settingsStyles.row, withBorder && settingsStyles.rowBorder]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{title}</Text>
        <Text style={settingsStyles.rowHint}>{hint}</Text>
        {warning === "notInstalled" ? (
          <Text style={styles.warning}>{t("settings.appearance.fonts.notInstalledWarning")}</Text>
        ) : null}
        {warning === "notMonospace" ? (
          <Text style={styles.warning}>{t("settings.appearance.fonts.notMonospaceWarning")}</Text>
        ) : null}
      </View>
      <View ref={anchorRef} collapsable={false} style={TRIGGER_FRAME_STYLE}>
        <Pressable
          onPress={handlePress}
          onFocus={handleTriggerFocus}
          onBlur={handleTriggerBlur}
          accessibilityRole="button"
          accessibilityLabel={t("settings.appearance.fonts.pickerAccessibility", {
            field: accessibilityLabel,
            value: value || defaultLabel,
          })}
          testID="font-picker-trigger"
        >
          {({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => (
            <FontPickerTrigger
              kind={kind}
              value={value}
              defaultLabel={defaultLabel}
              hovered={Boolean(hovered)}
              focused={triggerFocused}
              active={pressed || open}
            />
          )}
        </Pressable>
      </View>
      <Combobox
        options={options}
        value={value}
        onSelect={onChange}
        renderOption={renderOption}
        searchPlaceholder={t("settings.appearance.fonts.searchPlaceholder")}
        allowCustomValue
        customValuePrefix={t("settings.appearance.fonts.customValuePrefix")}
        title={title}
        open={open}
        onOpenChange={setOpen}
        anchorRef={anchorRef}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  warning: {
    color: theme.colors.statusWarning,
    ...theme.typeScale.caption,
    marginTop: theme.spacing[0.5],
  },
}));
