import { SPACING } from "@/styles/theme";
import { getNextActiveIndex } from "./combobox-keyboard";

export type AutocompleteGroup = "commands" | "skills" | "agents" | "files";

/** Command menu 分命令、技能两组；`@` 列表分智能体、文件两组。 */
export function getAutocompleteGroup(kind: string | undefined): AutocompleteGroup | null {
  if (kind === "skill") return "skills";
  if (kind === "command") return "commands";
  if (kind === "agent") return "agents";
  if (kind === "file" || kind === "directory") return "files";
  return null;
}

// Command menu 与 `@` 列表各有上下两组，从不混排；这些是排在下面的组。
const LOWER_GROUPS: ReadonlySet<AutocompleteGroup> = new Set(["skills", "files"]);

function isInLowerGroup(option: { kind?: string }): boolean {
  const group = getAutocompleteGroup(option.kind);
  return group !== null && LOWER_GROUPS.has(group);
}

/** 命令组在技能组上、智能体组在文件组上，组内保持传入顺序（即匹配排序）。 */
export function orderAutocompleteGroups<T extends { kind?: string }>(options: readonly T[]): T[] {
  return [
    ...options.filter((option) => !isInLowerGroup(option)),
    ...options.filter((option) => isInLowerGroup(option)),
  ];
}

export interface SelectableOption {
  /** 置灰：照常显示，但高亮与选择都跳过它。 */
  disabled?: boolean;
}

export function hasSelectableAutocompleteOption(options: readonly SelectableOption[]): boolean {
  return options.some((option) => !option.disabled);
}

export function getAutocompleteFallbackIndex(options: readonly SelectableOption[]): number {
  return options.findIndex((option) => !option.disabled);
}

export function getAutocompleteNextIndex(args: {
  currentIndex: number;
  options: readonly SelectableOption[];
  key: "ArrowDown" | "ArrowUp";
}): number {
  const itemCount = args.options.length;
  let index = args.currentIndex;
  for (let step = 0; step < itemCount; step += 1) {
    index = getNextActiveIndex({ currentIndex: index, itemCount, key: args.key });
    if (!args.options[index]?.disabled) return index;
  }
  return -1;
}

/** 面板底部渐隐的高度；列表底部留出同样的空白，滚到底时最后一行不被淡掉。 */
export const AUTOCOMPLETE_FADE_HEIGHT = SPACING[4];

export function getAutocompleteScrollOffset(args: {
  currentOffset: number;
  viewportHeight: number;
  /** 视口底部被渐隐盖住的高度，落在这里的行不算可见。 */
  bottomInset?: number;
  itemTop: number;
  itemHeight: number;
}): number {
  const visibleHeight = args.viewportHeight - (args.bottomInset ?? 0);
  if (visibleHeight <= 0) {
    return args.currentOffset;
  }

  const itemBottom = args.itemTop + args.itemHeight;
  const viewportTop = args.currentOffset;
  const viewportBottom = args.currentOffset + visibleHeight;

  if (args.itemTop < viewportTop) {
    return Math.max(0, args.itemTop);
  }

  if (itemBottom > viewportBottom) {
    return Math.max(0, itemBottom - visibleHeight);
  }

  return args.currentOffset;
}
