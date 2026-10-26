import React, { useCallback, useMemo } from "react";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ArrowDown, ArrowDownToLine, ArrowUp, ArrowUpToLine } from "lucide-react-native";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Shortcut } from "@/components/ui/shortcut";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import type { RowMoves } from "./sortable-order";

/*
 * 可排序列表行菜单里的四个排序项（上移、下移、移到最前、移到最后，带 Alt+↑/↓ 快捷键），
 * 以及拖动时浮起的行与占位的样式。第三方接口列表与提供方的账号列表共用；文字由各自的页面给。
 */

type MovePlace = keyof RowMoves;

const ThemedArrowUp = withUnistyles(ArrowUp);
const ThemedArrowDown = withUnistyles(ArrowDown);
const ThemedArrowUpToLine = withUnistyles(ArrowUpToLine);
const ThemedArrowDownToLine = withUnistyles(ArrowDownToLine);
const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

const ORDER_ITEMS: { place: MovePlace; keys: string[] }[] = [
  { place: "up", keys: ["alt", "Up"] },
  { place: "down", keys: ["alt", "Down"] },
  { place: "top", keys: ["alt", "shift", "Up"] },
  { place: "bottom", keys: ["alt", "shift", "Down"] },
];

const ORDER_ICONS = {
  up: ThemedArrowUp,
  down: ThemedArrowDown,
  top: ThemedArrowUpToLine,
  bottom: ThemedArrowDownToLine,
};

export function OrderMenuItems({
  moves,
  labels,
  onArrange,
  testIdPrefix,
}: {
  // 哪几项能点；不会让顺序变的、或页面正忙时为 false。
  moves: RowMoves;
  labels: Record<MovePlace, string>;
  onArrange: (place: MovePlace) => void;
  // 每项的 testID 是 `${testIdPrefix}${place}`。
  testIdPrefix: string;
}) {
  return (
    <>
      {ORDER_ITEMS.map((item) => (
        <OrderMenuItem
          key={item.place}
          place={item.place}
          keys={item.keys}
          label={labels[item.place]}
          isEnabled={moves[item.place]}
          onArrange={onArrange}
          testID={`${testIdPrefix}${item.place}`}
        />
      ))}
    </>
  );
}

function OrderMenuItem({
  place,
  keys,
  label,
  isEnabled,
  onArrange,
  testID,
}: {
  place: MovePlace;
  keys: string[];
  label: string;
  isEnabled: boolean;
  onArrange: (place: MovePlace) => void;
  testID: string;
}) {
  const Icon = ORDER_ICONS[place];
  const leading = useMemo(
    () => <Icon size={ICON_SIZE.md} uniProps={foregroundMutedColorMapping} />,
    [Icon],
  );
  const trailing = useMemo(() => <Shortcut keys={keys} />, [keys]);
  const handleSelect = useCallback(() => onArrange(place), [onArrange, place]);
  return (
    <DropdownMenuItem
      leading={leading}
      trailing={trailing}
      disabled={!isEnabled}
      onSelect={handleSelect}
      testID={testID}
    >
      {label}
    </DropdownMenuItem>
  );
}

export const sortableRowStyles = StyleSheet.create((theme) => ({
  // 拖着走的那一份浮在占位上：实底、强调色描边与阴影。
  dragging: {
    backgroundColor: theme.colors.surface1,
    borderColor: theme.colors.accent,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    ...theme.shadow.md,
  },
  // 被拖的行在列表里留下的等高占位：强调色虚线框，后面的行让开，停在哪儿就落在哪儿。
  dropSlot: {
    ...StyleSheet.absoluteFillObject,
    margin: theme.spacing[1],
    backgroundColor: theme.colors.surface2,
    borderColor: theme.colors.accent,
    borderStyle: "dashed",
    borderWidth: 2,
    borderRadius: theme.radius.md,
  },
}));
