import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { afterEach, describe, expect, it } from "vitest";
import { PARENT_TOOL_CALL_ID_LABEL } from "@getpaseo/protocol/agent-labels";
import type { AgentToolCallItem } from "@/types/stream";
import type { ProviderSubagentDescriptorPayload } from "@getpaseo/protocol/messages";
import {
  createDispatchSubagentsSelector,
  createProviderDispatchSubagentsSelector,
  PENDING_DISPATCH_LOOKUP,
  resolveDispatchCall,
  resolveProviderDispatchCall,
  selectDispatchSubagents,
  createProviderSubagentOwnedPermissionsSelector,
  createProviderSubagentPermissionsSelector,
  NO_PROVIDER_SUBAGENT_PERMISSIONS,
  selectProviderDispatchSubagents,
  selectProviderSubagentsForParent,
  type ProviderSubagentRowsInput,
  selectSubagentsForParent,
  splitDispatchSegments,
  toDispatchSubagent,
} from "./select";
import { useProviderSubagentStore } from "./provider-store";
import { useSessionStore, type Agent } from "@/stores/session-store";
import type { AgentPermissionRequest } from "@getpaseo/protocol/agent-types";

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

function providerRowsInput(
  input: Partial<ProviderSubagentRowsInput> & Pick<ProviderSubagentRowsInput, "parentAgentId">,
): ProviderSubagentRowsInput {
  return {
    serverId: SERVER_ID,
    supported: true,
    nestingSupported: false,
    permissions: NO_PROVIDER_SUBAGENT_PERMISSIONS,
    ...input,
  };
}

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
    const input = providerRowsInput({ parentAgentId: "parent-a" });

    expect(
      selectProviderSubagentsForParent(useProviderSubagentStore.getState(), {
        ...input,
        supported: false,
      }),
    ).toEqual([]);
    const [row] = selectProviderSubagentsForParent(useProviderSubagentStore.getState(), input);
    expect(row?.id).toBe("provider-child");
    expect(row?.subtitle).toBe("Codex worker · 4.2k tokens");
    expect(row?.toolCallId).toBe("call-1");
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
        providerRowsInput({ parentAgentId: "parent-a" }),
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
        providerRowsInput({ parentAgentId: "parent-a", nestingSupported: true }),
      ).map((row) => row.id),
    ).toEqual(["direct"]);
    expect(
      selectProviderSubagentsForParent(
        useProviderSubagentStore.getState(),
        providerRowsInput({
          parentAgentId: "parent-a",
          providerParentSubagentId: "direct",
          nestingSupported: true,
        }),
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
      key: "call-a",
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

function providerSubagentCall(
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
        name: "Task",
        status,
        error: null,
        detail: { type: "sub_agent", subAgentType: "Explore", description: "Find it", log: "" },
      },
    },
  };
}

function upsertProviderSubagent(
  input: Partial<ProviderSubagentDescriptorPayload> & Pick<ProviderSubagentDescriptorPayload, "id">,
): void {
  useProviderSubagentStore.getState().applyUpdate(SERVER_ID, {
    kind: "upsert",
    subagent: {
      parentAgentId: "parent",
      provider: "claude",
      title: "Explore",
      description: `Task ${input.id}`,
      status: "running",
      createdAt: "2026-03-08T10:01:00.000Z",
      updatedAt: "2026-03-08T10:02:00.000Z",
      toolCallId: null,
      ...input,
    },
  });
}

describe("provider subagents in dispatch groups", () => {
  const params = {
    serverId: SERVER_ID,
    parentAgentId: "parent",
    permissions: NO_PROVIDER_SUBAGENT_PERMISSIONS,
  };

  it("indexes this parent's provider subagents by the tool call that started them", () => {
    upsertProviderSubagent({ id: "a", toolCallId: "call-a" });
    upsertProviderSubagent({ id: "no-call" });
    upsertProviderSubagent({ id: "elsewhere", parentAgentId: "other", toolCallId: "call-x" });
    // Dismissing finished children from the track does not take them out of the timeline.
    upsertProviderSubagent({ id: "dismissed", toolCallId: "call-d", status: "completed" });
    useProviderSubagentStore.getState().hideFromTrack(SERVER_ID, "parent", ["dismissed"]);

    const linked = selectProviderDispatchSubagents(useProviderSubagentStore.getState(), params);

    expect(Object.keys(linked).sort()).toEqual(["call-a", "call-d"]);
    expect(linked["call-a"]).toMatchObject([
      {
        row: { kind: "provider", id: "a", parentAgentId: "parent", toolCallId: "call-a" },
        model: null,
        modeLabel: null,
        pendingPermissionName: null,
        updatedAt: new Date("2026-03-08T10:02:00.000Z"),
        archived: false,
        detached: false,
      },
    ]);
  });

  it("keeps every subagent one call started, oldest first", () => {
    upsertProviderSubagent({
      id: "second",
      toolCallId: "call-a",
      createdAt: "2026-03-08T10:03:00.000Z",
    });
    upsertProviderSubagent({ id: "first", toolCallId: "call-a" });

    const linked = selectProviderDispatchSubagents(useProviderSubagentStore.getState(), params);

    expect(linked["call-a"]?.map((subagent) => subagent.row.id)).toEqual(["first", "second"]);
  });

  it("reuses the last result until the descriptors change", () => {
    upsertProviderSubagent({ id: "a", toolCallId: "call-a" });
    const select = createProviderDispatchSubagentsSelector(params);

    const first = select(useProviderSubagentStore.getState());
    expect(select(useProviderSubagentStore.getState())).toBe(first);

    upsertProviderSubagent({ id: "a", toolCallId: "call-a", status: "completed" });
    expect(select(useProviderSubagentStore.getState())).toMatchObject({
      "call-a": [{ row: { status: "completed" } }],
    });
  });

  it("turns a linked provider call into one row per subagent", () => {
    upsertProviderSubagent({ id: "a1", toolCallId: "call-a" });
    upsertProviderSubagent({ id: "a2", toolCallId: "call-a" });
    const subagents = selectProviderDispatchSubagents(useProviderSubagentStore.getState(), params)[
      "call-a"
    ];

    expect(
      resolveProviderDispatchCall({ call: providerSubagentCall("call-a"), subagents }),
    ).toMatchObject([
      { kind: "provider", key: "call-a:a1", callId: "call-a" },
      { kind: "provider", key: "call-a:a2", callId: "call-a" },
    ]);
  });

  it("leaves an unlinked provider call on the generic card, running or not", () => {
    for (const status of ["running", "completed"] as const) {
      const call = providerSubagentCall("call-a", status);
      expect(resolveProviderDispatchCall({ call, subagents: undefined })).toEqual([
        { kind: "generic", call },
      ]);
    }
  });

  it("joins provider rows and Paseo rows in one group and splits at a generic call", () => {
    upsertProviderSubagent({ id: "a", toolCallId: "call-a" });
    const providerSubagents = selectProviderDispatchSubagents(
      useProviderSubagentStore.getState(),
      params,
    );
    const generic = providerSubagentCall("call-b");
    const states = [
      ...resolveProviderDispatchCall({
        call: providerSubagentCall("call-a"),
        subagents: providerSubagents["call-a"],
      }),
      resolveDispatchCall({
        call: createAgentCall("call-p", "running"),
        subagent: undefined,
        lookup: PENDING_DISPATCH_LOOKUP,
      }),
      ...resolveProviderDispatchCall({ call: generic, subagents: undefined }),
    ];

    expect(splitDispatchSegments(states)).toMatchObject([
      { kind: "group", key: "call-a:a", rows: [{ key: "call-a:a" }, { key: "call-p" }] },
      { kind: "generic", call: generic },
    ]);
  });
});

function permission(id: string, name: string, providerSubagentId?: string): AgentPermissionRequest {
  return {
    id,
    provider: "claude",
    name,
    kind: "tool",
    ...(providerSubagentId ? { metadata: { providerSubagentId } } : {}),
  };
}

describe("provider subagent permissions", () => {
  const params = { serverId: SERVER_ID, parentAgentId: "parent" };

  function setParentPermissions(pendingPermissions: AgentPermissionRequest[]): void {
    setAgents([
      makeAgent({ id: "parent", pendingPermissions }),
      makeAgent({
        id: "other-parent",
        pendingPermissions: [permission("other", "Write", "a")],
      }),
    ]);
  }

  it("groups the parent's pending permissions by the provider subagent that asked", () => {
    setParentPermissions([
      permission("p1", "Write", "a"),
      permission("p2", "Parent's own"),
      permission("p3", "Bash", "a"),
      permission("p4", "Edit", "b"),
    ]);

    expect(createProviderSubagentPermissionsSelector(params)(useSessionStore.getState())).toEqual({
      a: ["Write", "Bash"],
      b: ["Edit"],
    });
  });

  it("counts them on the subagent's track row, and leaves untagged permissions on the parent", () => {
    setParentPermissions([permission("p1", "Write", "a"), permission("p2", "Parent's own")]);
    upsertProviderSubagent({ id: "a" });
    upsertProviderSubagent({ id: "untagged" });
    const permissions = createProviderSubagentPermissionsSelector(params)(
      useSessionStore.getState(),
    );

    const rows = selectProviderSubagentsForParent(
      useProviderSubagentStore.getState(),
      providerRowsInput({ ...params, permissions }),
    );

    expect(rows.map((row) => [row.id, row.pendingPermissionCount])).toEqual([
      ["a", 1],
      ["untagged", 0],
    ]);
  });

  it("reuses the last grouping until the parent's pending list changes", () => {
    setParentPermissions([permission("p1", "Write", "a")]);
    const select = createProviderSubagentPermissionsSelector(params);

    const first = select(useSessionStore.getState());
    expect(select(useSessionStore.getState())).toBe(first);

    setParentPermissions([]);
    expect(select(useSessionStore.getState())).toEqual({});
  });

  it("hands the read-only panel only the cards its subagent asked for, keyed as on the parent", () => {
    const pending = new Map(
      [
        permission("p1", "Write", "a"),
        permission("p2", "Parent's own"),
        permission("p3", "Edit", "b"),
      ].map((request) => [
        `parent:${request.id}`,
        { key: `parent:${request.id}`, agentId: "parent", request },
      ]),
    );
    pending.set("other:x", {
      key: "other:x",
      agentId: "other-parent",
      request: permission("x", "Write", "a"),
    });
    setAgents([makeAgent({ id: "parent" })]);
    useSessionStore.getState().setPendingPermissions(SERVER_ID, pending);
    const select = createProviderSubagentOwnedPermissionsSelector({ ...params, subagentId: "a" });

    const owned = select(useSessionStore.getState());

    expect([...owned.keys()]).toEqual(["parent:p1"]);
    expect(select(useSessionStore.getState())).toBe(owned);
  });

  it("names the first pending tool on the subagent's dispatch row", () => {
    setParentPermissions([permission("p1", "Write", "a"), permission("p2", "Bash", "a")]);
    upsertProviderSubagent({ id: "a", toolCallId: "call-a" });
    const permissions = createProviderSubagentPermissionsSelector(params)(
      useSessionStore.getState(),
    );

    const select = createProviderDispatchSubagentsSelector({ ...params, permissions });

    expect(select(useProviderSubagentStore.getState())["call-a"]).toMatchObject([
      { row: { id: "a", pendingPermissionCount: 2 }, pendingPermissionName: "Write" },
    ]);
  });
});
