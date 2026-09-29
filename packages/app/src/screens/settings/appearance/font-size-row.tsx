import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Undo2 } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import { FormTextInput } from "@/components/ui/form-field";
import { useIsCompactFormFactor } from "@/constants/layout";
import { settingsStyles } from "@/styles/settings";

const FONT_SIZE_INPUT_STYLE = { width: 64, textAlign: "right" } as const;

interface FontSizeRowProps {
  title: string;
  hint: string;
  accessibilityLabel: string;
  draft: string;
  placeholder?: string;
  withBorder?: boolean;
  // 已提交的值不等于默认值时才显示重置按钮。
  showReset: boolean;
  onChangeDraft: (value: string) => void;
  // 提交和重置都要把 draft 改成规范化后的值，输入框随后换成新的 draft。
  onCommit: () => void;
  onReset: () => void;
}

export function FontSizeRow({
  title,
  hint,
  accessibilityLabel,
  draft,
  placeholder,
  withBorder = true,
  showReset,
  onChangeDraft,
  onCommit,
  onReset,
}: FontSizeRowProps) {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  // FormTextInput 只在挂载时读 initialValue；每次提交或重置后换 resetKey，让框内文字
  // 换成 clamp 或重置后的 draft。
  const [resetKey, setResetKey] = useState(0);

  const handleCommit = useCallback(() => {
    onCommit();
    setResetKey((key) => key + 1);
  }, [onCommit]);

  const handleReset = useCallback(() => {
    onReset();
    setResetKey((key) => key + 1);
  }, [onReset]);

  return (
    <View style={[settingsStyles.row, withBorder && settingsStyles.rowBorder]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{title}</Text>
        <Text style={settingsStyles.rowHint}>{hint}</Text>
      </View>
      <View style={styles.sizeField}>
        {/* 重置按钮放在输入框左侧，出现与消失时输入框和单位不移动。 */}
        {showReset ? (
          <Button
            variant="ghost"
            size="sm"
            leftIcon={Undo2}
            onPress={handleReset}
            accessibilityLabel={t("settings.appearance.fonts.resetSizeAccessibility", {
              field: title,
            })}
            testID="font-size-reset"
          />
        ) : null}
        <FormTextInput
          size={isCompact ? "md" : "sm"}
          initialValue={draft}
          resetKey={resetKey}
          onChangeText={onChangeDraft}
          onBlur={handleCommit}
          onSubmitEditing={handleCommit}
          keyboardType="number-pad"
          inputMode="numeric"
          selectTextOnFocus
          placeholder={placeholder}
          placeholderTextColor={styles.placeholderColor.color}
          style={FONT_SIZE_INPUT_STYLE}
          accessibilityLabel={accessibilityLabel}
        />
        <Text style={styles.unit}>px</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  sizeField: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  unit: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  placeholderColor: {
    color: theme.colors.foregroundMuted,
  },
}));
