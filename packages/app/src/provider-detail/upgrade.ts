import { create } from "zustand";
import type { ProviderUpgradeResponsePayload } from "@getpaseo/protocol/messages";

/*
 * 一键升级的进行状态。列表行和详情页的版本一节显示同一个提供方的升级，
 * 两处不在同一棵组件树里，所以放在按主机与提供方分键的 store 里。失败一直留着，直到关闭或重试。
 */

export type ProviderUpgradeState =
  | { status: "idle" }
  | { status: "upgrading" }
  // errorCode 为 null 表示请求本身没有送达（断线、超时），error 是那次请求的错误。
  | { status: "failed"; errorCode: string | null; error: string | null; output: string | null };

interface ProviderUpgradeStoreState {
  byKey: Record<string, ProviderUpgradeState>;
}

export interface ProviderUpgradeSteps {
  run: () => Promise<ProviderUpgradeResponsePayload>;
  // 升级成功后调用，带上 daemon 重新探测到的版本。
  onUpgraded: (version: string | undefined) => void;
}

const IDLE: ProviderUpgradeState = { status: "idle" };

export const useProviderUpgradeStore = create<ProviderUpgradeStoreState>()(() => ({
  byKey: {},
}));

function upgradeKey(serverId: string, provider: string): string {
  return `${serverId}\u0000${provider}`;
}

function setUpgradeState(key: string, state: ProviderUpgradeState): void {
  useProviderUpgradeStore.setState((current) => {
    const byKey = { ...current.byKey };
    if (state.status === "idle") {
      delete byKey[key];
    } else {
      byKey[key] = state;
    }
    return { byKey };
  });
}

export function selectProviderUpgrade(
  state: ProviderUpgradeStoreState,
  serverId: string,
  provider: string,
): ProviderUpgradeState {
  return state.byKey[upgradeKey(serverId, provider)] ?? IDLE;
}

export function useProviderUpgradeState(serverId: string, provider: string): ProviderUpgradeState {
  return useProviderUpgradeStore((state) => selectProviderUpgrade(state, serverId, provider));
}

export async function upgradeProvider(
  serverId: string,
  provider: string,
  steps: ProviderUpgradeSteps,
): Promise<void> {
  const key = upgradeKey(serverId, provider);
  if (useProviderUpgradeStore.getState().byKey[key]?.status === "upgrading") return;
  setUpgradeState(key, { status: "upgrading" });
  try {
    const result = await steps.run();
    if (result.ok) {
      setUpgradeState(key, IDLE);
      steps.onUpgraded(result.version);
      return;
    }
    setUpgradeState(key, {
      status: "failed",
      errorCode: result.errorCode ?? null,
      error: result.error ?? null,
      output: result.output ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setUpgradeState(key, { status: "failed", errorCode: null, error: message, output: null });
  }
}

export function dismissProviderUpgradeError(serverId: string, provider: string): void {
  const key = upgradeKey(serverId, provider);
  if (useProviderUpgradeStore.getState().byKey[key]?.status !== "failed") return;
  setUpgradeState(key, IDLE);
}
