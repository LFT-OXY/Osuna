import type { ReactElement } from "react";
import type { ApiEndpoint } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import type { EndpointPlace } from "./internal/host-list";

export interface SortableEndpointRowInfo {
  endpoint: ApiEndpoint;
  index: number;
  // 正被拖着的那一行。
  isDragging: boolean;
  // 行首图标是拖动把手（悬停时画成握把）。
  hasHandle: boolean;
  // 把行首图标包成拖动把手；不能拖（原生端、主机不支持排序）时原样返回。
  wrapHandle: (icon: ReactElement) => ReactElement;
  // 刚拖完松手时那一下点击不算打开这一行。
  isPressSuppressed: () => boolean;
}

export interface SortableEndpointRowsProps {
  // 同一组（已开启或已关闭）里的接口，按接口顺序。
  endpoints: ApiEndpoint[];
  // 主机支持改顺序时才能拖、才响应 Alt+↑/↓。
  isSortable: boolean;
  renderRow: (info: SortableEndpointRowInfo) => ReactElement;
  onMove: (endpoint: ApiEndpoint, place: EndpointPlace) => void;
}
