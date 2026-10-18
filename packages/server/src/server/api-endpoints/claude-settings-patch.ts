// modelPicker 的归属规则、云平台开关的拿掉与放回、自动模式审查的开关移植自 magpie（https://github.com/yetone/magpie，internal/agent/claude.go 的 writePicker / dropPicker、dropClouds / putClouds、writeReview / dropReview）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import {
  applyEdits,
  format,
  modify,
  parse as parseJsonc,
  printParseErrorCode,
  type Edit,
  type FormattingOptions,
  type JSONPath,
  type ParseError,
} from "jsonc-parser";
import { z } from "zod";
import { API_ENDPOINT_MODEL_TIERS } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { CLAUDE_CLOUD_SWITCH_KEYS, isClaudeSwitchOn } from "./claude-cloud-switches.js";
import { CLAUDE_HINT_ENV_KEYS, type ClaudeHintEnv } from "./claude-model-hints.js";

/*
 * Claude Code 的 ~/.claude/settings.json 补丁：只改 Osuna 负责的键，其余字节不动。
 * 规则见 docs/adr/0004-api-endpoint-rewrites-cli-config.md，思路参考 cc-switch（MIT）的 live/ 模块。
 * 按 JSONC 读写（ADR 0012）：开头的 BOM 读时摘下、写回时放回；注释、尾随逗号照认照留。
 * Claude Code 自己是去 BOM 后严格 JSON.parse，带注释或尾随逗号的整份跳过，检查结果里报出来。
 *
 * 负责的键（ADR 0007 改了写什么）：
 * - env 下的 ANTHROPIC_BASE_URL（daemon 中转站）/ ANTHROPIC_AUTH_TOKEN（中转站口令）/ ANTHROPIC_API_KEY（置空）；
 * - 顶层 model：新会话的起始模型。不写 env.ANTHROPIC_MODEL，它会盖过会话里 /model 的选择；
 * - env 下的 ANTHROPIC_MODEL、ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU,FABLE}_MODEL、ANTHROPIC_SMALL_FAST_MODEL：
 *   接管时有就记下并删掉（档位由中转站按各家映射翻译），切回官方时放回；
 * - permissions.deny 里的一条 "WebSearch"：WebSearch 是 Anthropic 服务端工具，多数第三方接口不支持，
 *   Claude Code 没有关它的环境变量，只能用权限规则。只在没有一家开着的接口「自己能联网搜索」时写；
 *   有了就拿掉自己写的那条（ADR 0009）。用户自己写的同名规则不归 Osuna 所有。
 * - 顶层 modelPicker：终端 /model 列出各家接口的已选模型（Claude Code v2.1.242 起，只读用户设置）。
 *   用户自己写的完全不碰，没有可列的模型就不写；Osuna 写过之后被手改的那份仍归 Osuna，下次重写会盖掉。
 * - env 下的模型提示 CLAUDE_CODE_MAX_CONTEXT_TOKENS / _MAX_OUTPUT_TOKENS / _MODEL_CAPABILITIES（见 claude-model-hints.ts）：
 *   键不在或还是 Osuna 上次写的值时才写；用户设的、或 Osuna 写过后被用户改了的，归用户，不碰也不删。
 * - env 下的 CLAUDE_CODE_AUTO_MODE_SERVER=0：经中转站能到的模型都不会被 Anthropic 审查时写，免得 Claude Code
 *   先请服务器审查、拿不到再弹「这个会话不符合条件」的提示（ADR 0012）。归属规则同模型提示，记在同一份记录里。
 * - env 下开着的云平台开关（见 claude-cloud-switches.ts）：接管与每次重写时拿掉、原样记下，切回官方时放回，
 *   用户之后又自己设了的除外；关着的开关和云平台的其他变量不动（ADR 0012，照 magpie 的 dropClouds / putClouds）。
 */

/** 接管期间不能留在 env 里的变量。 */
const REMOVED_ENV_KEYS = [
  "ANTHROPIC_MODEL",
  ...API_ENDPOINT_MODEL_TIERS.map((tier) => `ANTHROPIC_DEFAULT_${tier.toUpperCase()}_MODEL`),
  "ANTHROPIC_SMALL_FAST_MODEL",
];

const WEB_SEARCH_RULE = "WebSearch";
const AUTO_MODE_SERVER_KEY = "CLAUDE_CODE_AUTO_MODE_SERVER";
// 按模型提示的归属规则写的 env 键：文件里没有、或还是 Osuna 上次写的值，才归 Osuna。
const OWNED_WHILE_UNTOUCHED_ENV_KEYS = [...CLAUDE_HINT_ENV_KEYS, AUTO_MODE_SERVER_KEY];
const BOM = "\uFEFF";

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
  // Osuna 写着的模型提示与 CLAUDE_CODE_AUTO_MODE_SERVER：文件里的值等于这里记的才算 Osuna 的。
  // COMPAT(claudeModelHintRecord): 工单 18 以前的记录没有它，按没写过处理；remove after 2027-04-15.
  hintEnv: z.record(z.string(), z.string()).optional(),
  // 拿掉的云平台开关与它们原来的值（字符串或 JSON 的 true，照用户写的）。
  // COMPAT(claudeCloudSwitchRecord): 工单 16 以前的记录没有它，按没拿掉过处理；remove after 2027-04-18.
  clouds: z.record(z.string(), z.unknown()).optional(),
});
export type ClaudeSettingsTakeover = z.infer<typeof ClaudeSettingsTakeoverSchema>;

/** 读不懂的原因，app 按它用界面语言说明；message 是同一件事的英文。 */
export type ClaudeSettingsUnparsableReason =
  | { code: "syntax"; line: number; column: number }
  | { code: "root_not_object" }
  | { code: "key_not_object"; key: string }
  | { code: "key_not_array"; key: string };

interface ClaudeSettingsUnparsable {
  kind: "unparsable";
  message: string;
  reason: ClaudeSettingsUnparsableReason;
}

export type ClaudeSettingsPatchResult =
  | { kind: "patched"; text: string; takeover: ClaudeSettingsTakeover }
  | ClaudeSettingsUnparsable;

export type ClaudeSettingsRestoreResult =
  | { kind: "patched"; text: string }
  // 接管前文件不存在，恢复后又只剩一个空对象：把文件删掉。
  | { kind: "delete" }
  | { kind: "missing" }
  | ClaudeSettingsUnparsable;

/**
 * CLI 指向的中转站：地址、该 Agent 的口令、新会话的起始模型、/model 里列出的接口模型、模型提示，
 * 是否放开 WebSearch（至少一家开着的接口「自己能联网搜索」），以及经中转站能到的模型里有没有会被 Anthropic
 * 审查自动模式动作的（没有就写 CLAUDE_CODE_AUTO_MODE_SERVER=0）。
 */
export interface ClaudeGatewayWiring {
  baseUrl: string;
  token: string;
  model: string;
  modelPicker: ClaudeModelPickerOption[];
  hintEnv: ClaudeHintEnv;
  allowWebSearch: boolean;
  isAutoModeReviewed: boolean;
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
  const { bom, body } = splitBom(input.text ?? "");
  const baseText = body.trim() === "" ? "{}\n" : body;
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

  const webSearchDeny = writeWebSearchRule({
    text,
    before: parsed.settings,
    allow: input.wiring.allowWebSearch,
    takeover: input.takeover,
    formatting,
  });
  text = webSearchDeny.text;

  const hintEnv = writeHintEnv({
    text,
    envObject,
    hints: { ...input.wiring.hintEnv, ...autoModeServerEnv(input.wiring.isAutoModeReviewed) },
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

  const clouds = dropClouds({ text, envObject, takeover: input.takeover, formatting });
  text = clouds.text;

  return {
    kind: "patched",
    text: `${bom}${text}`,
    takeover: {
      originalFile: input.takeover?.originalFile ?? classifyOriginalFile(input.text),
      env: envRecords,
      model,
      envCreated: input.takeover?.envCreated ?? envObject === undefined,
      webSearchDeny: webSearchDeny.record,
      modelPicker: modelPicker.record,
      hintEnv: hintEnv.record,
      clouds: clouds.record,
    },
  };
}

interface CloudsPatch {
  text: string;
  record: NonNullable<ClaudeSettingsTakeover["clouds"]>;
}

/** 拿掉 env 里开着的云平台开关，原值记下；之前拿掉过的记录留着，这次又开的覆盖同名项。 */
function dropClouds(input: {
  text: string;
  envObject: Record<string, unknown> | undefined;
  takeover: ClaudeSettingsTakeover | null;
  formatting: FormattingOptions;
}): CloudsPatch {
  let { text } = input;
  const record = { ...input.takeover?.clouds };
  for (const key of CLAUDE_CLOUD_SWITCH_KEYS) {
    const value = input.envObject?.[key];
    if (!isClaudeSwitchOn(value)) continue;
    record[key] = value;
    text = edit(text, ["env", key], undefined, input.formatting);
  }
  return { text, record };
}

/** 能到的模型都不会被审查时让 Claude Code 只在本地分类；有一个会被审查就不写。 */
function autoModeServerEnv(isAutoModeReviewed: boolean): Partial<Record<string, string>> {
  return isAutoModeReviewed ? {} : { [AUTO_MODE_SERVER_KEY]: "0" };
}

interface HintEnvPatch {
  text: string;
  record: NonNullable<ClaudeSettingsTakeover["hintEnv"]>;
}

/** 每个提示键：文件里没有、或还是 Osuna 上次写的值，才归 Osuna 写或删；记下这次写着的。 */
function writeHintEnv(input: {
  text: string;
  envObject: Record<string, unknown> | undefined;
  hints: Partial<Record<string, string>>;
  takeover: ClaudeSettingsTakeover | null;
  formatting: FormattingOptions;
}): HintEnvPatch {
  let { text } = input;
  const record: Record<string, string> = {};
  for (const key of OWNED_WHILE_UNTOUCHED_ENV_KEYS) {
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
  const { bom, body } = splitBom(input.text);
  const parsed = parseSettings(body);
  if (parsed.kind === "unparsable") return parsed;

  const formatting = detectFormatting(body);
  let text = body;
  for (const [key, record] of Object.entries(input.takeover.env)) {
    text = restoreValue(text, ["env", key], record.original, formatting);
  }
  if (input.takeover.model) {
    text = restoreValue(text, ["model"], input.takeover.model.original, formatting);
  }
  text = removeOwnHints(text, input.takeover, formatting);
  text = putCloudsBack({ text, takeover: input.takeover, formatting });
  if (input.takeover.envCreated) {
    text = removeIfEmptyObject(text, ["env"], formatting);
  }
  if (input.takeover.modelPicker?.written) {
    text = edit(text, ["modelPicker"], undefined, formatting);
  }

  text = removeOwnWebSearchDeny(text, input.takeover.webSearchDeny, formatting);

  // 负责的东西都拿走后只剩空对象：jsonc 会留下 "{\n}"，按接管前的样子收回。
  const { originalFile } = input.takeover;
  if (Object.keys(readSettings(text)).length === 0) {
    if (originalFile.kind === "absent") return { kind: "delete" };
    if (originalFile.kind === "empty") return { kind: "patched", text: originalFile.text };
  }

  return { kind: "patched", text: `${bom}${text}` };
}

/** 拿掉过的云平台开关放回原值；用户之后又自己设了的（不论开关）归用户，不动。 */
interface PutCloudsBackInput {
  text: string;
  takeover: ClaudeSettingsTakeover;
  formatting: FormattingOptions;
}

function putCloudsBack(input: PutCloudsBackInput): string {
  let next = input.text;
  for (const [key, value] of Object.entries(input.takeover.clouds ?? {})) {
    const env = readSettings(next).env;
    if (env !== undefined && Object.hasOwn(env, key)) continue;
    next = edit(next, ["env", key], value, input.formatting);
  }
  return next;
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
      // 带注释或尾随逗号时为 false：Claude Code 读不了，整份跳过。文件不存在算读得了。
      isReadableByClaudeCode: boolean;
    }
  | ClaudeSettingsUnparsable;

const WEB_SEARCH_DENY_LABEL = `permissions.deny "${WEB_SEARCH_RULE}"`;

/** 读真实文件判断外部改动：负责的键和上次写入的值比对，其余键怎么改都不算。 */
export function inspectClaudeSettings(input: {
  text: string | null;
  takeover: ClaudeSettingsTakeover | null;
}): ClaudeSettingsInspection {
  let settings: ParsedSettings = {};
  let isReadableByClaudeCode = true;
  if (input.text !== null) {
    const { body } = splitBom(input.text);
    const parsed = parseSettings(body);
    if (parsed.kind === "unparsable") return parsed;
    settings = parsed.settings;
    isReadableByClaudeCode = parsesAsStrictJson(body);
  }
  const modifiedKeys = input.takeover ? modifiedOwnedKeys(settings, input.takeover) : [];
  const rawBaseUrl = settings.env?.ANTHROPIC_BASE_URL;
  const baseUrl = typeof rawBaseUrl === "string" ? rawBaseUrl.trim() : "";
  return {
    kind: "parsed",
    modifiedKeys,
    baseUrl: baseUrl === "" ? null : baseUrl,
    isReadableByClaudeCode,
  };
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
  const { body } = splitBom(text);
  if (body.trim() === "") return { kind: "empty", text };
  const parsed: unknown = parseJsonc(body, [], JSONC_OPTIONS);
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

type ParseResult = { kind: "parsed"; settings: ParsedSettings } | ClaudeSettingsUnparsable;

const JSONC_OPTIONS = { allowTrailingComma: true, disallowComments: false };

/** 已摘掉 BOM 的文本；注释、尾随逗号照认，别的语法错误照旧算读不懂。 */
function parseSettings(text: string): ParseResult {
  const errors: ParseError[] = [];
  const value: unknown = parseJsonc(text, errors, JSONC_OPTIONS);
  const [firstError] = errors;
  if (firstError) return syntaxError(text, firstError);
  if (!isRecord(value)) {
    return {
      kind: "unparsable",
      message: "settings.json is not a JSON object",
      reason: { code: "root_not_object" },
    };
  }
  if (value.env !== undefined && !isRecord(value.env)) return keyNotObject("env");
  if (value.permissions !== undefined) {
    if (!isRecord(value.permissions)) return keyNotObject("permissions");
    if (value.permissions.deny !== undefined && !Array.isArray(value.permissions.deny)) {
      return {
        kind: "unparsable",
        message: '"permissions.deny" in settings.json is not an array',
        reason: { code: "key_not_array", key: "permissions.deny" },
      };
    }
  }
  return { kind: "parsed", settings: value as ParsedSettings };
}

function keyNotObject(key: string): ClaudeSettingsUnparsable {
  return {
    kind: "unparsable",
    message: `"${key}" in settings.json is not an object`,
    reason: { code: "key_not_object", key },
  };
}

/** 只在已校验过的文本上调用。 */
function readSettings(text: string): ParsedSettings {
  return parseJsonc(text, [], JSONC_OPTIONS) as ParsedSettings;
}

function syntaxError(text: string, error: ParseError): ClaudeSettingsUnparsable {
  const before = text.slice(0, error.offset).split("\n");
  const line = before.length;
  const column = (before.at(-1)?.length ?? 0) + 1;
  return {
    kind: "unparsable",
    message: `${printParseErrorCode(error.error)} at line ${line}, column ${column}`,
    reason: { code: "syntax", line, column },
  };
}

/** Claude Code 读设置文件的方式：去掉 BOM 后严格 JSON.parse。 */
function parsesAsStrictJson(body: string): boolean {
  if (body.trim() === "") return true;
  try {
    JSON.parse(body);
    return true;
  } catch {
    return false;
  }
}

/** 开头的 BOM 读时摘下、写回时放回。 */
interface BomSplit {
  // 开头的 BOM，没有时为空串。
  bom: string;
  body: string;
}

function splitBom(text: string): BomSplit {
  if (!text.startsWith(BOM)) return { bom: "", body: text };
  return { bom: BOM, body: text.slice(BOM.length) };
}

/** 拿掉 Osuna 写的那条 "WebSearch"，以及因它而建、现在空了的 deny 与 permissions；不是 Osuna 的不动。 */
function removeOwnWebSearchDeny(
  text: string,
  record: ClaudeSettingsTakeover["webSearchDeny"],
  formatting: FormattingOptions,
): string {
  if (!record.added) return text;
  let next = text;
  const deny = readSettings(next).permissions?.deny ?? [];
  const index = deny.indexOf(WEB_SEARCH_RULE);
  if (index !== -1) {
    next = edit(next, ["permissions", "deny", index], undefined, formatting);
  }
  if (record.denyCreated && readSettings(next).permissions?.deny?.length === 0) {
    next = edit(next, ["permissions", "deny"], undefined, formatting);
  }
  if (record.permissionsCreated) {
    next = removeIfEmptyObject(next, ["permissions"], formatting);
  }
  return next;
}

/** 至少一家开着的接口自己会搜时放开 WebSearch，否则写上禁止规则（ADR 0009）。 */
function writeWebSearchRule(input: {
  text: string;
  before: ParsedSettings;
  allow: boolean;
  takeover: ClaudeSettingsTakeover | null;
  formatting: FormattingOptions;
}): { text: string; record: ClaudeSettingsTakeover["webSearchDeny"] } {
  const { text, takeover, formatting } = input;
  if (input.allow) return allowWebSearch(text, takeover, formatting);
  return ensureWebSearchDenied(text, input.before, takeover, formatting);
}

/** 放开 WebSearch：只拿掉自己写的那条，之后文件里的 "WebSearch"（如果有）都归用户。 */
function allowWebSearch(
  text: string,
  takeover: ClaudeSettingsTakeover | null,
  formatting: FormattingOptions,
): { text: string; record: ClaudeSettingsTakeover["webSearchDeny"] } {
  const notOurs = { added: false, permissionsCreated: false, denyCreated: false };
  if (!takeover) return { text, record: notOurs };
  return {
    text: removeOwnWebSearchDeny(text, takeover.webSearchDeny, formatting),
    record: notOurs,
  };
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
  const [change, ...others] = modify(text, path, value, {});
  if (change !== undefined && others.length === 0) {
    const commented = besideTrailingComment(text, change);
    if (commented) return editBesideComment({ text, change, commented, formatting });
  }
  return applyEdits(text, modify(text, path, value, { formattingOptions: formatting }));
}

// 上一个值后面、同一行只剩（逗号加）注释：这条注释属于上一行。
const TRAILING_COMMENT = /^([ \t]*,)?(?:[ \t]*(?:\/\/[^\r\n]*|\/\*[^\r\n]*?\*\/))+[ \t]*$/;

interface TrailingComment {
  // 注释那一行的行尾（换行符之前）。
  lineEnd: number;
  hasComma: boolean;
}

/**
 * jsonc-parser 在容器末尾加键时插在上一个值的紧后面，删末尾的键时从上一个值的紧后面删起；
 * 上一行末尾有注释时，前者把注释挤到新键那一行，后者把注释一起删掉。认出这种情况交给 editBesideComment。
 */
function besideTrailingComment(text: string, change: Edit): TrailingComment | null {
  const isAppend = change.length === 0 && change.content.startsWith(",");
  const isRemoveLast = change.content === "" && /^[ \t]*,/.test(text.slice(change.offset));
  if (!isAppend && !isRemoveLast) return null;
  const lineBreak = text.slice(change.offset).search(/\r?\n/);
  if (lineBreak === -1) return null;
  const lineEnd = change.offset + lineBreak;
  if (isRemoveLast && lineEnd >= change.offset + change.length) return null;
  const rest = TRAILING_COMMENT.exec(text.slice(change.offset, lineEnd));
  if (!rest) return null;
  return { lineEnd, hasComma: rest[1] !== undefined };
}

/**
 * 注释留在原来那一行，两个方向互为还原：
 * - 加键：新键另起一行放在注释之后；上一个值原本带尾随逗号，新键也带，没有就在上一个值后补逗号。
 * - 删键：只删被删的那几行；被删的键带尾随逗号就连它一起删，不带就把上一个值后的逗号也拿掉。
 */
interface BesideCommentEdit {
  text: string;
  // jsonc-parser 不带格式算出的那一处改动。
  change: Edit;
  commented: TrailingComment;
  formatting: FormattingOptions;
}

function editBesideComment(input: BesideCommentEdit): string {
  const { text, change, formatting } = input;
  const { lineEnd, hasComma } = input.commented;
  const valueEnd = change.offset;
  const separator = text.slice(valueEnd, lineEnd).replace(/^[ \t]*,/, "");
  if (change.content === "") {
    const removedEnd = change.offset + change.length;
    const trailingComma = /^[ \t]*,/.exec(text.slice(removedEnd));
    if (trailingComma) {
      return `${text.slice(0, lineEnd)}${text.slice(removedEnd + trailingComma[0].length)}`;
    }
    return `${text.slice(0, valueEnd)}${separator}${text.slice(removedEnd)}`;
  }
  // 上一个值带尾随逗号就整行留着；不带就在值后补上逗号。
  let head = text.slice(0, lineEnd);
  if (!hasComma) head = `${text.slice(0, valueEnd)},${separator}`;
  // 新键与上一个键同样缩进；值里的对象、数组再按文件格式展开。
  const lineStart = text.lastIndexOf("\n", valueEnd) + 1;
  const indent = /^[ \t]*/.exec(text.slice(lineStart))?.[0] ?? "";
  const begin = head.length + (formatting.eol ?? "\n").length;
  const property = `${indent}${change.content.slice(1)}${hasComma ? "," : ""}`;
  const next = `${head}${formatting.eol ?? "\n"}${property}${text.slice(lineEnd)}`;
  const range = { offset: begin, length: property.length };
  return applyEdits(next, format(next, range, { ...formatting, keepLines: false }));
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
