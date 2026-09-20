import { mkdtemp, mkdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { resolveOmpProviderParams, resolveOmpSessionPaths } from "./provider-config.js";
import { listOmpImportableSessions, readOmpImportSessionConfig } from "./session-descriptor.js";

async function writeSession(root: string, relativePath: string, lines: unknown[]): Promise<string> {
  const filePath = path.join(root, "sessions", relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`, "utf8");
  return filePath;
}

describe("OMP session descriptor", () => {
  test("cwd filtering continues past the global candidate overscan", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "paseo-omp-session-cwd-limit-"));
    const sessionsDir = path.join(root, "sessions");
    const requestedCwd = path.join(root, "requested");
    const otherCwd = path.join(root, "other");
    const requestedFile = await writeSession(root, "requested/requested.jsonl", [
      {
        type: "session",
        id: "requested-session",
        timestamp: "2026-06-01T00:00:00.000Z",
        cwd: requestedCwd,
      },
    ]);
    await utimes(requestedFile, new Date("2026-06-01"), new Date("2026-06-01"));

    await Promise.all(
      Array.from({ length: 400 }, async (_, index) => {
        const file = await writeSession(root, `other/${index}.jsonl`, [
          {
            type: "session",
            id: `other-${index}`,
            timestamp: "2026-06-02T00:00:00.000Z",
            cwd: otherCwd,
          },
        ]);
        await utimes(file, new Date("2026-06-02"), new Date("2026-06-02"));
      }),
    );

    await expect(
      listOmpImportableSessions({ sessionDir: sessionsDir, cwd: requestedCwd, limit: 1 }),
    ).resolves.toEqual([
      expect.objectContaining({ providerHandleId: requestedFile, cwd: requestedCwd }),
    ]);
  });

  test("reads title-first sessions and OMP combined model identifiers", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "paseo-omp-session-title-first-"));
    const cwd = path.join(root, "repo");
    const sessionFile = await writeSession(root, "project/session.jsonl", [
      {
        type: "title",
        id: "title-1",
        timestamp: "2026-06-09T00:00:00.000Z",
        title: "Deploy Paseo and verify",
      },
      {
        type: "session",
        version: 3,
        id: "session-title-first",
        timestamp: "2026-06-09T00:00:00.100Z",
        cwd,
      },
      {
        type: "model_change",
        id: "model-1",
        timestamp: "2026-06-09T00:00:00.200Z",
        model: "openai-codex/gpt-5.1",
      },
      {
        type: "message",
        id: "user-1",
        timestamp: "2026-06-09T00:00:01.000Z",
        message: { role: "user", content: [{ type: "text", text: "import me" }] },
      },
    ]);

    await expect(
      listOmpImportableSessions({ sessionDir: path.join(root, "sessions") }),
    ).resolves.toEqual([
      expect.objectContaining({
        providerHandleId: sessionFile,
        cwd,
        title: "Deploy Paseo and verify",
        firstPromptPreview: "import me",
      }),
    ]);
    await expect(readOmpImportSessionConfig(sessionFile)).resolves.toEqual({
      model: "openai-codex/gpt-5.1",
    });
  });

  test("keeps recent nested OMP subagent sessions importable", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "paseo-omp-session-nested-"));
    const cwd = path.join(root, "repo");
    const parent = await writeSession(root, "project/parent.jsonl", [
      { type: "session", id: "parent", timestamp: "2026-06-10T00:00:00.000Z", cwd },
      {
        type: "message",
        id: "parent-user",
        timestamp: "2026-06-10T00:00:01.000Z",
        message: { role: "user", content: "parent prompt" },
      },
    ]);
    const child = await writeSession(root, "project/parent/Explore.jsonl", [
      { type: "session", id: "child", timestamp: "2026-06-09T00:00:00.000Z", cwd },
      {
        type: "message",
        id: "child-user",
        timestamp: "2026-06-09T00:00:01.000Z",
        message: { role: "user", content: "child prompt" },
      },
    ]);
    await utimes(parent, new Date("2026-06-08"), new Date("2026-06-08"));
    await utimes(child, new Date("2026-06-09"), new Date("2026-06-09"));

    await expect(
      listOmpImportableSessions({ sessionDir: path.join(root, "sessions"), limit: 1 }),
    ).resolves.toEqual([
      expect.objectContaining({
        providerHandleId: child,
        title: "Explore",
        firstPromptPreview: "child prompt",
      }),
    ]);
  });

  test("uses OMP's own default session directory", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "paseo-omp-session-home-"));
    const cwd = path.join(home, "repo");
    const sessionFile = path.join(home, ".omp", "agent", "sessions", "project", "session.jsonl");
    await mkdir(path.dirname(sessionFile), { recursive: true });
    await writeFile(
      sessionFile,
      `${JSON.stringify({ type: "session", id: "default-dir", timestamp: "2026-06-09", cwd })}\n`,
      "utf8",
    );

    await expect(listOmpImportableSessions({ homeDir: home, env: {} })).resolves.toEqual([
      expect.objectContaining({ providerHandleId: sessionFile, cwd }),
    ]);
  });
});

describe("OMP sessions directory", () => {
  const tempDirs: string[] = [];
  // Only the XDG branch touches the filesystem; the other cases are pure path math.
  const home = path.join(tmpdir(), "paseo-omp-unwritten-home");

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  test("falls back to OMP's own agent sessions directory", () => {
    expect(resolveOmpSessionPaths({ env: {}, homeDir: home, platform: "linux" })).toEqual({
      agentDir: path.join(home, ".omp", "agent"),
      sessionsDir: path.join(home, ".omp", "agent", "sessions"),
    });
  });

  test("PI_CONFIG_DIR renames the config root", () => {
    expect(
      resolveOmpSessionPaths({
        env: { PI_CONFIG_DIR: ".omp-custom" },
        homeDir: home,
        platform: "linux",
      }).sessionsDir,
    ).toBe(path.join(home, ".omp-custom", "agent", "sessions"));
  });

  test("a named profile nests under profiles/, and OMP_PROFILE beats PI_PROFILE", () => {
    expect(
      resolveOmpSessionPaths({
        env: { OMP_PROFILE: "work", PI_PROFILE: "ignored" },
        homeDir: home,
        platform: "linux",
      }).sessionsDir,
    ).toBe(path.join(home, ".omp", "profiles", "work", "agent", "sessions"));
    expect(
      resolveOmpSessionPaths({ env: { PI_PROFILE: "side" }, homeDir: home, platform: "linux" })
        .sessionsDir,
    ).toBe(path.join(home, ".omp", "profiles", "side", "agent", "sessions"));
  });

  test("PI_CODING_AGENT_DIR overrides the agent directory on the default profile only", () => {
    const override = path.join(home, "custom-agent");
    expect(
      resolveOmpSessionPaths({
        env: { PI_CODING_AGENT_DIR: override },
        homeDir: home,
        platform: "linux",
      }).sessionsDir,
    ).toBe(path.join(override, "sessions"));
    expect(
      resolveOmpSessionPaths({
        env: { OMP_PROFILE: "work", PI_CODING_AGENT_DIR: override },
        homeDir: home,
        platform: "linux",
      }).sessionsDir,
    ).toBe(path.join(home, ".omp", "profiles", "work", "agent", "sessions"));
  });

  test("an existing XDG data root drops the agent/ layer", async () => {
    const xdgHome = await makeTempDir();
    const xdgData = path.join(xdgHome, "xdg-data");
    await mkdir(path.join(xdgData, "omp", "profiles", "work"), { recursive: true });

    expect(
      resolveOmpSessionPaths({
        env: { XDG_DATA_HOME: xdgData },
        homeDir: xdgHome,
        platform: "darwin",
      }).sessionsDir,
    ).toBe(path.join(xdgData, "omp", "sessions"));
    expect(
      resolveOmpSessionPaths({
        env: { XDG_DATA_HOME: xdgData, OMP_PROFILE: "work" },
        homeDir: xdgHome,
        platform: "linux",
      }).sessionsDir,
    ).toBe(path.join(xdgData, "omp", "profiles", "work", "sessions"));

    const agentLayerKept = path.join(xdgHome, ".omp", "agent", "sessions");
    // Windows has no XDG layout, and a data root OMP has not created yet is not adopted.
    expect(
      resolveOmpSessionPaths({
        env: { XDG_DATA_HOME: xdgData },
        homeDir: xdgHome,
        platform: "win32",
      }).sessionsDir,
    ).toBe(agentLayerKept);
    expect(
      resolveOmpSessionPaths({
        env: { XDG_DATA_HOME: path.join(xdgHome, "absent") },
        homeDir: xdgHome,
        platform: "linux",
      }).sessionsDir,
    ).toBe(agentLayerKept);
    // An explicit agent directory keeps OMP off the XDG branch entirely.
    expect(
      resolveOmpSessionPaths({
        env: { XDG_DATA_HOME: xdgData, PI_CODING_AGENT_DIR: path.join(xdgHome, "custom-agent") },
        homeDir: xdgHome,
        platform: "linux",
      }).sessionsDir,
    ).toBe(path.join(xdgHome, "custom-agent", "sessions"));
  });

  test("session import reads a project settings.json sessionDir", async () => {
    const root = await makeTempDir();
    const cwd = path.join(root, "repo");
    const configuredDir = path.join(root, "configured-sessions");
    await mkdir(path.join(cwd, ".omp"), { recursive: true });
    await writeFile(
      path.join(cwd, ".omp", "settings.json"),
      JSON.stringify({ sessionDir: configuredDir }),
      "utf8",
    );
    const sessionFile = path.join(configuredDir, "project", "session.jsonl");
    await mkdir(path.dirname(sessionFile), { recursive: true });
    await writeFile(
      sessionFile,
      `${JSON.stringify({ type: "session", id: "settings-dir", timestamp: "2026-06-09T00:00:00.000Z", cwd })}\n`,
      "utf8",
    );

    // Provider params leave sessionDir unset, so settings.json decides.
    const { runtimeProviderParams } = resolveOmpProviderParams({});
    expect(runtimeProviderParams.sessionDir).toBeUndefined();

    await expect(
      listOmpImportableSessions({
        sessionDir: runtimeProviderParams.sessionDir,
        cwd,
        homeDir: root,
        env: {},
      }),
    ).resolves.toEqual([expect.objectContaining({ providerHandleId: sessionFile, cwd })]);
  });

  test("runtime settings env wins over the daemon environment", async () => {
    const root = await makeTempDir();
    const cwd = path.join(root, "repo");
    const agentDir = path.join(root, "runtime-agent");
    const sessionFile = path.join(agentDir, "sessions", "project", "session.jsonl");
    await mkdir(path.dirname(sessionFile), { recursive: true });
    await writeFile(
      sessionFile,
      `${JSON.stringify({ type: "session", id: "runtime-env", timestamp: "2026-06-09T00:00:00.000Z", cwd })}\n`,
      "utf8",
    );

    await expect(
      listOmpImportableSessions({
        cwd,
        homeDir: root,
        env: { PI_CODING_AGENT_DIR: path.join(root, "stale-agent") },
        runtimeSettings: { env: { PI_CODING_AGENT_DIR: agentDir } },
      }),
    ).resolves.toEqual([expect.objectContaining({ providerHandleId: sessionFile, cwd })]);
  });

  async function makeTempDir(): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), "paseo-omp-sessions-dir-"));
    tempDirs.push(dir);
    return dir;
  }
});
