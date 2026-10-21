// 导入窗口里每条选不选、怎么进来，照 magpie（https://github.com/yetone/magpie，7597c132）internal/gui/assets/app.js 的
// openImportApps、importAppRow。Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。
import type {
  ApiEndpointImportItem,
  ApiEndpointImportPick,
  ApiEndpointImportSource,
} from "@getpaseo/protocol/api-endpoint/rpc-schemas";

/** 线上的 status 是字符串；认不出的当不能导入。 */
export type ImportItemStatus = "new" | "added" | "name_taken" | "other_key";

export function importItemStatusOf(item: ApiEndpointImportItem): ImportItemStatus | null {
  switch (item.status) {
    case "new":
    case "added":
    case "name_taken":
    case "other_key":
      return item.status;
    default:
      return null;
  }
}

/** 名称撞上时的两种进来法：留着两家（新增一家）或替换原来那家。改了名就只能新增。 */
export type ImportChoice = "add" | "replace";

export interface ImportPick {
  on: boolean;
  choice: ImportChoice;
  // 就地改的名称；没改是发现里的名称。
  name: string;
}

export type ImportPicks = Readonly<Record<string, ImportPick>>;

/** 能选的：读得了、还没添加过、状态认得出。 */
export function isPickable(item: ApiEndpointImportItem): boolean {
  const status = importItemStatusOf(item);
  return item.skip === null && status !== null && status !== "added";
}

/**
 * 打开时默认选上的（magpie openImportApps）：新的与同一家 key 不同的选上；名称撞上的、在那个软件里关着的要用户自己选。
 */
export function initialImportPicks(sources: readonly ApiEndpointImportSource[]): ImportPicks {
  const picks: Record<string, ImportPick> = {};
  for (const source of sources) {
    for (const item of source.items) {
      if (!isPickable(item)) continue;
      const isTaken = item.status === "name_taken";
      picks[item.fingerprint] = {
        on: item.off === null && !isTaken,
        choice: "add",
        name: item.name,
      };
    }
  }
  return picks;
}

export function isRenamed(item: ApiEndpointImportItem, pick: ImportPick): boolean {
  const name = pick.name.trim();
  return name !== "" && name !== item.name;
}

/** 这条能选的进来法：名称撞上、没改名时可选「两家都留」或「替换原来那家」；别的只有一种，不用选。 */
export function importChoices(item: ApiEndpointImportItem, pick: ImportPick): ImportChoice[] {
  const canReplace = item.status === "name_taken" && !isRenamed(item, pick);
  return canReplace ? ["add", "replace"] : ["add"];
}

/** 就地改名：改了名就不再替换，并选上这条（magpie 的 nm.oninput）。 */
export function renamePick(input: {
  item: ApiEndpointImportItem;
  pick: ImportPick;
  name: string;
}): ImportPick {
  const next: ImportPick = { ...input.pick, name: input.name };
  if (!isRenamed(input.item, next)) return next;
  return { ...next, on: true, choice: "add" };
}

/** 选了一种进来法就选上这条。 */
export function choosePick(pick: ImportPick, choice: ImportChoice): ImportPick {
  return { ...pick, on: true, choice };
}

export function pickedCount(picks: ImportPicks): number {
  return Object.values(picks).filter((pick) => pick.on).length;
}

/** 一个来源里能选的那几条：全选的开关用。 */
export function sourcePickState(input: { source: ApiEndpointImportSource; picks: ImportPicks }): {
  pickable: number;
  on: number;
} {
  let pickable = 0;
  let on = 0;
  for (const item of input.source.items) {
    const pick = input.picks[item.fingerprint];
    if (pick === undefined) continue;
    pickable += 1;
    if (pick.on) on += 1;
  }
  return { pickable, on };
}

export function setSourcePicks(input: {
  source: ApiEndpointImportSource;
  picks: ImportPicks;
  on: boolean;
}): ImportPicks {
  const next: Record<string, ImportPick> = { ...input.picks };
  for (const item of input.source.items) {
    const pick = next[item.fingerprint];
    if (pick !== undefined) next[item.fingerprint] = { ...pick, on: input.on };
  }
  return next;
}

/** 发给 daemon 的那几条：改了名是 rename，否则按选的进来法。 */
export function importRequests(input: {
  sources: readonly ApiEndpointImportSource[];
  picks: ImportPicks;
}): ApiEndpointImportPick[] {
  const requests: ApiEndpointImportPick[] = [];
  for (const source of input.sources) {
    for (const item of source.items) {
      const pick = input.picks[item.fingerprint];
      if (pick === undefined || !pick.on) continue;
      if (isRenamed(item, pick)) {
        requests.push({ fingerprint: item.fingerprint, action: "rename", name: pick.name.trim() });
      } else {
        requests.push({ fingerprint: item.fingerprint, action: pick.choice });
      }
    }
  }
  return requests;
}

/** 条目的主机名（各格式地址里第一个）。 */
export function importItemHost(item: ApiEndpointImportItem): string | null {
  const url = item.baseUrls[0]?.url;
  if (url === undefined || !URL.canParse(url)) return null;
  return new URL(url).host;
}
