// 问登录 shell 要变量的做法移植自 magpie（https://github.com/yetone/magpie，internal/proc/path_other.go 的
// LoginEnv / shellEnv / termShells / FindShell / mergeShellEnv / askShell / shellProbe / parseShellEnv）。
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { spawn as defaultSpawn } from "node:child_process";
import { accessSync, constants, existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/*
 * 终端里现在打开的 shell 有哪些变量：起登录 shell（先 -ilc，答不上再 -lc），让它在两个标记之间
 * 用 NUL 隔开打印要问的变量。终端也可能开的是 fish 或 nushell：装了、且配置目录在（首次运行时建）的
 * 一并问，同时问；每个变量取第一个答出它的，登录 shell 在前。一分钟内再问用上次的答案；
 * Windows 不问（magpie 同样）。
 * shell 起在自己的会话里（detached），不抢 daemon 的终端；带 PASEO_SHELL_PROBE=1，e2e 封条据此拦下。
 */

const SHELL_MARK = "__osuna_shell_env__";
const SHELL_ASK_MS = 5_000;
const CACHE_MS = 60_000;

/** 问到的变量；shell 没有、没答上或答不出时不在里面。 */
export type LoginShellVars = Record<string, string>;

export type ReadLoginShellEnv = (keys: readonly string[]) => Promise<LoginShellVars>;

export interface LoginShellEnvReaderOptions {
  // 找登录 shell（SHELL）用，也作为 shell 进程的环境。
  env: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  spawn?: typeof defaultSpawn;
  now?: () => number;
  // 找 fish、nushell 的配置目录用；缺省取系统的家目录。
  homeDir?: string;
  // 找装在这台机器上的 shell（fish、nu）；缺省按 magpie 的 FindShell，测试换成假的。
  findShell?: FindShell;
}

/** 装在这台机器上的那个 shell 的路径；没有时为 null。 */
export type FindShell = (name: string) => string | null;

interface CachedAnswer {
  at: number;
  keys: string;
  vars: LoginShellVars;
}

/** 带一分钟缓存的读取器；同时来的几次问合成一次。 */
export function createLoginShellEnvReader(options: LoginShellEnvReaderOptions): ReadLoginShellEnv {
  const platform = options.platform ?? process.platform;
  const spawn = options.spawn ?? defaultSpawn;
  const now = options.now ?? Date.now;
  let cached: CachedAnswer | null = null;
  let pending: Promise<CachedAnswer> | null = null;

  return async (keys) => {
    if (platform === "win32") return {};
    const wanted = keys.join("\0");
    const isFresh = cached !== null && cached.keys === wanted && now() - cached.at < CACHE_MS;
    if (cached && isFresh) return cached.vars;
    const shells = [
      loginShell(options.env),
      ...terminalShells({
        loginShell: loginShell(options.env),
        env: options.env,
        homeDir: options.homeDir ?? homedir(),
        findShell: options.findShell ?? findShell,
      }),
    ];
    pending ??= askShells({ env: options.env, spawn, keys, shells })
      .then((vars) => ({ at: now(), keys: wanted, vars }))
      .finally(() => {
        pending = null;
      });
    cached = await pending;
    return cached.vars;
  };
}

interface ShellQuestion {
  env: NodeJS.ProcessEnv;
  spawn: typeof defaultSpawn;
  keys: readonly string[];
}

interface AskShellsInput extends ShellQuestion {
  // 登录 shell 在前。
  shells: string[];
}

/** 同时问每个 shell；每个变量取第一个答出它的（magpie 的 mergeShellEnv）。 */
async function askShells(input: AskShellsInput): Promise<LoginShellVars> {
  const answers = await Promise.all(input.shells.map((shell) => askShell({ ...input, shell })));
  const merged: LoginShellVars = {};
  for (const answer of answers) {
    for (const [key, value] of Object.entries(answer)) {
      merged[key] ??= value;
    }
  }
  return merged;
}

interface AskShellInput extends ShellQuestion {
  shell: string;
}

async function askShell(input: AskShellInput): Promise<LoginShellVars> {
  const { shell } = input;
  for (const flags of ["-ilc", "-lc"]) {
    const output = await runShell({ ...input, shell, flags });
    const vars = parseShellEnv({ output, keys: input.keys });
    if (vars) return vars;
  }
  return {};
}

interface TerminalShellsInput {
  loginShell: string;
  env: NodeJS.ProcessEnv;
  homeDir: string;
  findShell: FindShell;
}

/** 登录 shell 之外终端可能开的：fish 与 nushell，装了且配置目录在时（magpie 的 termShells）。 */
export function terminalShells(input: TerminalShellsInput): string[] {
  const xdg = input.env.XDG_CONFIG_HOME;
  const configHome = xdg && path.isAbsolute(xdg) ? xdg : path.join(input.homeDir, ".config");
  const configDirs: Record<string, string[]> = {
    fish: [path.join(configHome, "fish")],
    nu: [
      path.join(configHome, "nushell"),
      path.join(input.homeDir, "Library", "Application Support", "nushell"),
    ],
  };
  const shells: string[] = [];
  for (const name of ["fish", "nu"]) {
    if (path.basename(input.loginShell) === name) continue;
    const isConfigured = (configDirs[name] ?? []).some(isDirectory);
    const program = isConfigured ? input.findShell(name) : null;
    if (program) shells.push(program);
  }
  return shells;
}

/** shell 装在哪：先看常见的安装目录，再看 /etc/shells，最后看 PATH（magpie 的 FindShell）。 */
export function findShell(name: string): string | null {
  const home = homedir();
  const dirs = [
    "/bin",
    "/usr/bin",
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/opt/local/bin",
    "/home/linuxbrew/.linuxbrew/bin",
    "/run/current-system/sw/bin",
    "/nix/var/nix/profiles/default/bin",
    path.join(home, ".nix-profile", "bin"),
    path.join(home, ".local", "bin"),
    path.join(home, ".cargo", "bin"),
  ];
  const inDirs = dirs.map((dir) => path.join(dir, name)).find(isProgram);
  if (inDirs) return inDirs;
  const listed = readOptionalText("/etc/shells")
    ?.split("\n")
    .map((line) => line.trim())
    .find((line) => path.isAbsolute(line) && path.basename(line) === name && isProgram(line));
  if (listed) return listed;
  const onPath = (process.env.PATH ?? "")
    .split(path.delimiter)
    .filter((dir) => dir !== "")
    .map((dir) => path.join(dir, name))
    .find(isProgram);
  return onPath ?? null;
}

function isProgram(file: string): boolean {
  if (!existsSync(file) || statSync(file).isDirectory()) return false;
  try {
    accessSync(file, constants.X_OK);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EACCES") return false;
    throw error;
  }
}

function isDirectory(dir: string): boolean {
  return existsSync(dir) && statSync(dir).isDirectory();
}

function readOptionalText(file: string): string | null {
  try {
    return readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** SHELL 不是绝对路径时按 magpie：/bin/zsh，没有就 /bin/sh。 */
function loginShell(env: NodeJS.ProcessEnv): string {
  const shell = env.SHELL;
  if (shell && path.isAbsolute(shell)) return shell;
  return existsSync("/bin/zsh") ? "/bin/zsh" : "/bin/sh";
}

/** shell 打印的命令：标记、各变量（NUL 隔开）、标记。nushell 的双引号不展开变量，交给 /bin/sh 打印。 */
export function shellProbeCommand(input: { shell: string; keys: readonly string[] }): string {
  const format = `${SHELL_MARK}${input.keys.map(() => "%s").join("\\0")}${SHELL_MARK}`;
  const args = input.keys.map((key) => ` "$${key}"`).join("");
  if (path.basename(input.shell) === "nu") return `^/bin/sh -c 'printf "${format}"${args}'`;
  return `printf '${format}'${args}`;
}

/**
 * 从 shell 的输出里取两个标记之间的答案；个数对不上（printf 不认 \0）时为 null。
 * 值就是变量自己的引用（"$KEY"）说明 shell 没展开，按没设。
 */
export function parseShellEnv(input: {
  output: string;
  keys: readonly string[];
}): LoginShellVars | null {
  const start = input.output.indexOf(SHELL_MARK);
  if (start < 0) return null;
  const rest = input.output.slice(start + SHELL_MARK.length);
  const end = rest.indexOf(SHELL_MARK);
  if (end < 0) return null;
  const fields = rest.slice(0, end).split("\0");
  if (fields.length !== input.keys.length) return null;
  const vars: LoginShellVars = {};
  input.keys.forEach((key, index) => {
    const value = fields[index] ?? "";
    const isUnexpanded = value === `$${key}`;
    if (value !== "" && !isUnexpanded) vars[key] = value;
  });
  return vars;
}

interface RunShellInput extends ShellQuestion {
  shell: string;
  flags: string;
}

/** 跑一次，最多等 5 秒；起不来、超时都按没答上（空输出）。 */
async function runShell(input: RunShellInput): Promise<string> {
  let output = "";
  const child = input.spawn(
    input.shell,
    [input.flags, shellProbeCommand({ shell: input.shell, keys: input.keys })],
    {
      env: { ...input.env, PASEO_SHELL_PROBE: "1" },
      stdio: ["ignore", "pipe", "ignore"],
      detached: true,
    },
  );
  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    output += chunk;
  });
  // 起不来时先发 error 再发 close（输出为空），所以只等 close；error 不接会被当作未处理而抛出。
  child.on("error", () => undefined);
  const closed = new Promise<void>((resolve) => child.on("close", () => resolve()));
  const timer = setTimeout(() => child.kill("SIGKILL"), SHELL_ASK_MS);
  await closed;
  clearTimeout(timer);
  return output;
}
