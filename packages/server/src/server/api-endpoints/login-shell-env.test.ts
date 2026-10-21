import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isPlatform } from "../../test-utils/platform.js";
import {
  createLoginShellEnvReader,
  parseShellEnv,
  shellProbeCommand,
  terminalShells,
} from "./login-shell-env.js";

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
  // 假 shell 是 #!/bin/sh 脚本，Windows 起不来；读取器在 Windows 上本来就不问（见「does not ask on Windows」）。
  let dir: string | null = null;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  /** 假的 shell：记下每次被问，带上用例给的变量，不读任何配置文件就跑那条命令。 */
  function fakeShell(exports: string, name = "fake-sh"): { shell: string; calls: () => string[] } {
    dir ??= mkdtempSync(path.join(tmpdir(), "osuna-fake-shell-"));
    const log = path.join(dir, `${name}.log`);
    const shell = path.join(dir, name);
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

  it.skipIf(isPlatform("win32"))(
    "asks the login shell, marked as a probe, and keeps the answer for a minute",
    async () => {
      const { shell, calls } = fakeShell("export CLAUDE_CODE_USE_VERTEX=1");
      let clock = 0;
      const read = createLoginShellEnvReader({
        env: { SHELL: shell },
        now: () => clock,
        findShell: () => null,
      });

      expect(await read(KEYS)).toEqual({ CLAUDE_CODE_USE_VERTEX: "1" });
      clock = 59_000;
      expect(await read(KEYS)).toEqual({ CLAUDE_CODE_USE_VERTEX: "1" });
      expect(calls()).toEqual(["-ilc 1"]);

      clock = 61_000;
      await read(KEYS);
      expect(calls()).toEqual(["-ilc 1", "-ilc 1"]);
    },
  );

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
    const read = createLoginShellEnvReader({
      env: { SHELL: path.join(dir, "missing-sh") },
      findShell: () => null,
    });
    expect(await read(KEYS)).toEqual({});
  });

  it.skipIf(isPlatform("win32"))(
    "also asks fish and nushell when they are set up, the login shell's value first",
    async () => {
      const login = fakeShell("export CLAUDE_CODE_USE_VERTEX=0", "zsh");
      const fish = fakeShell(
        "export CLAUDE_CODE_USE_VERTEX=1\nexport CLAUDE_CODE_USE_BEDROCK=1",
        "fish",
      );
      const home = path.join(dir ?? "", "home");
      mkdirSync(path.join(home, ".config", "fish"), { recursive: true });
      const read = createLoginShellEnvReader({
        env: { SHELL: login.shell },
        homeDir: home,
        findShell: (name) => (name === "fish" ? fish.shell : null),
      });

      expect(await read(KEYS)).toEqual({
        CLAUDE_CODE_USE_VERTEX: "0",
        CLAUDE_CODE_USE_BEDROCK: "1",
      });
      expect(fish.calls()).toEqual(["-ilc 1"]);
    },
  );
});

describe("terminalShells", () => {
  let home: string | null = null;

  afterEach(() => {
    if (home) rmSync(home, { recursive: true, force: true });
    home = null;
  });

  const installed = (name: string) => `/fake/bin/${name}`;

  it("lists fish and nushell only when installed and their config folder is there", () => {
    home = mkdtempSync(path.join(tmpdir(), "osuna-terminal-shells-"));
    const input = { loginShell: "/bin/zsh", env: {}, homeDir: home, findShell: installed };
    expect(terminalShells(input)).toEqual([]);

    mkdirSync(path.join(home, ".config", "fish"), { recursive: true });
    mkdirSync(path.join(home, "Library", "Application Support", "nushell"), { recursive: true });
    expect(terminalShells(input)).toEqual(["/fake/bin/fish", "/fake/bin/nu"]);
    expect(terminalShells({ ...input, findShell: () => null })).toEqual([]);
  });

  it("follows XDG_CONFIG_HOME and skips the login shell itself", () => {
    home = mkdtempSync(path.join(tmpdir(), "osuna-terminal-shells-"));
    const xdg = path.join(home, "xdg");
    mkdirSync(path.join(xdg, "nushell"), { recursive: true });
    mkdirSync(path.join(xdg, "fish"), { recursive: true });
    expect(
      terminalShells({
        loginShell: "/opt/homebrew/bin/fish",
        env: { XDG_CONFIG_HOME: xdg },
        homeDir: home,
        findShell: installed,
      }),
    ).toEqual(["/fake/bin/nu"]);
  });
});
