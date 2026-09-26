import type { RefCallback } from "react";
import type { View } from "react-native";

/** 原生端的扫光由 useRetainedPanelActive 暂停，这里不需要观察视口。 */
export function useShimmerVisibilityRef(): RefCallback<View> | undefined {
  return undefined;
}
