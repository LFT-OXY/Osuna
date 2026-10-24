// providers.osuna 里用户自己加的键（含 compat.sendSessionAffinityHeaders）照留移植自 magpie
// （https://github.com/yetone/magpie，internal/agent/agents.go 的 piBlockKept 与 internal/agent/sync.go 的 theirsKept、mergeTheirs）。
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import {
  findNodeAtLocation,
  parse as parseJsonc,
  parseTree,
  printParseErrorCode,
  type FormattingOptions,
  type ParseError,
} from "jsonc-parser";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import type { ClaudeSettingsUnparsableReason } from "./claude-settings-patch.js";
import { CliModelHoldSchema, type CliModelHold, type CliPicks } from "./cli-model-hold.js";
import {
  classifyOriginalFile,
  detectFormatting,
  edit,
  OriginalFileSchema,
  OriginalValueSchema,
  splitBom,
  type OriginalFile,
  type OriginalValue,
} from "./jsonc-edit.js";
import { PI_THINKING_LEVELS, type PiModelEntry } from "./pi-model-entries.js";

/*
 * Pi 的 models.json 与 settings.json 补丁（ADR 0004、0012；任务 10-16-pi-omp-endpoints）：只改 Osuna 负责的键，其余字节与注释不动。
 * 两份文件各一份接管记录。按 JSONC 读写：Pi 读 models.json 时去掉注释，settings.json 是严格 JSON，Osuna 都只改负责的属性。
 *
 * 负责的键：
 * - models.json 的 providers.osuna：中转站 /v1 地址、openai-completions、Pi 的中转站口令、compat.sendSessionAffinityHeaders
 *   与模型清单。用户在这一项里自己加的键与 compat 值留着（照 magpie piBlockKept），models 整份是 Osuna 的。
 *   关掉时放回接管前的值（多半是没有），为它新建的 providers 空了就删掉。
 * - settings.json 的 defaultProvider（osuna）与 defaultModel：两个键是 Pi 的一个默认模型，一起放回（照 magpie 的 Disconnect）。
 *   关掉时默认服务商还是 Osuna、或两个键都还是 Osuna 写的，就放回接管前的一对；用户开着期间换成了别家的模型，两个都留着。
 *   Pi 里换过的默认模型归 Pi（ADR 0012），重写不碰。设了默认思考档位才写 defaultThinkingLevel。
 * - settings.json 的 enabledModels：已有清单时把默认模型挪到最前（Pi 新会话先用清单的第一个，比 magpie 只追加到末尾多做），
 *   关掉时挪回原位、去掉指向 Osuna 的条目，删空了整个删掉；没有清单不新建。
 * 接管前文件不存在、关掉后只剩空对象就删掉文件；接管前是空对象的逐字节放回。
 */

export const PI_PROVIDER_ID = "osuna";

export const PiModelsTakeoverSchema = z.object({
  originalFile: OriginalFileSchema,
  // providers.osuna 接管前的值与上次写进去的整项（检测外部改动用）。
  provider: z.object({ original: OriginalValueSchema, written: z.record(z.string(), z.unknown()) }),
  // 接管前没有 providers 对象；放回后空了就整个删掉。
  providersCreated: z.boolean(),
});
export type PiModelsTakeover = z.infer<typeof PiModelsTakeoverSchema>;

// 默认服务商与默认模型是 Pi 的一个默认模型，一起写、一起放回；默认思考档位设了才写。
const PAIR_KEYS = ["defaultProvider", "defaultModel"] as const;
const THINKING_KEY = "defaultThinkingLevel";
const SCOPE_KEY = "enabledModels";

// written 为 null：文件里这个键没了（Pi 里删掉了默认模型后记作 Pi 的）。
const PiSettingsKeyRecordSchema = z.object({
  original: OriginalValueSchema,
  written: z.string().nullable(),
  // OMP 的角色接管前是 flow 写法的列表（[a, b]）：放回时照样写成 flow（magpie 按原来的 YAML 写法放回）。
  isOriginalFlow: z.boolean().optional(),
});
export type PiSettingsKeyRecord = z.infer<typeof PiSettingsKeyRecordSchema>;

/** enabledModels 里 Osuna 挪到最前的默认模型，与它挪之前在用户清单里的位置（null 为 Osuna 加的）。 */
const PiScopePlacementSchema = z.object({
  front: z.string(),
  wasAt: z.number().int().nonnegative().nullable(),
});
export type PiScopePlacement = z.infer<typeof PiScopePlacementSchema>;

export const PiSettingsTakeoverSchema = z.object({
  originalFile: OriginalFileSchema,
  keys: z.record(z.string(), PiSettingsKeyRecordSchema),
  // 文件里的默认模型归 Pi（见 cli-model-hold.ts）：重写不碰这一对。
  modelHeld: CliModelHoldSchema.optional(),
  scope: PiScopePlacementSchema.optional(),
  // 接管前 enabledModels 里用户自己就有的「osuna/…」条目：关开关时留着，只删 Osuna 加的。
  userOsunaEntries: z.array(z.string()).optional(),
});
export type PiSettingsTakeover = z.infer<typeof PiSettingsTakeoverSchema>;

/** OMP 的一个模型角色写进 config.yml 的样子：角色键（task、smol……）、模型（接口模型的 id）与思考档位（null 为不带）。 */
export interface PiLikeRoleWiring {
  role: string;
  model: string;
  thinking: string | null;
}

/**
 * 写进设置文件的默认设置：默认模型（接口模型的 id），默认思考档位（null 为没设，不碰用户自己的），
 * 以及设了的模型角色（只有 OMP 有，Pi 恒为空）。
 */
export interface PiSettingsWiring {
  model: string;
  thinking: string | null;
  roles: PiLikeRoleWiring[];
}

export interface PiSettingsApplyInput {
  // null 为文件不存在。
  text: string | null;
  wiring: PiSettingsWiring;
  // null 为首次接管。
  takeover: PiSettingsTakeover | null;
  // 「重新应用」或在 Osuna 里换了默认模型：Pi 自己换过的默认模型也写回。省略为不写回。
  shouldRewriteModel?: boolean;
}

/** Pi 的两份文件现在的内容；null 为不存在。 */
export interface PiStartupFiles {
  settingsText: string | null;
  modelsText: string | null;
}

/** 一份文件现在的内容（null 为不存在）与它的接管记录（Pi 与 OMP 共用）。 */
export interface PiFileState<Takeover> {
  text: string | null;
  takeover: Takeover;
}

/** settings.json 现在的内容与接管记录。 */
export type PiSettingsFile = PiFileState<PiSettingsTakeover | null>;

export interface PiSettingsKeepInput extends PiFileState<PiSettingsTakeover | null> {
  held: CliModelHold;
}

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
  // 服务商别处还用着（OMP 的别的角色、fallback 链等），留着；text 是重写过接线的文件。
  | { kind: "kept"; text: string }
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
  const opened = openModels(input.text);
  if (opened.kind === "unparsable") return opened;
  const { bom, text, providers, formatting } = opened;
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
export function restorePiModels(input: PiFileState<PiModelsTakeover>): PiConfigRestoreResult {
  if (input.text === null) return { kind: "missing" };
  const opened = openModels(input.text);
  if (opened.kind === "unparsable") return opened;
  const { bom, formatting } = opened;
  let text = restoreValue(opened.text, PROVIDER_PATH, input.takeover.provider.original, formatting);
  if (input.takeover.providersCreated) {
    const { providers } = readObject(text);
    if (isRecord(providers) && Object.keys(providers).length === 0) {
      text = edit(text, ["providers"], undefined, formatting);
    }
  }
  return finishedRestore({ bom, text, originalFile: input.takeover.originalFile });
}

/** providers.osuna 的地址、口令或格式不再是 Osuna 写的（或整项没了）即算被外部改过。 */
export function inspectPiModels(input: PiFileState<PiModelsTakeover | null>): PiConfigInspection {
  const opened = openModels(input.text);
  if (opened.kind === "unparsable") return opened;
  if (!input.takeover) return { kind: "parsed", modifiedKeys: [] };
  const block = opened.providers?.[PI_PROVIDER_ID];
  const { written } = input.takeover.provider;
  const isChanged =
    !isRecord(block) || ROUTING_FIELDS.some((field) => block[field] !== written[field]);
  return { kind: "parsed", modifiedKeys: isChanged ? [PROVIDER_PATH.join(".")] : [] };
}

/** models.json 里 providers.osuna 写的中转站地址与口令。 */
export interface PiGatewayAddress {
  baseUrl: string;
  apiKey: string;
}

/** models.json 里 providers.osuna 现在写的地址与口令；没有或读不懂为 null。 */
export function readPiGateway(text: string | null): PiGatewayAddress | null {
  const opened = openModels(text);
  if (opened.kind === "unparsable") return null;
  const block = opened.providers?.[PI_PROVIDER_ID];
  if (!isRecord(block)) return null;
  const { baseUrl, apiKey } = block;
  if (typeof baseUrl !== "string" || typeof apiKey !== "string") return null;
  return { baseUrl, apiKey };
}

/**
 * 把默认设置写进 settings.json：默认服务商与模型（Pi 换过、记作它的就不碰，照 magpie 的 Follow），设了的默认思考档位，
 * 以及 enabledModels 里把默认模型挪到最前（Pi 新会话先用清单里的第一个；没有清单不新建）。
 */
export function applyPiSettings(
  input: PiSettingsApplyInput,
): PiConfigPatchResult<PiSettingsTakeover> {
  const opened = openFile(input.text, "settings.json");
  if (opened.kind === "unparsable") return opened;
  const { bom, root, formatting } = opened;
  const { wiring, takeover } = input;
  const isPairHeld =
    takeover !== null &&
    input.shouldRewriteModel !== true &&
    (takeover.modelHeld !== undefined || isPairChanged(root, takeover));
  const draft: SettingsDraft = { text: opened.text, keys: {}, root, formatting, takeover };
  if (isPairHeld) keepPair(draft);
  else writePair(draft, wiring.model);
  writeThinking(draft, wiring.thinking);
  const written = readObject(draft.text);
  const placed = placeScope({
    value: written[SCOPE_KEY],
    previous: takeover?.scope ?? null,
    front: osunaRef(written),
    takes: piTakes,
  });
  if (placed.list !== null && !isDeepStrictEqual(placed.list, written[SCOPE_KEY])) {
    draft.text = editScope({ text: draft.text, list: placed.list, formatting });
  }
  const modelHeld = isPairHeld ? takeover.modelHeld : undefined;
  return {
    kind: "patched",
    text: `${bom}${draft.text}`,
    takeover: {
      originalFile: takeover?.originalFile ?? classifyOriginalFile(input.text),
      keys: draft.keys,
      ...(modelHeld === undefined ? {} : { modelHeld }),
      ...(placed.scope === null ? {} : { scope: placed.scope }),
      userOsunaEntries: takeover ? (takeover.userOsunaEntries ?? []) : osunaEntriesIn(root),
    },
  };
}

/** 改写 settings.json 时一路改下去的正文与这次的接管记录；root 是改之前读到的。 */
interface SettingsDraft {
  text: string;
  keys: PiSettingsTakeover["keys"];
  root: Record<string, unknown>;
  formatting: FormattingOptions;
  takeover: PiSettingsTakeover | null;
}

/** 默认模型归 Pi：这一对不写，记录照旧。 */
function keepPair(draft: SettingsDraft): void {
  for (const key of PAIR_KEYS) {
    const record = draft.takeover?.keys[key];
    if (record) draft.keys[key] = record;
  }
}

function writePair(draft: SettingsDraft, model: string): void {
  const values: Record<(typeof PAIR_KEYS)[number], string> = {
    defaultProvider: PI_PROVIDER_ID,
    defaultModel: model,
  };
  for (const key of PAIR_KEYS) {
    const original = draft.takeover?.keys[key]?.original ?? originalValue(draft.root, key);
    draft.keys[key] = { original, written: values[key] };
    draft.text = edit(draft.text, [key], values[key], draft.formatting);
  }
}

/** 设了就写；不再设时 Osuna 写的放回原值，用户在 Pi 里改过的留着。 */
function writeThinking(draft: SettingsDraft, thinking: string | null): void {
  const record = draft.takeover?.keys[THINKING_KEY];
  if (thinking !== null) {
    const original = record?.original ?? originalValue(draft.root, THINKING_KEY);
    draft.keys[THINKING_KEY] = { original, written: thinking };
    draft.text = edit(draft.text, [THINKING_KEY], thinking, draft.formatting);
    return;
  }
  if (record && holds(draft.root[THINKING_KEY], record.written)) {
    draft.text = restoreValue(draft.text, [THINKING_KEY], record.original, draft.formatting);
  }
}

/**
 * 关掉时的 settings.json（照 magpie 的 Disconnect）：
 * - 默认服务商还是 osuna，或两个键都还是 Osuna 写的值（且没记作 Pi 的），两个键一起放回原值；用户换成了别家的模型就都留着。
 *   不拆开放回，免得拼出「原来的服务商 + Osuna 的模型名」。
 * - 默认思考档位还是 Osuna 写的就放回原值，用户改过的留着。
 * - enabledModels：挪到最前的默认模型挪回原位，再去掉指向 Osuna 的条目（服务商删了，它们什么也不指；magpie piScopeWithout），
 *   接管前用户自己就有的留着；删空了整个删掉。
 */
export function restorePiSettings(input: PiFileState<PiSettingsTakeover>): PiConfigRestoreResult {
  if (input.text === null) return { kind: "missing" };
  const opened = openFile(input.text, "settings.json");
  if (opened.kind === "unparsable") return opened;
  const { bom, root, formatting } = opened;
  const { takeover } = input;
  const isOnOsuna = root.defaultProvider === PI_PROVIDER_ID;
  const isOursStill = takeover.modelHeld === undefined && !isPairChanged(root, takeover);
  let text = opened.text;
  if (isOnOsuna || isOursStill) {
    for (const key of PAIR_KEYS) {
      const record = takeover.keys[key];
      if (record) text = restoreValue(text, [key], record.original, formatting);
    }
  }
  const thinking = takeover.keys[THINKING_KEY];
  if (thinking && holds(root[THINKING_KEY], thinking.written)) {
    text = restoreValue(text, [THINKING_KEY], thinking.original, formatting);
  }
  const scope = root[SCOPE_KEY];
  if (isScopeList(scope)) {
    const users = takeover.userOsunaEntries ?? [];
    const kept = unplaceScope(scope, takeover.scope ?? null).filter(
      (pattern) => !namesOsunaModel(pattern) || users.includes(pattern),
    );
    if (kept.length === 0) text = edit(text, [SCOPE_KEY], undefined, formatting);
    else if (!isDeepStrictEqual(kept, scope)) text = editScope({ text, list: kept, formatting });
  }
  return finishedRestore({ bom, text, originalFile: takeover.originalFile });
}

/** 默认服务商或默认模型不再是 Osuna 记下的写入值（默认思考档位与 enabledModels 是 Pi 自己会存的，跟着走、不算）。 */
export function inspectPiSettings(input: PiSettingsFile): PiConfigInspection {
  const opened = openFile(input.text, "settings.json");
  if (opened.kind === "unparsable") return opened;
  const recorded = input.takeover?.keys ?? {};
  const modifiedKeys = PAIR_KEYS.filter((key) => {
    const record = recorded[key];
    return record !== undefined && !holds(opened.root[key], record.written);
  });
  return { kind: "parsed", modifiedKeys };
}

/**
 * Pi 自己存下、与 Osuna 记下的写入值不同的选择（照 magpie 的 Follow 与 effort 字段的 Get 读文件）：model 是 Pi 新会话实际用的
 * 「服务商/模型」（magpie piStartup，enabledModels 说了算；删掉了为 null），level 是 defaultThinkingLevel。没有接管记录或读不懂为 null。
 */
export function readPiCliPicks(input: PiSettingsFile): CliPicks | null {
  const { takeover } = input;
  if (!takeover) return null;
  const opened = openFile(input.text, "settings.json");
  if (opened.kind === "unparsable") return null;
  const { root } = opened;
  const startup = piStartup(root);
  const isChanged = isPairChanged(root, takeover) || startup !== piModelRef(root);
  const model = isChanged ? { now: startup, isKept: takeover.modelHeld === "kept" } : null;
  const level = root[THINKING_KEY];
  return {
    model,
    level: typeof level === "string" && level !== "" ? level : null,
    isUltraCodeOn: null,
    subagent: null,
    subagentLevel: null,
    memory: null,
    roles: null,
  };
}

/** 把文件里现在的默认模型记作 Pi 的（held 说是跟过去的还是保留当前设置留下的）：重写不碰。读不懂时原样返回。 */
export function keepPiCliModel(input: PiSettingsKeepInput): PiSettingsTakeover | null {
  const { takeover } = input;
  if (!takeover) return takeover;
  const opened = openFile(input.text, "settings.json");
  if (opened.kind === "unparsable") return takeover;
  const keys = { ...takeover.keys };
  for (const key of PAIR_KEYS) {
    const record = keys[key];
    if (!record) continue;
    const now = opened.root[key];
    keys[key] = { ...record, written: typeof now === "string" ? now : null };
  }
  return { ...takeover, keys, modelHeld: input.held };
}

/**
 * Pi 启动时读进来、Osuna 替它写的那部分（magpie startsWith）：settings.json 的默认设置与 enabledModels，
 * models.json 里 Osuna 的服务商；读不懂时是整份文本。拿来比较，不用来读值。
 */
export function readPiStartupReads(input: PiStartupFiles): string {
  const settings = openFile(input.settingsText, "settings.json");
  const models = openModels(input.modelsText);
  const settingsPart =
    settings.kind === "unparsable"
      ? (input.settingsText ?? "")
      : [...PAIR_KEYS, THINKING_KEY, SCOPE_KEY].map((key) => settings.root[key]);
  const modelsPart =
    models.kind === "unparsable" ? (input.modelsText ?? "") : models.providers?.[PI_PROVIDER_ID];
  return JSON.stringify({ settings: settingsPart, provider: modelsPart });
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

/** 文件里的值还是记下的写入值（null 为没有这个键）。 */
export function holds(value: unknown, written: string | null): boolean {
  return written === null ? value === undefined : value === written;
}

/** 默认服务商或默认模型不再是记下的写入值。 */
function isPairChanged(root: Record<string, unknown>, takeover: PiSettingsTakeover): boolean {
  return PAIR_KEYS.some((key) => {
    const record = takeover.keys[key];
    return record !== undefined && !holds(root[key], record.written);
  });
}

/** Pi 写法的默认模型：「服务商/模型」，没设服务商时只是模型；没设为 null。 */
function piModelRef(root: Record<string, unknown>): string | null {
  const { defaultProvider, defaultModel } = root;
  if (typeof defaultModel !== "string" || defaultModel === "") return null;
  if (typeof defaultProvider !== "string" || defaultProvider === "") return defaultModel;
  return `${defaultProvider}/${defaultModel}`;
}

/** 默认服务商是 Osuna 时 enabledModels 里它的写法「osuna/模型」；不是为 null。 */
function osunaRef(root: Record<string, unknown>): string | null {
  const ref = piModelRef(root);
  return root.defaultProvider === PI_PROVIDER_ID ? ref : null;
}

/** Pi 当成清单读的 enabledModels：非空、全是字符串（magpie piScope）；别的样子 Pi 不按它挑模型，Osuna 也不碰。 */
export function isScopeList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((pattern): pattern is string => typeof pattern === "string")
  );
}

/** 指着 Osuna 某个模型的条目（不含通配符的「osuna/…」）。 */
export function namesOsunaModel(pattern: string): boolean {
  return !isGlob(pattern) && pattern.toLowerCase().startsWith(`${PI_PROVIDER_ID}/`);
}

/** enabledModels 里现在指着 Osuna 模型的条目；没有清单为空。 */
function osunaEntriesIn(root: Record<string, unknown>): string[] {
  const scope = root[SCOPE_KEY];
  return isScopeList(scope) ? scope.filter(namesOsunaModel) : [];
}

export function isGlob(pattern: string): boolean {
  return /[*?[]/.test(pattern);
}

/** 去掉条目末尾的「:档位」（Pi 的 provider/model:high）。 */
export function withoutLevel(pattern: string): string {
  const at = pattern.lastIndexOf(":");
  if (at < 0) return pattern;
  return PI_THINKING_LEVELS.includes(pattern.slice(at + 1)) ? pattern.slice(0, at) : pattern;
}

/**
 * Pi 的清单条目一定指着 ref（「服务商/模型」）（magpie piTakes）：同一个引用（带不带「:档位」都算），或是 ref、或它的模型 id
 * 符合的通配符（Pi 的 *、? 与 [..]，不分大小写）。光秃秃的模型 id 不算。
 */
export function piTakes(pattern: string, ref: string): boolean {
  const bare = withoutLevel(pattern).trim().toLowerCase();
  const target = ref.toLowerCase();
  if (bare === target) return true;
  if (!isGlob(pattern)) return false;
  const matcher = globMatcher(bare);
  const id = target.slice(target.indexOf("/") + 1);
  return matcher.test(target) || matcher.test(id);
}

/** Go path.Match 的写法：* 与 ? 不跨「/」，[..] 是字符类。 */
function globMatcher(glob: string): RegExp {
  let source = "";
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob.charAt(index);
    if (char === "*") source += "[^/]*";
    else if (char === "?") source += "[^/]";
    else if (char === "[") {
      const close = glob.indexOf("]", index + 1);
      if (close < 0) source += "\\[";
      else {
        // 字符类原样用（Go 的 [^..] 与正则同义），只把反斜杠转义。
        source += `[${glob.slice(index + 1, close).replace(/\\/g, "\\\\")}]`;
        index = close;
      }
    } else source += char.replace(/[.+^${}()|\\]/g, "\\$&");
  }
  return new RegExp(`^${source}$`);
}

/**
 * Pi 新会话用的模型（magpie piStartup）：清单收着默认模型（或没有清单）就是默认模型，否则是清单第一条——它只指一个模型时。
 */
function piStartup(root: Record<string, unknown>): string | null {
  const ref = piModelRef(root);
  const scope = root[SCOPE_KEY];
  if (ref === null || !isScopeList(scope)) return ref;
  if (scope.some((pattern) => piTakes(pattern, ref))) return ref;
  const first = withoutLevel((scope[0] ?? "").trim());
  if (isGlob(first) || !first.includes("/")) return ref;
  return first;
}

/** 用户自己的清单：上次挪到最前的还在最前，就挪回原位（Osuna 加的拿掉）。 */
export function unplaceScope(list: readonly string[], previous: PiScopePlacement | null): string[] {
  const user = [...list];
  if (previous === null || user[0] !== previous.front) return user;
  user.shift();
  if (previous.wasAt !== null)
    user.splice(Math.min(previous.wasAt, user.length), 0, previous.front);
  return user;
}

/** 换掉 enabledModels：用户写成一行的照样写成一行，别的按文件格式展开。 */
interface ScopeEdit {
  text: string;
  list: string[];
  formatting: FormattingOptions;
}

function editScope(input: ScopeEdit): string {
  const { text, list } = input;
  const tree = parseTree(text, [], JSONC_OPTIONS);
  const node = tree ? findNodeAtLocation(tree, [SCOPE_KEY]) : undefined;
  const isOneLine =
    node !== undefined && !/\r?\n/.test(text.slice(node.offset, node.offset + node.length));
  if (!isOneLine) return edit(text, [SCOPE_KEY], list, input.formatting);
  const inline = `[${list.map((pattern) => JSON.stringify(pattern)).join(", ")}]`;
  return `${text.slice(0, node.offset)}${inline}${text.slice(node.offset + node.length)}`;
}

export interface ScopePlacement {
  // 要写进去的清单；null 为没有清单，不碰。
  list: string[] | null;
  scope: PiScopePlacement | null;
}

/** 先挪回上次的，再把 front 放到最前；front 为 null（默认服务商不是 Osuna）时只挪回。 */
export interface PlaceScopeInput {
  // 文件里现在的 enabledModels（OMP 的已换成只有字符串的清单）。
  value: unknown;
  previous: PiScopePlacement | null;
  front: string | null;
  // 条目指不指着「服务商/模型」：Pi 是 piTakes，OMP 另认它的档位写法。
  takes: (pattern: string, ref: string) => boolean;
}

export function placeScope(input: PlaceScopeInput): ScopePlacement {
  if (!isScopeList(input.value)) return { list: null, scope: null };
  const user = unplaceScope(input.value, input.previous);
  const { front } = input;
  if (front === null) return { list: user, scope: null };
  // 已有指着它的条目（可带「:档位」、大小写不同；magpie piTakes）就把那一条挪到最前，不再另加。
  const at = user.findIndex((pattern) => !isGlob(pattern) && input.takes(pattern, front));
  if (at < 0) return { list: [front, ...user], scope: { front, wasAt: null } };
  const taken = user[at] ?? front;
  const rest = user.filter((_, index) => index !== at);
  return { list: [taken, ...rest], scope: { front: taken, wasAt: at } };
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

export function mergeTheirs(input: {
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
      root: Record<string, unknown>;
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
  return { kind: "parsed", bom, text: base, root: value, formatting: detectFormatting(base) };
}

/** models.json 另要 providers 是对象（没有也行）。 */
type OpenedModels =
  | (Extract<OpenedFile, { kind: "parsed" }> & { providers: Record<string, unknown> | undefined })
  | PiConfigUnparsable;

function openModels(text: string | null): OpenedModels {
  const opened = openFile(text, "models.json");
  if (opened.kind === "unparsable") return opened;
  const { providers } = opened.root;
  if (providers === undefined) return { ...opened, providers: undefined };
  if (!isRecord(providers)) return keyNotObject("models.json", "providers");
  return { ...opened, providers };
}

/** 只在已校验过的文本上调用；万一不是对象按空对象算。 */
function readObject(text: string): Record<string, unknown> {
  const value: unknown = parseJsonc(text, [], JSONC_OPTIONS);
  return isRecord(value) ? value : {};
}

function finishedRestore(input: {
  bom: string;
  text: string;
  originalFile: OriginalFile;
}): PiConfigRestoreResult {
  const { originalFile } = input;
  // 负责的都拿走后只剩空对象：按接管前的样子收回。
  if (Object.keys(readObject(input.text)).length === 0) {
    if (originalFile.kind === "absent") return { kind: "delete" };
    if (originalFile.kind === "empty") return { kind: "patched", text: originalFile.text };
  }
  return { kind: "patched", text: `${input.bom}${input.text}` };
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

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
