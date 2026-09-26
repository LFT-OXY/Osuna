import { StyleSheet } from "react-native-unistyles";
import type { SurfaceBackdrop } from "@/styles/surface-backdrop";

// 挖空元素（状态环、项目图标上的状态徽标、行上盖住 trailing 的悬停操作）用它填上身后表面的
// 颜色。新增一个 backdrop 名称只改这里。
const styles = StyleSheet.create((theme) => ({
  surface0: { backgroundColor: theme.colors.surface0 },
  surface1: { backgroundColor: theme.colors.surface1 },
  surface2: { backgroundColor: theme.colors.surface2 },
  surfaceSidebar: { backgroundColor: theme.colors.surfaceSidebar },
  surfaceSidebarHover: { backgroundColor: theme.colors.surfaceSidebarHover },
  surfaceSidebarActive: { backgroundColor: theme.colors.surfaceSidebarActive },
  surfaceSidebarSelected: { backgroundColor: theme.colors.surfaceSidebarSelected },
}));

export function getSurfaceBackdropFillStyle(backdrop: SurfaceBackdrop) {
  return styles[backdrop];
}
