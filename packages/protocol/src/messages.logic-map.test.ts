import { describe, expect, it } from "vitest";
import {
  ServerInfoStatusPayloadSchema,
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
} from "./messages";
import { getLogicMapNameFromLabels, LOGIC_MAP_LABEL } from "./agent-labels";

describe("logic map protocol", () => {
  it("accepts a toggle for a running agent and for a draft that only knows its cwd", () => {
    expect(
      SessionInboundMessageSchema.safeParse({
        type: "agent.logic_map.set_enabled.request",
        requestId: "request-1",
        agentId: "agent-1",
        enabled: true,
      }).success,
    ).toBe(true);
    expect(
      SessionInboundMessageSchema.safeParse({
        type: "agent.logic_map.set_enabled.request",
        requestId: "request-2",
        cwd: "/repo",
        enabled: false,
      }).success,
    ).toBe(true);
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
});
