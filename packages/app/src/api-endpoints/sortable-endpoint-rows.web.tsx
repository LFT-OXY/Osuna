import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  type Modifier,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS as DndCss } from "@dnd-kit/utilities";
import type { ApiEndpoint } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import type { EndpointPlace } from "./internal/host-list";
import type {
  SortableEndpointRowInfo,
  SortableEndpointRowsProps,
} from "./sortable-endpoint-rows.types";

/*
 * 网页与桌面端（照 magpie providerHandle、openProviderMenu）：行首图标是拖动把手；拖动时列表里留一个等高占位，
 * 后面的行整体让开，浮起的那份停在占位上，占位停在哪儿就落在哪儿；焦点在行上时 Alt+↑/↓ 挪一格，
 * Alt+Shift+↑/↓ 挪到最前或最后，挪完焦点留在这一行；右键行打开排序菜单。只在本组里挪。
 */

const keepIcon = (icon: ReactElement) => icon;
const neverSuppressed = () => false;
const ignoreMenu = () => {};
const HANDLE_STYLE = { cursor: "grab", touchAction: "none" } as const;
const restrictToVerticalAxis: Modifier = ({ transform }) => ({ ...transform, x: 0 });
const MODIFIERS = [restrictToVerticalAxis];
// 浮起的那份不跟着指针飘，而是停在占位上（占位就是落点）：后面的行让开，它不会压住邻行。
// 只改画出来的位置；判断落在哪一行仍按指针（DndContext 的 modifiers）。
const snapToDropSlot: Modifier = ({ transform, over, activeNodeRect }) =>
  over && activeNodeRect
    ? { ...transform, x: 0, y: over.rect.top - activeNodeRect.top }
    : { ...transform, x: 0 };
const OVERLAY_MODIFIERS = [snapToDropSlot];
const MOUSE_ACTIVATION = { activationConstraint: { distance: 6 } };
const TOUCH_ACTIVATION = { activationConstraint: { delay: 180, tolerance: 8 } };

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
  const [activeId, setActiveId] = useState<string | null>(null);
  const [menuEndpointId, setMenuEndpointId] = useState<string | null>(null);
  // 键盘挪过的那一行：列表按新顺序画完后把焦点放回它的行上。
  const focusAfterMoveRef = useRef<string | null>(null);
  // 拖动开始到下一次按下之间为 true：松手时落在行上的那次点击不打开详情。
  const justDraggedRef = useRef(false);
  const order = useMemo(() => endpoints.map((endpoint) => endpoint.id), [endpoints]);
  const sensors = useSensors(
    useSensor(MouseSensor, MOUSE_ACTIVATION),
    useSensor(TouchSensor, TOUCH_ACTIVATION),
  );

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
  const handleContextMenu = useCallback((endpoint: ApiEndpoint, event: MouseEvent) => {
    event.preventDefault();
    setMenuEndpointId(endpoint.id);
  }, []);
  const handleMenuOpenChange = useCallback((endpoint: ApiEndpoint, open: boolean) => {
    setMenuEndpointId(open ? endpoint.id : null);
  }, []);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    justDraggedRef.current = true;
    setActiveId(String(event.active.id));
  }, []);
  const handleDragEnd = useCallback(
    ({ active, over }: DragEndEvent) => {
      setActiveId(null);
      if (!over || over.id === active.id) return;
      const endpoint = endpoints.find((entry) => entry.id === active.id);
      if (endpoint) onMove(endpoint, { index: order.indexOf(String(over.id)) });
    },
    [endpoints, onMove, order],
  );
  const handleDragCancel = useCallback(() => setActiveId(null), []);
  const handlePointerDownCapture = useCallback(() => {
    justDraggedRef.current = false;
  }, []);
  const isPressSuppressed = useCallback(() => {
    if (!justDraggedRef.current) return false;
    justDraggedRef.current = false;
    return true;
  }, []);
  const hint = t("settings.apiEndpoints.order.hint");

  if (!isSortable) {
    return (
      <>
        {endpoints.map((endpoint, index) => (
          <div key={endpoint.id}>
            {renderRow({
              endpoint,
              index,
              isDragging: false,
              isPlaceholder: false,
              hasHandle: false,
              wrapHandle: keepIcon,
              isPressSuppressed: neverSuppressed,
              isMenuOpen: false,
              onMenuOpenChange: ignoreMenu,
            })}
          </div>
        ))}
      </>
    );
  }

  const activeIndex = activeId === null ? -1 : order.indexOf(activeId);
  const active = activeIndex === -1 ? null : endpoints[activeIndex];

  return (
    <div ref={containerRef} onPointerDownCapture={handlePointerDownCapture}>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={MODIFIERS}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <SortableContext items={order} strategy={verticalListSortingStrategy}>
          {endpoints.map((endpoint, index) => (
            <SortableEndpoint
              key={endpoint.id}
              endpoint={endpoint}
              index={index}
              hint={hint}
              isMenuOpen={menuEndpointId === endpoint.id}
              renderRow={renderRow}
              isPressSuppressed={isPressSuppressed}
              onKeyDown={handleKeyDown}
              onContextMenu={handleContextMenu}
              onMenuOpenChange={handleMenuOpenChange}
            />
          ))}
        </SortableContext>
        {/* 设置页的面板带 transform，fixed 定位会以它为准而错位：浮起的那份挂到 body 上。 */}
        {createPortal(
          <DragOverlay dropAnimation={null} modifiers={OVERLAY_MODIFIERS}>
            {active
              ? renderRow({
                  endpoint: active,
                  index: activeIndex,
                  isDragging: true,
                  isPlaceholder: false,
                  hasHandle: true,
                  wrapHandle: keepIcon,
                  isPressSuppressed: neverSuppressed,
                  isMenuOpen: false,
                  onMenuOpenChange: ignoreMenu,
                })
              : null}
          </DragOverlay>,
          document.body,
        )}
      </DndContext>
    </div>
  );
}

function SortableEndpoint({
  endpoint,
  index,
  hint,
  isMenuOpen,
  renderRow,
  isPressSuppressed,
  onKeyDown,
  onContextMenu,
  onMenuOpenChange,
}: {
  endpoint: ApiEndpoint;
  index: number;
  hint: string;
  isMenuOpen: boolean;
  renderRow: (info: SortableEndpointRowInfo) => ReactElement;
  isPressSuppressed: () => boolean;
  onKeyDown: (endpoint: ApiEndpoint, event: KeyboardEvent<HTMLDivElement>) => void;
  onContextMenu: (endpoint: ApiEndpoint, event: MouseEvent) => void;
  onMenuOpenChange: (endpoint: ApiEndpoint, open: boolean) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: endpoint.id });
  const style = useMemo(
    () => ({ transform: DndCss.Translate.toString(transform), transition }),
    [transform, transition],
  );
  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => onKeyDown(endpoint, event),
    [endpoint, onKeyDown],
  );
  const handleContextMenu = useCallback(
    (event: MouseEvent) => onContextMenu(endpoint, event),
    [endpoint, onContextMenu],
  );
  const handleMenuOpenChange = useCallback(
    (open: boolean) => onMenuOpenChange(endpoint, open),
    [endpoint, onMenuOpenChange],
  );
  const wrapHandle = useCallback(
    (icon: ReactElement) => (
      <DragHandle
        attributes={attributes}
        listeners={listeners}
        setActivatorNodeRef={setActivatorNodeRef}
        hint={hint}
      >
        {icon}
      </DragHandle>
    ),
    [attributes, hint, listeners, setActivatorNodeRef],
  );
  return (
    <div ref={setNodeRef} style={style} onKeyDown={handleKeyDown} onContextMenu={handleContextMenu}>
      {renderRow({
        endpoint,
        index,
        isDragging: false,
        isPlaceholder: isDragging,
        hasHandle: true,
        wrapHandle,
        isPressSuppressed,
        isMenuOpen,
        onMenuOpenChange: handleMenuOpenChange,
      })}
    </div>
  );
}

type SortableState = ReturnType<typeof useSortable>;

function DragHandle({
  attributes,
  listeners,
  setActivatorNodeRef,
  hint,
  children,
}: {
  attributes: SortableState["attributes"];
  listeners: SortableState["listeners"];
  setActivatorNodeRef: SortableState["setActivatorNodeRef"];
  hint: string;
  children: ReactElement;
}) {
  // 把手不单独占一个 Tab 位：键盘用 Alt+↑/↓。
  const {
    role: _role,
    tabIndex: _tabIndex,
    "aria-roledescription": _roleDescription,
    "aria-describedby": _describedBy,
    ...handleAttributes
  } = attributes;
  return (
    <div
      {...handleAttributes}
      {...listeners}
      ref={setActivatorNodeRef}
      title={hint}
      data-testid="api-endpoint-drag-handle"
      style={HANDLE_STYLE}
    >
      {children}
    </div>
  );
}
