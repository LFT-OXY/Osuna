import type { SurfaceBackdrop } from "@/styles/surface-backdrop";

/** The surface a tab rail paints: a pane header or the Explorer sidebar. */
export type WorkspaceTabRailSurface = "surface" | "sidebar";

/**
 * The fill of a tab chip, named as the surface token it paints so the chip style and everything
 * knocking out of it (the running-status ring, the trailing-action scrim) agree.
 *
 * Both rails share the tab ladder (resting, filled: hovered or active in an unfocused pane, selected)
 * so Explorer tabs and workspace tabs read as the same control; only the resting fill follows the
 * rail.
 */
export function resolveWorkspaceTabChipBackdrop({
  rail,
  isActiveFocused,
  isFilled,
}: {
  rail: WorkspaceTabRailSurface;
  isActiveFocused: boolean;
  isFilled: boolean;
}): SurfaceBackdrop {
  // 不用上游侧栏的 surfaceSidebarHover/Selected：Explorer 标签要与工作区标签同一种选中态。
  if (isActiveFocused) return "surfaceTabActive";
  if (isFilled) return "surfaceTabHover";
  return rail === "sidebar" ? "surfaceSidebar" : "surface0";
}
