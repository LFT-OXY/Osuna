import type { SidebarSurfaceBackdrop } from "@/styles/surface-backdrop";
import { getRowBackdrop } from "@/components/ui/row";

/**
 * Which surface a sidebar row is currently painting, so anything knocking out of it — the status
 * badge on a project icon — can match.
 *
 * 状态优先级沿用 `<Row>` 的 `getRowBackdrop`，行渲染器也通过 `getRowSurfaceStyle` 用同一条
 * 规则上色；拖拽是侧栏独有、叠在最上层的状态。
 */
export function getSidebarRowBackdrop({
  isDragging = false,
  isPressed = false,
  selected = false,
  isHovered = false,
}: {
  isDragging?: boolean;
  isPressed?: boolean;
  selected?: boolean;
  isHovered?: boolean;
}): SidebarSurfaceBackdrop {
  if (isDragging) return "surface2";
  return getRowBackdrop({ hovered: isHovered, pressed: isPressed, selected });
}
