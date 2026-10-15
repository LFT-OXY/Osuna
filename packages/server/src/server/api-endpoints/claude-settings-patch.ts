// modelPicker 的归属规则移植自 magpie（https://github.com/yetone/magpie，internal/agent/claude.go 的 writePicker / dropPicker）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { applyEdits, modify, type FormattingOptions, type JSONPath } from "jsonc-parser";
import { z } from "zod";
import { API_ENDPOINT_MODEL_TIERS } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { CLAUDE_HINT_ENV_KEYS, type ClaudeHintEnv } from "./claude-model-hints.js";

/*
 * Claude Code 的 ~/.claude/settings.json 补丁：只改 Osuna 负责的键，其余字节不动。
 * 规则见 docs/adr/0004-api-endpoint-rewrites-cli-config.md，思路参考 cc-switch（MIT）的 live/ 模块。
 *
 * 负责的键（ADR 0007 改了写什么）：
 * - env 下的 ANTHROPIC_BASE_URL（daemon 中转站）/ ANTHROPIC_AUTH_TOKEN（中转站口令）/ ANTHROPIC_API_KEY（置空）；
 * - 顶层 model：新会话的起始模型。不写 env.ANTHROPIC_MODEL，它会盖过会话里 /model 的选择；
 * - env 下的 ANTHROPIC_MODEL、ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU,FABLE}_MODEL、ANTHROPIC_SMALL_FAST_MODEL：
 *   接管时有就记下并删掉（档位由中转站按各家映射翻译），切回官方时放回；
 * - permissions.deny 里的一条 "WebSearch"：WebSearch 是 Anthropic 服务端工具，第三方接口不支持，
 *   Claude Code 没有关它的环境变量，只能用权限规则。用户自己写的同名规则不归 Osuna 所有。
 * - 顶层 modelPicker：终端 /model 列出各家接口的已选模型（Claude Code v2.1.242 起，只读用户设置）。
 *   用户自己写的完全不碰，没有可列的模型就不写；Osuna 写过之后被手改的那份仍归 Osuna，下次重写会盖掉。
 * - env 下的模型提示 CLAUDE_CODE_MAX_CONTEXT_TOKENS / _MAX_OUTPUT_TOKENS / _MODEL_CAPABILITIES（见 claude-model-hints.ts）：
 *   键不在或还是 Osuna 上次写的值时才写；用户设的、或 Osuna 写过后被用户改了的，归用户，不碰也不删。
 */

/** 接管期间不能留在 env 里的变量。 */
const REMOVED_ENV_KEYS = [
  "ANTHROPIC_MODEL",
  ...API_ENDPOINT_MODEL_TIERS.map((tier) => `ANTHROPIC_DEFAULT_${tier.toUpperCase()}_MODEL`),
  "ANTHROPIC_SMALL_FAST_MODEL",
];

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

const ModelPickerOptionSchema = z.object({
  model: z.string(),
  label: z.string(),
  description: z.string(),
});
export type ClaudeModelPickerOption = z.infer<typeof ModelPickerOptionSchema>;

/** 接管记录：每个负责的键接管前的原值，以及上次写入的值（检测外部改动用）。 */
export const ClaudeSettingsTakeoverSchema = z.object({
  originalFile: OriginalFileSchema,
  // written 为 null：Osuna 把这个键删掉了。
  env: z.record(
    z.string(),
    z.object({ original: OriginalValueSchema, written: z.string().nullable() }),
  ),
  // 顶层 model；v0.15 及以前不写它，旧记录里没有。
  model: z.object({ original: OriginalValueSchema, written: z.string() }).optional(),
  // 接管前没有 env 对象；恢复后 env 变空就整个删掉。
  envCreated: z.boolean(),
  webSearchDeny: z.object({
    added: z.boolean(),
    permissionsCreated: z.boolean(),
    denyCreated: z.boolean(),
  }),
  // 文件里现在的 modelPicker 是 Osuna 写的才有 written；为 null 时文件里的（如果有）是用户的。
  // COMPAT(claudeModelPickerRecord): 工单 17 以前的记录没有它，按没写过处理；remove after 2027-04-15.
  modelPicker: z.object({ written: z.array(ModelPickerOptionSchema).nullable() }).optional(),
  // Osuna 写着的模型提示：文件里的值等于这里记的才算 Osuna 的。
  // COMPAT(claudeModelHintRecord): 工单 18 以前的记录没有它，按没写过处理；remove after 2027-04-15.
  hintEnv: z.record(z.string(), z.string()).optional(),
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

/** CLI 指向的中转站：地址、该 Agent 的口令、新会话的起始模型、/model 里列出的接口模型、模型提示。 */
export interface ClaudeGatewayWiring {
  baseUrl: string;
  token: string;
  model: string;
  modelPicker: ClaudeModelPickerOption[];
  hintEnv: ClaudeHintEnv;
}

/**
 * 把中转站写进 settings.json。`takeover` 为 null 表示首次接管；
 * 已接管时沿用其中的原值，只更新写入值，这样切回官方总能回到接管前的样子。
 * `text` 为 null 表示文件不存在。
 */
export function applyClaudeApiEndpoint(input: {
  text: string | null;
  wiring: ClaudeGatewayWiring;
  takeover: ClaudeSettingsTakeover | null;
}): ClaudeSettingsPatchResult {
  const baseText = input.text === null || input.text.trim() === "" ? "{}\n" : input.text;
  const parsed = parseSettings(baseText);
  if (parsed.kind === "unparsable") return parsed;

  const formatting = detectFormatting(baseText);
  const envObject = parsed.settings.env;
  let text = baseText;
  const envRecords: ClaudeSettingsTakeover["env"] = {};

  const env = gatewayEnv(input.wiring, envObject, input.takeover);
  for (const [key, value] of Object.entries(env)) {
    const original = input.takeover?.env[key]?.original ?? originalValue(envObject, key);
    envRecords[key] = { original, written: value };
    text = edit(text, ["env", key], value ?? undefined, formatting);
  }

  // 上次接管过、这次不再写的键：恢复原值并放弃所有权。
  for (const [key, record] of Object.entries(input.takeover?.env ?? {})) {
    if (Object.hasOwn(env, key)) continue;
    text = restoreValue(text, ["env", key], record.original, formatting);
  }

  const model = {
    original: input.takeover?.model?.original ?? originalValue(parsed.settings, "model"),
    written: input.wiring.model,
  };
  text = edit(text, ["model"], input.wiring.model, formatting);

  const webSearchDeny = ensureWebSearchDenied(text, parsed.settings, input.takeover, formatting);
  text = webSearchDeny.text;

  const hintEnv = writeHintEnv({
    text,
    envObject,
    hints: input.wiring.hintEnv,
    takeover: input.takeover,
    formatting,
  });
  text = hintEnv.text;

  const modelPicker = writeModelPicker({
    text,
    before: parsed.settings,
    options: input.wiring.modelPicker,
    takeover: input.takeover,
    formatting,
  });
  text = modelPicker.text;

  return {
    kind: "patched",
    text,
    takeover: {
      originalFile: input.takeover?.originalFile ?? classifyOriginalFile(input.text),
      env: envRecords,
      model,
      envCreated: input.takeover?.envCreated ?? envObject === undefined,
      webSearchDeny: webSearchDeny.record,
      modelPicker: modelPicker.record,
      hintEnv: hintEnv.record,
    },
  };
}

interface HintEnvPatch {
  text: string;
  record: NonNullable<ClaudeSettingsTakeover["hintEnv"]>;
}

/** 每个提示键：文件里没有、或还是 Osuna 上次写的值，才归 Osuna 写或删；记下这次写着的。 */
function writeHintEnv(input: {
  text: string;
  envObject: Record<string, unknown> | undefined;
  hints: ClaudeHintEnv;
  takeover: ClaudeSettingsTakeover | null;
  formatting: FormattingOptions;
}): HintEnvPatch {
  let { text } = input;
  const record: Record<string, string> = {};
  for (const key of CLAUDE_HINT_ENV_KEYS) {
    const current = input.envObject?.[key];
    const isOurs = current !== undefined && current === input.takeover?.hintEnv?.[key];
    if (current !== undefined && !isOurs) continue;
    const value = input.hints[key];
    if (value !== undefined) {
      text = edit(text, ["env", key], value, input.formatting);
      record[key] = value;
    } else if (isOurs) {
      text = edit(text, ["env", key], undefined, input.formatting);
    }
  }
  return { text, record };
}

interface ModelPickerPatch {
  text: string;
  record: NonNullable<ClaudeSettingsTakeover["modelPicker"]>;
}

/** 上次是 Osuna 写的就覆盖或删掉；文件里有一份却不是 Osuna 写的，是用户的，原样留着。 */
function writeModelPicker(input: {
  text: string;
  before: ParsedSettings;
  options: ClaudeModelPickerOption[];
  takeover: ClaudeSettingsTakeover | null;
  formatting: FormattingOptions;
}): ModelPickerPatch {
  const { text, options, formatting } = input;
  const isOurs = Boolean(input.takeover?.modelPicker?.written);
  const hasPicker = Object.hasOwn(input.before, "modelPicker");
  if (hasPicker && !isOurs) return { text, record: { written: null } };
  if (options.length === 0) {
    return {
      text: hasPicker ? edit(text, ["modelPicker"], undefined, formatting) : text,
      record: { written: null },
    };
  }
  return {
    text: edit(text, ["modelPicker"], { options }, formatting),
    record: { written: options },
  };
}

/** 这次要写的 env：值为 null 的是要删掉的键。接管前没有、之后也没出现的不记，不归 Osuna 管。 */
function gatewayEnv(
  wiring: ClaudeGatewayWiring,
  envObject: Record<string, unknown> | undefined,
  takeover: ClaudeSettingsTakeover | null,
): Record<string, string | null> {
  const env: Record<string, string | null> = {
    ANTHROPIC_BASE_URL: wiring.baseUrl,
    ANTHROPIC_AUTH_TOKEN: wiring.token,
    // 登录态或环境里残留的 API key 会和 token 冲突，置空并纳入负责的键。
    ANTHROPIC_API_KEY: "",
  };
  for (const key of REMOVED_ENV_KEYS) {
    if (originalValue(envObject, key).present || takeover?.env[key]) env[key] = null;
  }
  return env;
}

function originalValue<T extends object>(
  container: T | undefined,
  key: keyof T & string,
): OriginalValue {
  return container !== undefined && Object.hasOwn(container, key)
    ? { present: true, value: container[key] }
    : { present: false };
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
  if (input.takeover.model) {
    text = restoreValue(text, ["model"], input.takeover.model.original, formatting);
  }
  text = removeOwnHints(text, input.takeover, formatting);
  if (input.takeover.envCreated) {
    text = removeIfEmptyObject(text, ["env"], formatting);
  }
  if (input.takeover.modelPicker?.written) {
    text = edit(text, ["modelPicker"], undefined, formatting);
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

/** 还是 Osuna 写的那个值的提示键删掉；用户改过的归用户，留着。 */
function removeOwnHints(
  text: string,
  takeover: ClaudeSettingsTakeover,
  formatting: FormattingOptions,
): string {
  let next = text;
  const env = readSettings(text).env;
  for (const [key, written] of Object.entries(takeover.hintEnv ?? {})) {
    if (env?.[key] === written) next = edit(next, ["env", key], undefined, formatting);
  }
  return next;
}

export type ClaudeSettingsInspection =
  | {
      kind: "parsed";
      // 不再是上次写入值的负责键；没有接管记录时为空。
      modifiedKeys: string[];
      // env.ANTHROPIC_BASE_URL：官方模式下用来提示 CLI 自身配置指向哪里。
      baseUrl: string | null;
    }
  | { kind: "unparsable"; message: string };

const WEB_SEARCH_DENY_LABEL = `permissions.deny "${WEB_SEARCH_RULE}"`;

/** 读真实文件判断外部改动：负责的键和上次写入的值比对，其余键怎么改都不算。 */
export function inspectClaudeSettings(input: {
  text: string | null;
  takeover: ClaudeSettingsTakeover | null;
}): ClaudeSettingsInspection {
  let settings: ParsedSettings = {};
  if (input.text !== null) {
    const parsed = parseSettings(input.text);
    if (parsed.kind === "unparsable") return parsed;
    settings = parsed.settings;
  }
  const modifiedKeys = input.takeover ? modifiedOwnedKeys(settings, input.takeover) : [];
  const rawBaseUrl = settings.env?.ANTHROPIC_BASE_URL;
  const baseUrl = typeof rawBaseUrl === "string" ? rawBaseUrl.trim() : "";
  return { kind: "parsed", modifiedKeys, baseUrl: baseUrl === "" ? null : baseUrl };
}

function modifiedOwnedKeys(settings: ParsedSettings, takeover: ClaudeSettingsTakeover): string[] {
  const modifiedKeys: string[] = [];
  for (const [key, record] of Object.entries(takeover.env)) {
    if ((settings.env?.[key] ?? null) !== record.written) modifiedKeys.push(`env.${key}`);
  }
  if (takeover.model && settings.model !== takeover.model.written) modifiedKeys.push("model");
  const pickerWritten = takeover.modelPicker?.written;
  const isPickerChanged =
    pickerWritten != null &&
    JSON.stringify(settings.modelPicker) !== JSON.stringify({ options: pickerWritten });
  if (isPickerChanged) modifiedKeys.push("modelPicker");
  if (takeover.webSearchDeny.added && !settings.permissions?.deny?.includes(WEB_SEARCH_RULE)) {
    modifiedKeys.push(WEB_SEARCH_DENY_LABEL);
  }
  return modifiedKeys;
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
  model?: unknown;
  modelPicker?: unknown;
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
