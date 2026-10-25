import { Fragment, useState, type ReactElement } from "react";
import type { SortableEndpointRowsProps, SortableItem } from "./sortable-endpoint-rows.types";

/*
 * 原生端：不拖动，排顺序用行菜单（sortable-endpoint-rows.web.tsx 是网页与桌面端的拖动、键盘与右键）。
 */

const keepIcon = (icon: ReactElement) => icon;
const neverSuppressed = () => false;

export function SortableEndpointRows<T extends SortableItem>({
  endpoints,
  renderRow,
}: SortableEndpointRowsProps<T>) {
  const [menuEndpointId, setMenuEndpointId] = useState<string | null>(null);
  return (
    <>
      {endpoints.map((endpoint, index) => (
        <Fragment key={endpoint.id}>
          {renderRow({
            endpoint,
            index,
            isDragging: false,
            isPlaceholder: false,
            hasHandle: false,
            wrapHandle: keepIcon,
            isPressSuppressed: neverSuppressed,
            isMenuOpen: menuEndpointId === endpoint.id,
            onMenuOpenChange: (open) => setMenuEndpointId(open ? endpoint.id : null),
          })}
        </Fragment>
      ))}
    </>
  );
}
