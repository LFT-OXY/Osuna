import { Fragment } from "react";
import type { SortableEndpointRowsProps } from "./sortable-endpoint-rows.types";

/*
 * 原生端：不拖动，排顺序用行菜单（sortable-endpoint-rows.web.tsx 是网页与桌面端的拖动与键盘）。
 */

const keepIcon = (icon: React.ReactElement) => icon;
const neverSuppressed = () => false;

export function SortableEndpointRows({ endpoints, renderRow }: SortableEndpointRowsProps) {
  return (
    <>
      {endpoints.map((endpoint, index) => (
        <Fragment key={endpoint.id}>
          {renderRow({
            endpoint,
            index,
            isDragging: false,
            hasHandle: false,
            wrapHandle: keepIcon,
            isPressSuppressed: neverSuppressed,
          })}
        </Fragment>
      ))}
    </>
  );
}
