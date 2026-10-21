import React from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Text } from "@/components/ui/text";
import { SettingsInfoTip } from "@/components/settings/headings/settings-info-tip";

/**
 * 添加 / 编辑窗口里请求头、附加请求体、key 放在哪个头、不校验证书与冷却设置共用的字段标签：主前景色的文字，
 * 旁边的信息提示往下开，不盖住上一行。`title` 给提示的无障碍名称，缺省是标签本身。
 */
export function AdvancedFieldLabel({
  label,
  info,
  testID,
  title,
}: {
  label: string;
  info: string;
  testID: string;
  title?: string;
}) {
  return (
    <View style={styles.labelRow}>
      <Text style={styles.labelText}>{label}</Text>
      <SettingsInfoTip title={title ?? label} info={info} testID={testID} side="bottom" />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  labelText: {
    flexShrink: 1,
  },
}));
