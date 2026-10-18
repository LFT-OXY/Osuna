import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  claudeManagedSettingsFiles,
  findClaudeCloudSwitch,
  managedBaseUrl,
  type ClaudeEnvFile,
} from "./claude-cloud-switches.js";

const MANAGED = "/managed/managed-settings.json";
const SETTINGS = "/home/me/.claude/settings.json";
const GLOBAL = "/home/me/.claude.json";

function file(name: string, env: Record<string, unknown> | null = {}): ClaudeEnvFile {
  return { file: name, env };
}

function find(input: {
  managed?: Record<string, unknown>;
  settings?: Record<string, unknown>;
  globalConfig?: Record<string, unknown>;
  shellEnv?: NodeJS.ProcessEnv;
}) {
  return findClaudeCloudSwitch({
    managed: [file(MANAGED, input.managed ?? {})],
    settings: file(SETTINGS, input.settings ?? {}),
    globalConfig: file(GLOBAL, input.globalConfig ?? {}),
    shellEnv: input.shellEnv ?? {},
  });
}

describe("findClaudeCloudSwitch", () => {
  it("finds nothing when no switch is on anywhere", () => {
    expect(find({ settings: { CLAUDE_CODE_USE_VERTEX: "0" }, shellEnv: { PATH: "/bin" } })).toBe(
      null,
    );
  });

  it("names the managed settings file that turns a switch on", () => {
    expect(find({ managed: { CLAUDE_CODE_USE_BEDROCK: "1" } })).toEqual({
      source: "managed",
      file: MANAGED,
      key: "CLAUDE_CODE_USE_BEDROCK",
      cloud: "Amazon Bedrock",
    });
  });

  it("names ~/.claude.json when its env turns a switch on", () => {
    expect(find({ globalConfig: { CLAUDE_CODE_USE_VERTEX: true } })).toEqual({
      source: "global_config",
      file: GLOBAL,
      key: "CLAUDE_CODE_USE_VERTEX",
      cloud: "Google Vertex AI",
    });
  });

  it("says the login shell has a switch on when no file sets it", () => {
    expect(find({ shellEnv: { CLAUDE_CODE_USE_FOUNDRY: "yes" } })).toEqual({
      source: "shell",
      file: null,
      key: "CLAUDE_CODE_USE_FOUNDRY",
      cloud: "Microsoft Foundry",
    });
  });

  it("goes by the place Claude Code applies last: a switch off there wins over one on below it", () => {
    expect(
      find({
        managed: { CLAUDE_CODE_USE_BEDROCK: "0" },
        settings: { CLAUDE_CODE_USE_BEDROCK: "1" },
        globalConfig: { CLAUDE_CODE_USE_BEDROCK: "1" },
        shellEnv: { CLAUDE_CODE_USE_BEDROCK: "1" },
      }),
    ).toBe(null);
    expect(
      find({
        settings: { CLAUDE_CODE_USE_MANTLE: "false" },
        shellEnv: { CLAUDE_CODE_USE_MANTLE: "1" },
      }),
    ).toBe(null);
  });

  it("reports a switch turned on again in settings.json", () => {
    expect(find({ settings: { CLAUDE_CODE_USE_ANTHROPIC_AWS: "on" } })?.source).toBe("settings");
  });

  it("names the last managed drop-in that sets the switch", () => {
    const dropIn = "/managed/managed-settings.d/20-cloud.json";
    expect(
      findClaudeCloudSwitch({
        managed: [
          file(MANAGED, { CLAUDE_CODE_USE_BEDROCK: "0" }),
          file("/managed/managed-settings.d/10-other.json", { OTHER: "1" }),
          file(dropIn, { CLAUDE_CODE_USE_BEDROCK: "1" }),
        ],
        settings: file(SETTINGS),
        globalConfig: file(GLOBAL, null),
        shellEnv: {},
      }),
    ).toMatchObject({ source: "managed", file: dropIn });
  });
});

describe("managedBaseUrl", () => {
  it("gives the address the last managed file sets, and the file", () => {
    const dropIn = "/managed/managed-settings.d/50-gateway.json";
    expect(
      managedBaseUrl([
        file(MANAGED, { ANTHROPIC_BASE_URL: "https://first.example" }),
        file(dropIn, { ANTHROPIC_BASE_URL: " https://corp-gateway.example " }),
      ]),
    ).toEqual({ file: dropIn, url: "https://corp-gateway.example" });
  });

  it("gives nothing when no managed file sets an address", () => {
    expect(
      managedBaseUrl([file(MANAGED, null), file("/m/a.json", { ANTHROPIC_BASE_URL: "" })]),
    ).toBe(null);
  });
});

describe("claudeManagedSettingsFiles", () => {
  let dir: string | null = null;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  it("lists managed-settings.json first, then the drop-ins in alphabetical order, skipping hidden and non-JSON files", () => {
    dir = mkdtempSync(path.join(tmpdir(), "osuna-managed-"));
    const dropIns = path.join(dir, "managed-settings.d");
    mkdirSync(dropIns);
    for (const name of ["20-b.json", "10-a.json", ".hidden.json", "notes.txt"]) {
      writeFileSync(path.join(dropIns, name), "{}");
    }
    expect(claudeManagedSettingsFiles(dir)).toEqual([
      path.join(dir, "managed-settings.json"),
      path.join(dropIns, "10-a.json"),
      path.join(dropIns, "20-b.json"),
    ]);
  });

  it("lists only managed-settings.json when there is no drop-in directory", () => {
    dir = mkdtempSync(path.join(tmpdir(), "osuna-managed-"));
    expect(claudeManagedSettingsFiles(dir)).toEqual([path.join(dir, "managed-settings.json")]);
  });
});
