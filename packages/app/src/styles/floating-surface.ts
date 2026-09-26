import type { Theme } from "@/styles/theme";

// t3code 的 surface-glass 与 dialog-backdrop。模糊值两种配色相同：样式工厂里按 colorScheme
// 分支不会随主题切换重算（docs/unistyles.md）。
const GLASS_BACKDROP_FILTER = "blur(12px) saturate(1.14)";
const DIALOG_SCRIM_BACKDROP_FILTER = "blur(4px)";

// RN 的 ViewStyle 没有 backdropFilter；react-native-web 与 Unistyles 的 Web 端都原样输出为 CSS，
// 所以返回值不标 ViewStyle，交给 StyleSheet.create 推断。

interface SurfaceFillOptions {
  /** 传 `GLASS_SURFACES_ENABLED`；这里保持纯函数，两条路径都能在 browser 测试里断言。 */
  glass: boolean;
}

/** 菜单、Combobox 弹层、对话框卡片与 Composer 的底色。 */
export function floatingSurfaceFill(theme: Theme, { glass }: SurfaceFillOptions) {
  if (!glass) {
    return { backgroundColor: theme.colors.surfaceCard };
  }
  return {
    backgroundColor: theme.colors.surfaceGlass,
    backdropFilter: GLASS_BACKDROP_FILTER,
  };
}

/** 对话框遮罩。Web 上轻微模糊背后的内容，原生端只有半透明黑。 */
export function dialogScrimFill(theme: Theme, { glass }: SurfaceFillOptions) {
  if (!glass) {
    return { backgroundColor: theme.colors.overlayScrim };
  }
  return {
    backgroundColor: theme.colors.overlayScrim,
    backdropFilter: DIALOG_SCRIM_BACKDROP_FILTER,
  };
}

/**
 * 菜单与 Combobox 弹层的整块外观：毛玻璃（或不透明）底色、圆角 10、1px 边框、浮层投影，
 * 暗色主题再叠一道顶部内高光（亮色主题的 insetHighlight 为 transparent）。
 */
export function popoverSurfaceStyle(theme: Theme, options: SurfaceFillOptions) {
  return {
    ...floatingSurfaceFill(theme, options),
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    borderRadius: theme.radius.lg,
    boxShadow: `0 16px 40px -18px ${theme.colors.shadowPopover}, inset 0 1px 0 ${theme.colors.insetHighlight}`,
  };
}

/**
 * Composer 输入面：与浮层同一种（毛玻璃或不透明）底色，但描边是半透明的 `borderComposer`，
 * 叠在毛玻璃上随背后内容变化；亮色投下 Composer 阴影，暗色只有顶部内高光。
 */
export function composerSurfaceStyle(theme: Theme, options: SurfaceFillOptions) {
  return {
    ...floatingSurfaceFill(theme, options),
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.borderComposer,
    borderRadius: theme.radius["3xl"],
    boxShadow: `0 12px 28px -18px ${theme.colors.shadowComposer}, inset 0 1px 0 ${theme.colors.insetHighlight}`,
  };
}
