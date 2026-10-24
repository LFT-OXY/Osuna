// providers.osuna 里用户自己加的键（含 compat.sendSessionAffinityHeaders）照留移植自 magpie
// （https://github.com/yetone/magpie，internal/agent/agents.go 的 piBlockKept 与 internal/agent/sync.go 的 theirsKept、mergeTheirs）。
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import {
  parse as parseJsonc,
  printParseErrorCode,
  type FormattingOptions,
  type ParseError,
} from "jsonc-parser";
import { z } from "zod";
import {
  OriginalValueSchema,
  type ClaudeSettingsUnparsableReason,
  type OriginalValue,
} from "./claude-settings-patch.js";
import { detectFormatting, edit, splitBom } from "./jsonc-edit.js";
import type { PiModelEntry } from "./pi-model-entries.js";

/*
 * Pi 的 models.json 与 settings.json 补丁（ADR 0004、0012；任务 10-16-pi-omp-endpoints）：只改 Osuna 负责的键，其余字节与注释不动。
 * 两份文件各一份接管记录。按 JSONC 读写：Pi 读 models.json 时去掉注释，settings.json 是严格 JSON，Osuna 都只改负责的属性。
 *
 * 负责的键：
 * - models.json 的 providers.osuna：中转站 /v1 地址、openai-completions、Pi 的中转站口令、compat.sendSessionAffinityHeaders
 *   与模型清单。用户在这一项里自己加的键与 compat 值留着（照 magpie piBlockKept），models 整份是 Osuna 的。
 *   关掉时放回接管前的值（多半是没有），为它新建的 providers 空了就删掉。
 * - settings.json 的 defaultProvider（osuna）与 defaultModel：关掉时还是 Osuna 写的值才放回原值，开着期间用户自己改过的留着。
 * 接管前文件不存在、关掉后只剩空对象就删掉文件；接管前是空对象的逐字节放回。
 */

export const PI_PROVIDER_ID = "osuna";

// 接管前整个文件的样子（同 Claude Code 的 settings.json）。
const OriginalFileSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("absent") }),
  z.object({ kind: z.literal("empty"), text: z.string() }),
  z.object({ kind: z.literal("content") }),
]);
type OriginalFile = z.infer<typeof OriginalFileSchema>;

export const PiModelsTakeoverSchema = z.object({
  originalFile: OriginalFileSchema,
  // providers.osuna 接管前的值与上次写进去的整项（检测外部改动用）。
  provider: z.object({ original: OriginalValueSchema, written: z.record(z.string(), z.unknown()) }),
  // 接管前没有 providers 对象；放回后空了就整个删掉。
  providersCreated: z.boolean(),
});
export type PiModelsTakeover = z.infer<typeof PiModelsTakeoverSchema>;

const SETTINGS_KEYS = ["defaultProvider", "defaultModel"] as const;
type SettingsKey = (typeof SETTINGS_KEYS)[number];

export const PiSettingsTakeoverSchema = z.object({
  originalFile: OriginalFileSchema,
  keys: z.record(z.string(), z.object({ original: OriginalValueSchema, written: z.string() })),
});
export type PiSettingsTakeover = z.infer<typeof PiSettingsTakeoverSchema>;

/** Osuna 写进 models.json 的 providers.osuna。 */
export interface PiProviderBlock {
  baseUrl: string;
  api: "openai-completions";
  apiKey: string;
  compat: { sendSessionAffinityHeaders: true };
  models: PiModelEntry[];
}

export interface PiConfigUnparsable {
  kind: "unparsable";
  message: string;
  reason: ClaudeSettingsUnparsableReason;
}

export type PiConfigPatchResult<Takeover> =
  | { kind: "patched"; text: string; takeover: Takeover }
  | PiConfigUnparsable;

export type PiConfigRestoreResult =
  | { kind: "patched"; text: string }
  // 接管前文件不存在，放回后又只剩一个空对象：把文件删掉。
  | { kind: "delete" }
  | { kind: "missing" }
  | PiConfigUnparsable;

export type PiConfigInspection =
  | {
      kind: "parsed";
      // 不再是上次写入值的负责键；没有接管记录时为空。
      modifiedKeys: string[];
    }
  | PiConfigUnparsable;

const PROVIDER_PATH = ["providers", PI_PROVIDER_ID];
// 这几项变了 Pi 的请求就不再经过中转站。
const ROUTING_FIELDS = ["baseUrl", "apiKey", "api"] as const;

/** 把 providers.osuna 写进 models.json；`takeover` 为 null 是首次接管，`text` 为 null 是文件不存在。 */
export function applyPiModels(input: {
  text: string | null;
  block: PiProviderBlock;
  takeover: PiModelsTakeover | null;
}): PiConfigPatchResult<PiModelsTakeover> {
  const opened = openFile(input.text, "models.json");
  if (opened.kind === "unparsable") return opened;
  const { bom, text, root, formatting } = opened;
  if (root.providers !== undefined && !isRecord(root.providers)) {
    return keyNotObject("models.json", "providers");
  }
  const providers = root.providers;
  const existing = providers?.[PI_PROVIDER_ID];
  const written = keptBlock({ existing, block: input.block });
  return {
    kind: "patched",
    text: `${bom}${edit(text, PROVIDER_PATH, written, formatting)}`,
    takeover: {
      originalFile: input.takeover?.originalFile ?? classifyOriginalFile(input.text),
      provider: {
        original: input.takeover?.provider.original ?? originalValue(providers, PI_PROVIDER_ID),
        written,
      },
      providersCreated: input.takeover?.providersCreated ?? providers === undefined,
    },
  };
}

/** 关掉时的 models.json：providers.osuna 放回接管前的值，为它新建的 providers 空了就删掉。 */
export function restorePiModels(input: {
  text: string | null;
  takeover: PiModelsTakeover;
}): PiConfigRestoreResult {
  if (input.text === null) return { kind: "missing" };
  const opened = openFile(input.text, "models.json");
  if (opened.kind === "unparsable") return opened;
  const { bom, formatting, root } = opened;
  if (root.providers !== undefined && !isRecord(root.providers)) {
    return keyNotObject("models.json", "providers");
  }
  let text = restoreValue(opened.text, PROVIDER_PATH, input.takeover.provider.original, formatting);
  if (input.takeover.providersCreated) {
    const providers = readRoot(text).providers;
    if (isRecord(providers) && Object.keys(providers).length === 0) {
      text = edit(text, ["providers"], undefined, formatting);
    }
  }
  return finishedRestore({ bom, text, originalFile: input.takeover.originalFile });
}

/** providers.osuna 的地址、口令或格式不再是 Osuna 写的（或整项没了）即算被外部改过。 */
export function inspectPiModels(input: {
  text: string | null;
  takeover: PiModelsTakeover | null;
}): PiConfigInspection {
  const opened = openFile(input.text, "models.json");
  if (opened.kind === "unparsable") return opened;
  if (!input.takeover) return { kind: "parsed", modifiedKeys: [] };
  const providers = opened.root.providers;
  const block = isRecord(providers) ? providers[PI_PROVIDER_ID] : undefined;
  const { written } = input.takeover.provider;
  const isChanged =
    !isRecord(block) || ROUTING_FIELDS.some((field) => block[field] !== written[field]);
  return { kind: "parsed", modifiedKeys: isChanged ? [PROVIDER_PATH.join(".")] : [] };
}

/** models.json 里 providers.osuna 现在写的地址与口令；没有或读不懂为 null。 */
export function readPiGateway(text: string | null): { baseUrl: string; apiKey: string } | null {
  const opened = openFile(text, "models.json");
  if (opened.kind === "unparsable") return null;
  const providers = opened.root.providers;
  const block = isRecord(providers) ? providers[PI_PROVIDER_ID] : undefined;
  if (!isRecord(block)) return null;
  const { baseUrl, apiKey } = block;
  if (typeof baseUrl !== "string" || typeof apiKey !== "string") return null;
  return { baseUrl, apiKey };
}

/** 把默认服务商与默认模型写进 settings.json。 */
export function applyPiSettings(input: {
  text: string | null;
  model: string;
  takeover: PiSettingsTakeover | null;
}): PiConfigPatchResult<PiSettingsTakeover> {
  const opened = openFile(input.text, "settings.json");
  if (opened.kind === "unparsable") return opened;
  const { bom, root, formatting } = opened;
  const values: Record<SettingsKey, string> = {
    defaultProvider: PI_PROVIDER_ID,
    defaultModel: input.model,
  };
  let text = opened.text;
  const keys: PiSettingsTakeover["keys"] = {};
  for (const key of SETTINGS_KEYS) {
    const original = input.takeover?.keys[key]?.original ?? originalValue(root, key);
    keys[key] = { original, written: values[key] };
    text = edit(text, [key], values[key], formatting);
  }
  return {
    kind: "patched",
    text: `${bom}${text}`,
    takeover: {
      originalFile: input.takeover?.originalFile ?? classifyOriginalFile(input.text),
      keys,
    },
  };
}

/** 关掉时的 settings.json：还是 Osuna 写的值的键放回原值，用户开着期间改过的留着。 */
export function restorePiSettings(input: {
  text: string | null;
  takeover: PiSettingsTakeover;
}): PiConfigRestoreResult {
  if (input.text === null) return { kind: "missing" };
  const opened = openFile(input.text, "settings.json");
  if (opened.kind === "unparsable") return opened;
  const { bom, root, formatting } = opened;
  let text = opened.text;
  for (const [key, record] of Object.entries(input.takeover.keys)) {
    if (root[key] !== record.written) continue;
    text = restoreValue(text, [key], record.original, formatting);
  }
  return finishedRestore({ bom, text, originalFile: input.takeover.originalFile });
}

export function inspectPiSettings(input: {
  text: string | null;
  takeover: PiSettingsTakeover | null;
}): PiConfigInspection {
  const opened = openFile(input.text, "settings.json");
  if (opened.kind === "unparsable") return opened;
  const modifiedKeys = Object.entries(input.takeover?.keys ?? {})
    .filter(([key, record]) => opened.root[key] !== record.written)
    .map(([key]) => key);
  return { kind: "parsed", modifiedKeys };
}

/** settings.json 的 defaultProvider；没设或读不懂为 null。 */
export function readPiDefaultProvider(text: string | null): string | null {
  const opened = openFile(text, "settings.json");
  if (opened.kind === "unparsable") return null;
  const { defaultProvider } = opened.root;
  return typeof defaultProvider === "string" ? defaultProvider : null;
}

/**
 * Pi 新会话的默认模型，按 Pi 的写法：默认服务商是 Osuna 时只是模型（接口模型的 id），别的是「服务商/模型」；
 * 没设或读不懂为 null。
 */
export function readPiModel(text: string | null): string | null {
  const opened = openFile(text, "settings.json");
  if (opened.kind === "unparsable") return null;
  const { defaultProvider, defaultModel } = opened.root;
  if (typeof defaultModel !== "string" || defaultModel.trim() === "") return null;
  if (defaultProvider === PI_PROVIDER_ID) return defaultModel;
  if (typeof defaultProvider !== "string" || defaultProvider === "") return defaultModel;
  return `${defaultProvider}/${defaultModel}`;
}

/**
 * Osuna 要写的整项，并上文件里这一项已有的：用户加的键留着，两边都是对象的再往下并，models 整份用 Osuna 的；
 * 文件里已经设了 compat.sendSessionAffinityHeaders 就用文件里的（magpie piBlockKept）。
 */
function keptBlock(input: { existing: unknown; block: PiProviderBlock }): Record<string, unknown> {
  const ours: Record<string, unknown> = structuredClone({ ...input.block });
  if (!isRecord(input.existing)) return ours;
  const theirCompat = input.existing.compat;
  if (isRecord(theirCompat) && Object.hasOwn(theirCompat, "sendSessionAffinityHeaders")) {
    delete ours.compat;
  }
  return mergeTheirs({ have: input.existing, want: ours, whole: ["models"] });
}

function mergeTheirs(input: {
  have: Record<string, unknown>;
  want: Record<string, unknown>;
  whole: readonly string[];
}): Record<string, unknown> {
  const { have, want, whole } = input;
  const out: Record<string, unknown> = { ...want };
  for (const [key, value] of Object.entries(have)) {
    if (!Object.hasOwn(want, key)) {
      out[key] = value;
      continue;
    }
    if (whole.includes(key)) continue;
    const wanted = want[key];
    if (isRecord(value) && isRecord(wanted)) {
      out[key] = mergeTheirs({ have: value, want: wanted, whole: [] });
    }
  }
  return out;
}

type OpenedFile =
  | {
      kind: "parsed";
      bom: string;
      // 摘掉 BOM 的正文；文件不存在或是空白时为 "{}\n"。
      text: string;
      root: Record<string, unknown> & { providers?: Record<string, unknown> };
      formatting: FormattingOptions;
    }
  | PiConfigUnparsable;

const JSONC_OPTIONS = { allowTrailingComma: true, disallowComments: false };

function openFile(text: string | null, name: string): OpenedFile {
  const { bom, body } = splitBom(text ?? "");
  const base = body.trim() === "" ? "{}\n" : body;
  const errors: ParseError[] = [];
  const value: unknown = parseJsonc(base, errors, JSONC_OPTIONS);
  const [firstError] = errors;
  if (firstError) return syntaxError({ text: base, error: firstError, name });
  if (!isRecord(value)) {
    return {
      kind: "unparsable",
      message: `${name} is not a JSON object`,
      reason: { code: "root_not_object" },
    };
  }
  return {
    kind: "parsed",
    bom,
    text: base,
    root: value as OpenedRoot,
    formatting: detectFormatting(base),
  };
}

type OpenedRoot = Record<string, unknown> & { providers?: Record<string, unknown> };

function readRoot(text: string): OpenedRoot {
  return parseJsonc(text, [], JSONC_OPTIONS) as OpenedRoot;
}

function finishedRestore(input: {
  bom: string;
  text: string;
  originalFile: OriginalFile;
}): PiConfigRestoreResult {
  const { originalFile } = input;
  // 负责的都拿走后只剩空对象：按接管前的样子收回。
  if (Object.keys(readRoot(input.text)).length === 0) {
    if (originalFile.kind === "absent") return { kind: "delete" };
    if (originalFile.kind === "empty") return { kind: "patched", text: originalFile.text };
  }
  return { kind: "patched", text: `${input.bom}${input.text}` };
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

function originalValue(container: Record<string, unknown> | undefined, key: string): OriginalValue {
  return container !== undefined && Object.hasOwn(container, key)
    ? { present: true, value: container[key] }
    : { present: false };
}

function restoreValue(
  text: string,
  path: string[],
  original: OriginalValue,
  formatting: FormattingOptions,
): string {
  return edit(text, path, original.present ? original.value : undefined, formatting);
}

function keyNotObject(name: string, key: string): PiConfigUnparsable {
  return {
    kind: "unparsable",
    message: `"${key}" in ${name} is not an object`,
    reason: { code: "key_not_object", key },
  };
}

function syntaxError(input: { text: string; error: ParseError; name: string }): PiConfigUnparsable {
  const before = input.text.slice(0, input.error.offset).split("\n");
  const line = before.length;
  const column = (before.at(-1)?.length ?? 0) + 1;
  return {
    kind: "unparsable",
    message: `${printParseErrorCode(input.error.error)} at line ${line}, column ${column} of ${input.name}`,
    reason: { code: "syntax", line, column },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
