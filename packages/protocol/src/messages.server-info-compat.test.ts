import { describe, expect, test } from "vitest";

import { parseServerInfoStatusPayload } from "./messages.js";

describe("server_info from a 0.14.x daemon", () => {
  // 0.14.x 的 daemon 给 owner 下发全量权限，里面有 1.0.0 已删除的 hub.execute，
  // features 里也还有两个已删除的 Hub 特性位。
  const sentByLegacyDaemon = {
    status: "server_info",
    serverId: "srv_legacy",
    hostname: "old-host",
    version: "0.14.2",
    permissions: [
      "daemon.read",
      "daemon.manage",
      "tunnel.manage",
      "access.manage",
      "workspace.read",
      "workspace.write",
      "workspace.manage",
      "automation.manage",
      "hub.execute",
    ],
    features: { providersSnapshot: true, hubAgentRpc: true, hubRelationship: true },
  };

  test("still parses in a 1.0.0 client, with the retired permission kept as sent", () => {
    expect(parseServerInfoStatusPayload(sentByLegacyDaemon)).toEqual({
      status: "server_info",
      serverId: "srv_legacy",
      hostname: "old-host",
      version: "0.14.2",
      permissions: sentByLegacyDaemon.permissions,
      features: { providersSnapshot: true },
    });
  });

  test("does not accept a permission no daemon version ever sent", () => {
    expect(
      parseServerInfoStatusPayload({ ...sentByLegacyDaemon, permissions: ["hub.manage"] }),
    ).toBeNull();
  });
});
