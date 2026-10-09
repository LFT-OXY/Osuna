import { DaemonHostOutdatedError } from "@osuna/client/internal/daemon-client";
import { describe, expect, it } from "vitest";
import { buildDaemonConnectionCommandError } from "./client.js";

describe("CLI against a host below the 1.0.0 protocol floor", () => {
  it("names the host's version and the update, not a start command", () => {
    const refusal = new DaemonHostOutdatedError({
      serverId: "srv_legacy",
      hostname: "old-host",
      version: "0.14.2",
    });

    expect(
      buildDaemonConnectionCommandError({
        target: { kind: "endpoint", host: "old-host:6767" },
        error: refusal,
      }),
    ).toEqual({
      code: "HOST_OUTDATED",
      message:
        "Cannot connect to daemon at old-host:6767: old-host runs Osuna 0.14.2. Update it to 1.0.0 or later to connect.",
      details: "Osuna 1.0.0 changed the protocol. This CLI cannot talk to an older host.",
    });
  });
});
