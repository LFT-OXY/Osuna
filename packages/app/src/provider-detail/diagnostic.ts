import { create } from "zustand";

/*
 * 诊断节的运行状态。手机上 ⋯ 在顶栏、诊断节在正文，两处不在同一棵组件树里，
 * 所以和删除状态一样放在按主机与提供方分键的 store 里。
 * reveals 是「滚到诊断节」的请求计数：⋯ 菜单与错误卡每点一次加一，诊断节看到变化就把自己滚进视野。
 */

export type ProviderDiagnosticState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "ready"; output: string; ranAt: string }
  | { status: "failed"; message: string };

interface ProviderDiagnosticStoreState {
  byKey: Record<string, ProviderDiagnosticState>;
  reveals: Record<string, number>;
}

const IDLE: ProviderDiagnosticState = { status: "idle" };

export const useProviderDiagnosticStore = create<ProviderDiagnosticStoreState>()(() => ({
  byKey: {},
  reveals: {},
}));

function diagnosticKey(serverId: string, provider: string): string {
  return `${serverId}\u0000${provider}`;
}

function setDiagnosticState(key: string, state: ProviderDiagnosticState): void {
  useProviderDiagnosticStore.setState((current) => ({
    byKey: { ...current.byKey, [key]: state },
  }));
}

export function selectProviderDiagnostic(
  state: ProviderDiagnosticStoreState,
  serverId: string,
  provider: string,
): ProviderDiagnosticState {
  return state.byKey[diagnosticKey(serverId, provider)] ?? IDLE;
}

export function selectProviderDiagnosticReveal(
  state: ProviderDiagnosticStoreState,
  serverId: string,
  provider: string,
): number {
  return state.reveals[diagnosticKey(serverId, provider)] ?? 0;
}

export function useProviderDiagnostic(serverId: string, provider: string): ProviderDiagnosticState {
  return useProviderDiagnosticStore((state) => selectProviderDiagnostic(state, serverId, provider));
}

export function useProviderDiagnosticReveal(serverId: string, provider: string): number {
  return useProviderDiagnosticStore((state) =>
    selectProviderDiagnosticReveal(state, serverId, provider),
  );
}

export async function runProviderDiagnostic(
  serverId: string,
  provider: string,
  fetchDiagnostic: () => Promise<string>,
): Promise<void> {
  const key = diagnosticKey(serverId, provider);
  if (useProviderDiagnosticStore.getState().byKey[key]?.status === "running") return;
  setDiagnosticState(key, { status: "running" });
  try {
    const output = await fetchDiagnostic();
    setDiagnosticState(key, { status: "ready", output, ranAt: new Date().toISOString() });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setDiagnosticState(key, { status: "failed", message });
  }
}

export function revealProviderDiagnostic(serverId: string, provider: string): void {
  const key = diagnosticKey(serverId, provider);
  useProviderDiagnosticStore.setState((current) => ({
    reveals: { ...current.reveals, [key]: (current.reveals[key] ?? 0) + 1 },
  }));
}
