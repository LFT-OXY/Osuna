import { describe, expect, it } from "vitest";
import { resolveUsageSessionAction, type UsageSessionTarget } from "./open-session";

const WORKSPACES = [
  { id: "workspace-1", workspaceDirectory: "/work/demo" },
  { id: "workspace-2", workspaceDirectory: "/work/other" },
];

const SESSION: UsageSessionTarget = {
  cwd: "/work/demo",
  project: { rootPath: "/work/demo", displayName: "demo", kind: "git" },
  handle: { providerId: "claude", providerHandleId: "sess-1" },
};

describe("resolveUsageSessionAction", () => {
  it("opens the agent when Paseo owns the session", () => {
    expect(
      resolveUsageSessionAction({
        session: {
          ...SESSION,
          importedAgentId: "agent-1",
          importedAgentWorkspaceId: "workspace-9",
        },
        workspaces: WORKSPACES,
      }),
    ).toEqual({ kind: "agent", agentId: "agent-1", workspaceId: "workspace-9" });
  });

  it("opens an owned session whose agent has no workspace at host level", () => {
    expect(
      resolveUsageSessionAction({
        session: { ...SESSION, importedAgentId: "agent-1" },
        workspaces: WORKSPACES,
      }),
    ).toEqual({ kind: "agent", agentId: "agent-1", workspaceId: null });
  });

  it("resumes an external session in the workspace that holds its directory", () => {
    expect(
      resolveUsageSessionAction({
        session: { ...SESSION, cwd: "/work/demo/" },
        workspaces: WORKSPACES,
      }),
    ).toEqual({
      kind: "resume",
      workspaceId: "workspace-1",
      workspaceDirectory: "/work/demo",
      sessionKey: "claude:sess-1",
      launch: {
        cwd: "/work/demo/",
        name: "demo",
        command: "claude",
        args: ["--resume", "sess-1"],
      },
    });
  });

  it("resumes a session run below a workspace in that workspace", () => {
    const action = resolveUsageSessionAction({
      session: { ...SESSION, cwd: "/work/demo/packages/app" },
      workspaces: WORKSPACES,
    });

    expect(action).toMatchObject({ kind: "resume", workspaceId: "workspace-1" });
    // The terminal still starts where the session ran, not at the workspace root.
    expect(action).toMatchObject({ launch: { cwd: "/work/demo/packages/app" } });
  });

  it("takes the innermost workspace when one sits inside another", () => {
    expect(
      resolveUsageSessionAction({
        session: { ...SESSION, cwd: "/work/demo/packages/app" },
        workspaces: [
          ...WORKSPACES,
          { id: "workspace-3", workspaceDirectory: "/work/demo/packages" },
        ],
      }),
    ).toMatchObject({ kind: "resume", workspaceId: "workspace-3" });
  });

  it("does not mistake a sibling directory for a parent", () => {
    expect(
      resolveUsageSessionAction({
        session: { ...SESSION, cwd: "/work/demo-2" },
        workspaces: WORKSPACES,
      }),
    ).toEqual({ kind: "unavailable", reason: "noWorkspace" });
  });

  it("cannot resume a session no workspace on this host holds", () => {
    expect(
      resolveUsageSessionAction({
        session: { ...SESSION, cwd: "/work/elsewhere" },
        workspaces: WORKSPACES,
      }),
    ).toEqual({ kind: "unavailable", reason: "noWorkspace" });
  });

  it("cannot resume a session whose transcript the scanner lost", () => {
    expect(
      resolveUsageSessionAction({ session: { ...SESSION, handle: null }, workspaces: WORKSPACES }),
    ).toEqual({ kind: "unavailable", reason: "noHandle" });
  });

  it("cannot resume a CLI with no resume command", () => {
    expect(
      resolveUsageSessionAction({
        session: { ...SESSION, handle: { providerId: "mystery", providerHandleId: "sess-1" } },
        workspaces: WORKSPACES,
      }),
    ).toEqual({ kind: "unavailable", reason: "noHandle" });
  });
});
