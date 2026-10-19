import { LOGIC_MAP_LABEL } from "@getpaseo/protocol/agent-labels";
import { create } from "zustand";

/**
 * 还没发第一条消息的草稿打开逻辑图后，daemon 已建好的图名。
 * 第一条消息新建 Agent 时作为 labels 交给 daemon，之后由 Agent 记录保存。
 */
interface DraftLogicMapState {
  mapNameByDraftKey: Record<string, string>;
  setDraftMapName: (draftKey: string, mapName: string | null) => void;
}

export const useDraftLogicMapStore = create<DraftLogicMapState>()((set) => ({
  mapNameByDraftKey: {},
  setDraftMapName: (draftKey, mapName) =>
    set((state) => {
      const { [draftKey]: _previous, ...rest } = state.mapNameByDraftKey;
      return { mapNameByDraftKey: mapName ? { ...rest, [draftKey]: mapName } : rest };
    }),
}));

export function buildDraftLogicMapKey(input: { serverId: string; draftTabId: string }): string {
  return `${input.serverId}:${input.draftTabId}`;
}

/**
 * 新建 Agent 时带上的逻辑图标签；开关关着时为 undefined。
 * 新建成功后调用方用 `setDraftMapName(key, null)` 清掉，失败重试时还能再读到。
 */
export function readDraftLogicMapLabels(draftKey: string): Record<string, string> | undefined {
  const mapName = useDraftLogicMapStore.getState().mapNameByDraftKey[draftKey];
  return mapName ? { [LOGIC_MAP_LABEL]: mapName } : undefined;
}
