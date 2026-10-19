import { describe, expect, it } from "vitest";
import {
  LogicMapSkeletonSchema,
  ServerInfoStatusPayloadSchema,
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
} from "./messages";
import { getLogicMapNameFromLabels, LOGIC_MAP_LABEL } from "./agent-labels";

describe("logic map protocol", () => {
  it("accepts a toggle for a running agent and for a draft in a workspace", () => {
    expect(
      SessionInboundMessageSchema.safeParse({
        type: "agent.logic_map.set_enabled.request",
        requestId: "request-1",
        target: { kind: "agent", agentId: "agent-1" },
        enabled: true,
      }).success,
    ).toBe(true);
    expect(
      SessionInboundMessageSchema.safeParse({
        type: "agent.logic_map.set_enabled.request",
        requestId: "request-2",
        target: { kind: "draft", workspaceId: "workspace-1" },
        enabled: false,
      }).success,
    ).toBe(true);
  });

  it("lets a toggle name an existing map to continue, and still parses one that does not", () => {
    const continuing = {
      type: "agent.logic_map.set_enabled.request" as const,
      requestId: "request-4",
      target: { kind: "agent" as const, agentId: "agent-1" },
      enabled: true,
      mapName: "login",
    };
    const fromOldClient = {
      type: "agent.logic_map.set_enabled.request" as const,
      requestId: "request-5",
      target: { kind: "draft" as const, workspaceId: "workspace-1" },
      enabled: true,
    };

    const draftLeavingItsMap = {
      ...fromOldClient,
      requestId: "request-6",
      target: { ...fromOldClient.target, createdMapName: "untitled-1a2b3c4d" },
      mapName: "login",
    };

    expect(SessionInboundMessageSchema.parse(continuing)).toEqual(continuing);
    expect(SessionInboundMessageSchema.parse(draftLeavingItsMap)).toEqual(draftLeavingItsMap);
    expect(SessionInboundMessageSchema.parse(fromOldClient)).toEqual(fromOldClient);
    expect(SessionInboundMessageSchema.safeParse({ ...continuing, mapName: 42 }).success).toBe(
      false,
    );
  });

  it("rejects a toggle that names neither an agent nor a draft workspace", () => {
    for (const target of [
      undefined,
      { kind: "agent" },
      { kind: "draft", cwd: "/repo" },
      { kind: "other", agentId: "agent-1" },
    ]) {
      expect(
        SessionInboundMessageSchema.safeParse({
          type: "agent.logic_map.set_enabled.request",
          requestId: "request-3",
          target,
          enabled: true,
        }).success,
      ).toBe(false);
    }
  });

  it("parses the response with and without a map", () => {
    for (const payload of [
      { requestId: "r", agentId: "agent-1", mapName: "untitled-1a2b3c4d", error: null },
      { requestId: "r", agentId: null, mapName: null, error: "Agent not found" },
    ]) {
      expect(
        SessionOutboundMessageSchema.safeParse({
          type: "agent.logic_map.set_enabled.response",
          payload,
        }).success,
      ).toBe(true);
    }
  });

  it("keeps the server_info flag optional so an old daemon still parses", () => {
    const legacy = ServerInfoStatusPayloadSchema.parse({
      status: "server_info",
      serverId: "old-daemon",
      features: {},
    });
    const current = ServerInfoStatusPayloadSchema.parse({
      status: "server_info",
      serverId: "new-daemon",
      features: { logicMap: true },
    });

    expect(legacy.features?.logicMap).toBeUndefined();
    expect(current.features?.logicMap).toBe(true);
  });

  it("reads the maintained map from the agent's labels", () => {
    expect(getLogicMapNameFromLabels({ [LOGIC_MAP_LABEL]: "untitled-1a2b3c4d" })).toBe(
      "untitled-1a2b3c4d",
    );
    expect(getLogicMapNameFromLabels({ [LOGIC_MAP_LABEL]: "  " })).toBeNull();
    expect(getLogicMapNameFromLabels({})).toBeNull();
    expect(getLogicMapNameFromLabels(undefined)).toBeNull();
  });

  it("lists and reads a workspace's maps", () => {
    for (const message of [
      { type: "workspace.logic_map.list.request", requestId: "r1", workspaceId: "w1" },
      {
        type: "workspace.logic_map.get.request",
        requestId: "r2",
        workspaceId: "w1",
        mapName: "login",
      },
    ]) {
      expect(SessionInboundMessageSchema.safeParse(message).success).toBe(true);
    }
    expect(
      SessionInboundMessageSchema.safeParse({
        type: "workspace.logic_map.get.request",
        requestId: "r3",
        workspaceId: "w1",
      }).success,
    ).toBe(false);
  });

  it("parses a list response and each kind of read result", () => {
    const map = {
      title: "Login",
      specFramework: { kind: "none" },
      nodes: [
        {
          id: "start",
          title: "Open the page",
          kind: "start",
          parentId: null,
          failure: false,
          doc: { kind: "own", file: "start.md", pendingLink: false },
        },
        {
          id: "check",
          title: "Check password",
          kind: "decision",
          parentId: null,
          failure: false,
          doc: { kind: "external", path: "docs/prd.md", heading: "Password" },
        },
      ],
      edges: [{ from: "start", to: "check", condition: null }],
    };
    const messages = [
      {
        type: "workspace.logic_map.list.response",
        payload: {
          requestId: "r1",
          workspaceId: "w1",
          maps: [
            { name: "login", title: "Login" },
            { name: "untitled-1a2b3c4d", title: null },
          ],
          error: null,
        },
      },
      {
        type: "workspace.logic_map.get.response",
        payload: {
          requestId: "r2",
          workspaceId: "w1",
          mapName: "login",
          result: { kind: "ok", map },
        },
      },
      {
        type: "workspace.logic_map.get.response",
        payload: {
          requestId: "r3",
          workspaceId: "w1",
          mapName: "login",
          result: {
            kind: "corrupt",
            file: "docs/logic-maps/login/map.json",
            problem: "Not valid JSON",
          },
        },
      },
      {
        type: "workspace.logic_map.get.response",
        payload: {
          requestId: "r4",
          workspaceId: "w1",
          mapName: "gone",
          result: { kind: "error", message: "Logic map not found: gone" },
        },
      },
      { type: "workspace.logic_map.changed", payload: { workspaceId: "w1", mapName: "login" } },
    ];
    for (const message of messages) {
      expect(SessionOutboundMessageSchema.parse(message)).toEqual(message);
    }
  });

  it("lets an old client read a map that carries fields it does not know yet", () => {
    const parsed = LogicMapSkeletonSchema.parse({
      title: null,
      specFramework: null,
      nodes: [
        {
          id: "a",
          title: "A",
          kind: "step",
          parentId: null,
          failure: false,
          doc: null,
          addedLater: 1,
        },
      ],
      edges: [],
      addedLater: true,
    });

    expect(parsed.nodes[0]?.id).toBe("a");
  });

  it("subscribes to map changes by name", () => {
    const message = {
      type: "session.events.set_subscription.request" as const,
      requestId: "r5",
      events: ["workspace.logic_map.changed" as const],
    };
    expect(SessionInboundMessageSchema.parse(message)).toEqual(message);
  });
});
