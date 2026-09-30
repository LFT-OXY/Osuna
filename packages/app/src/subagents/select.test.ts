import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { afterEach, describe, expect, it } from "vitest";
import { PARENT_TOOL_CALL_ID_LABEL } from "@getpaseo/protocol/agent-labels";
import type { AgentToolCallItem } from "@/types/stream";
import {
  createDispatchSubagentsSelector,
  PENDING_DISPATCH_LOOKUP,
  resolveDispatchCall,
  selectDispatchSubagents,
  selectProviderSubagentsForParent,
  selectSubagentsForParent,
  splitDispatchSegments,
  toDispatchSubagent,
} from "./select";
import { useProviderSubagentStore } from "./provider-store";
import { useSessionStore, type Agent } from "@/stores/session-store";

const SERVER_ID = "server-1";
const AGENT_TIMESTAMP = new Date("2026-03-08T10:00:00.000Z");
const EMPTY_PENDING_ARCHIVE_IDS = new Set<string>();

const AGENT_DEFAULTS: Agent = {
  serverId: SERVER_ID,
  id: "agent",
  provider: "codex",
  status: "idle",
  turn: { phase: "idle", cancellationRequestId: null },
  createdAt: AGENT_TIMESTAMP,
  updatedAt: AGENT_TIMESTAMP,
  lastUserMessageAt: null,
  lastActivityAt: AGENT_TIMESTAMP,
  capabilities: {
    supportsStreaming: true,
    supportsSessionPersistence: true,
    supportsDynamicModes: true,
    supportsMcpServers: true,
    supportsReasoningStream: true,
    supportsToolInvocations: true,
  },
  currentModeId: null,
  availableModes: [],
  pendingPermissions: [],
  persistence: null,
  runtimeInfo: undefined,
  lastUsage: undefined,
  lastError: null,
  title: "Agent",
  cwd: "/tmp/project",
  model: null,
  features: undefined,
  thinkingOptionId: undefined,
  requiresAttention: false,
  attentionReason: null,
  attentionTimestamp: null,
  archivedAt: null,
  parentAgentId: null,
  labels: {},
  projectPlacement: null,
};

function makeAgent(input: Partial<Agent> & Pick<Agent, "id">): Agent {
  return { ...AGENT_DEFAULTS, ...input };
}

function setAgents(agents: Agent[]): void {
  useSessionStore.getState().initializeSession(SERVER_ID, null as unknown as DaemonClient);
  useSessionStore
    .getState()
    .setAgents(SERVER_ID, new Map(agents.map((agent) => [agent.id, agent])));
}

afterEach(() => {
  useSessionStore.getState().clearSession(SERVER_ID);
  useProviderSubagentStore.setState({
    descriptors: new Map(),
    timelines: new Map(),
    hiddenFromTrack: new Set(),
  });
});

describe("selectSubagentsForParent", () => {
  it("hides cached provider children when the host does not support them", () => {
    useProviderSubagentStore.getState().applyUpdate(SERVER_ID, {
      kind: "upsert",
      subagent: {
        id: "provider-child",
        parentAgentId: "parent-a",
        provider: "codex",
        title: "Provider child",
        description: null,
        subtitle: "Codex worker · 4.2k tokens",
        status: "completed",
        createdAt: "2026-03-08T10:01:00.000Z",
        updatedAt: "2026-03-08T10:02:00.000Z",
        toolCallId: "call-1",
      },
    });
    const params = { serverId: SERVER_ID, parentAgentId: "parent-a" };

    expect(
      selectProviderSubagentsForParent(useProviderSubagentStore.getState(), params, false),
    ).toEqual([]);
    expect(
      selectProviderSubagentsForParent(useProviderSubagentStore.getState(), params, true).map(
        (row) => row.id,
      ),
    ).toEqual(["provider-child"]);
    expect(
      selectProviderSubagentsForParent(useProviderSubagentStore.getState(), params, true)[0]
        ?.subtitle,
    ).toBe("Codex worker · 4.2k tokens");
  });

  it("hides locally dismissed provider children while retaining their descriptor", () => {
    const store = useProviderSubagentStore.getState();
    store.applyUpdate(SERVER_ID, {
      kind: "upsert",
      subagent: {
        id: "provider-child",
        parentAgentId: "parent-a",
        provider: "codex",
        title: "Provider child",
        description: null,
        status: "completed",
        createdAt: "2026-03-08T10:01:00.000Z",
        updatedAt: "2026-03-08T10:02:00.000Z",
        toolCallId: "call-1",
      },
    });
    store.hideFromTrack(SERVER_ID, "parent-a", ["provider-child"]);

    expect(
      selectProviderSubagentsForParent(
        useProviderSubagentStore.getState(),
        { serverId: SERVER_ID, parentAgentId: "parent-a" },
        true,
      ),
    ).toEqual([]);
    expect(useProviderSubagentStore.getState().descriptors.size).toBe(1);
  });

  it("places nested provider children only beneath their direct provider parent", () => {
    const store = useProviderSubagentStore.getState();
    const base = {
      parentAgentId: "parent-a",
      provider: "claude" as const,
      title: "general-purpose",
      subtitle: null,
      status: "running" as const,
      createdAt: "2026-09-04T10:00:00.000Z",
      updatedAt: "2026-09-04T10:00:00.000Z",
      toolCallId: null,
    };
    store.applyUpdate(SERVER_ID, {
      kind: "upsert",
      subagent: { ...base, id: "direct", description: "Direct", parentSubagentId: null },
    });
    store.applyUpdate(SERVER_ID, {
      kind: "upsert",
      subagent: {
        ...base,
        id: "nested",
        description: "Nested",
        parentSubagentId: "direct",
      },
    });

    expect(
      selectProviderSubagentsForParent(
        useProviderSubagentStore.getState(),
        { serverId: SERVER_ID, parentAgentId: "parent-a" },
        true,
        true,
      ).map((row) => row.id),
    ).toEqual(["direct"]);
    expect(
      selectProviderSubagentsForParent(
        useProviderSubagentStore.getState(),
        {
          serverId: SERVER_ID,
          parentAgentId: "parent-a",
          providerParentSubagentId: "direct",
        },
        true,
        true,
      ).map((row) => row.id),
    ).toEqual(["nested"]);
  });

  it("returns only non-archived children for the requested parent", () => {
    setAgents([
      makeAgent({ id: "parent-a" }),
      makeAgent({ id: "child-a", parentAgentId: "parent-a" }),
      makeAgent({
        id: "archived-child",
        parentAgentId: "parent-a",
        archivedAt: new Date("2026-03-08T12:00:00.000Z"),
      }),
    ]);

    const rows = selectSubagentsForParent(
      useSessionStore.getState(),
      {
        serverId: SERVER_ID,
        parentAgentId: "parent-a",
      },
      EMPTY_PENDING_ARCHIVE_IDS,
    );

    expect(rows.map((row) => row.id)).toEqual(["child-a"]);
  });

  it("excludes siblings, unrelated agents, and grandchildren", () => {
    setAgents([
      makeAgent({ id: "parent-a" }),
      makeAgent({ id: "parent-b" }),
      makeAgent({ id: "child-a", parentAgentId: "parent-a" }),
      makeAgent({ id: "sibling-b", parentAgentId: "parent-b" }),
      makeAgent({ id: "grandchild-a", parentAgentId: "child-a" }),
      makeAgent({ id: "unrelated" }),
    ]);

    const rows = selectSubagentsForParent(
      useSessionStore.getState(),
      {
        serverId: SERVER_ID,
        parentAgentId: "parent-a",
      },
      EMPTY_PENDING_ARCHIVE_IDS,
    );

    expect(rows.map((row) => row.id)).toEqual(["child-a"]);
  });

  it("shows only direct children for each parent", () => {
    setAgents([
      makeAgent({ id: "parent" }),
      makeAgent({ id: "child", parentAgentId: "parent" }),
      makeAgent({ id: "grandchild", parentAgentId: "child" }),
    ]);

    const parentRows = selectSubagentsForParent(
      useSessionStore.getState(),
      {
        serverId: SERVER_ID,
        parentAgentId: "parent",
      },
      EMPTY_PENDING_ARCHIVE_IDS,
    );
    const childRows = selectSubagentsForParent(
      useSessionStore.getState(),
      {
        serverId: SERVER_ID,
        parentAgentId: "child",
      },
      EMPTY_PENDING_ARCHIVE_IDS,
    );

    expect(parentRows.map((row) => row.id)).toEqual(["child"]);
    expect(childRows.map((row) => row.id)).toEqual(["grandchild"]);
  });

  it("sorts by createdAt ascending", () => {
    setAgents([
      makeAgent({ id: "parent" }),
      makeAgent({
        id: "third",
        parentAgentId: "parent",
        createdAt: new Date("2026-03-08T10:03:00.000Z"),
      }),
      makeAgent({
        id: "first",
        parentAgentId: "parent",
        createdAt: new Date("2026-03-08T10:01:00.000Z"),
      }),
      makeAgent({
        id: "second",
        parentAgentId: "parent",
        createdAt: new Date("2026-03-08T10:02:00.000Z"),
      }),
    ]);

    const rows = selectSubagentsForParent(
      useSessionStore.getState(),
      {
        serverId: SERVER_ID,
        parentAgentId: "parent",
      },
      EMPTY_PENDING_ARCHIVE_IDS,
    );

    expect(rows.map((row) => row.id)).toEqual(["first", "second", "third"]);
  });

  it("maps only row-rendered fields and does not expose onOpen", () => {
    const createdAt = new Date("2026-03-08T10:01:00.000Z");
    setAgents([
      makeAgent({ id: "parent" }),
      makeAgent({
        id: "child",
        parentAgentId: "parent",
        provider: "claude",
        title: "Review child",
        status: "running",
        requiresAttention: true,
        pendingPermissions: [{ id: "perm-1", provider: "claude", name: "Bash", kind: "tool" }],
        createdAt,
        model: "should-not-leak",
        cwd: "/private/project",
      }),
    ]);

    const rows = selectSubagentsForParent(
      useSessionStore.getState(),
      {
        serverId: SERVER_ID,
        parentAgentId: "parent",
      },
      EMPTY_PENDING_ARCHIVE_IDS,
    );

    expect(rows).toEqual([
      {
        kind: "paseo",
        id: "child",
        provider: "claude",
        title: "Review child",
        description: null,
        subtitle: null,
        status: "running",
        turn: { phase: "idle", cancellationRequestId: null },
        requiresAttention: true,
        pendingPermissionCount: 1,
        createdAt,
      },
    ]);
    expect(Object.keys(rows[0] ?? {}).sort()).toEqual([
      "createdAt",
      "description",
      "id",
      "kind",
      "pendingPermissionCount",
      "provider",
      "requiresAttention",
      "status",
      "subtitle",
      "title",
      "turn",
    ]);
    expect(rows[0]).not.toHaveProperty("onOpen");
    expect(rows[0]).not.toHaveProperty("model");
    expect(rows[0]).not.toHaveProperty("cwd");
  });

  it("moves a child when parentAgentId changes", () => {
    const child = makeAgent({ id: "child", parentAgentId: "parent-a" });
    setAgents([makeAgent({ id: "parent-a" }), makeAgent({ id: "parent-b" }), child]);

    expect(
      selectSubagentsForParent(
        useSessionStore.getState(),
        {
          serverId: SERVER_ID,
          parentAgentId: "parent-a",
        },
        EMPTY_PENDING_ARCHIVE_IDS,
      ).map((row) => row.id),
    ).toEqual(["child"]);
    expect(
      selectSubagentsForParent(
        useSessionStore.getState(),
        {
          serverId: SERVER_ID,
          parentAgentId: "parent-b",
        },
        EMPTY_PENDING_ARCHIVE_IDS,
      ).map((row) => row.id),
    ).toEqual([]);

    setAgents([
      makeAgent({ id: "parent-a" }),
      makeAgent({ id: "parent-b" }),
      { ...child, parentAgentId: "parent-b" },
    ]);

    expect(
      selectSubagentsForParent(
        useSessionStore.getState(),
        {
          serverId: SERVER_ID,
          parentAgentId: "parent-a",
        },
        EMPTY_PENDING_ARCHIVE_IDS,
      ).map((row) => row.id),
    ).toEqual([]);
    expect(
      selectSubagentsForParent(
        useSessionStore.getState(),
        {
          serverId: SERVER_ID,
          parentAgentId: "parent-b",
        },
        EMPTY_PENDING_ARCHIVE_IDS,
      ).map((row) => row.id),
    ).toEqual(["child"]);
  });

  it("excludes children whose archive is pending", () => {
    setAgents([
      makeAgent({ id: "parent" }),
      makeAgent({ id: "child-a", parentAgentId: "parent" }),
      makeAgent({ id: "child-b", parentAgentId: "parent" }),
    ]);

    const rows = selectSubagentsForParent(
      useSessionStore.getState(),
      {
        serverId: SERVER_ID,
        parentAgentId: "parent",
      },
      new Set(["child-b"]),
    );

    expect(rows.map((row) => row.id)).toEqual(["child-a"]);
  });

  it("returns the shared empty array when pending archive hides the last child", () => {
    setAgents([makeAgent({ id: "parent" }), makeAgent({ id: "child", parentAgentId: "parent" })]);

    const rows = selectSubagentsForParent(
      useSessionStore.getState(),
      {
        serverId: SERVER_ID,
        parentAgentId: "parent",
      },
      new Set(["child"]),
    );

    expect(rows).toEqual([]);
    expect(rows).toBe(
      selectSubagentsForParent(
        useSessionStore.getState(),
        {
          serverId: SERVER_ID,
          parentAgentId: "missing-parent",
        },
        EMPTY_PENDING_ARCHIVE_IDS,
      ),
    );
  });
});

function createAgentCall(
  callId: string,
  status: "running" | "completed" | "failed" = "completed",
): AgentToolCallItem {
  return {
    kind: "tool_call",
    id: callId,
    timestamp: AGENT_TIMESTAMP,
    payload: {
      source: "agent",
      data: {
        provider: "claude",
        callId,
        name: "paseo.create_agent",
        status,
        error: null,
        detail: {
          type: "unknown",
          input: {
            title: `Task ${callId}`,
            provider: "codex/gpt-5.4",
            initialPrompt: "Do it",
            settings: { modeId: "auto" },
          },
          output: null,
        },
      },
    },
  };
}

function dispatchChild(input: Partial<Agent> & Pick<Agent, "id">, callId: string): Agent {
  return makeAgent({
    parentAgentId: "parent",
    ...input,
    labels: { [PARENT_TOOL_CALL_ID_LABEL]: callId, ...input.labels },
  });
}

describe("dispatch groups", () => {
  it("links each call to the child that carries its call id under this parent", () => {
    setAgents([
      makeAgent({ id: "parent" }),
      dispatchChild({ id: "child-a" }, "call-a"),
      dispatchChild({ id: "child-b", parentAgentId: null }, "call-b"),
      dispatchChild({ id: "other-parent-child", parentAgentId: "someone-else" }, "call-c"),
      makeAgent({ id: "sibling-without-link", parentAgentId: "parent" }),
    ]);

    const linked = selectDispatchSubagents(useSessionStore.getState(), {
      serverId: SERVER_ID,
      parentAgentId: "parent",
    });

    expect(Object.keys(linked).sort()).toEqual(["call-a", "call-b"]);
    expect(linked["call-a"]).toMatchObject({ row: { id: "child-a" }, detached: false });
    // Detach clears the parent label but keeps the call id, so the row stays linked.
    expect(linked["call-b"]).toMatchObject({ row: { id: "child-b" }, detached: true });
  });

  it("reuses the last result until the agents table changes", () => {
    setAgents([makeAgent({ id: "parent" }), dispatchChild({ id: "child-a" }, "call-a")]);
    const select = createDispatchSubagentsSelector({
      serverId: SERVER_ID,
      parentAgentId: "parent",
    });

    const first = select(useSessionStore.getState());
    expect(select(useSessionStore.getState())).toBe(first);

    setAgents([
      makeAgent({ id: "parent" }),
      dispatchChild({ id: "child-a", status: "running" }, "call-a"),
    ]);
    expect(select(useSessionStore.getState())).toMatchObject({
      "call-a": { row: { status: "running" } },
    });
  });

  it("carries what the row shows: model, mode label, first pending tool, archive state", () => {
    const archivedAt = new Date("2026-03-08T11:00:00.000Z");
    const subagent = toDispatchSubagent(
      dispatchChild(
        {
          id: "child",
          model: "gpt-5.4",
          currentModeId: "auto",
          availableModes: [{ id: "auto", label: "Auto" }],
          pendingPermissions: [{ id: "perm-1", provider: "codex", name: "Bash", kind: "tool" }],
          archivedAt,
        },
        "call-a",
      ),
    );

    expect(subagent).toMatchObject({
      row: { kind: "paseo", id: "child", pendingPermissionCount: 1 },
      model: "gpt-5.4",
      modeLabel: "Auto",
      pendingPermissionName: "Bash",
      archived: true,
      detached: false,
    });
  });

  it("shows a running call without a child as starting, from the call's own input", () => {
    expect(
      resolveDispatchCall({
        call: createAgentCall("call-a", "running"),
        subagent: undefined,
        lookup: PENDING_DISPATCH_LOOKUP,
      }),
    ).toEqual({
      kind: "starting",
      callId: "call-a",
      input: { title: "Task call-a", provider: "codex", model: "gpt-5.4", modeId: "auto" },
    });
  });

  it("prefers the live child over an archived lookup and keeps starting while the lookup runs", () => {
    const live = toDispatchSubagent(dispatchChild({ id: "child" }, "call-a"));
    const call = createAgentCall("call-a");

    expect(
      resolveDispatchCall({ call, subagent: live, lookup: { status: "missing" } }),
    ).toMatchObject({
      kind: "subagent",
      callId: "call-a",
      input: { title: "Task call-a" },
      subagent: live,
    });
    expect(
      resolveDispatchCall({ call, subagent: undefined, lookup: PENDING_DISPATCH_LOOKUP }).kind,
    ).toBe("starting");
    const archived = toDispatchSubagent(
      dispatchChild({ id: "child", archivedAt: AGENT_TIMESTAMP }, "call-a"),
    );
    expect(
      resolveDispatchCall({
        call,
        subagent: undefined,
        lookup: { status: "found", subagent: archived },
      }),
    ).toMatchObject({
      kind: "subagent",
      callId: "call-a",
      subagent: archived,
    });
  });

  it("falls back to the generic card once a finished call has no child anywhere", () => {
    const call = createAgentCall("call-a", "failed");

    expect(
      resolveDispatchCall({ call, subagent: undefined, lookup: { status: "missing" } }),
    ).toEqual({
      kind: "generic",
      call,
    });
  });

  it("splits a run into cards around the calls that fell back to generic", () => {
    const linked = toDispatchSubagent(dispatchChild({ id: "child" }, "a"));
    const generic = createAgentCall("b");
    const states = [
      resolveDispatchCall({
        call: createAgentCall("a"),
        subagent: linked,
        lookup: PENDING_DISPATCH_LOOKUP,
      }),
      resolveDispatchCall({ call: generic, subagent: undefined, lookup: { status: "missing" } }),
      resolveDispatchCall({
        call: createAgentCall("c", "running"),
        subagent: undefined,
        lookup: PENDING_DISPATCH_LOOKUP,
      }),
      resolveDispatchCall({
        call: createAgentCall("d", "running"),
        subagent: undefined,
        lookup: PENDING_DISPATCH_LOOKUP,
      }),
    ];

    const segments = splitDispatchSegments(states);

    expect(segments.map((segment) => segment.kind)).toEqual(["group", "generic", "group"]);
    expect(segments[0]).toMatchObject({ kind: "group", key: "a", rows: [{ callId: "a" }] });
    expect(segments[1]).toEqual({ kind: "generic", call: generic });
    expect(segments[2]).toMatchObject({
      kind: "group",
      key: "c",
      rows: [{ callId: "c" }, { callId: "d" }],
    });
  });
});
