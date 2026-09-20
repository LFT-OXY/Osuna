import type { TerminalViewAttributes } from "@getpaseo/protocol/messages";

import type { TerminalSession } from "./terminal.js";

interface TerminalSizeRequest {
  rows: number;
  cols: number;
  intent?: "claim" | "update";
}

const terminalSizeOwners = new WeakMap<TerminalSession, WeakRef<object>>();

export function applyTerminalSize(
  terminal: TerminalSession,
  owner: object,
  request: TerminalSizeRequest,
): boolean {
  const intent = resolveTerminalSizeIntent(request.intent);
  if (intent === "update" && terminalSizeOwners.get(terminal)?.deref() !== owner) {
    return false;
  }

  if (intent === "claim") {
    terminalSizeOwners.set(terminal, new WeakRef(owner));
  }

  const currentSize = terminal.getSize();
  if (currentSize.rows !== request.rows || currentSize.cols !== request.cols) {
    terminal.send({ type: "resize", rows: request.rows, cols: request.cols });
  }
  return true;
}

// 视图属性跟随尺寸所有者：只有当前所有者推送的颜色送达会话，其余连接静默忽略。
// 不单独仲裁颜色，焦点切到另一台设备时颜色随尺寸 claim 一起转移。
export function applyTerminalViewAttributes(
  terminal: TerminalSession,
  owner: object,
  attributes: TerminalViewAttributes,
): boolean {
  if (terminalSizeOwners.get(terminal)?.deref() !== owner) {
    return false;
  }
  terminal.send({ type: "view_attributes", attributes });
  return true;
}

function resolveTerminalSizeIntent(intent: TerminalSizeRequest["intent"]): "claim" | "update" {
  if (intent) {
    return intent;
  }
  // COMPAT(terminalSizeOwnership): added in v0.2.6, remove after 2027-02-02 once the client floor sends resize intent.
  return "claim";
}
