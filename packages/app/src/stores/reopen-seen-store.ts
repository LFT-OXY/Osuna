import { create } from "zustand";

/*
 * 提供方页提示区「要重开谁」点「知道了」时看到的那些副本，按主机与提供方记（magpie staleSeen，只记在内存里）：
 * 同一台主机、同一个提供方的副本没变就不再显示，变了再出现。
 */

export interface ReopenSeenTarget {
  serverId: string;
  provider: string;
}

interface ReopenSeenState {
  // 「主机\0提供方」→ 点「知道了」时那些副本的指纹。
  seen: Record<string, string>;
  markSeen: (input: ReopenSeenTarget & { signature: string }) => void;
}

export function reopenSeenKey(target: ReopenSeenTarget): string {
  return `${target.serverId}\0${target.provider}`;
}

export const useReopenSeenStore = create<ReopenSeenState>()((set) => ({
  seen: {},
  markSeen: ({ signature, ...target }) =>
    set((state) => ({ seen: { ...state.seen, [reopenSeenKey(target)]: signature } })),
}));
