import { applyEdits, modify, type FormattingOptions, type JSONPath } from "jsonc-parser";
import { z } from "zod";
import {
  API_ENDPOINT_MODEL_TIERS,
  type ApiEndpointModelMapping,
} from "@getpaseo/protocol/api-endpoint/rpc-schemas";

/*
 * Claude Code 的 ~/.claude/settings.json 补丁：只改 Osuna 负责的键，其余字节不动。
 * 规则见 docs/adr/0004-api-endpoint-rewrites-cli-config.md，思路参考 cc-switch（MIT）的 live/ 模块。
 *
 * 负责的键：
 * - env 下的 ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN / ANTHROPIC_API_KEY（置空）/ ANTHROPIC_MODEL；
 * - env 下用户映射了的 ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU,FABLE}_MODEL，没映射的档位不写；
 * - permissions.deny 里的一条 "WebSearch"：WebSearch 是 Anthropic 服务端工具，第三方接口不支持，
 *   Claude Code 没有关它的环境变量，只能用权限规则。用户自己写的同名规则不归 Osuna 所有。
 */

const WEB_SEARCH_RULE = "WebSearch";

const OriginalValueSchema = z.discriminatedUnion("present", [
  z.object({ present: z.literal(true), value: z.unknown() }),
  z.object({ present: z.literal(false) }),
]);
export type OriginalValue = z.infer<typeof OriginalValueSchema>;

// 接管前整个文件的样子：不存在、空对象（留原文，恢复成空时逐字节还原）、或有内容。
const OriginalFileSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("absent") }),
  z.object({ kind: z.literal("empty"), text: z.string() }),
  z.object({ kind: z.literal("content") }),
]);
type OriginalFile = z.infer<typeof OriginalFileSchema>;

/** 接管记录：每个负责的键接管前的原值，以及上次写入的值（检测外部改动用）。 */
export const ClaudeSettingsTakeoverSchema = z.object({
  originalFile: OriginalFileSchema,
  env: z.record(z.string(), z.object({ original: OriginalValueSchema, written: z.string() })),
  // 接管前没有 env 对象；恢复后 env 变空就整个删掉。
  envCreated: z.boolean(),
  webSearchDeny: z.object({
    added: z.boolean(),
    permissionsCreated: z.boolean(),
    denyCreated: z.boolean(),
  }),
});
export type ClaudeSettingsTakeover = z.infer<typeof ClaudeSettingsTakeoverSchema>;

export type ClaudeSettingsPatchResult =
  | { kind: "patched"; text: string; takeover: ClaudeSettingsTakeover }
  | { kind: "unparsable"; message: string };

export type ClaudeSettingsRestoreResult =
  | { kind: "patched"; text: string }
  // 接管前文件不存在，恢复后又只剩一个空对象：把文件删掉。
  | { kind: "delete" }
  | { kind: "missing" }
  | { kind: "unparsable"; message: string };

export function buildClaudeEndpointEnv(input: {
  baseUrl: string;
  apiKey: string;
  defaultModelId: string;
  modelMapping?: ApiEndpointModelMapping;
}): Record<string, string> {
  const env: Record<string, string> = {
    ANTHROPIC_BASE_URL: input.baseUrl,
    ANTHROPIC_AUTH_TOKEN: input.apiKey,
    // 登录态或环境里残留的 API key 会和 token 冲突，置空并纳入负责的键。
    ANTHROPIC_API_KEY: "",
    ANTHROPIC_MODEL: input.defaultModelId,
  };
  for (const tier of API_ENDPOINT_MODEL_TIERS) {
    const modelId = input.modelMapping?.[tier];
    if (modelId) env[`ANTHROPIC_DEFAULT_${tier.toUpperCase()}_MODEL`] = modelId;
  }
  return env;
}

/**
 * 把第三方接口写进 settings.json。`takeover` 为 null 表示首次接管；
 * 已接管时沿用其中的原值，只更新写入值，这样切回官方总能回到接管前的样子。
 * `text` 为 null 表示文件不存在。
 */
export function applyClaudeApiEndpoint(input: {
  text: string | null;
  env: Record<string, string>;
  takeover: ClaudeSettingsTakeover | null;
}): ClaudeSettingsPatchResult {
  const baseText = input.text === null || input.text.trim() === "" ? "{}\n" : input.text;
  const parsed = parseSettings(baseText);
  if (parsed.kind === "unparsable") return parsed;

  const formatting = detectFormatting(baseText);
  const envObject = parsed.settings.env;
  let text = baseText;
  const envRecords: ClaudeSettingsTakeover["env"] = {};

  for (const [key, value] of Object.entries(input.env)) {
    const previous = input.takeover?.env[key];
    const original: OriginalValue =
      previous?.original ??
      (envObject && Object.hasOwn(envObject, key)
        ? { present: true, value: envObject[key] }
        : { present: false });
    envRecords[key] = { original, written: value };
    text = edit(text, ["env", key], value, formatting);
  }

  // 上次接管过、这次不再写的键：恢复原值并放弃所有权。
  for (const [key, record] of Object.entries(input.takeover?.env ?? {})) {
    if (Object.hasOwn(input.env, key)) continue;
    text = restoreValue(text, ["env", key], record.original, formatting);
  }

  const webSearchDeny = ensureWebSearchDenied(text, parsed.settings, input.takeover, formatting);
  text = webSearchDeny.text;

  return {
    kind: "patched",
    text,
    takeover: {
      originalFile: input.takeover?.originalFile ?? classifyOriginalFile(input.text),
      env: envRecords,
      envCreated: input.takeover?.envCreated ?? envObject === undefined,
      webSearchDeny: webSearchDeny.record,
    },
  };
}

/** 切回官方：把负责的键恢复成接管前的值，删掉接管时新建出来的空容器。 */
export function restoreClaudeOfficial(input: {
  text: string | null;
  takeover: ClaudeSettingsTakeover;
}): ClaudeSettingsRestoreResult {
  if (input.text === null) return { kind: "missing" };
  const parsed = parseSettings(input.text);
  if (parsed.kind === "unparsable") return parsed;

  const formatting = detectFormatting(input.text);
  let text = input.text;
  for (const [key, record] of Object.entries(input.takeover.env)) {
    text = restoreValue(text, ["env", key], record.original, formatting);
  }
  if (input.takeover.envCreated) {
    text = removeIfEmptyObject(text, ["env"], formatting);
  }

  const { webSearchDeny } = input.takeover;
  if (webSearchDeny.added) {
    const deny = readSettings(text).permissions?.deny ?? [];
    const index = deny.indexOf(WEB_SEARCH_RULE);
    if (index !== -1) {
      text = edit(text, ["permissions", "deny", index], undefined, formatting);
    }
    if (webSearchDeny.denyCreated && readSettings(text).permissions?.deny?.length === 0) {
      text = edit(text, ["permissions", "deny"], undefined, formatting);
    }
    if (webSearchDeny.permissionsCreated) {
      text = removeIfEmptyObject(text, ["permissions"], formatting);
    }
  }

  // 负责的东西都拿走后只剩空对象：jsonc 会留下 "{\n}"，按接管前的样子收回。
  const { originalFile } = input.takeover;
  if (Object.keys(readSettings(text)).length === 0) {
    if (originalFile.kind === "absent") return { kind: "delete" };
    if (originalFile.kind === "empty") return { kind: "patched", text: originalFile.text };
  }

  return { kind: "patched", text };
}

function classifyOriginalFile(text: string | null): OriginalFile {
  if (text === null) return { kind: "absent" };
  if (text.trim() === "") return { kind: "empty", text };
  const parsed: unknown = JSON.parse(text);
  return isRecord(parsed) && Object.keys(parsed).length === 0
    ? { kind: "empty", text }
    : { kind: "content" };
}

interface ParsedSettings {
  env?: Record<string, unknown>;
  permissions?: { deny?: unknown[] };
}

type ParseResult =
  | { kind: "parsed"; settings: ParsedSettings }
  | { kind: "unparsable"; message: string };

function parseSettings(text: string): ParseResult {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return { kind: "unparsable", message: error instanceof Error ? error.message : String(error) };
  }
  if (!isRecord(value)) {
    return { kind: "unparsable", message: "settings.json is not a JSON object" };
  }
  if (value.env !== undefined && !isRecord(value.env)) {
    return { kind: "unparsable", message: '"env" in settings.json is not an object' };
  }
  if (value.permissions !== undefined) {
    if (!isRecord(value.permissions)) {
      return { kind: "unparsable", message: '"permissions" in settings.json is not an object' };
    }
    if (value.permissions.deny !== undefined && !Array.isArray(value.permissions.deny)) {
      return { kind: "unparsable", message: '"permissions.deny" in settings.json is not an array' };
    }
  }
  return { kind: "parsed", settings: value as ParsedSettings };
}

/** 只在已校验过的文本上调用。 */
function readSettings(text: string): ParsedSettings {
  return JSON.parse(text) as ParsedSettings;
}

function ensureWebSearchDenied(
  text: string,
  before: ParsedSettings,
  takeover: ClaudeSettingsTakeover | null,
  formatting: FormattingOptions,
): { text: string; record: ClaudeSettingsTakeover["webSearchDeny"] } {
  const deny = readSettings(text).permissions?.deny;
  if (deny?.includes(WEB_SEARCH_RULE)) {
    return {
      text,
      record: takeover?.webSearchDeny ?? {
        added: false,
        permissionsCreated: false,
        denyCreated: false,
      },
    };
  }
  const next = edit(text, ["permissions", "deny", -1], WEB_SEARCH_RULE, formatting);
  // 之前已接管过（用户中途删掉了这条），沿用当初记下的容器是否由 Osuna 新建。
  if (takeover?.webSearchDeny.added) {
    return { text: next, record: takeover.webSearchDeny };
  }
  return {
    text: next,
    record: {
      added: true,
      permissionsCreated: before.permissions === undefined,
      denyCreated: before.permissions?.deny === undefined,
    },
  };
}

function restoreValue(
  text: string,
  path: JSONPath,
  original: OriginalValue,
  formatting: FormattingOptions,
): string {
  return edit(text, path, original.present ? original.value : undefined, formatting);
}

function removeIfEmptyObject(text: string, path: JSONPath, formatting: FormattingOptions): string {
  let node: unknown = readSettings(text);
  for (const segment of path) {
    node = isRecord(node) ? node[String(segment)] : undefined;
  }
  if (isRecord(node) && Object.keys(node).length === 0) {
    return edit(text, path, undefined, formatting);
  }
  return text;
}

function edit(text: string, path: JSONPath, value: unknown, formatting: FormattingOptions): string {
  return applyEdits(text, modify(text, path, value, { formattingOptions: formatting }));
}

/** 按文件自身的缩进和换行写入新键；被插入的那一行会按该缩进重新排版。 */
function detectFormatting(text: string): FormattingOptions {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const indent = /^([ \t]+)\S/m.exec(text)?.[1];
  if (indent?.startsWith("\t")) {
    return { insertSpaces: false, tabSize: 1, eol };
  }
  return { insertSpaces: true, tabSize: indent ? indent.length : 2, eol };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
