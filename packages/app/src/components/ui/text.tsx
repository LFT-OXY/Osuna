import React from "react";
import {
  Text as RNText,
  type StyleProp,
  type TextProps as RNTextProps,
  type TextStyle,
} from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { TextVariant } from "@/styles/theme";

/** 文字三级（主、次、弱）加语义色。其余颜色不是文字该用的颜色。 */
export type TextColor =
  | "foreground"
  | "foregroundMuted"
  | "foregroundExtraMuted"
  | "statusSuccess"
  | "statusDanger"
  | "statusWarning"
  | "statusMerged"
  | "accentBright";

export type TextWeight = "normal" | "medium" | "semibold";

// 字号、行高、颜色、字重只能经 variant / color / weight 给出，style 只管布局。
type TextOwnedStyleKey = "color" | "fontSize" | "lineHeight" | "fontWeight";
type TextLayoutStyle = Omit<TextStyle, TextOwnedStyleKey> & {
  [Key in TextOwnedStyleKey]?: never;
};

export interface TextProps extends Omit<RNTextProps, "style"> {
  variant?: TextVariant;
  color?: TextColor;
  weight?: TextWeight;
  style?: StyleProp<TextLayoutStyle>;
}

/**
 * 文字基础组件。字号与行高取自 variant 对应的 `theme.typeScale`，外观设置里的界面字号会在
 * 运行时整体换算它。
 */
export function Text({
  variant = "body",
  color = "foreground",
  weight = "normal",
  style,
  ...props
}: TextProps) {
  return (
    <RNText
      {...props}
      style={[variantStyles[variant], colorStyles[color], weightStyles[weight], style]}
    />
  );
}

const variantStyles = StyleSheet.create((theme) => ({
  micro: { ...theme.typeScale.micro },
  caption: { ...theme.typeScale.caption },
  label: { ...theme.typeScale.label },
  body: { ...theme.typeScale.body },
  "body-lg": { ...theme.typeScale["body-lg"] },
  "title-sm": { ...theme.typeScale["title-sm"] },
  title: { ...theme.typeScale.title },
  "title-lg": { ...theme.typeScale["title-lg"] },
  display: { ...theme.typeScale.display },
  prose: { ...theme.typeScale.prose },
}));

const colorStyles = StyleSheet.create((theme) => ({
  foreground: { color: theme.colors.foreground },
  foregroundMuted: { color: theme.colors.foregroundMuted },
  foregroundExtraMuted: { color: theme.colors.foregroundExtraMuted },
  statusSuccess: { color: theme.colors.statusSuccess },
  statusDanger: { color: theme.colors.statusDanger },
  statusWarning: { color: theme.colors.statusWarning },
  statusMerged: { color: theme.colors.statusMerged },
  accentBright: { color: theme.colors.accentBright },
}));

const weightStyles = StyleSheet.create((theme) => ({
  normal: { fontWeight: theme.fontWeight.normal },
  medium: { fontWeight: theme.fontWeight.medium },
  semibold: { fontWeight: theme.fontWeight.semibold },
}));
