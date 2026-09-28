import type { KeyboardEvent } from "react";

// View 上只在 Web 生效的键盘属性；react-native-web 会把 onKeyDown 转给 DOM。
export interface ThinkingSliderKeyboardProps {
  onKeyDown?: (event: KeyboardEvent) => void;
}

// 原生没有键盘事件，增减只走读屏的 increment / decrement。
export function thinkingSliderKeyboardProps(
  _onStep: (delta: 1 | -1) => void,
): ThinkingSliderKeyboardProps {
  return {};
}
