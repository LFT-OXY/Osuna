import type { ComponentType, ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import type { ViewportFitOptions, ViewportRect, ViewportSize } from "./geometry";

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
  /** 打开和复位时的位置：center（默认）居中；top 从内容顶部看起，比视口宽时从左边看起。 */
  initialPosition?: "center" | "top";
  /** 缩放控件：hover-icons（默认）右上角悬停出现的图标；zoom-bar 右下角常驻的"− 百分比 + 适应"条。 */
  controls?: "hover-icons" | "zoom-bar";
  /** Web：内容比视口小时也能在视口内拖动，不强制居中；配合 initialPosition="top" 把内容放在顶部。 */
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
  /**
   * Web：内容里要保持可见的一块（按 contentSize 的坐标）。它变了、又不在视口里时平移到刚好看见，
   * 已经看得见就不动；用户之后拖走也不再拉回来。
   */
  revealRect?: ViewportRect | null;
}
