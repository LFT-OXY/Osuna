import { create } from "zustand";

/*
 * 删除自定义提供方的进行状态。手机上 ⋯ 在顶栏，失败提示在正文顶部，两处不在同一棵组件树里，
 * 所以放在按主机与提供方分键的 store 里。失败会一直留着，直到用户关闭或重试。
 */

export type ProviderRemovalState =
  | { status: "idle" }
  | { status: "removing" }
  | { status: "failed"; message: string };

interface ProviderRemovalStoreState {
  byKey: Record<string, ProviderRemovalState>;
}

export interface ProviderRemovalSteps {
  confirm: () => Promise<boolean>;
  remove: () => Promise<unknown>;
}

const IDLE: ProviderRemovalState = { status: "idle" };

export const useProviderRemovalStore = create<ProviderRemovalStoreState>()(() => ({
  byKey: {},
}));

function removalKey(serverId: string, provider: string): string {
  return `${serverId}\u0000${provider}`;
}

function setRemovalState(key: string, state: ProviderRemovalState): void {
  useProviderRemovalStore.setState((current) => {
    const byKey = { ...current.byKey };
    if (state.status === "idle") {
      delete byKey[key];
    } else {
      byKey[key] = state;
    }
    return { byKey };
  });
}

export function selectProviderRemoval(
  state: ProviderRemovalStoreState,
  serverId: string,
  provider: string,
): ProviderRemovalState {
  return state.byKey[removalKey(serverId, provider)] ?? IDLE;
}

export function useProviderRemoval(serverId: string, provider: string): ProviderRemovalState {
  return useProviderRemovalStore((state) => selectProviderRemoval(state, serverId, provider));
}

export async function removeProvider(
  serverId: string,
  provider: string,
  steps: ProviderRemovalSteps,
): Promise<void> {
  const key = removalKey(serverId, provider);
  if (useProviderRemovalStore.getState().byKey[key]?.status === "removing") return;
  setRemovalState(key, { status: "removing" });
  try {
    const confirmed = await steps.confirm();
    if (confirmed) {
      await steps.remove();
    }
    setRemovalState(key, IDLE);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setRemovalState(key, { status: "failed", message });
  }
}

export function dismissProviderRemovalError(serverId: string, provider: string): void {
  const key = removalKey(serverId, provider);
  if (useProviderRemovalStore.getState().byKey[key]?.status !== "failed") return;
  setRemovalState(key, IDLE);
}
