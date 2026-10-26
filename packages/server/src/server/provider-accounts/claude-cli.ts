// 运行环境的清理与问 `claude auth status` 移植自 magpie（https://github.com/yetone/magpie，d5805372）：
// internal/provider/claude_signin.go 的 claudeSignInEnv、claudeSignedIn，account.go 的 withoutClaudeWiring，
// internal/gateway/claude_warmup.go 的 claudeUsage。
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { spawnProcess } from "../../utils/spawn.js";
import { isRecord, nonEmptyString } from "./cli-login.js";

/*
 * 为存着的 Claude 号运行的真的 Claude Code（`claude auth login`、`claude -p /usage`）：用 Claude 提供方配置的命令
 * （与新会话同一套解析），在这个号的私有配置目录里跑。环境里去掉会把它指向别处的接线（第三方接口、
 * 别的配置目录、外层会话），只留 CLAUDE_CONFIG_DIR 指向这个号的目录。
 */

export interface ClaudeCliLaunch {
  command: string;
  // 提供方配置追加的参数，放在子命令前面。
  args: string[];
  env: NodeJS.ProcessEnv;
}

/** 找这台主机上的 Claude Code；找不到抛 ClaudeCliNotFound。 */
export type ResolveClaudeCli = () => Promise<ClaudeCliLaunch>;

export class ClaudeCliNotFound extends Error {
  constructor() {
    super("Install Claude Code first: Osuna signs in to Claude through its `claude` command");
    this.name = "ClaudeCliNotFound";
  }
}

// 会把 Claude Code 指向别的接口、token 或配置目录的变量（magpie 的 withoutClaudeWiring 与 claudeSignInEnv）。
const WIRING_KEYS = [
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_API_KEY",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "CLAUDE_CONFIG_DIR",
  "CLAUDE_SECURESTORAGE_CONFIG_DIR",
  "CLAUDECODE",
  "CLAUDE_CODE_ENTRYPOINT",
  "BROWSER",
];

/** 在 configDir 里跑 Claude Code 的环境。 */
export function claudeEnvFor(input: {
  env: NodeJS.ProcessEnv;
  configDir: string;
  extra?: Record<string, string>;
}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...input.env };
  for (const key of WIRING_KEYS) delete env[key];
  return { ...env, ...input.extra, CLAUDE_CONFIG_DIR: input.configDir };
}

export interface ClaudeCliRun {
  stdout: string;
  stderr: string;
  // 跑不起来或超时。
  error: string | undefined;
}

/** 在 configDir 的号上跑一次 Claude Code（标准输入给空的，照 magpie），收下输出；超时就停掉它。 */
export function runClaudeCli(input: {
  launch: ClaudeCliLaunch;
  args: string[];
  cwd: string;
  configDir: string;
  extra?: Record<string, string>;
  timeoutMs: number;
}): Promise<ClaudeCliRun> {
  const { launch } = input;
  return new Promise((resolve) => {
    const child = spawnProcess(launch.command, [...launch.args, ...input.args], {
      cwd: input.cwd,
      env: claudeEnvFor({
        env: launch.env,
        configDir: input.configDir,
        ...(input.extra ? { extra: input.extra } : {}),
      }),
      envMode: "internal",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let error: string | undefined;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, input.timeoutMs);
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    // 跑不起来（如找不到程序）时先有 error，随后照样有 close。
    child.once("error", (cause) => {
      error = cause.message;
    });
    child.once("close", () => clearTimeout(timer));
    child.once("close", () => {
      resolve({ stdout, stderr, error: timedOut ? "Claude Code timed out" : error });
    });
  });
}

const AUTH_STATUS_TIMEOUT_MS = 15_000;

/**
 * `claude auth status --json` 说的邮箱、组织名与套餐（magpie 的 claudeSignedIn）：.claude.json 没记下邮箱或套餐时补上。
 * 跑不起来或读不懂为空。
 */
export async function readClaudeAuthStatus(input: {
  launch: ClaudeCliLaunch;
  configDir: string;
}): Promise<{ email?: string; orgName?: string; plan?: string }> {
  const run = await runClaudeCli({
    launch: input.launch,
    args: ["auth", "status", "--json"],
    cwd: input.configDir,
    configDir: input.configDir,
    timeoutMs: AUTH_STATUS_TIMEOUT_MS,
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(run.stdout);
  } catch {
    return {};
  }
  if (!isRecord(parsed)) return {};
  const email = nonEmptyString(parsed.email);
  const orgName = nonEmptyString(parsed.orgName);
  const plan = nonEmptyString(parsed.subscriptionType);
  return {
    ...(email ? { email } : {}),
    ...(orgName ? { orgName } : {}),
    ...(plan ? { plan } : {}),
  };
}
