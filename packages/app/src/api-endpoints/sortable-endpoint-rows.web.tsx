import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type KeyboardEvent,
  type ReactElement,
} from "react";
import { useTranslation } from "react-i18next";
import type { ApiEndpoint } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { DraggableList, type DraggableRenderItemInfo } from "@/components/draggable-list";
import type { DraggableListDragHandleProps } from "@/components/draggable-list.types";
import { draggedEndpoint, type EndpointPlace } from "./internal/host-list";
import type { SortableEndpointRowsProps } from "./sortable-endpoint-rows.types";

/*
 * 网页与桌面端（照 magpie providerHandle）：行首图标是拖动把手，拖到哪一行就落在那一行原来的位置；
 * 焦点在行上时 Alt+↑/↓ 挪一格，Alt+Shift+↑/↓ 挪到最前或最后，挪完焦点留在这一行。只在本组里挪。
 */

const keepIcon = (icon: ReactElement) => icon;
const HANDLE_STYLE = { cursor: "grab", touchAction: "none" } as const;
const neverSuppressed = () => false;

function keyboardPlace(event: KeyboardEvent<HTMLDivElement>): EndpointPlace | null {
  if (!event.altKey || event.ctrlKey || event.metaKey) return null;
  if (event.key === "ArrowUp") return event.shiftKey ? "top" : "up";
  if (event.key === "ArrowDown") return event.shiftKey ? "bottom" : "down";
  return null;
}

export function SortableEndpointRows({
  endpoints,
  isSortable,
  renderRow,
  onMove,
}: SortableEndpointRowsProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  // 键盘挪过的那一行：列表按新顺序画完后把焦点放回它的行上。
  const focusAfterMoveRef = useRef<string | null>(null);
  // 拖动开始到下一次按下之间为 true：松手时落在行上的那次点击不打开详情。
  const justDraggedRef = useRef(false);
  const order = useMemo(() => endpoints.map((endpoint) => endpoint.id), [endpoints]);

  useEffect(() => {
    const id = focusAfterMoveRef.current;
    if (id === null) return;
    const row = containerRef.current?.querySelector<HTMLElement>(
      `[data-testid="api-endpoint-row-${CSS.escape(id)}"]`,
    );
    if (!row) return;
    row.focus({ preventScroll: true });
    if (document.activeElement === row) focusAfterMoveRef.current = null;
  }, [order]);

  const handleKeyDown = useCallback(
    (endpoint: ApiEndpoint, event: KeyboardEvent<HTMLDivElement>) => {
      const place = keyboardPlace(event);
      if (!place) return;
      event.preventDefault();
      event.stopPropagation();
      focusAfterMoveRef.current = endpoint.id;
      onMove(endpoint, place);
    },
    [onMove],
  );

  const handleDragEnd = useCallback(
    (items: ApiEndpoint[]) => {
      const moved = draggedEndpoint(
        order,
        items.map((endpoint) => endpoint.id),
      );
      const endpoint = moved ? endpoints.find((entry) => entry.id === moved.id) : undefined;
      if (moved && endpoint) onMove(endpoint, { index: moved.index });
    },
    [endpoints, onMove, order],
  );
  const handleDragBegin = useCallback(() => {
    justDraggedRef.current = true;
  }, []);
  const handlePointerDownCapture = useCallback(() => {
    justDraggedRef.current = false;
  }, []);
  const isPressSuppressed = useCallback(() => {
    if (!justDraggedRef.current) return false;
    justDraggedRef.current = false;
    return true;
  }, []);
  const keyExtractor = useCallback((endpoint: ApiEndpoint) => endpoint.id, []);
  const hint = t("settings.apiEndpoints.order.hint");

  const renderItem = useCallback(
    ({ item, index, isActive, dragHandleProps }: DraggableRenderItemInfo<ApiEndpoint>) => (
      <KeyboardRow endpoint={item} onKeyDown={handleKeyDown}>
        {renderRow({
          endpoint: item,
          index,
          isDragging: isActive,
          hasHandle: true,
          wrapHandle: (icon) => (
            <DragHandle handleProps={dragHandleProps} hint={hint}>
              {icon}
            </DragHandle>
          ),
          isPressSuppressed,
        })}
      </KeyboardRow>
    ),
    [handleKeyDown, hint, isPressSuppressed, renderRow],
  );

  if (!isSortable) {
    return (
      <>
        {endpoints.map((endpoint, index) => (
          <div key={endpoint.id}>
            {renderRow({
              endpoint,
              index,
              isDragging: false,
              hasHandle: false,
              wrapHandle: keepIcon,
              isPressSuppressed: neverSuppressed,
            })}
          </div>
        ))}
      </>
    );
  }

  return (
    <div ref={containerRef} onPointerDownCapture={handlePointerDownCapture}>
      <DraggableList
        data={endpoints}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        onDragEnd={handleDragEnd}
        onDragBegin={handleDragBegin}
        scrollEnabled={false}
        useDragHandle
      />
    </div>
  );
}

function KeyboardRow({
  endpoint,
  onKeyDown,
  children,
}: {
  endpoint: ApiEndpoint;
  onKeyDown: (endpoint: ApiEndpoint, event: KeyboardEvent<HTMLDivElement>) => void;
  children: ReactElement;
}) {
  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => onKeyDown(endpoint, event),
    [endpoint, onKeyDown],
  );
  return <div onKeyDown={handleKeyDown}>{children}</div>;
}

function DragHandle({
  handleProps,
  hint,
  children,
}: {
  handleProps: DraggableListDragHandleProps | undefined;
  hint: string;
  children: ReactElement;
}) {
  // 把手不单独占一个 Tab 位：键盘用 Alt+↑/↓。
  const {
    role: _role,
    tabIndex: _tabIndex,
    "aria-roledescription": _roleDescription,
    "aria-describedby": _describedBy,
    ...attributes
  } = handleProps?.attributes ?? {};
  return (
    <div
      {...attributes}
      {...handleProps?.listeners}
      ref={handleProps?.setActivatorNodeRef as ((node: HTMLDivElement | null) => void) | undefined}
      title={hint}
      data-testid="api-endpoint-drag-handle"
      style={HANDLE_STYLE}
    >
      {children}
    </div>
  );
}
