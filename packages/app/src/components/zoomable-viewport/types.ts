import type { ComponentType, ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import type { ViewportFitOptions, ViewportPoint, ViewportSize } from "./geometry";

export interface ZoomableViewportAction {
  icon: ComponentType<{ size?: number; color?: string }>;
  label: string;
  onPress: () => void;
  testID?: string;
}

export interface ZoomableViewportProps {
  contentSize: ViewportSize;
  children: ReactNode;
  actions?: ZoomableViewportAction[];
  accessibilityLabel?: string;
  fit?: ViewportFitOptions;
  /** 打开和复位时放到视口顶边正中的内容点（按 contentSize 计）；不填则内容居中。 */
  initialTopCenter?: ViewportPoint;
  /** Web：内容比视口小时也能在视口内拖动，不强制居中；配合 initialTopCenter 把内容放在顶部。 */
  panWithinViewport?: boolean;
  /** 子元素按 contentSize 排版、整体缩放到适配尺寸；不填则子元素直接按适配后的尺寸排版。 */
  renderAtContentSize?: boolean;
  maxScale?: number;
  minScale?: number;
  onPressOutsideContent?: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  wheelActivation?: "always" | "modifier";
  /** Web：不按修饰键滚动滚轮时平移内容（配合 wheelActivation="modifier"）。 */
  wheelPan?: boolean;
}
