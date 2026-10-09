import type { Command } from "commander";
import { describe, expect, it, vi } from "vitest";
import { runArchiveCommand } from "./archive.js";
import { runCreateCommand } from "./create.js";
import { runLsCommand } from "./ls.js";
import { runRenameCommand } from "./rename.js";
import { runSetupCommand } from "./setup.js";

// connectToDaemon 抛出的就是这个形状：主机在运行，只是低于 1.0.0 协议下限。
const hostOutdated = {
  code: "HOST_OUTDATED",
  message:
    "Cannot connect to daemon at old-host:6767: old-host runs Osuna 0.14.2. Update it to 1.0.0 or later to connect.",
  details: "Osuna 1.0.0 changed the protocol. This CLI cannot talk to an older host.",
};

vi.mock("../../utils/client.js", () => ({
  getDaemonHost: () => "old-host:6767",
  connectToDaemon: async () => {
    throw hostOutdated;
  },
}));

const command = {} as Command;
const options = { daemonTarget: { kind: "endpoint" as const, host: "old-host:6767" } };

describe("workspace commands when the daemon connection is refused", () => {
  it.each([
    ["ls", () => runLsCommand(options, command)],
    ["archive", () => runArchiveCommand("ws-1", options, command)],
    ["create", () => runCreateCommand({ ...options, path: "/repo" }, command)],
    ["rename", () => runRenameCommand("ws-1", "Fix login", options, command)],
    ["setup", () => runSetupCommand("ws-1", options, command)],
  ])("%s reports the reason connectToDaemon gave", async (_name, run) => {
    await expect(run()).rejects.toEqual(hostOutdated);
  });
});
