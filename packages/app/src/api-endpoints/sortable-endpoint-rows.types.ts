import type { ReactElement } from "react";
import type { ApiEndpoint } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import type { RowPlace } from "./sortable-order";

// 能排序的一行：第三方接口，或提供方的账号（provider-accounts/section.tsx）。
export interface SortableItem {
  id: string;
}

export interface SortableEndpointRowInfo<T extends SortableItem = ApiEndpoint> {
  endpoint: T;
  index: number;
  // 拖着走的那一份（浮在列表上）。
  isDragging: boolean;
  // 被拖的行在列表里留下的等高占位，跟着落点走。
  isPlaceholder: boolean;
  // 行首图标是拖动把手。
  hasHandle: boolean;
  // 把行首图标包成拖动把手；不能拖（原生端、主机不支持排序）时原样返回。
  wrapHandle: (icon: ReactElement) => ReactElement;
  // 刚拖完松手时那一下点击不算打开这一行。
  isPressSuppressed: () => boolean;
  // 排序菜单开着没有；桌面端右键行也会打开它。
  isMenuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
}

export interface SortableEndpointRowsProps<T extends SortableItem = ApiEndpoint> {
  // 同一组（已开启或已关闭）里的接口，按接口顺序。
  endpoints: T[];
  // 主机支持改顺序时才能拖、才响应 Alt+↑/↓ 与右键。
  isSortable: boolean;
  renderRow: (info: SortableEndpointRowInfo<T>) => ReactElement;
  onMove: (endpoint: T, place: RowPlace) => void;
  // 行的 testID 前缀：键盘挪完后按它把焦点放回这一行；缺省是接口行的。
  rowTestIdPrefix?: string;
  // 拖动把手的提示；缺省是接口列表的。
  hint?: string;
}
