import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createLoginShellEnvReader, parseShellEnv, shellProbeCommand } from "./login-shell-env.js";

const KEYS = ["CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX"];

describe("parseShellEnv", () => {
  it("reads the values between the marks, past whatever the profile printed", () => {
    expect(
      parseShellEnv({
        output: "welcome!\n__osuna_shell_env__1\0__osuna_shell_env__",
        keys: KEYS,
      }),
    ).toEqual({ CLAUDE_CODE_USE_BEDROCK: "1" });
  });

  it("takes a value that is the variable's own reference as unset", () => {
    expect(
      parseShellEnv({
        output: "__osuna_shell_env__$CLAUDE_CODE_USE_BEDROCK\0yes__osuna_shell_env__",
        keys: KEYS,
      }),
    ).toEqual({ CLAUDE_CODE_USE_VERTEX: "yes" });
  });

  it("gives no answer when the shell printed no marks or the wrong number of values", () => {
    expect(parseShellEnv({ output: "nothing", keys: KEYS })).toBeNull();
    expect(parseShellEnv({ output: "__osuna_shell_env__1__osuna_shell_env__", keys: KEYS })).toBe(
      null,
    );
  });

  it("asks nushell through /bin/sh, which expands the references", () => {
    expect(shellProbeCommand({ shell: "/opt/homebrew/bin/nu", keys: ["A"] })).toBe(
      `^/bin/sh -c 'printf "__osuna_shell_env__%s__osuna_shell_env__" "$A"'`,
    );
  });
});

describe("createLoginShellEnvReader", () => {
  let dir: string | null = null;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  /** 假的登录 shell：记下每次被问，带上用例给的变量，不读任何配置文件就跑那条命令。 */
  function fakeShell(exports: string): { shell: string; calls: () => string[] } {
    dir = mkdtempSync(path.join(tmpdir(), "osuna-fake-shell-"));
    const log = path.join(dir, "calls.log");
    const shell = path.join(dir, "fake-sh");
    writeFileSync(
      shell,
      `#!/bin/sh\necho "$1 $PASEO_SHELL_PROBE" >> "${log}"\n${exports}\nexec /bin/sh -c "$2"\n`,
    );
    chmodSync(shell, 0o755);
    return {
      shell,
      calls: () => readFileSync(log, "utf8").trim().split("\n"),
    };
  }

  it("asks the login shell, marked as a probe, and keeps the answer for a minute", async () => {
    const { shell, calls } = fakeShell("export CLAUDE_CODE_USE_VERTEX=1");
    let clock = 0;
    const read = createLoginShellEnvReader({ env: { SHELL: shell }, now: () => clock });

    expect(await read(KEYS)).toEqual({ CLAUDE_CODE_USE_VERTEX: "1" });
    clock = 59_000;
    expect(await read(KEYS)).toEqual({ CLAUDE_CODE_USE_VERTEX: "1" });
    expect(calls()).toEqual(["-ilc 1"]);

    clock = 61_000;
    await read(KEYS);
    expect(calls()).toEqual(["-ilc 1", "-ilc 1"]);
  });

  it("does not ask on Windows", async () => {
    const read = createLoginShellEnvReader({
      env: { SHELL: "/nonexistent" },
      platform: "win32",
      spawn: () => {
        throw new Error("must not spawn");
      },
    });
    expect(await read(KEYS)).toEqual({});
  });

  it("answers nothing when the shell can't be started", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "osuna-fake-shell-"));
    const read = createLoginShellEnvReader({ env: { SHELL: path.join(dir, "missing-sh") } });
    expect(await read(KEYS)).toEqual({});
  });
});
