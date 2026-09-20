import { describe, expect, test } from "vitest";

import {
  TerminalStreamOpcode,
  encodeTerminalResizePayload,
  type TerminalStreamFrame,
} from "@osuna/protocol/binary-frames/index";
import { SessionDelivery } from "../server/session/owned-subscriptions/index.js";
import type {
  SessionInboundMessage,
  SessionOutboundMessage,
  TerminalState,
} from "@osuna/protocol/messages";
import type pino from "pino";

import { TerminalSessionController } from "./terminal-session-controller.js";
import type { TerminalManager } from "./terminal-manager.js";
import type { TerminalSession } from "./terminal.js";

function createFixture(): {
  terminal: TerminalSession;
  terminalManager: TerminalManager;
  appliedSizes: string[];
  appliedBackgrounds: string[];
} {
  const appliedSizes: string[] = [];
  const appliedBackgrounds: string[] = [];
  let size = { rows: 24, cols: 80 };
  const state = (): TerminalState => ({
    rows: size.rows,
    cols: size.cols,
    grid: [],
    scrollback: [],
    cursor: { row: 0, col: 0 },
  });
  const terminal = {
    id: "terminal-1",
    name: "Terminal",
    cwd: "/tmp",
    workspaceId: "workspace-1",
    getSize: () => size,
    send: (message: Parameters<TerminalSession["send"]>[0]) => {
      if (message.type === "view_attributes") {
        appliedBackgrounds.push(message.attributes.background);
        return;
      }
      if (message.type !== "resize") {
        return;
      }
      size = { rows: message.rows, cols: message.cols };
      appliedSizes.push(`${message.cols}x${message.rows}`);
    },
    subscribe: () => () => {},
    onExit: () => () => {},
  } as unknown as TerminalSession;
  const terminalManager = {
    getTerminal: () => terminal,
    getTerminalState: async () => ({ state: state(), revision: 0 }),
  } as unknown as TerminalManager;
  return { terminal, terminalManager, appliedSizes, appliedBackgrounds };
}

function viewAttributesMessage(
  background: string,
): Extract<SessionInboundMessage, { type: "terminal_input" }> {
  return {
    type: "terminal_input",
    terminalId: "terminal-1",
    message: {
      type: "view_attributes",
      attributes: { foreground: "#1a1a1e", background, cursor: "#1a1a1e" },
    },
  };
}

function createController(
  terminalManager: TerminalManager,
  outbound: SessionOutboundMessage[] = [],
): TerminalSessionController {
  return new TerminalSessionController({
    terminalManager,
    emit: (message) => outbound.push(message),
    emitBinary: () => {},
    hasBinaryChannel: () => true,
    isPathWithinRoot: () => false,
    sessionLogger: { warn: () => {}, error: () => {} } as unknown as pino.Logger,
  });
}

function resizeFrame(input: {
  rows: number;
  cols: number;
  intent?: "claim" | "update";
}): TerminalStreamFrame {
  return {
    opcode: TerminalStreamOpcode.Resize,
    slot: 0,
    payload: encodeTerminalResizePayload(input),
  };
}

describe("terminal session controller size ownership", () => {
  test("routes JSON, binary, and attach sizes through one connection-owned arbiter", async () => {
    const { terminalManager, appliedSizes } = createFixture();
    const controllerA = createController(terminalManager);
    const controllerB = createController(terminalManager);
    const sourceA = {};
    const sourceB = {};
    const ownership = new SessionDelivery(() => {});
    // Legacy binary resize and attach sizing remain source scoped.
    const dispatch = (
      controller: TerminalSessionController,
      source: object,
      message: SessionInboundMessage,
    ) =>
      ownership.request(source, message, async () => {
        await controller.dispatch(message, ownership);
      });

    await dispatch(controllerA, sourceA, {
      type: "terminal_input",
      terminalId: "terminal-1",
      message: { type: "resize", rows: 30, cols: 100, intent: "claim" },
    });
    await dispatch(controllerA, sourceA, {
      type: "terminal_input",
      terminalId: "terminal-1",
      message: { type: "resize", rows: 31, cols: 101, intent: "update" },
    });
    await dispatch(controllerB, sourceB, {
      type: "terminal_input",
      terminalId: "terminal-1",
      message: { type: "resize", rows: 32, cols: 102, intent: "update" },
    });

    await dispatch(controllerB, sourceB, {
      type: "subscribe_terminal_request",
      terminalId: "terminal-1",
      requestId: "subscribe-b",
      restore: { mode: "live" },
    });
    controllerB.handleBinaryFrame(resizeFrame({ rows: 33, cols: 103, intent: "claim" }), sourceB);
    await dispatch(controllerA, sourceA, {
      type: "terminal_input",
      terminalId: "terminal-1",
      message: { type: "resize", rows: 34, cols: 104, intent: "update" },
    });

    await dispatch(controllerA, sourceA, {
      type: "subscribe_terminal_request",
      terminalId: "terminal-1",
      requestId: "subscribe-a",
      restore: { mode: "live", size: { rows: 35, cols: 105 } },
    });
    controllerB.handleBinaryFrame(resizeFrame({ rows: 36, cols: 106, intent: "update" }), sourceB);

    await ownership.close();
    expect(appliedSizes).toEqual(["100x30", "101x31", "103x33", "105x35"]);
  });

  test("applies view attributes only from the connection that owns the terminal size", async () => {
    const { terminalManager, appliedBackgrounds } = createFixture();
    const controllerA = createController(terminalManager);
    const controllerB = createController(terminalManager);
    const sourceA = {};
    const sourceB = {};
    const ownership = new SessionDelivery(() => {});
    const dispatch = (
      controller: TerminalSessionController,
      source: object,
      message: SessionInboundMessage,
    ) =>
      ownership.request(source, message, async () => {
        await controller.dispatch(message, ownership);
      });

    // 尚无所有者：忽略。
    await dispatch(controllerA, sourceA, viewAttributesMessage("#000000"));

    await dispatch(controllerA, sourceA, {
      type: "terminal_input",
      terminalId: "terminal-1",
      message: { type: "resize", rows: 30, cols: 100, intent: "claim" },
    });
    await dispatch(controllerA, sourceA, viewAttributesMessage("#ffffff"));
    // 非所有者：忽略。
    await dispatch(controllerB, sourceB, viewAttributesMessage("#111111"));

    // B claim 之后成为新所有者，其颜色生效，A 的被忽略。
    await dispatch(controllerB, sourceB, {
      type: "terminal_input",
      terminalId: "terminal-1",
      message: { type: "resize", rows: 30, cols: 100, intent: "claim" },
    });
    await dispatch(controllerB, sourceB, viewAttributesMessage("#222222"));
    await dispatch(controllerA, sourceA, viewAttributesMessage("#333333"));

    await ownership.close();
    expect(appliedBackgrounds).toEqual(["#ffffff", "#222222"]);
  });
});
