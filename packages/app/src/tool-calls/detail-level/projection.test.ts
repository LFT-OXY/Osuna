import { describe, expect, it } from "vitest";
import type { ToolCallDetail } from "@osuna/protocol/agent-types";
import type { StreamItem, ToolCallItem } from "@/types/stream";
import {
  prepareToolCallHistory,
  projectToolCallDetailLevel,
  type PreparedToolCallHistory,
  type ToolCallDetailLevel,
} from "./projection";

type AssistantMessageItem = Extract<StreamItem, { kind: "assistant_message" }>;

function toolCall(
  id: string,
  detail: ToolCallDetail,
  options: {
    name?: string;
    status?: "running" | "completed" | "failed" | "canceled";
  } = {},
): ToolCallItem {
  return {
    kind: "tool_call",
    id,
    timestamp: new Date(`2026-01-01T00:00:${id.padStart(2, "0")}.000Z`),
    payload: {
      source: "agent",
      data: {
        provider: "claude",
        callId: id,
        name: options.name ?? detail.type,
        status: options.status ?? "completed",
        error: options.status === "failed" ? "boom" : null,
        detail,
      },
    },
  };
}

function assistant(id: string): AssistantMessageItem {
  return {
    kind: "assistant_message",
    id,
    text: id,
    timestamp: new Date("2026-01-01T00:01:00.000Z"),
  };
}

function createAgentCall(
  id: string,
  options: { name?: string; status?: "running" | "completed" } = {},
): ToolCallItem {
  return toolCall(
    id,
    { type: "unknown", input: { title: `Task ${id}`, provider: "codex/gpt-5.4" }, output: null },
    { name: options.name ?? "osuna.create_agent", status: options.status },
  );
}

function project(input: {
  level: ToolCallDetailLevel;
  tail?: StreamItem[];
  head?: StreamItem[];
  isTurnActive?: boolean;
  preparedHistory?: PreparedToolCallHistory | null;
  dispatchGroups?: boolean;
}) {
  const tail = input.tail ?? [];
  const dispatchGroups = input.dispatchGroups ?? false;
  return projectToolCallDetailLevel({
    level: input.level,
    tail,
    head: input.head ?? [],
    preparedHistory:
      input.preparedHistory ?? prepareToolCallHistory({ level: input.level, tail, dispatchGroups }),
    isTurnActive: input.isTurnActive ?? false,
    dispatchGroups,
  });
}

describe("tool call detail-level projection", () => {
  it.each(["detailed", "overview"] as const)(
    "keeps pending approval tools out of %s presentation without removing their canonical position",
    (level) => {
      const pending = toolCall(
        "1",
        { type: "plan", text: "Ship it" },
        { name: "ExitPlanMode", status: "running" },
      );
      const followUp = {
        kind: "user_message",
        id: "question",
        text: "What about tests?",
        timestamp: new Date(2),
      } satisfies StreamItem;
      const tail = [pending, followUp];
      expect(project({ level, tail }).tail).toEqual([followUp]);
      expect(tail).toEqual([pending, followUp]);
      const rejected = toolCall("1", { type: "plan", text: "Ship it" }, { name: "plan_approval" });
      expect(project({ level, tail: [rejected, followUp] }).tail).toEqual([rejected, followUp]);
    },
  );

  it("passes detailed timelines through without grouping work", () => {
    const tail = [toolCall("1", { type: "shell", command: "one" })];
    const head = [toolCall("2", { type: "shell", command: "two" })];

    const prepared = prepareToolCallHistory({ level: "detailed", tail, dispatchGroups: false });
    const result = project({ level: "detailed", tail, head, preparedHistory: prepared });

    expect(prepared).toBeNull();
    expect(result.tail).toBe(tail);
    expect(result.head).toBe(head);
    expect(result.groupsByHostId.size).toBe(0);
  });

  it("keeps one stable overview host as a run grows", () => {
    const firstCall = toolCall("1", { type: "shell", command: "one" });
    const secondCall = toolCall("2", { type: "read", filePath: "/repo/a.ts" });
    const prepared = prepareToolCallHistory({ level: "overview", tail: [], dispatchGroups: false });

    const single = project({
      level: "overview",
      head: [firstCall],
      isTurnActive: true,
      preparedHistory: prepared,
    });
    expect(single.head).toEqual([firstCall]);
    expect(single.groupsByHostId.get(firstCall.id)?.run).toMatchObject({
      calls: [firstCall],
      latest: firstCall,
      isSealed: false,
    });

    const grouped = project({
      level: "overview",
      head: [firstCall, secondCall],
      isTurnActive: true,
      preparedHistory: prepared,
    });
    expect(grouped.head).toEqual([
      expect.objectContaining({ id: firstCall.id, timestamp: secondCall.timestamp }),
    ]);
    expect(grouped.groupsByHostId.get(firstCall.id)?.run).toMatchObject({
      calls: [firstCall, secondCall],
      latest: secondCall,
      isSealed: false,
    });
  });

  it("keeps a parallel group loading while any call is still running", () => {
    const calls = [
      toolCall("1", { type: "shell", command: "slow" }, { status: "running" }),
      toolCall("2", { type: "shell", command: "done" }),
    ];
    const result = project({ level: "overview", head: calls, isTurnActive: true });

    expect(result.groupsByHostId.get("1")).toMatchObject({ isLoading: true });
  });

  it("builds a loading aggregate for a one-call run", () => {
    const call = toolCall("1", { type: "shell", command: "one" }, { status: "running" });
    const result = project({ level: "overview", head: [call], isTurnActive: true });
    const group = result.groupsByHostId.get(call.id);
    if (!group) {
      throw new Error("Expected an overview group");
    }

    expect(group).toMatchObject({
      isLoading: true,
      summary: { commandCount: 1 },
    });
  });

  it("keeps an active overview group on its latest call until a visible boundary arrives", () => {
    const calls = [
      toolCall("1", { type: "shell", command: "one" }),
      toolCall("2", { type: "read", filePath: "/repo/a.ts" }),
      toolCall("3", { type: "read", filePath: "/repo/b.ts" }),
      toolCall("4", { type: "edit", filePath: "/repo/a.ts" }),
    ];
    const prepared = prepareToolCallHistory({ level: "overview", tail: [], dispatchGroups: false });
    const active = project({
      level: "overview",
      head: calls,
      isTurnActive: true,
      preparedHistory: prepared,
    });
    const activeGroup = active.groupsByHostId.get("1");

    expect(activeGroup).toMatchObject({
      mode: "overview",
      run: { id: "1", latest: calls[3], isSealed: false },
    });
    const boundary = assistant("answer");
    const sealed = project({
      level: "overview",
      head: [...calls, boundary],
      isTurnActive: true,
      preparedHistory: prepared,
    });
    expect(sealed.groupsByHostId.get("1")).toMatchObject({
      mode: "overview",
      run: { latest: calls[3], isSealed: true },
      summary: { editedFileCount: 1, readFileCount: 2, commandCount: 1 },
    });
  });

  it("keeps a running overview group live before the agent lifecycle catches up", () => {
    const calls = ["1", "2", "3", "4"].map((id) =>
      toolCall(id, { type: "shell", command: id }, { status: "running" }),
    );

    const result = project({
      level: "overview",
      tail: calls,
      isTurnActive: false,
    });

    expect(result.groupsByHostId.get("1")).toMatchObject({
      run: { latest: calls[3], isSealed: false },
      isLoading: true,
      summary: { commandCount: 4 },
    });
  });

  it("seals the trailing overview group only when the turn ends", () => {
    const calls = ["1", "2", "3", "4"].map((id) => toolCall(id, { type: "shell", command: id }));
    const prepared = prepareToolCallHistory({ level: "overview", tail: [], dispatchGroups: false });

    const betweenCalls = project({
      level: "overview",
      head: calls,
      isTurnActive: true,
      preparedHistory: prepared,
    });
    const nextCall = toolCall("5", { type: "read", filePath: "/repo/a.ts" });
    const continued = project({
      level: "overview",
      head: [...calls, nextCall],
      isTurnActive: true,
      preparedHistory: prepared,
    });
    const ended = project({
      level: "overview",
      head: [...calls, nextCall],
      isTurnActive: false,
      preparedHistory: prepared,
    });

    expect(betweenCalls.groupsByHostId.get("1")?.run.isSealed).toBe(false);
    expect(continued.groupsByHostId.get("1")?.run).toMatchObject({
      latest: nextCall,
      isSealed: false,
    });
    expect(ended.groupsByHostId.get("1")?.run.isSealed).toBe(true);
  });

  it("builds overview summaries without category-specific presentation data", () => {
    const calls = [
      toolCall("1", { type: "read", filePath: "/repo/src/a.ts" }),
      toolCall("2", { type: "read", filePath: "/repo/src/b.ts" }),
      toolCall("3", { type: "shell", command: "npm test" }),
      toolCall("4", { type: "edit", filePath: "/repo/src/a.ts" }, { status: "failed" }),
    ];

    const overview = project({ level: "overview", head: calls });

    expect(overview.groupsByHostId.get("1")).toEqual({
      mode: "overview",
      run: expect.any(Object),
      isLoading: false,
      summary: {
        editedFileCount: 1,
        commandCount: 1,
        readFileCount: 2,
        searchCount: 0,
        otherToolCount: 0,
        osunaCallCount: 0,
      },
    });
  });

  it("distinguishes reads, searches, and other tools in overview", () => {
    const calls = [
      toolCall("1", { type: "read", filePath: "/repo/src/a.ts" }),
      toolCall("2", { type: "read", filePath: "C:\\repo\\src\\beta.ts" }),
      toolCall("3", { type: "fetch", url: "https://github.com/org/repo" }),
      toolCall(
        "4",
        { type: "search", query: "osuna", toolName: "web_search" },
        { status: "failed" },
      ),
      toolCall("5", { type: "fetch", url: "not a url" }),
    ];

    const result = project({ level: "overview", head: calls });

    expect(result.groupsByHostId.get("1")).toMatchObject({
      summary: {
        editedFileCount: 0,
        commandCount: 0,
        readFileCount: 2,
        searchCount: 1,
        otherToolCount: 2,
      },
    });
  });

  it("counts unique edited files and every shell command in overview", () => {
    const calls = [
      toolCall("1", { type: "edit", filePath: "/repo/a.ts" }),
      toolCall("2", { type: "edit", filePath: "/repo/a.ts" }),
      toolCall("3", { type: "write", filePath: "/repo/b.ts" }),
      toolCall("4", { type: "shell", command: "npm test" }),
      toolCall("5", { type: "shell", command: "npm run lint" }),
      toolCall("6", { type: "read", filePath: "/repo/c.ts" }),
    ];

    const result = project({ level: "overview", head: calls });

    expect(result.groupsByHostId.get("1")).toMatchObject({
      summary: {
        editedFileCount: 2,
        commandCount: 2,
        readFileCount: 1,
        otherToolCount: 0,
      },
    });
  });

  it("counts Osuna calls separately from other tools", () => {
    const calls = [
      toolCall("1", { type: "unknown", input: null, output: null }, { name: "osuna.list_agents" }),
      toolCall(
        "2",
        { type: "unknown", input: null, output: null },
        { name: "mcp__osuna__list_worktrees" },
      ),
      toolCall("3", { type: "fetch", url: "https://osuna.chinhae.cc" }),
      toolCall("4", { type: "fetch", url: "https://github.com/LFT-OXY" }),
    ];

    const result = project({ level: "overview", head: calls });

    expect(result.groupsByHostId.get("1")).toMatchObject({
      summary: { otherToolCount: 2, osunaCallCount: 2 },
    });
  });

  it("classifies direct Brave search and Osuna runtime tool names", () => {
    const unknownDetail = { type: "unknown" as const, input: null, output: null };
    const calls = [
      toolCall("1", unknownDetail, { name: "brave-search_brave_web_search" }),
      toolCall("2", unknownDetail, { name: "brave-search_brave_llm_context" }),
      toolCall("3", unknownDetail, { name: "osuna_list_providers" }),
      toolCall("4", unknownDetail, { name: "osuna_list_worktrees" }),
      toolCall("5", unknownDetail, { name: "osuna_list_worktrees" }),
      toolCall("6", unknownDetail, { name: "mcp__exa__web_search" }),
    ];

    const result = project({ level: "overview", head: calls });

    expect(result.groupsByHostId.get("1")).toMatchObject({
      summary: { searchCount: 3, otherToolCount: 0, osunaCallCount: 3 },
    });
  });

  // COMPAT(paseoDataMigration): added in v1.0.0, remove after 2027-10-09 or in 2.0.0, whichever first
  const LEGACY_TOOL_NAMES = [
    "mcp__paseo__list_worktrees",
    "paseo.list_agents",
    "paseo_list_providers",
  ];

  it("counts the Osuna calls a 0.14.x timeline recorded under the old tool names", () => {
    const unknownDetail = { type: "unknown" as const, input: null, output: null };
    const calls = LEGACY_TOOL_NAMES.map((name, index) =>
      toolCall(String(index + 1), unknownDetail, { name }),
    );

    const result = project({ level: "overview", head: calls });

    expect(result.groupsByHostId.get("1")).toMatchObject({
      summary: { otherToolCount: 0, osunaCallCount: 3 },
    });
  });

  it("reuses prepared history and sealed group models across live-head updates", () => {
    const historicalCalls = ["1", "2", "3", "4"].map((id) =>
      toolCall(id, { type: "shell", command: id }),
    );
    const tail = [...historicalCalls, assistant("boundary")];
    const prepared = prepareToolCallHistory({ level: "overview", tail, dispatchGroups: false });
    if (!prepared) {
      throw new Error("Overview history must be prepared");
    }
    expect(prepared.grouped.tail).toEqual([
      expect.objectContaining({ id: "1", timestamp: historicalCalls[3]?.timestamp }),
      tail[4],
    ]);
    const first = project({
      level: "overview",
      tail,
      head: [toolCall("5", { type: "read", filePath: "/repo/a.ts" })],
      isTurnActive: true,
      preparedHistory: prepared,
    });
    const second = project({
      level: "overview",
      tail,
      head: [
        toolCall("5", { type: "read", filePath: "/repo/a.ts" }),
        toolCall("6", { type: "read", filePath: "/repo/b.ts" }),
      ],
      isTurnActive: true,
      preparedHistory: prepared,
    });

    expect(first.tail).toBe(prepared.grouped.tail);
    expect(second.tail).toBe(prepared.grouped.tail);
    expect(first.groupsByHostId.get("1")).toBe(prepared.grouped.groupsByHostId.get("1"));
    expect(second.groupsByHostId.get("1")).toBe(prepared.grouped.groupsByHostId.get("1"));
    expect(first.historyGroupUpdatesByHostId.size).toBe(0);
    expect(second.historyGroupUpdatesByHostId).toBe(first.historyGroupUpdatesByHostId);
    expect(second.groupsByHostId.get("5")?.run.calls).toHaveLength(2);
  });

  it("preserves projected history identity during assistant-only head updates", () => {
    const trailingCalls = [
      toolCall("1", { type: "shell", command: "one" }),
      toolCall("2", { type: "read", filePath: "/repo/a.ts" }),
    ];
    const tail = [assistant("before"), ...trailingCalls];
    const prepared = prepareToolCallHistory({ level: "overview", tail, dispatchGroups: false });
    if (!prepared) {
      throw new Error("Overview history must be prepared");
    }

    const firstHead = [assistant("answer")];
    const secondHead = [{ ...firstHead[0], text: "answer grows" }];
    const first = project({
      level: "overview",
      tail,
      head: firstHead,
      isTurnActive: true,
      preparedHistory: prepared,
    });
    const second = project({
      level: "overview",
      tail,
      head: secondHead,
      isTurnActive: true,
      preparedHistory: prepared,
    });

    expect(first.tail).toBe(prepared.grouped.tail);
    expect(second.tail).toBe(prepared.grouped.tail);
    expect(first.groupsByHostId).toBe(prepared.grouped.groupsByHostId);
    expect(second.groupsByHostId).toBe(prepared.grouped.groupsByHostId);
    expect(first.historyGroupUpdatesByHostId.size).toBe(0);
    expect(second.historyGroupUpdatesByHostId).toBe(first.historyGroupUpdatesByHostId);
  });

  it("forms one group across the retained-history and live-head boundary", () => {
    const tail = [
      assistant("before"),
      toolCall("1", { type: "shell", command: "one" }),
      toolCall("2", { type: "shell", command: "two" }),
    ];
    const head = [
      toolCall("3", { type: "read", filePath: "/repo/a.ts" }),
      toolCall("4", { type: "edit", filePath: "/repo/a.ts" }, { status: "running" }),
    ];

    const result = project({ level: "overview", tail, head, isTurnActive: true });

    expect(result.tail).toEqual([
      tail[0],
      expect.objectContaining({ id: "1", timestamp: tail[2]?.timestamp }),
    ]);
    expect(result.head).toEqual([]);
    expect(result.groupsByHostId.get("1")?.run).toMatchObject({
      calls: [...tail.slice(1), ...head],
      latest: head[1],
      isSealed: false,
    });
    expect(result.historyGroupUpdatesByHostId.get("1")).toBe(result.groupsByHostId.get("1"));
  });

  it("keeps a trailing history-only group in the retained segment", () => {
    const tail = ["1", "2", "3", "4"].map((id) => toolCall(id, { type: "shell", command: id }));

    const result = project({ level: "overview", tail, isTurnActive: false });

    expect(result.tail).toEqual([
      expect.objectContaining({ id: "1", timestamp: tail[3]?.timestamp }),
    ]);
    expect(result.head).toEqual([]);
    expect(result.groupsByHostId.get("1")?.run.isSealed).toBe(true);
  });

  it("hosts single calls while leaving plans and spoken messages ungrouped", () => {
    const singleCall = toolCall("1", { type: "shell", command: "one" });
    const plan = toolCall("2", { type: "plan", text: "Plan" });
    const speak = toolCall(
      "3",
      { type: "unknown", input: "Hello", output: null },
      { name: "speak" },
    );

    const result = project({ level: "overview", head: [singleCall, plan, speak] });

    expect(result.head).toEqual([singleCall, plan, speak]);
    expect(result.groupsByHostId.get(singleCall.id)?.run.calls).toEqual([singleCall]);
    expect(result.groupsByHostId.size).toBe(1);
  });
});

describe("dispatch groups", () => {
  it.each(["detailed", "overview"] as const)(
    "joins consecutive create_agent calls into one %s dispatch group",
    (level) => {
      const calls = [
        createAgentCall("1"),
        createAgentCall("2", { name: "mcp__osuna__create_agent" }),
      ];
      const result = project({ level, tail: calls, dispatchGroups: true });

      expect(result.tail).toEqual([expect.objectContaining({ id: "1" })]);
      expect(result.groupsByHostId.get("1")).toMatchObject({
        mode: "dispatch",
        run: { calls },
      });
    },
  );

  it("splits dispatch groups at prose and at other tool calls", () => {
    const tail = [
      createAgentCall("1"),
      assistant("between"),
      createAgentCall("2"),
      toolCall("3", { type: "shell", command: "ls" }),
      createAgentCall("4"),
    ];
    const result = project({ level: "detailed", tail, dispatchGroups: true });

    expect(result.tail.map((item) => item.id)).toEqual(["1", "between", "2", "3", "4"]);
    const modes = ["1", "2", "4"].map((id) => result.groupsByHostId.get(id)?.mode);
    expect(modes).toEqual(["dispatch", "dispatch", "dispatch"]);
    expect(result.groupsByHostId.has("3")).toBe(false);
  });

  it("keeps create_agent calls out of overview groups beside them", () => {
    const tail = [
      toolCall("1", { type: "shell", command: "ls" }),
      createAgentCall("2"),
      createAgentCall("3"),
      toolCall("4", { type: "read", filePath: "/repo/a.ts" }),
    ];
    const result = project({ level: "overview", tail, dispatchGroups: true });

    expect(result.tail.map((item) => item.id)).toEqual(["1", "2", "4"]);
    expect(result.groupsByHostId.get("1")).toMatchObject({
      mode: "overview",
      run: { calls: [tail[0]] },
    });
    expect(result.groupsByHostId.get("2")).toMatchObject({
      mode: "dispatch",
      run: { calls: [tail[1], tail[2]] },
    });
    expect(result.groupsByHostId.get("4")).toMatchObject({ mode: "overview" });
  });

  it("leaves create_agent calls ordinary when the host has no call links", () => {
    const tail = [createAgentCall("1"), createAgentCall("2")];

    expect(project({ level: "detailed", tail }).groupsByHostId.size).toBe(0);
    expect(project({ level: "overview", tail }).groupsByHostId.get("1")).toMatchObject({
      mode: "overview",
      summary: { osunaCallCount: 2 },
    });
  });

  it("does not treat other Osuna tools or provider-native names as dispatches", () => {
    const tail = [
      toolCall("1", { type: "unknown", input: {}, output: null }, { name: "osuna.list_agents" }),
      createAgentCall("2", { name: "create_agent" }),
    ];

    expect(project({ level: "detailed", tail, dispatchGroups: true }).groupsByHostId.size).toBe(0);
  });

  it("joins provider subagent calls into the same dispatch group as create_agent", () => {
    const subAgent = (id: string) =>
      toolCall(id, { type: "sub_agent", subAgentType: "Explore", log: "" }, { name: "Task" });
    const tail = [subAgent("1"), createAgentCall("2"), subAgent("3"), assistant("after")];

    const result = project({ level: "detailed", tail, dispatchGroups: true });

    expect(result.tail.map((item) => item.id)).toEqual(["1", "after"]);
    expect(result.groupsByHostId.get("1")).toMatchObject({
      mode: "dispatch",
      calls: [tail[0], tail[1], tail[2]],
    });
    expect(project({ level: "detailed", tail }).groupsByHostId.size).toBe(0);
  });

  it("grows a history dispatch group with the live head", () => {
    const first = createAgentCall("1");
    const second = createAgentCall("2", { status: "running" });
    const tail = [first];
    const prepared = prepareToolCallHistory({ level: "detailed", tail, dispatchGroups: true });
    const result = project({
      level: "detailed",
      tail,
      head: [second],
      isTurnActive: true,
      preparedHistory: prepared,
      dispatchGroups: true,
    });

    expect(result.head).toEqual([]);
    expect(result.historyGroupUpdatesByHostId.get("1")).toMatchObject({
      mode: "dispatch",
      run: { calls: [first, second] },
    });
  });
});
