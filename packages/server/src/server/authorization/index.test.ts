import { describe, expect, test } from "vitest";
import {
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
  type SessionInboundMessage,
  type SessionOutboundMessage,
} from "../messages.js";
import {
  DAEMON_PERMISSIONS,
  OWNER_PERMISSIONS,
  SessionAuthorization,
  parseDaemonPermissions,
} from "./index.js";

function inboundOperationTypes(): SessionInboundMessage["type"][] {
  return SessionInboundMessageSchema.options.map((option) => option.shape.type.value);
}

function outboundOperationTypes(): SessionOutboundMessage["type"][] {
  return SessionOutboundMessageSchema.options.map((option) => option.shape.type.value);
}

function inboundMessage(type: SessionInboundMessage["type"]): SessionInboundMessage {
  return { type } as SessionInboundMessage;
}

function outboundMessage(type: SessionOutboundMessage["type"]): SessionOutboundMessage {
  if (type === "status")
    return {
      type,
      payload: { status: "agent_create_failed", error: "test", requestId: "test" },
    } as SessionOutboundMessage;
  return { type } as SessionOutboundMessage;
}

describe("SessionAuthorization", () => {
  test("owner authority covers every session operation", () => {
    const authorization = new SessionAuthorization(OWNER_PERMISSIONS);

    expect(
      inboundOperationTypes().every((type) => authorization.allowsInbound(inboundMessage(type))),
    ).toBe(true);
    expect(
      outboundOperationTypes().every((type) => authorization.allowsOutbound(outboundMessage(type))),
    ).toBe(true);
  });

  test("semantic permissions authorize operations instead of RPC namespaces", () => {
    const authorization = new SessionAuthorization(["daemon.read"]);

    expect(authorization.allowsInbound(inboundMessage("get_providers_snapshot_request"))).toBe(
      true,
    );
    expect(authorization.allowsInbound(inboundMessage("refresh_providers_snapshot_request"))).toBe(
      true,
    );
    expect(authorization.allowsOutbound(outboundMessage("get_providers_snapshot_response"))).toBe(
      true,
    );
    expect(authorization.allowsOutbound(outboundMessage("providers_snapshot_update"))).toBe(true);
    expect(
      authorization.allowsOutbound(outboundMessage("refresh_providers_snapshot_response")),
    ).toBe(true);
    expect(authorization.allowsInbound(inboundMessage("daemon.get_status.request"))).toBe(true);
    expect(authorization.allowsInbound(inboundMessage("daemon.config.reload.request"))).toBe(false);
    expect(authorization.allowsInbound(inboundMessage("daemon.get_pairing_offer.request"))).toBe(
      false,
    );
    expect(authorization.allowsInbound(inboundMessage("create_agent_request"))).toBe(false);
  });

  test("workspace authority operates agents and recovers workspaces without daemon administration", () => {
    const authorization = new SessionAuthorization([
      "workspace.read",
      "workspace.write",
      "workspace.manage",
    ]);
    for (const type of [
      "create_agent_request",
      "send_agent_message_request",
      "fetch_agent_request",
      "agent.timeline.set_subscription.request",
      "workspace.recovery.inspect.request",
      "workspace.recovery.restore.request",
    ] as const) {
      expect(authorization.allowsInbound(inboundMessage(type))).toBe(true);
    }
    for (const type of [
      "status",
      "agent_update",
      "agent_stream",
      "send_agent_message_response",
      "workspace.recovery.restore.response",
    ] as const) {
      expect(authorization.allowsOutbound(outboundMessage(type))).toBe(true);
    }
    for (const type of [
      "restart_server_request",
      "get_daemon_config_request",
      "daemon.get_pairing_offer.request",
    ] as const) {
      expect(authorization.allowsInbound(inboundMessage(type))).toBe(false);
    }
    expect(
      authorization.allowsOutbound({
        type: "status",
        payload: { status: "shutdown_requested", clientId: "owner", requestId: "shutdown" },
      }),
    ).toBe(false);
    authorization.replacePermissions([]);
    expect(authorization.allowsInbound(inboundMessage("send_agent_message_request"))).toBe(false);
    expect(authorization.allowsOutbound(outboundMessage("agent_update"))).toBe(false);
  });

  test("read-only workspace authority observes agents without operating them", () => {
    const authorization = new SessionAuthorization(["workspace.read"]);

    expect(authorization.allowsInbound(inboundMessage("fetch_agent_request"))).toBe(true);
    expect(authorization.allowsOutbound(outboundMessage("agent_stream"))).toBe(true);
    expect(authorization.allowsInbound(inboundMessage("create_agent_request"))).toBe(false);
    expect(authorization.allowsInbound(inboundMessage("send_agent_message_request"))).toBe(false);
    expect(authorization.allowsInbound(inboundMessage("archive_workspace_request"))).toBe(false);
    expect(authorization.allowsOutbound(outboundMessage("status"))).toBe(false);
  });

  test("correlated authorization errors can always be emitted", () => {
    const authorization = new SessionAuthorization([]);

    expect(authorization.allowsOutbound(outboundMessage("rpc_error"))).toBe(true);
  });

  test("the permission registry is the documented daemon, access, workspace, and automation set", () => {
    expect([...DAEMON_PERMISSIONS]).toEqual([
      "daemon.read",
      "daemon.manage",
      "tunnel.manage",
      "access.manage",
      "workspace.read",
      "workspace.write",
      "workspace.manage",
      "automation.manage",
    ]);
  });

  test("permission names are semantic", () => {
    expect(
      DAEMON_PERMISSIONS.every(
        (permission) => !permission.includes("*") && !permission.includes("request"),
      ),
    ).toBe(true);
  });

  test("permission parsing validates against the shared registry and removes duplicates", () => {
    expect(parseDaemonPermissions(["workspace.read", "workspace.read"])).toEqual([
      "workspace.read",
    ]);
    expect(() => parseDaemonPermissions(["workspace.*"])).toThrow("Invalid daemon permission");
  });
});
