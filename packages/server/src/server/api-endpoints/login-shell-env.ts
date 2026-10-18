// 问登录 shell 要变量的做法移植自 magpie（https://github.com/yetone/magpie，internal/proc/path_other.go 的
// LoginEnv / shellEnv / askShell / shellProbe / parseShellEnv）。
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { spawn as defaultSpawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

/*
 * 终端里现在打开的 shell 有哪些变量：起一个登录 shell（先 -ilc，答不上再 -lc），让它在两个标记之间
 * 用 NUL 隔开打印要问的变量。一分钟内再问用上次的答案；Windows 不问（magpie 同样）。
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
}

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
    pending ??= askLoginShell({ env: options.env, spawn, keys })
      .then((vars) => ({ at: now(), keys: wanted, vars }))
      .finally(() => {
        pending = null;
      });
    cached = await pending;
    return cached.vars;
  };
}

interface AskLoginShellInput {
  env: NodeJS.ProcessEnv;
  spawn: typeof defaultSpawn;
  keys: readonly string[];
}

async function askLoginShell(input: AskLoginShellInput): Promise<LoginShellVars> {
  const shell = loginShell(input.env);
  for (const flags of ["-ilc", "-lc"]) {
    const output = await runShell({ ...input, shell, flags });
    const vars = parseShellEnv({ output, keys: input.keys });
    if (vars) return vars;
  }
  return {};
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

interface RunShellInput extends AskLoginShellInput {
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
