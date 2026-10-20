import type { ApiEndpointLongConversations } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { WORKING_WINDOW } from "@getpaseo/protocol/api-endpoint/model-settings";
import { parseTokens, type TokenFormat } from "./model-settings-form";

/*
 * 「第三方接口」页的「长对话」（照 magpie 设置页的 Long conversations）：纯 TypeScript，无 React（docs/forms.md）。
 * 「完整窗口」开关一拨就存；压缩阈值在输入框交出（回车或离开）时存，同时关掉完整窗口（magpie SetCompactAt）。
 * 框里空着是 272K（灰字），填 272K 等于不设。存失败时开关回到原样、输入留着，原因留在原处。
 */

/** 交给主机的一次修改；compactAt 为 null 回到 272K，省略即不变。 */
export interface LongConversationsChange {
  fullContext: boolean;
  compactAt?: number | null;
}

export type LongConversationsStatus =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "failed"; message: string };

export interface LongConversationsFormState {
  fullContext: boolean;
  compactAt: { text: string; invalid: boolean };
  // 输入框灰字：没设时用的 272K，按界面语言写。
  placeholder: string;
  status: LongConversationsStatus;
}

export type CompactCommitResult = "saved" | "unchanged" | "invalid" | "failed";

export interface LongConversationsForm {
  getState(): LongConversationsFormState;
  subscribe(listener: () => void): () => void;
  setFullContext(on: boolean): Promise<void>;
  setCompactText(text: string): void;
  commitCompact(): Promise<CompactCommitResult>;
}

export function openLongConversationsForm(input: {
  initial: ApiEndpointLongConversations;
  // 失败原因，成功为 null。
  save: (change: LongConversationsChange) => Promise<string | null>;
  tokenFormat: TokenFormat;
}): LongConversationsForm {
  const { tokenFormat } = input;
  let fullContext = input.initial.fullContext === true;
  let savedCompact: number | null = input.initial.compactAt ?? null;
  let text = savedCompact === null ? "" : tokenFormat.format(savedCompact);
  let status: LongConversationsStatus = { kind: "idle" };
  const listeners = new Set<() => void>();

  function build(): LongConversationsFormState {
    return {
      fullContext,
      compactAt: { text, invalid: parseTokens(text, tokenFormat).kind === "invalid" },
      placeholder: tokenFormat.format(WORKING_WINDOW),
      status,
    };
  }
  let state = build();
  function publish() {
    state = build();
    for (const listener of listeners) listener();
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async setFullContext(on) {
      const before = fullContext;
      fullContext = on;
      status = { kind: "saving" };
      publish();
      const failure = await input.save({ fullContext: on });
      if (failure !== null) fullContext = before;
      status = failure === null ? { kind: "idle" } : { kind: "failed", message: failure };
      publish();
    },
    setCompactText(next) {
      text = next;
      publish();
    },
    async commitCompact() {
      const parsed = parseTokens(text, tokenFormat);
      if (parsed.kind === "invalid") return "invalid";
      let value = parsed.kind === "count" ? parsed.value : null;
      if (value === WORKING_WINDOW) value = null;
      if (value === savedCompact) return "unchanged";
      status = { kind: "saving" };
      publish();
      const failure = await input.save({ fullContext: false, compactAt: value });
      if (failure === null) {
        savedCompact = value;
        fullContext = false;
      }
      status = failure === null ? { kind: "idle" } : { kind: "failed", message: failure };
      publish();
      return failure === null ? "saved" : "failed";
    },
  };
}
