import AsyncStorage from "@react-native-async-storage/async-storage";
import { LOGIC_MAP_LABEL } from "@getpaseo/protocol/agent-labels";
import { z } from "zod";
import { create, type StoreApi, type UseBoundStore } from "zustand";
import { persist, type StateStorage } from "zustand/middleware";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

const DRAFT_LOGIC_MAP_STORAGE_KEY = "paseo-draft-logic-maps";
const DRAFT_LOGIC_MAP_STORE_VERSION = 1;

const DraftLogicMapSchema = z.object({ mapName: z.string().min(1), enabled: z.boolean() });
const DraftLogicMapPersistedStateSchema = z.object({
  draftsByKey: z.record(z.string(), DraftLogicMapSchema),
});

type DraftLogicMap = z.infer<typeof DraftLogicMapSchema>;
type DraftLogicMapPersistedState = z.infer<typeof DraftLogicMapPersistedStateSchema>;

/**
 * 还没发第一条消息的草稿的逻辑图开关。打开时 daemon 建好的图名记在这里，关掉再打开沿用同一张；
 * 第一条消息新建 Agent 时作为 labels 交给 daemon，之后由 Agent 记录保存。和草稿一样存到本机，重启后读回。
 */
interface DraftLogicMapState extends DraftLogicMapPersistedState {
  turnOnWithMap: (draftKey: string, mapName: string) => void;
  setEnabled: (draftKey: string, enabled: boolean) => void;
  forget: (draftKey: string) => void;
}

export type DraftLogicMapStore = UseBoundStore<StoreApi<DraftLogicMapState>> & {
  persist: { rehydrate: () => Promise<void> | void };
};

function withDraft(
  drafts: Record<string, DraftLogicMap>,
  draftKey: string,
  draft: DraftLogicMap | null,
): Record<string, DraftLogicMap> {
  const { [draftKey]: _previous, ...rest } = drafts;
  return draft ? { ...rest, [draftKey]: draft } : rest;
}

export function createDraftLogicMapStore(
  backingStorage: StateStorage = AsyncStorage,
): DraftLogicMapStore {
  return create<DraftLogicMapState>()(
    persist(
      (set) => ({
        draftsByKey: {},
        turnOnWithMap: (draftKey, mapName) =>
          set((state) => ({
            draftsByKey: withDraft(state.draftsByKey, draftKey, { mapName, enabled: true }),
          })),
        setEnabled: (draftKey, enabled) =>
          set((state) => {
            const draft = state.draftsByKey[draftKey];
            if (!draft) return state;
            return { draftsByKey: withDraft(state.draftsByKey, draftKey, { ...draft, enabled }) };
          }),
        forget: (draftKey) =>
          set((state) => ({ draftsByKey: withDraft(state.draftsByKey, draftKey, null) })),
      }),
      {
        name: DRAFT_LOGIC_MAP_STORAGE_KEY,
        version: DRAFT_LOGIC_MAP_STORE_VERSION,
        storage: createValidatedPersistStorage(backingStorage, DraftLogicMapPersistedStateSchema),
        partialize: ({ draftsByKey }) => ({ draftsByKey }),
      },
    ),
  );
}

export const useDraftLogicMapStore = createDraftLogicMapStore();

export function buildDraftLogicMapKey(input: { serverId: string; draftTabId: string }): string {
  return `${input.serverId}:${input.draftTabId}`;
}

/** 新建 Agent 时带上的逻辑图标签；开关关着时为 undefined。新建成功后调用方用 `forget` 清掉。 */
export function readDraftLogicMapLabels(
  store: DraftLogicMapStore,
  draftKey: string,
): Record<string, string> | undefined {
  const draft = store.getState().draftsByKey[draftKey];
  return draft?.enabled ? { [LOGIC_MAP_LABEL]: draft.mapName } : undefined;
}
