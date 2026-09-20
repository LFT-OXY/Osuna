import type { SessionOutboundMessage, TerminalViewAttributes } from "@getpaseo/protocol/messages";
import { describe, expect, it } from "vitest";

import {
  TerminalStreamController,
  type TerminalStreamControllerClient,
  type TerminalStreamControllerStatus,
} from "./terminal-stream-controller";

interface TerminalSnapshot {
  rows: number;
  cols: number;
  grid: Array<Array<{ char: string }>>;
  scrollback: Array<Array<{ char: string }>>;
  cursor: { row: number; col: number };
}

function terminalCellText(cell: { char: string }): string {
  return cell.char;
}

function terminalRowText(row: Array<{ char: string }>): string {
  return row.map(terminalCellText).join("");
}

function terminalSnapshotText(state: TerminalSnapshot): string {
  return state.grid.map(terminalRowText).join("\n");
}

function terminalOutput(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

type TerminalStreamEvent =
  | { terminalId: string; type: "output"; data: Uint8Array }
  | { terminalId: string; type: "snapshot"; state: TerminalSnapshot }
  | { terminalId: string; type: "restore"; data: Uint8Array };

class FakeTerminalStreamClient implements TerminalStreamControllerClient {
  private readonly updates = new Set<(message: SessionOutboundMessage) => void>();
  emitUpdate(message: SessionOutboundMessage): void {
    for (const receive of this.updates) receive(message);
  }
  private readonly listeners = new Set<(event: TerminalStreamEvent) => void>();
  public subscribeCalls: Array<{ terminalId: string; options?: unknown }> = [];
  public unsubscribeCalls: string[] = [];
  public resizeCalls: Array<{
    terminalId: string;
    rows: number;
    cols: number;
    intent?: "claim" | "update";
  }> = [];
  public viewAttributesCalls: Array<{ terminalId: string; attributes: TerminalViewAttributes }> =
    [];
  // resize 与 view_attributes 的发送顺序，用于断言"claim 之后紧接视图属性"。
  public sentKinds: Array<"resize:claim" | "resize:update" | "view_attributes"> = [];
  public nextSubscribeResults: Array<{ terminalId: string; error?: string | null }> = [];

  observeTerminal: TerminalStreamControllerClient["observeTerminal"] = (
    terminalId,
    receive,
    options,
  ) => {
    this.subscribeCalls.push({ terminalId, ...(options ? { options } : {}) });
    const result = this.nextSubscribeResults.shift();
    if (!result) throw new Error("Missing fake subscribe result");
    const subscriptionId = `terminal-${this.subscribeCalls.length}`;
    const listener = (event: TerminalStreamEvent) => {
      if (event.terminalId === terminalId) receive({ ...event, subscriptionId });
    };
    this.listeners.add(listener);
    const ready = result.error
      ? Promise.reject(new Error(result.error))
      : Promise.resolve({
          terminalId,
          subscriptionId,
          slot: this.subscribeCalls.length,
          error: null,
          requestId: subscriptionId,
        });
    let released = false;
    return {
      subscriptionId,
      ready,
      subscribe: (observer) => {
        this.updates.add(observer.update);
        return () => {
          this.updates.delete(observer.update);
        };
      },
      release: async () => {
        if (released) return;
        released = true;
        this.listeners.delete(listener);
        this.unsubscribeCalls.push(terminalId);
      },
    };
  };

  sendTerminalInput(
    terminalId: string,
    message: { type: "resize"; rows: number; cols: number; intent?: "claim" | "update" },
  ): void {
    this.resizeCalls.push({
      terminalId,
      rows: message.rows,
      cols: message.cols,
      ...(message.intent ? { intent: message.intent } : {}),
    });
    this.sentKinds.push(message.intent === "claim" ? "resize:claim" : "resize:update");
  }

  sendTerminalViewAttributes(terminalId: string, attributes: TerminalViewAttributes): void {
    this.viewAttributesCalls.push({ terminalId, attributes });
    this.sentKinds.push("view_attributes");
  }

  emit(event: TerminalStreamEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

function createHarness(input?: {
  client?: FakeTerminalStreamClient;
  getViewAttributes?: () => TerminalViewAttributes | undefined;
}) {
  const client = input?.client ?? new FakeTerminalStreamClient();
  const outputs: Array<{ terminalId: string; data: Uint8Array }> = [];
  const restores: Array<{ terminalId: string; data: Uint8Array }> = [];
  const snapshots: Array<{ terminalId: string; text: string }> = [];
  const statuses: TerminalStreamControllerStatus[] = [];
  const exits: string[] = [];
  const controller = new TerminalStreamController({
    client,
    onExit: (terminalId) => exits.push(terminalId),
    getPreferredSize: () => ({ rows: 24, cols: 80 }),
    onOutput: (output) => {
      outputs.push(output);
    },
    onRestore: (restore) => {
      restores.push(restore);
    },
    onSnapshot: ({ terminalId, state }) => {
      snapshots.push({
        terminalId,
        text: terminalSnapshotText(state),
      });
    },
    onStatusChange: (status) => {
      statuses.push(status);
    },
    getViewAttributes: input?.getViewAttributes ?? (() => undefined),
  });

  return { client, controller, outputs, restores, snapshots, statuses, exits };
}

const LIGHT_VIEW_ATTRIBUTES: TerminalViewAttributes = {
  foreground: "#1a1a1e",
  background: "#ffffff",
  cursor: "#1a1a1e",
};
const DARK_VIEW_ATTRIBUTES: TerminalViewAttributes = {
  foreground: "#e6e6e6",
  background: "#0b0b0b",
  cursor: "#e6e6e6",
};

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("terminal-stream-controller", () => {
  it("subscribes, resizes, and forwards snapshot/output events", async () => {
    const harness = createHarness();
    harness.client.nextSubscribeResults.push({ terminalId: "term-1", error: null });

    harness.controller.setTerminal({ terminalId: "term-1" });
    await flushAsyncWork();

    harness.client.emit({
      terminalId: "term-1",
      type: "snapshot",
      state: {
        rows: 1,
        cols: 5,
        grid: [[{ char: "h" }, { char: "e" }, { char: "l" }, { char: "l" }, { char: "o" }]],
        scrollback: [],
        cursor: { row: 0, col: 5 },
      },
    });
    const outputData = terminalOutput(" world");
    harness.client.emit({
      terminalId: "term-1",
      type: "output",
      data: outputData,
    });

    expect(harness.client.subscribeCalls).toEqual([{ terminalId: "term-1" }]);
    expect(harness.client.resizeCalls).toEqual([
      { terminalId: "term-1", rows: 24, cols: 80, intent: "claim" },
    ]);
    expect(harness.snapshots).toEqual([{ terminalId: "term-1", text: "hello" }]);
    expect(harness.outputs[0]?.data).toBe(outputData);
    expect(harness.outputs).toEqual([{ terminalId: "term-1", data: terminalOutput(" world") }]);
    expect(harness.statuses.at(-1)).toEqual({
      terminalId: "term-1",
      isAttaching: false,
      error: null,
    });
  });

  it("surfaces subscribe failures without retrying", async () => {
    const harness = createHarness();
    harness.client.nextSubscribeResults.push({
      terminalId: "term-1",
      error: "network disconnected",
    });

    harness.controller.setTerminal({ terminalId: "term-1" });
    await flushAsyncWork();

    expect(harness.client.subscribeCalls).toEqual([{ terminalId: "term-1" }]);
    expect(harness.statuses.at(-1)).toEqual({
      terminalId: "term-1",
      isAttaching: false,
      error: "network disconnected",
    });
  });

  it("treats terminal exit as final and does not reconnect", async () => {
    const harness = createHarness();
    harness.client.nextSubscribeResults.push({ terminalId: "term-1", error: null });

    harness.controller.setTerminal({ terminalId: "term-1" });
    await flushAsyncWork();
    harness.controller.handleTerminalExit({ terminalId: "term-1" });
    await flushAsyncWork();

    expect(harness.client.subscribeCalls).toEqual([{ terminalId: "term-1" }]);
    expect(harness.statuses.at(-1)).toEqual({
      terminalId: "term-1",
      isAttaching: false,
      error: "Terminal exited",
    });
  });

  it("requests configured restore options and forwards restore output", async () => {
    const client = new FakeTerminalStreamClient();
    const harness = createHarness({ client });
    client.nextSubscribeResults.push({ terminalId: "term-1", error: null });
    const controller = new TerminalStreamController({
      client,
      getPreferredSize: () => ({ rows: 24, cols: 80 }),
      getViewAttributes: () => undefined,
      getRestoreOptions: () => ({
        mode: "visible-snapshot",
        scrollbackLines: 200,
        size: { rows: 24, cols: 80 },
      }),
      onOutput: (output) => harness.outputs.push(output),
      onRestore: (restore) => harness.restores.push(restore),
      onSnapshot: ({ terminalId, state }) => {
        harness.snapshots.push({
          terminalId,
          text: terminalSnapshotText(state),
        });
      },
    });

    controller.setTerminal({ terminalId: "term-1" });
    await flushAsyncWork();
    const restoreData = terminalOutput("restored");
    client.emit({
      terminalId: "term-1",
      type: "restore",
      data: restoreData,
    });
    controller.dispose();

    expect(client.subscribeCalls).toEqual([
      {
        terminalId: "term-1",
        options: {
          restore: {
            mode: "visible-snapshot",
            scrollbackLines: 200,
            size: { rows: 24, cols: 80 },
          },
        },
      },
    ]);
    expect(client.resizeCalls).toEqual([
      { terminalId: "term-1", rows: 24, cols: 80, intent: "claim" },
    ]);
    expect(harness.restores[0]?.data).toBe(restoreData);
    expect(harness.restores).toEqual([{ terminalId: "term-1", data: terminalOutput("restored") }]);
    expect(harness.outputs).toEqual([]);
  });

  it("unsubscribes when switching terminals and on dispose", async () => {
    const harness = createHarness();
    harness.client.nextSubscribeResults.push({ terminalId: "term-1", error: null });
    harness.client.nextSubscribeResults.push({ terminalId: "term-2", error: null });

    harness.controller.setTerminal({ terminalId: "term-1" });
    await flushAsyncWork();
    harness.controller.setTerminal({ terminalId: "term-2" });
    await flushAsyncWork();
    harness.controller.dispose();

    expect(harness.client.unsubscribeCalls).toEqual(["term-1", "term-2"]);
    expect(harness.statuses.at(-1)).toEqual({
      terminalId: null,
      isAttaching: false,
      error: null,
    });
  });
});

describe("terminal-stream-controller view attributes", () => {
  it("pushes view attributes right after the attach claim resize", async () => {
    const harness = createHarness({ getViewAttributes: () => LIGHT_VIEW_ATTRIBUTES });
    harness.client.nextSubscribeResults.push({ terminalId: "term-1", error: null });

    harness.controller.setTerminal({ terminalId: "term-1" });
    await flushAsyncWork();

    expect(harness.client.sentKinds).toEqual(["resize:claim", "view_attributes"]);
    expect(harness.client.viewAttributesCalls).toEqual([
      { terminalId: "term-1", attributes: LIGHT_VIEW_ATTRIBUTES },
    ]);
  });

  it("re-pushes on theme change only when the colors actually changed", async () => {
    let current = LIGHT_VIEW_ATTRIBUTES;
    const harness = createHarness({ getViewAttributes: () => current });
    harness.client.nextSubscribeResults.push({ terminalId: "term-1", error: null });
    harness.controller.setTerminal({ terminalId: "term-1" });
    await flushAsyncWork();

    // 同值：不重发。
    current = { ...LIGHT_VIEW_ATTRIBUTES };
    harness.controller.syncViewAttributes();
    expect(harness.client.viewAttributesCalls).toHaveLength(1);

    // 变化：重发。
    current = DARK_VIEW_ATTRIBUTES;
    harness.controller.syncViewAttributes();
    expect(harness.client.viewAttributesCalls).toEqual([
      { terminalId: "term-1", attributes: LIGHT_VIEW_ATTRIBUTES },
      { terminalId: "term-1", attributes: DARK_VIEW_ATTRIBUTES },
    ]);
  });

  it("always re-pushes after a later size claim even when the colors are unchanged", async () => {
    const harness = createHarness({ getViewAttributes: () => LIGHT_VIEW_ATTRIBUTES });
    harness.client.nextSubscribeResults.push({ terminalId: "term-1", error: null });
    harness.controller.setTerminal({ terminalId: "term-1" });
    await flushAsyncWork();

    harness.controller.syncViewAttributes({ afterClaim: true });

    expect(harness.client.viewAttributesCalls).toHaveLength(2);
  });

  it("sends nothing when there are no view attributes to send", async () => {
    const harness = createHarness({ getViewAttributes: () => undefined });
    harness.client.nextSubscribeResults.push({ terminalId: "term-1", error: null });
    harness.controller.setTerminal({ terminalId: "term-1" });
    await flushAsyncWork();
    harness.controller.syncViewAttributes();

    expect(harness.client.sentKinds).toEqual(["resize:claim"]);
    expect(harness.client.viewAttributesCalls).toEqual([]);
  });

  it("does not push view attributes without an attached terminal", async () => {
    const harness = createHarness({ getViewAttributes: () => LIGHT_VIEW_ATTRIBUTES });

    harness.controller.syncViewAttributes();
    harness.controller.dispose();
    harness.controller.syncViewAttributes({ afterClaim: true });

    expect(harness.client.viewAttributesCalls).toEqual([]);
  });
});

it("reports observation failure without declaring the PTY exited, then allows reattach", async () => {
  const h = createHarness();
  h.client.nextSubscribeResults.push({ terminalId: "term-1", error: null });
  h.controller.setTerminal({ terminalId: "term-1" });
  await flushAsyncWork();
  h.client.emitUpdate({
    type: "terminal_stream_exit",
    payload: { terminalId: "term-1", subscriptionId: "terminal-1", error: "Snapshot read failed" },
  });
  expect(h.statuses.at(-1)).toEqual({
    terminalId: "term-1",
    isAttaching: false,
    error: "Snapshot read failed",
  });
  expect(h.exits).toEqual([]);
  expect(h.client.unsubscribeCalls).toEqual(["term-1"]);
  h.client.nextSubscribeResults.push({ terminalId: "term-1", error: null });
  h.controller.setTerminal({ terminalId: "term-1" });
  await flushAsyncWork();
  h.client.emit({ terminalId: "term-1", type: "output", data: terminalOutput("STILL ALIVE") });
  expect(h.outputs).toHaveLength(1);
  expect(h.statuses.at(-1)?.error).toBe(null);
  h.controller.dispose();
});
