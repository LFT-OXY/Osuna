import { getNextActiveIndex } from "./combobox-keyboard";

export type AutocompleteGroup = "commands" | "skills";

/** Command menu 的分组；`@` 文件列表不分组，返回 null。 */
export function getAutocompleteGroup(kind: string | undefined): AutocompleteGroup | null {
  if (kind === "skill") return "skills";
  if (kind === "command") return "commands";
  return null;
}

/** 命令组在上、技能组在下，组内保持传入顺序（即匹配排序）。 */
export function orderAutocompleteGroups<T extends { kind?: string }>(options: readonly T[]): T[] {
  return [
    ...options.filter((option) => getAutocompleteGroup(option.kind) !== "skills"),
    ...options.filter((option) => getAutocompleteGroup(option.kind) === "skills"),
  ];
}

export function getAutocompleteFallbackIndex(itemCount: number): number {
  return itemCount > 0 ? 0 : -1;
}

export function getAutocompleteNextIndex(args: {
  currentIndex: number;
  itemCount: number;
  key: "ArrowDown" | "ArrowUp";
}): number {
  return getNextActiveIndex(args);
}

export function getAutocompleteScrollOffset(args: {
  currentOffset: number;
  viewportHeight: number;
  itemTop: number;
  itemHeight: number;
}): number {
  if (args.viewportHeight <= 0) {
    return args.currentOffset;
  }

  const itemBottom = args.itemTop + args.itemHeight;
  const viewportTop = args.currentOffset;
  const viewportBottom = args.currentOffset + args.viewportHeight;

  if (args.itemTop < viewportTop) {
    return Math.max(0, args.itemTop);
  }

  if (itemBottom > viewportBottom) {
    return Math.max(0, itemBottom - args.viewportHeight);
  }

  return args.currentOffset;
}
