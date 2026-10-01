import { create } from "zustand";

/*
 * 详情页头启用开关的写入状态。手机上开关在顶栏，失败提示在正文顶部，两处不在同一棵组件树里，
 * 所以和删除一样放在按主机与提供方分键的 store 里。失败会一直留着，直到用户关闭或再拨一次。
 */

// enabled 是这次要写入的值，失败提示据此说"无法启用"还是"无法停用"。
export interface ProviderEnablementError {
  enabled: boolean;
  message: string;
}

export type ProviderEnablementState =
  | { status: "idle" }
  | { status: "saving" }
  | ({ status: "failed" } & ProviderEnablementError);

interface ProviderEnablementStoreState {
  byKey: Record<string, ProviderEnablementState>;
}

const IDLE: ProviderEnablementState = { status: "idle" };

export const useProviderEnablementStore = create<ProviderEnablementStoreState>()(() => ({
  byKey: {},
}));

function enablementKey(serverId: string, provider: string): string {
  return `${serverId}\u0000${provider}`;
}

function setEnablementState(key: string, state: ProviderEnablementState): void {
  useProviderEnablementStore.setState((current) => {
    const byKey = { ...current.byKey };
    if (state.status === "idle") {
      delete byKey[key];
    } else {
      byKey[key] = state;
    }
    return { byKey };
  });
}

export function selectProviderEnablement(
  state: ProviderEnablementStoreState,
  serverId: string,
  provider: string,
): ProviderEnablementState {
  return state.byKey[enablementKey(serverId, provider)] ?? IDLE;
}

export function useProviderEnablement(serverId: string, provider: string): ProviderEnablementState {
  return useProviderEnablementStore((state) => selectProviderEnablement(state, serverId, provider));
}

export async function setProviderEnabled(
  serverId: string,
  provider: string,
  change: { enabled: boolean; write: () => Promise<unknown> },
): Promise<void> {
  const { enabled, write } = change;
  const key = enablementKey(serverId, provider);
  if (useProviderEnablementStore.getState().byKey[key]?.status === "saving") return;
  setEnablementState(key, { status: "saving" });
  try {
    await write();
    setEnablementState(key, IDLE);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setEnablementState(key, { status: "failed", enabled, message });
  }
}

export function dismissProviderEnablementError(serverId: string, provider: string): void {
  const key = enablementKey(serverId, provider);
  if (useProviderEnablementStore.getState().byKey[key]?.status !== "failed") return;
  setEnablementState(key, IDLE);
}
