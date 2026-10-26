/*
 * 一组行的先后怎么挪（照 magpie arrangeProvider、stepProvider、shownToOn）：上移、下移、移到最前、移到最后，
 * 或拖到第几行。第三方接口列表（每组各挪各的）与提供方的账号列表共用。
 */

/** 一次挪动：上移、下移、移到最前、移到最后，或拖到组里的第几个（落在那一行原来的位置）。 */
export type RowPlace = "up" | "down" | "top" | "bottom" | { index: number };

/** 行菜单里四个排序项哪些能用：会让顺序变的才能点。 */
export interface RowMoves {
  top: boolean;
  up: boolean;
  down: boolean;
  bottom: boolean;
}

/**
 * 挪到组里的第几个。只显示一部分行时（`shown`，如搜索时），上移、下移跨过上下相邻的那个显示着的行，
 * 拖动的序号是显示着的行里的序号，落在那一行原来的位置；移到最前、最后仍到整组的两头。
 */
function targetIndex(input: {
  group: string[];
  id: string;
  place: RowPlace;
  shown: ReadonlySet<string> | null;
}): number {
  const { group, id, place, shown } = input;
  if (place === "top") return 0;
  if (place === "bottom") return group.length - 1;
  const visible = shown ? group.filter((member) => member === id || shown.has(member)) : group;
  let target: string | undefined;
  if (place === "up") target = visible[visible.indexOf(id) - 1];
  else if (place === "down") target = visible[visible.indexOf(id) + 1];
  else target = visible[place.index];
  return target === undefined ? -1 : group.indexOf(target);
}

/** 挪动之后这一组的顺序；什么都不会变时为 null。 */
export function arrangeIds(input: {
  group: string[];
  id: string;
  place: RowPlace;
  shown: ReadonlySet<string> | null;
}): string[] | null {
  const { group, id } = input;
  const from = group.indexOf(id);
  if (from === -1) return null;
  const to = targetIndex(input);
  if (to < 0 || to >= group.length || to === from) return null;
  const moved = group.filter((member) => member !== id);
  moved.splice(to, 0, id);
  return moved;
}

export function rowMoves(input: {
  group: string[];
  id: string;
  shown: ReadonlySet<string> | null;
}): RowMoves {
  const can = (place: RowPlace) => arrangeIds({ ...input, place }) !== null;
  return { top: can("top"), up: can("up"), down: can("down"), bottom: can("bottom") };
}
