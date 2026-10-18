// 云平台开关的名单、开着的判断与「写在哪」的查找顺序移植自 magpie
// （https://github.com/yetone/magpie，internal/agent/claude.go 的 claudeClouds / claudeSwitchOn / claudeCloud）。
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { readdirSync } from "node:fs";
import path from "node:path";

/*
 * Claude Code 的云平台开关（ADR 0012「Keys Osuna now owns」）：开着任何一个，Claude Code 就把请求发给那家云
 * 自己的地址变量，ANTHROPIC_BASE_URL 不再生效，请求不经过中转站。名单与云的叫法按 Claude Code 2.1.302。
 */
export const CLAUDE_CLOUD_SWITCHES = {
  CLAUDE_CODE_USE_BEDROCK: "Amazon Bedrock",
  CLAUDE_CODE_USE_VERTEX: "Google Vertex AI",
  CLAUDE_CODE_USE_FOUNDRY: "Microsoft Foundry",
  CLAUDE_CODE_USE_ANTHROPIC_AWS: "Claude Platform on AWS",
  CLAUDE_CODE_USE_ANTHROPIC_GOOGLE_CLOUD: "Claude Platform on Google Cloud",
  CLAUDE_CODE_USE_MANTLE: "Amazon Bedrock (Mantle)",
} as const;

export type ClaudeCloudSwitch = keyof typeof CLAUDE_CLOUD_SWITCHES;

export const CLAUDE_CLOUD_SWITCH_KEYS = Object.keys(CLAUDE_CLOUD_SWITCHES) as ClaudeCloudSwitch[];

/** Claude Code 认作开着的值：1、true、yes、on，不分大小写、去掉两边空白；JSON 的 true 与数字 1 同样算。 */
export function isClaudeSwitchOn(value: unknown): boolean {
  const isScalar =
    typeof value === "string" || typeof value === "boolean" || typeof value === "number";
  if (!isScalar) return false;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

/** 一处设了云平台开关的地方；shell 没有文件。 */
export type ClaudeCloudSource = "managed" | "settings" | "global_config" | "shell";

export interface ClaudeCloudSwitchFinding {
  source: ClaudeCloudSource;
  // 设了这个开关的文件；shell 时为 null。
  file: string | null;
  key: ClaudeCloudSwitch;
  cloud: string;
}

/** 一份读出来的设置文件里的 env；读不到、读不懂时 env 为 null。 */
export interface ClaudeEnvFile {
  file: string;
  env: Record<string, unknown> | null;
}

/**
 * 哪个开着的开关把 Claude Code 带去云平台、写在哪；都没开时为 null。按名单顺序，每个开关看
 * 托管设置、用户 settings.json、~/.claude.json，最先有这个变量的那一处说了算（Claude Code 按
 * shell → ~/.claude.json → 用户设置 → 托管设置依次盖上去）；三处都没有才看登录 shell 的环境。
 * 项目自己的 .claude/settings.json 不看：Osuna 不知道 Claude Code 在哪些目录里跑。
 */
export function findClaudeCloudSwitch(input: {
  managed: ClaudeEnvFile[];
  settings: ClaudeEnvFile;
  globalConfig: ClaudeEnvFile;
  shellEnv: NodeJS.ProcessEnv;
}): ClaudeCloudSwitchFinding | null {
  const managed = lastSetter(input.managed);
  const files: { source: ClaudeCloudSource; find: (key: string) => ClaudeEnvFile | null }[] = [
    { source: "managed", find: managed },
    { source: "settings", find: (key) => (hasKey(input.settings, key) ? input.settings : null) },
    {
      source: "global_config",
      find: (key) => (hasKey(input.globalConfig, key) ? input.globalConfig : null),
    },
  ];
  for (const key of CLAUDE_CLOUD_SWITCH_KEYS) {
    const cloud = CLAUDE_CLOUD_SWITCHES[key];
    const setter = firstSetter(files, key);
    if (setter) {
      if (isClaudeSwitchOn(setter.file.env?.[key])) {
        return { source: setter.source, file: setter.file.file, key, cloud };
      }
      continue;
    }
    if (isClaudeSwitchOn(input.shellEnv[key])) return { source: "shell", file: null, key, cloud };
  }
  return null;
}

function firstSetter(
  files: { source: ClaudeCloudSource; find: (key: string) => ClaudeEnvFile | null }[],
  key: string,
): { source: ClaudeCloudSource; file: ClaudeEnvFile } | null {
  for (const { source, find } of files) {
    const file = find(key);
    if (file) return { source, file };
  }
  return null;
}

/** 托管文件按合并顺序排好时，最后一份有这个变量的说了算（env 按变量逐个合并，后面的盖前面的）。 */
function lastSetter(files: ClaudeEnvFile[]): (key: string) => ClaudeEnvFile | null {
  return (key) => files.findLast((file) => hasKey(file, key)) ?? null;
}

function hasKey(file: ClaudeEnvFile, key: string): boolean {
  return file.env !== null && Object.hasOwn(file.env, key);
}

/** 托管设置里最终生效的 ANTHROPIC_BASE_URL 与写它的文件；没写或是空串时为 null。 */
export function managedBaseUrl(managed: ClaudeEnvFile[]): { file: string; url: string } | null {
  const setter = lastSetter(managed)("ANTHROPIC_BASE_URL");
  const raw = setter?.env?.ANTHROPIC_BASE_URL;
  if (!setter || typeof raw !== "string" || raw.trim() === "") return null;
  return { file: setter.file, url: raw.trim() };
}

/** Claude Code 2.1.302 读托管设置文件的目录（KE()）；与官方文档一致。 */
export function defaultClaudeManagedSettingsDir(platform: NodeJS.Platform): string {
  if (platform === "darwin") return "/Library/Application Support/ClaudeCode";
  if (platform === "win32") return "C:\\Program Files\\ClaudeCode";
  return "/etc/claude-code";
}

/**
 * 托管设置文件按 Claude Code 的合并顺序：先 managed-settings.json，再 managed-settings.d/ 里
 * 不以点开头、以 .json 结尾的文件按字母序。只给路径，存不存在由读的一方判断。
 */
export function claudeManagedSettingsFiles(dir: string): string[] {
  const dropInDir = path.join(dir, "managed-settings.d");
  let dropIns: string[] = [];
  try {
    dropIns = readdirSync(dropInDir)
      .filter((name) => !name.startsWith(".") && name.endsWith(".json"))
      .sort()
      .map((name) => path.join(dropInDir, name));
  } catch {
    // 目录不存在或读不了：没有 drop-in。
  }
  return [path.join(dir, "managed-settings.json"), ...dropIns];
}
