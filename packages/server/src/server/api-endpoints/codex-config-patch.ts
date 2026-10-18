// 用 ChatGPT 登录时的接法照 magpie（https://github.com/yetone/magpie，internal/agent/codex.go 的 Join、putProvider、dropProvider、
// isCCSwitchMirror、takeMirrors、giveMirrors；默认思考档位照 effort 字段；Codex 自己换过的模型照 internal/agent/applied.go 的 Drift 与 Keep；
// 默认 Subagent 模型与档位、记忆模型照 subagents、subagent_effort、memories 字段与 internal/edit/toml.go 的 SetTOMLKey、DelTOMLKey；
// Codex 自己的 multi_agent_v2 照 internal/agent/codex.go 的 multiAgentV2OnIn、codexMultiAgentV2On）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { getStaticTOMLValue, parseTOML, type AST } from "toml-eslint-parser";
import { z } from "zod";
import {
  CliModelHoldSchema,
  type CliModelHold,
  type CliPicks,
  type CliSidePick,
} from "./cli-model-hold.js";

/*
 * Codex 的 config.toml 补丁（编辑规则见 ADR 0004，写什么见 ADR 0007 与 0010）：用 toml-eslint-parser 拿到节点的精确位置，
 * 按位置拼接文本，其余字节不动；每次拼完再解析一遍，拼不出合法文件就整个拒绝。
 *
 * 负责的键：顶层 model_provider / model / model_catalog_json，设了默认思考档位时的 model_reasoning_effort（照 magpie 的 effort 字段），
 * 设了才写的 [agents] default_subagent_model / default_subagent_reasoning_effort 与 [memories] extract_model / consolidation_model，以及整张专用表
 * [model_providers.osuna_api_endpoint]（daemon 中转站地址与口令明文）；用 ChatGPT 登录时另有顶层 openai_base_url，
 * model_provider 与 model_catalog_json 改为拿掉（ADR 0010），CC Switch 的 OpenAI 镜像表的 base_url 也指到中转站。切回官方时顶层键还原、专用表留着：
 * 记在这个服务商名下的 Codex 对话关掉开关后还要能续，daemon 每次启动按新端口改写它。
 * 顶层 model 被 Codex 自己换过（TUI 的 /model）之后归 Codex（照 magpie 的 Follow，ADR 0012）：之后的重写不碰它，
 * 直到「重新应用」或在 Osuna 里换默认模型（shouldRewriteModel）。
 */

/**
 * 专用 provider id。带下划线：自定义提供方的 id 只能是 [a-z][a-z0-9-]*，
 * 请求级注入的 model_providers 永远合并不到这张表上。
 */
export const CODEX_API_ENDPOINT_PROVIDER_ID = "osuna_api_endpoint";

const TOML_VERSION = "1.0";
const BOM = "\uFEFF";
const TOP_LEVEL_KEYS = [
  "model_provider",
  "model",
  "model_catalog_json",
  "openai_base_url",
  "model_reasoning_effort",
] as const;
// CLI 自己会存下的选择（TUI 的 /model 连档位一起写回）：跟着走（第 30 条），不算被改过。
const FOLLOWED_KEYS: ReadonlySet<TopLevelKey> = new Set(["model_reasoning_effort"]);
// API key 登录或未登录时负责的顶层键（Osuna 的服务商接法）。
const PROVIDER_KEYS = ["model_provider", "model", "model_catalog_json"] as const;
// 专用表的 name：Codex 在状态与报错里显示它。
const PROVIDER_TABLE_NAME = "Osuna";
type TopLevelKey = (typeof TOP_LEVEL_KEYS)[number];

/** [agents] 与 [memories] 里负责的一个键；接管记录与提示里叫「表名.键名」。 */
interface TableKey {
  table: "agents" | "memories";
  key: string;
}

const SUBAGENT_MODEL_KEY: TableKey = { table: "agents", key: "default_subagent_model" };
const SUBAGENT_EFFORT_KEY: TableKey = { table: "agents", key: "default_subagent_reasoning_effort" };
const MEMORY_EXTRACT_KEY: TableKey = { table: "memories", key: "extract_model" };
const MEMORY_CONSOLIDATION_KEY: TableKey = { table: "memories", key: "consolidation_model" };
const TABLE_KEYS: readonly TableKey[] = [
  SUBAGENT_MODEL_KEY,
  SUBAGENT_EFFORT_KEY,
  MEMORY_EXTRACT_KEY,
  MEMORY_CONSOLIDATION_KEY,
];
// 手改的档位照样跟过去（Codex 收任何档位名），不算被改过。
const FOLLOWED_TABLE_KEYS: ReadonlySet<string> = new Set([tableKeyName(SUBAGENT_EFFORT_KEY)]);

function tableKeyName(tableKey: TableKey): string {
  return `${tableKey.table}.${tableKey.key}`;
}

// raw 是原值在文件里的写法（含引号），恢复时原样放回。
const CodexOriginalValueSchema = z.discriminatedUnion("present", [
  z.object({ present: z.literal(true), raw: z.string() }),
  z.object({ present: z.literal(false) }),
]);
type CodexOriginalValue = z.infer<typeof CodexOriginalValueSchema>;

const CodexProviderTableRecordSchema = z.object({ baseUrl: z.string(), bearerToken: z.string() });
export type CodexProviderTableRecord = z.infer<typeof CodexProviderTableRecordSchema>;

// 镜像表的 base_url：接管前的写法（通常没有）与写入的中转站地址。
const CodexMirrorRecordSchema = z.object({
  original: CodexOriginalValueSchema,
  written: z.string(),
});
type CodexMirrorRecord = z.infer<typeof CodexMirrorRecordSchema>;

/**
 * 接管记录：顶层负责的键接管前的写法，以及上次写入的值（检测外部改动用）。
 * v0.15 的记录没有 table 与 fileCreated（那时专用表用 auth.command 读 key）。
 */
export const CodexConfigTakeoverSchema = z.object({
  // written 为 null：Osuna 拿掉了这个键（ChatGPT 登录时的 model_provider 与 model_catalog_json），或 Codex 删掉了 model。
  // held（只用在 model 上）：文件里的 model 归 Codex（见 cli-model-hold.ts），written 记着它，重写时不碰。
  keys: z.record(
    z.string(),
    z.object({
      original: CodexOriginalValueSchema,
      written: z.string().nullable(),
      held: CliModelHoldSchema.optional(),
    }),
  ),
  // 专用表上次写入的地址与口令。
  table: CodexProviderTableRecordSchema.optional(),
  // ChatGPT 接法下指到中转站的 CC Switch OpenAI 镜像表，按服务商 id。
  mirrors: z.record(z.string(), CodexMirrorRecordSchema).optional(),
  // 接管前文件不存在：切回官方后只剩 Osuna 写的东西时把文件删掉。
  fileCreated: z.boolean().optional(),
  // Osuna 加的 [agents]、[memories] 表：里面的键都放回后表空了就整张拿掉（magpie DelTOMLKey）。
  createdTables: z.array(z.string()).optional(),
});
export type CodexConfigTakeover = z.infer<typeof CodexConfigTakeoverSchema>;

/**
 * CLI 指向的中转站：地址（以 /v1 结尾）、该 Agent 的口令、新会话的起始模型、模型目录文件。
 * chatgptBaseUrl 非 null 表示 Codex 用 ChatGPT 登录：写进 openai_base_url 的中转站 ChatGPT 后端地址，
 * 起始模型这时不写，model 归 Codex 自己；只有原本用着用户自己的服务商时，照 magpie 的 connect 写上默认模型，
 * 光秃秃的换成 endpointModels（开着的接口的「接口标识/模型名」，聊天模型选择器的顺序）里第一家的写法。
 * defaultThinking 是默认思考档位，两种接法都写进 model_reasoning_effort；null 为没设，不碰用户自己的。
 * subagent 是默认 Subagent 模型与档位，memoryModel 是记忆模型（写进 extract_model 与 consolidation_model）；
 * null 为没设，不碰用户自己的。模型已是 Codex 认得的写法（ChatGPT 接法下由调用方换成 /model 里的写法）。
 */
export interface CodexGatewayWiring {
  baseUrl: string;
  token: string;
  model: string;
  catalogPath: string;
  chatgptBaseUrl: string | null;
  endpointModels: string[];
  defaultThinking: string | null;
  subagent: CodexSubagentWiring | null;
  memoryModel: string | null;
}

/** 默认 Subagent 模型（null 为不设，跟主对话）与档位（null 为不设）。 */
export interface CodexSubagentWiring {
  model: string | null;
  effort: string | null;
}

export type CodexConfigPatchResult =
  | { kind: "patched"; text: string; takeover: CodexConfigTakeover }
  | { kind: "unparsable"; message: string };

export type CodexConfigRestoreResult =
  | { kind: "patched"; text: string }
  | { kind: "missing" }
  | { kind: "unparsable"; message: string }
  // 接管前文件不存在，恢复后又什么都不剩（用户连专用表也删了）：把文件删掉。
  | { kind: "delete" };

export type CodexProviderTableRefreshResult =
  // text 可能与原文相同：表已经指向这里。
  | { kind: "patched"; text: string }
  // 文件不存在或里面没有专用表：不写（用户删了就不再写回）。
  | { kind: "absent" }
  | Unparsable;

interface Unparsable {
  kind: "unparsable";
  message: string;
}

/**
 * 把中转站写进 config.toml：顶层负责的键原地替换或插入，专用表整块放到文件末尾。
 * `takeover` 为 null 表示首次接管；已接管时沿用其中的原值。`text` 为 null 表示文件不存在。
 */
export function applyCodexApiEndpoint(input: {
  text: string | null;
  wiring: CodexGatewayWiring;
  takeover: CodexConfigTakeover | null;
  // 「重新应用」或在 Osuna 里换了默认模型：Codex 换过的 model 也写回。省略为不写回。
  shouldRewriteModel?: boolean;
}): CodexConfigPatchResult {
  const [bom, baseText] = splitBom(input.text ?? "");
  const parsed = parseConfig(baseText);
  if (parsed.kind === "unparsable") return parsed;

  const eol = detectEol(baseText);
  const { wiring } = input;
  const originalOf = (key: TopLevelKey): CodexOriginalValue => {
    const recorded = input.takeover?.keys[key]?.original;
    if (recorded) return recorded;
    const node = findTopLevelKeyValue(parsed.program, key);
    return node ? { present: true, raw: sliceNode(baseText, node.value) } : { present: false };
  };
  // 每个负责的键这次写的原文（含引号），null 为拿掉。
  const raws = wiringRaws(wiring, chatgptModel(parsed.value, originalOf, wiring));
  const table: CodexProviderTableRecord = { baseUrl: wiring.baseUrl, bearerToken: wiring.token };
  const keys: CodexConfigTakeover["keys"] = {};
  // ChatGPT 接法下模型归 Codex 时（raws 里没有 model）不用留。
  let heldModel: CodexKeyRecord | null = null;
  if (raws.model !== undefined) {
    heldModel = heldCliModel({
      value: parsed.value,
      record: input.takeover?.keys.model,
      shouldRewriteModel: input.shouldRewriteModel === true,
    });
  }
  const isModelHeld = heldModel !== null;
  let text = baseText;
  for (const key of TOP_LEVEL_KEYS) {
    const raw = raws[key];
    const original = originalOf(key);
    if (key === "model" && heldModel) {
      keys.model = heldModel;
      continue;
    }
    if (raw === undefined) {
      // 换了登录方式：这种接法不负责的键（openai_base_url，或 ChatGPT 接法下的 model）放回接管前的样子，不再记。
      if (input.takeover?.keys[key]) text = putBack(text, key, original, eol);
      continue;
    }
    keys[key] = { original, written: raw === null ? null : readRaw(raw) };
    text = raw === null ? removeTopLevelKey(text, key) : setTopLevelValue({ text, key, raw, eol });
  }
  const recordedMirrors = input.takeover?.mirrors ?? {};
  let mirrors: Record<string, CodexMirrorRecord> = {};
  if (wiring.chatgptBaseUrl === null) {
    // 换成服务商接法：镜像表不再归 Osuna，放回接管前的样子。
    text = giveMirrors({ text, mirrors: recordedMirrors, eol });
  } else {
    ({ text, mirrors } = takeMirrors({
      text,
      value: parsed.value,
      url: wiring.chatgptBaseUrl,
      recorded: recordedMirrors,
      eol,
    }));
  }
  // 旧版本写的 auth.command 子表一并拿掉。新加的 [agents]、[memories] 放在专用表前面，重写时位置不变。
  const sides = applyTableKeys({
    text: removeProviderTables(text),
    raws: tableRaws(wiring),
    originalIn: { program: parsed.program, text: baseText },
    takeover: input.takeover,
    keys,
    eol,
  });
  text = appendProviderTable({ text: sides.text, table, eol });
  // COMPAT(codexLegacyProviderTable): v0.15 的记录没有 fileCreated，按文件原本存在处理；remove after 2027-04-14.
  const fileCreated = input.takeover ? (input.takeover.fileCreated ?? false) : input.text === null;

  const failure = verify(text, (value) =>
    holdsEverything({ value, keys, isModelHeld, table, mirrors }),
  );
  const takeover = takeoverOf({
    keys,
    table,
    fileCreated,
    mirrors,
    createdTables: sides.createdTables,
  });
  return failure ?? { kind: "patched", text: bom + text, takeover };
}

/** 接管记录；没有镜像表、没有新加的表时不记这两项。 */
function takeoverOf(input: {
  keys: CodexConfigTakeover["keys"];
  table: CodexProviderTableRecord;
  fileCreated: boolean;
  mirrors: Record<string, CodexMirrorRecord>;
  createdTables: string[];
}): CodexConfigTakeover {
  const { keys, table, fileCreated, mirrors, createdTables } = input;
  const takeover: CodexConfigTakeover = { keys, table, fileCreated };
  if (Object.keys(mirrors).length > 0) takeover.mirrors = mirrors;
  if (createdTables.length > 0) takeover.createdTables = createdTables;
  return takeover;
}

/**
 * magpie `takeMirrors`：内置 openai 以外的服务商不跟 openai_base_url 走，记在 CC Switch 镜像表名下的对话会直连 ChatGPT、
 * 用不了接口模型（magpie #1796），所以把镜像表的 base_url 也指到中转站的 ChatGPT 后端。profile 点名的表归用户挑，不动；
 * 只认用自己的 [model_providers.<id>] 表头写的表（magpie 的 edit.TOMLTables 同样只列表头）。
 * 记录只增不减（magpie 的 `codex.mirrors`）：记过的表地址还是 Osuna 写的就一直记着，后来被 profile 点名、改了名也一样，
 * 关开关时照样拿掉；地址已不是 Osuna 写的才从记录里去掉。
 */
function takeMirrors(input: {
  text: string;
  value: Record<string, unknown>;
  url: string;
  recorded: Record<string, CodexMirrorRecord>;
  eol: string;
}): MirrorsTaken {
  const { value, url, recorded, eol } = input;
  const program = parse(input.text);
  const named = profileNamedProviders(value);
  const mirrors = Object.fromEntries(
    Object.entries(recorded).filter(([id, record]) => mirrorBaseUrl(value, id) === record.written),
  );
  let text = input.text;
  for (const id of providerIds(value)) {
    const isTakeable =
      !named.has(id) &&
      isCCSwitchMirror({ value, providerId: id, recorded: recorded[id] }) &&
      findOwnTable(program, id) !== null;
    if (!isTakeable) continue;
    const node = findTableKeyValue({ program: parse(text), providerId: id, key: "base_url" });
    const originalInFile: CodexOriginalValue = node
      ? { present: true, raw: sliceNode(text, node.value) }
      : { present: false };
    const original = recorded[id]?.original ?? originalInFile;
    mirrors[id] = { original, written: url };
    text = setTableValue({ text, id, raw: tomlString(url), eol });
  }
  return { text, mirrors };
}

interface MirrorsTaken {
  text: string;
  mirrors: Record<string, CodexMirrorRecord>;
}

/** magpie `giveMirrors`：拿掉写进镜像表的地址（原来有写法就放回）；之后被改过的表照现在的样子留着。 */
function giveMirrors(input: {
  text: string;
  mirrors: Record<string, CodexMirrorRecord>;
  eol: string;
}): string {
  let text = input.text;
  for (const [id, record] of Object.entries(input.mirrors)) {
    const program = parse(text);
    const value = getStaticTOMLValue(program);
    const isStillOurs =
      isRecord(value) &&
      mirrorBaseUrl(value, id) === record.written &&
      findOwnTable(program, id) !== null;
    if (!isStillOurs) continue;
    text = record.original.present
      ? setTableValue({ text, id, raw: record.original.raw, eol: input.eol })
      : removeTableKey(text, id);
  }
  return text;
}

/**
 * 两种接法各自写的顶层键。ChatGPT 登录：Codex 回到内置 openai 服务商（拿掉 model_provider 与目录），
 * 地址由 openai_base_url 指到中转站；model 不归 Osuna（magpie 的 Join 不碰它）：Codex 自己选过的留着，
 * 没选过就照旧没有（用 Codex 自己的默认）；从服务商接法换过来时放回接管前的样子。
 */
function wiringRaws(
  wiring: CodexGatewayWiring,
  model: string | null,
): Partial<Record<TopLevelKey, string | null>> {
  const thinking =
    wiring.defaultThinking === null
      ? {}
      : { model_reasoning_effort: tomlString(wiring.defaultThinking) };
  if (wiring.chatgptBaseUrl === null) {
    return {
      model_provider: tomlString(CODEX_API_ENDPOINT_PROVIDER_ID),
      model: tomlString(wiring.model),
      model_catalog_json: tomlString(wiring.catalogPath),
      ...thinking,
    };
  }
  const ownModel = model === null ? {} : { model: tomlString(model) };
  return {
    model_provider: null,
    ...ownModel,
    model_catalog_json: null,
    openai_base_url: tomlString(wiring.chatgptBaseUrl),
    ...thinking,
  };
}

/** 这次写进 [agents]、[memories] 的原文（含引号），按「表名.键名」；没设的不在里面。 */
function tableRaws(wiring: CodexGatewayWiring): Record<string, string> {
  const raws: Record<string, string> = {};
  const subagentModel = wiring.subagent?.model ?? null;
  const subagentEffort = wiring.subagent?.effort ?? null;
  if (subagentModel !== null) raws[tableKeyName(SUBAGENT_MODEL_KEY)] = tomlString(subagentModel);
  if (subagentEffort !== null) raws[tableKeyName(SUBAGENT_EFFORT_KEY)] = tomlString(subagentEffort);
  if (wiring.memoryModel !== null) {
    const memory = tomlString(wiring.memoryModel);
    raws[tableKeyName(MEMORY_EXTRACT_KEY)] = memory;
    raws[tableKeyName(MEMORY_CONSOLIDATION_KEY)] = memory;
  }
  return raws;
}

interface TableKeysApplied {
  text: string;
  createdTables: string[];
}

/**
 * 写 [agents]、[memories] 里设了的键（照 magpie SetTOMLKey：只换值，没有就接在表的最后一个键后面，没有表就加一张），
 * 记下接管前的写法；这次没设、上次写过的放回接管前的样子。Osuna 加的表空了就拿掉。
 */
function applyTableKeys(input: {
  text: string;
  raws: Record<string, string>;
  // 接管前的文件：原值从这里读。
  originalIn: { program: AST.TOMLProgram; text: string };
  takeover: CodexConfigTakeover | null;
  keys: CodexConfigTakeover["keys"];
  eol: string;
}): TableKeysApplied {
  const { raws, takeover, keys, eol } = input;
  const created = new Set(takeover?.createdTables ?? []);
  let text = input.text;
  for (const tableKey of TABLE_KEYS) {
    const name = tableKeyName(tableKey);
    const raw = raws[name];
    const recorded = takeover?.keys[name];
    if (raw === undefined) {
      if (recorded) text = putBackInTable({ text, tableKey, original: recorded.original, eol });
      continue;
    }
    const original = recorded?.original ?? originalInTable(input.originalIn, tableKey);
    keys[name] = { original, written: readRaw(raw) };
    if (!findNamedTable(parse(text), tableKey.table)) created.add(tableKey.table);
    text = setTableKeyValue({ text, tableKey, raw, eol });
  }
  const isWritingIn = (table: string) =>
    TABLE_KEYS.some((tableKey) => tableKey.table === table && keys[tableKeyName(tableKey)]);
  const createdTables: string[] = [];
  for (const table of created) {
    if (isWritingIn(table)) createdTables.push(table);
    else text = removeEmptyTable(text, table);
  }
  return { text, createdTables };
}

function originalInTable(
  file: { program: AST.TOMLProgram; text: string },
  tableKey: TableKey,
): CodexOriginalValue {
  const node = findKeyInTable(findNamedTable(file.program, tableKey.table), tableKey.key);
  if (!node) return { present: false };
  return { present: true, raw: sliceNode(file.text, node.value) };
}

function putBackInTable(input: {
  text: string;
  tableKey: TableKey;
  original: CodexOriginalValue;
  eol: string;
}): string {
  const { text, tableKey, original, eol } = input;
  if (original.present) return setTableKeyValue({ text, tableKey, raw: original.raw, eol });
  const node = findKeyInTable(findNamedTable(parse(text), tableKey.table), tableKey.key);
  if (!node) return text;
  return removeLine(text, node);
}

/**
 * ChatGPT 登录时要写的 model，不写为 null。接管前用的是用户自己的服务商（不是 openai、也不是 CC Switch 的
 * OpenAI 镜像）时，magpie 的 Join 不接（codex.go `Join`），`connect` 接着挑一个 magpie 模型 `set` 上：
 * 服务商照样拿掉、模型写成挑中的那个（applied.go `connect`）。用户 2026-10-18 决定完全照 magpie。
 * 挑中的就是默认模型（default-model-pick.ts）；这种接法下光秃秃的名字指 ChatGPT 自带模型，所以写成第一家提供它的「接口标识/模型名」。
 */
function chatgptModel(
  value: Record<string, unknown>,
  originalOf: (key: TopLevelKey) => CodexOriginalValue,
  wiring: CodexGatewayWiring,
): string | null {
  const provider = originalOf("model_provider");
  if (!provider.present) return null;
  if (keepsOwnModel({ value, providerId: readRaw(provider.raw) })) return null;
  return endpointModelFor(wiring.model, wiring.endpointModels);
}

/** ChatGPT 接法下 Codex 的模型归它自己（magpie 的 Join 接得上）：没写服务商、内置 openai，或 CC Switch 的 OpenAI 镜像。 */
function keepsOwnModel(input: { value: Record<string, unknown>; providerId: unknown }): boolean {
  const { value, providerId } = input;
  if (providerId === undefined || providerId === "openai") return true;
  return typeof providerId === "string" && isCCSwitchMirror({ value, providerId });
}

/** 默认模型在「接口标识/模型名」里的写法：本身就是就照用，光秃秃的取第一家提供它的。 */
function endpointModelFor(model: string, endpointModels: string[]): string | null {
  if (endpointModels.includes(model)) return model;
  const named = endpointModels.find((option) => option.slice(option.indexOf("/") + 1) === model);
  return named ?? endpointModels[0] ?? null;
}

/**
 * magpie `isCCSwitchMirror`：名叫 OpenAI、要求 OpenAI 登录、没有自己的地址的服务商表；
 * 地址是 Osuna 上次写进去的那个（`recorded`）也算，接管着时才认得出。
 */
function isCCSwitchMirror(input: {
  value: Record<string, unknown>;
  providerId: string;
  recorded?: CodexMirrorRecord;
}): boolean {
  const { value, providerId, recorded } = input;
  if (providerId === "openai" || providerId === CODEX_API_ENDPOINT_PROVIDER_ID) return false;
  const providers = value.model_providers;
  const table = isRecord(providers) ? providers[providerId] : undefined;
  if (!isRecord(table) || table.name !== "OpenAI" || table.requires_openai_auth !== true) {
    return false;
  }
  const hasNoAddress = table.base_url === undefined || table.base_url === "";
  const holdsOurAddress = recorded !== undefined && table.base_url === recorded.written;
  return hasNoAddress || holdsOurAddress;
}

function providerIds(value: Record<string, unknown>): string[] {
  return isRecord(value.model_providers) ? Object.keys(value.model_providers) : [];
}

/** magpie `profileNamed`：config.toml 里各个 [profiles.<name>] 点名的服务商。 */
function profileNamedProviders(value: Record<string, unknown>): Set<string> {
  const profiles = isRecord(value.profiles) ? Object.values(value.profiles) : [];
  return new Set(
    profiles.flatMap((profile) =>
      isRecord(profile) && typeof profile.model_provider === "string"
        ? [profile.model_provider]
        : [],
    ),
  );
}

/** 服务商表的 base_url；没有表、没有地址或不是字符串为 undefined。 */
function mirrorBaseUrl(value: Record<string, unknown>, providerId: string): unknown {
  const providers = value.model_providers;
  const table = isRecord(providers) ? providers[providerId] : undefined;
  return isRecord(table) ? table.base_url : undefined;
}

/** 写进接管记录与提示区的镜像表的键名。 */
function mirrorKey(providerId: string): string {
  return `model_providers.${providerId}.base_url`;
}

/** 提示区用：这个负责的键是镜像表的地址（被外部改了就不再经过中转站）。 */
export function isCodexMirrorKey(key: string): boolean {
  return key.startsWith("model_providers.") && key.endsWith(".base_url");
}

type CodexKeyRecord = CodexConfigTakeover["keys"][string];

/** 拼完的文件里，这次写的每一项都在（Codex 自己换过、留着的 model 不查）。 */
function holdsEverything(input: {
  value: Record<string, unknown>;
  keys: CodexConfigTakeover["keys"];
  isModelHeld: boolean;
  table: CodexProviderTableRecord;
  mirrors: Record<string, CodexMirrorRecord>;
}): boolean {
  const { value, isModelHeld } = input;
  const holdsKeys = Object.entries(input.keys).every(([key, record]) => {
    const isLeftToCodex = key === "model" && isModelHeld;
    return isLeftToCodex || holdsWritten(valueAt(value, key), record.written);
  });
  const holdsMirrors = Object.entries(input.mirrors).every(
    ([id, record]) => mirrorBaseUrl(value, id) === record.written,
  );
  const holdsTable = holdsProviderTable(value, input.table);
  return holdsKeys && holdsTable && holdsMirrors;
}

/**
 * Codex 自己换过的 model（不再是记下的写入值，或已记作 Codex 的）：原样留着，记录不变；不归 Codex 时为 null。
 * 照 magpie：Osuna 不改回 CLI 存下的模型（ADR 0012）。
 */
function heldCliModel(input: {
  value: Record<string, unknown>;
  record: CodexKeyRecord | undefined;
  shouldRewriteModel: boolean;
}): CodexKeyRecord | null {
  const { record } = input;
  if (!record || input.shouldRewriteModel) return null;
  const isChangedByCli = !holdsWritten(input.value.model, record.written);
  const isHeldByCli = record.held !== undefined || isChangedByCli;
  return isHeldByCli ? record : null;
}

/**
 * Codex 自己存下、与 Osuna 记下的写入值不同的选择（照 magpie 的 Follow 与 effort 字段的 Get）；没有 Ultra Code。
 * 文件读不懂或没有接管记录时为 null。
 */
export function readCodexCliPicks(input: {
  text: string | null;
  takeover: CodexConfigTakeover | null;
}): CliPicks | null {
  const { takeover } = input;
  if (!takeover) return null;
  const value = parsedTopLevel(input.text);
  if (value === null) return null;
  const now = stringOrNull(value.model);
  const modelRecord = takeover.keys.model;
  let model: CliPicks["model"] = null;
  // ChatGPT 接法下模型归 Codex、Osuna 没记 model：文件里的就是它自己选的（magpie 一律读文件）。
  const isOwnedByCodex = modelRecord === undefined && now !== null;
  if (isOwnedByCodex) model = { now, isKept: false };
  const isChangedByCodex =
    modelRecord !== undefined && !holdsWritten(value.model, modelRecord.written);
  if (modelRecord && isChangedByCodex) model = { now, isKept: modelRecord.held === "kept" };
  const level = stringOrNull(value.model_reasoning_effort);
  return {
    model,
    level,
    isUltraCodeOn: null,
    subagent: changedTableValue({ value, takeover, tableKey: SUBAGENT_MODEL_KEY }),
    subagentLevel: changedTableValue({ value, takeover, tableKey: SUBAGENT_EFFORT_KEY }),
    memory: changedMemoryModel(value, takeover),
  };
}

/**
 * [agents]、[memories] 里的一个键不再是 Osuna 写的值（没写过时就是文件里有值）时，它现在的值（没了为 null）；
 * 没变为 null（照 magpie 这几个字段的 Get 读文件）。
 */
function changedTableValue(input: {
  value: Record<string, unknown>;
  takeover: CodexConfigTakeover;
  tableKey: TableKey;
}): CliSidePick | null {
  const name = tableKeyName(input.tableKey);
  const now = stringOrNull(valueAt(input.value, name));
  const written = input.takeover.keys[name]?.written ?? null;
  if (now === written) return null;
  return { now };
}

/** 记忆模型（照 magpie memories 字段的 Get：consolidation_model，没有再看 extract_model）：两个键有一个变了就算变了。 */
function changedMemoryModel(
  value: Record<string, unknown>,
  takeover: CodexConfigTakeover,
): CliSidePick | null {
  const consolidation = changedTableValue({ value, takeover, tableKey: MEMORY_CONSOLIDATION_KEY });
  const extract = changedTableValue({ value, takeover, tableKey: MEMORY_EXTRACT_KEY });
  if (consolidation === null && extract === null) return null;
  const now =
    stringOrNull(valueAt(value, tableKeyName(MEMORY_CONSOLIDATION_KEY))) ??
    stringOrNull(valueAt(value, tableKeyName(MEMORY_EXTRACT_KEY)));
  return { now };
}

/** 顶层键的值；「表名.键名」是那张表里的键。 */
function valueAt(value: Record<string, unknown>, name: string): unknown {
  const tableKey = TABLE_KEYS.find((candidate) => tableKeyName(candidate) === name);
  if (!tableKey) return value[name];
  const table = value[tableKey.table];
  if (!isRecord(table)) return undefined;
  return table[tableKey.key];
}

/**
 * 把文件里现在的 model 记作 Codex 的（held 说是跟过去的还是保留当前设置留下的）：重写不碰。
 * 文件读不懂或没记过 model 时原样返回。
 */
export function keepCodexCliModel(input: {
  text: string | null;
  takeover: CodexConfigTakeover | null;
  held: CliModelHold;
}): CodexConfigTakeover | null {
  const { takeover } = input;
  const record = takeover?.keys.model;
  if (!takeover || !record) return takeover;
  const value = parsedTopLevel(input.text);
  if (value === null) return takeover;
  const model = { ...record, written: stringOrNull(value.model), held: input.held };
  return { ...takeover, keys: { ...takeover.keys, model } };
}

/**
 * Codex 把 model_reasoning_effort 删掉（选了模型自己的默认）后跟过去：关开关时也不放回接管前的档位，文件照现在的样子（magpie 同样不放回）。
 */
export function forgetCodexEffortOriginal(takeover: CodexConfigTakeover): CodexConfigTakeover {
  const record = takeover.keys.model_reasoning_effort;
  if (!record) return takeover;
  const absent: CodexOriginalValue = { present: false };
  const forgotten = { ...record, original: absent };
  return { ...takeover, keys: { ...takeover.keys, model_reasoning_effort: forgotten } };
}

/**
 * Codex 启动时读进来、Osuna 替它写的那部分（magpie startsWith）：顶层的服务商、模型、目录、地址与思考档位，
 * 和 Osuna 的服务商表；读不懂时是整份文本，改了什么都算改过。拿来比较，不用来读值。
 */
export function readCodexStartupReads(text: string | null): string {
  const top = parsedTopLevel(text);
  if (top === null) return text ?? "";
  const tables = top.model_providers;
  const table = isRecord(tables) ? tables[CODEX_API_ENDPOINT_PROVIDER_ID] : undefined;
  return JSON.stringify({
    model_provider: top.model_provider,
    model: top.model,
    model_catalog_json: top.model_catalog_json,
    openai_base_url: top.openai_base_url,
    model_reasoning_effort: top.model_reasoning_effort,
    table,
  });
}

/** 顶层的值；文件不存在为空表，读不懂为 null。 */
function parsedTopLevel(text: string | null): Record<string, unknown> | null {
  if (text === null) return {};
  const parsed = parseConfig(splitBom(text)[1]);
  return parsed.kind === "unparsable" ? null : parsed.value;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** 接管记录里这个键的写入值是否还在：null 是拿掉了，文件里就不该有它。 */
function holdsWritten(value: unknown, written: string | null): boolean {
  return written === null ? value === undefined : value === written;
}

function putBack(
  text: string,
  key: TopLevelKey,
  original: CodexOriginalValue,
  eol: string,
): string {
  return original.present
    ? setTopLevelValue({ text, key, raw: original.raw, eol })
    : removeTopLevelKey(text, key);
}

/** 一个 TOML 值原文（含引号）代表的字符串；负责的键在解析时已保证是字符串。 */
function readRaw(raw: string): string {
  const value: unknown = getStaticTOMLValue(parse(`v = ${raw}`));
  if (!isRecord(value) || typeof value.v !== "string") {
    throw new Error("An owned config.toml key does not hold a string");
  }
  return value.v;
}

/** 切回官方：把顶层负责的键恢复成接管前的写法，专用表留着。 */
export function restoreCodexOfficial(input: {
  text: string | null;
  takeover: CodexConfigTakeover;
}): CodexConfigRestoreResult {
  if (input.text === null) return { kind: "missing" };
  const [bom, original] = splitBom(input.text);
  const parsed = parseConfig(original);
  if (parsed.kind === "unparsable") return parsed;

  const eol = detectEol(original);
  let text = original;
  for (const key of TOP_LEVEL_KEYS) {
    const record = input.takeover.keys[key];
    if (record) text = putBack(text, key, record.original, eol);
  }
  for (const tableKey of TABLE_KEYS) {
    const record = input.takeover.keys[tableKeyName(tableKey)];
    if (record) text = putBackInTable({ text, tableKey, original: record.original, eol });
  }
  for (const table of input.takeover.createdTables ?? []) text = removeEmptyTable(text, table);
  text = giveMirrors({ text, mirrors: input.takeover.mirrors ?? {}, eol });
  // 文件是 Osuna 建的：顶层键拿掉后专用表前面的空行也是当初补的。
  if (input.takeover.fileCreated) text = text.replace(/^(?:\r?\n)+/, "");
  const failure = verify(text, () => true);
  if (failure) return failure;
  if (text === "" && input.takeover.fileCreated) return { kind: "delete" };
  return { kind: "patched", text: text === "" ? "" : bom + text };
}

/**
 * 官方模式下留着的专用表改指现在的中转站地址与口令，放到文件末尾；旧版本（v0.15）留下的 auth.command 表一并换掉。
 * 文件里没有这张表就什么都不写。
 */
export function refreshCodexProviderTable(input: {
  text: string | null;
  table: CodexProviderTableRecord;
}): CodexProviderTableRefreshResult {
  if (input.text === null) return { kind: "absent" };
  const [bom, original] = splitBom(input.text);
  const parsed = parseConfig(original);
  if (parsed.kind === "unparsable") return parsed;
  if (!hasProviderTable(parsed.program)) return { kind: "absent" };
  if (holdsProviderTable(parsed.value, input.table)) return { kind: "patched", text: input.text };
  // COMPAT(codexLegacyProviderTable): added after v0.15.0, remove after 2027-04-14.
  // 连同 v0.15 留下的 [model_providers.osuna_api_endpoint.auth] 子表一起拿掉，换成指向中转站的表。
  const text = appendProviderTable({
    text: removeProviderTables(original),
    table: input.table,
    eol: detectEol(original),
  });
  const failure = verify(text, (value) => holdsProviderTable(value, input.table));
  return failure ?? { kind: "patched", text: bom + text };
}

export interface CodexProfileOverride {
  profile: string;
  // 这个 profile 覆盖掉的负责的顶层键。
  keys: TopLevelKey[];
}

export type CodexConfigInspection =
  | {
      kind: "parsed";
      // 不再是上次写入值的负责键，专用表内容不对时记为 model_providers.<id>；没有接管记录时为空。
      modifiedKeys: string[];
      profileOverride: CodexProfileOverride | null;
      // 当前生效的 provider 指向的地址：官方模式下用来提示 CLI 自身配置指向哪里。
      baseUrl: string | null;
    }
  | Unparsable;

/** 顶层的 model_reasoning_effort（Codex 新会话的推理档位）；没设、不是字符串或文件读不出为 null。 */
export function readCodexReasoningEffort(text: string | null): string | null {
  if (text === null) return null;
  const parsed = parseConfig(splitBom(text)[1]);
  if (parsed.kind === "unparsable") return null;
  const effort = parsed.value.model_reasoning_effort;
  return typeof effort === "string" ? effort : null;
}

/** 顶层的 model（Codex 新会话的模型）；没设、不是字符串或文件读不出为 null。 */
export function readCodexModel(text: string | null): string | null {
  if (text === null) return null;
  const parsed = parseConfig(splitBom(text)[1]);
  if (parsed.kind === "unparsable") return null;
  const model = parsed.value.model;
  return typeof model === "string" ? model : null;
}

/** 用 ChatGPT 登录时 Codex 的模型是否归它自己（顶层服务商没写、是 openai 或 CC Switch 的镜像）；文件读不出按归它自己算。 */
export function codexKeepsOwnModel(text: string | null): boolean {
  if (text === null) return true;
  const parsed = parseConfig(splitBom(text)[1]);
  if (parsed.kind === "unparsable") return true;
  return keepsOwnModel({ value: parsed.value, providerId: parsed.value.model_provider });
}

/** 顶层的 model_catalog_json；没设、不是字符串或文件读不出为 null。 */
export function readCodexCatalogPath(text: string | null): string | null {
  if (text === null) return null;
  const parsed = parseConfig(splitBom(text)[1]);
  if (parsed.kind === "unparsable") return null;
  const catalogPath = parsed.value.model_catalog_json;
  return typeof catalogPath === "string" ? catalogPath : null;
}

/** Codex 自己的 multi_agent_v2：开着、没开，或文件读不懂（不当作没开）。 */
export type CodexMultiAgentV2 = { kind: "on" } | { kind: "off" } | Unparsable;

/**
 * config.toml 有没有明确打开 Codex 自己的 multi_agent_v2（它盖过模型条目的 multi_agent_version，
 * codex-rs core/src/config/mod.rs multi_agent_version_override）：`[features]` 下的 `multi_agent_v2 = true`，
 * 或 `[features.multi_agent_v2]` 里的 `enabled = true`，表、内联、点号三种写法都认；旧式顶层 `profile` 选中的
 * `[profiles.<name>.features]` 写了的盖过顶层（Codex 0.133 的做法，同 magpie）。只读不写，没有文件算没开。
 */
export function readCodexMultiAgentV2(text: string | null): CodexMultiAgentV2 {
  if (text === null) return { kind: "off" };
  let value: unknown;
  try {
    value = getStaticTOMLValue(parse(splitBom(text)[1]));
  } catch (error) {
    return { kind: "unparsable", message: errorMessage(error) };
  }
  if (!isRecord(value)) return { kind: "unparsable", message: "config.toml is not a table" };
  let found = multiAgentV2In(value.features);
  const inProfile = multiAgentV2In(selectedProfileFeatures(value));
  if (inProfile !== "unset") found = inProfile;
  if (found === "on") return { kind: "on" };
  return { kind: "off" };
}

/**
 * config.toml 的 `[features] respect_system_proxy` 是不是 true（magpie codexProxyFor 读的同一项）：
 * 开着时 Codex 只问系统要代理。没文件、读不懂（另有 config_unparsable 提示）都按没开。
 */
export function readCodexRespectsSystemProxy(text: string | null): boolean {
  if (text === null) return false;
  const parsed = parseConfig(splitBom(text)[1]);
  if (parsed.kind === "unparsable") return false;
  const { features } = parsed.value;
  return isRecord(features) && features.respect_system_proxy === true;
}

/** 旧式顶层 `profile` 选中的 `[profiles.<name>.features]`；没选或没有为 undefined。 */
function selectedProfileFeatures(value: Record<string, unknown>): unknown {
  const profileName = value.profile;
  const isSelected = typeof profileName === "string" && profileName !== "";
  if (!isSelected || !isRecord(value.profiles)) return undefined;
  const profile = value.profiles[profileName];
  if (!isRecord(profile)) return undefined;
  return profile.features;
}

/** 一张 [features] 表里的 multi_agent_v2；不是布尔值、表里没写 enabled 的都算没写（Codex 自己会拒绝这样的文件）。 */
function multiAgentV2In(features: unknown): "on" | "off" | "unset" {
  if (!isRecord(features)) return "unset";
  const flag = features.multi_agent_v2;
  let enabled: unknown = flag;
  if (isRecord(flag)) enabled = flag.enabled;
  if (typeof enabled !== "boolean") return "unset";
  if (enabled) return "on";
  return "off";
}

/**
 * 读真实文件判断健康状态。`takeover` 与 `table` 是启用中的接口上次写入的内容，官方模式下都为 null。
 * profile 只认 Codex 0.118–0.133 的旧写法：顶层 `profile` 选中 `[profiles.<name>]`，覆盖顶层键。
 * 0.134 起顶层 `profile` 直接报错，profile 改成 `<name>.config.toml`、只能用命令行 `--profile` 选，
 * 文件里查不到；Osuna 启动 app-server 不带 `--profile`，自己的会话不受影响。
 */
export function inspectCodexConfig(input: {
  text: string | null;
  takeover: CodexConfigTakeover | null;
}): CodexConfigInspection {
  let value: Record<string, unknown> = {};
  if (input.text !== null) {
    const parsed = parseConfig(splitBom(input.text)[1]);
    if (parsed.kind === "unparsable") return parsed;
    value = parsed.value;
  }

  const modifiedKeys = modifiedOwnedKeys(value, input.takeover);

  const profile = typeof value.profile === "string" ? value.profile : null;
  const profiles = isRecord(value.profiles) ? value.profiles : {};
  const selected = profile ? profiles[profile] : undefined;
  const profileTable = isRecord(selected) ? selected : {};
  // 接管时查这次负责的键（ChatGPT 登录含 openai_base_url），官方模式下查服务商接法那三个。
  const checkedKeys = input.takeover
    ? TOP_LEVEL_KEYS.filter((key) => input.takeover?.keys[key] !== undefined)
    : PROVIDER_KEYS;
  const overriddenKeys = checkedKeys.filter((key) => profileTable[key] !== undefined);
  const profileOverride =
    profile && overriddenKeys.length > 0 ? { profile, keys: overriddenKeys } : null;

  return {
    kind: "parsed",
    modifiedKeys,
    profileOverride,
    baseUrl: effectiveBaseUrl(value, profileTable),
  };
}

/** 不再是上次写入值的负责的键；没有接管记录时为空。 */
function modifiedOwnedKeys(
  value: Record<string, unknown>,
  takeover: CodexConfigTakeover | null,
): string[] {
  const modifiedKeys: string[] = [];
  for (const key of TOP_LEVEL_KEYS) {
    const record = takeover?.keys[key];
    if (FOLLOWED_KEYS.has(key)) continue;
    if (record && !holdsWritten(value[key], record.written)) modifiedKeys.push(key);
  }
  for (const tableKey of TABLE_KEYS) {
    const name = tableKeyName(tableKey);
    const record = takeover?.keys[name];
    if (FOLLOWED_TABLE_KEYS.has(name)) continue;
    if (record && !holdsWritten(valueAt(value, name), record.written)) modifiedKeys.push(name);
  }
  const table = takeover?.table;
  if (table && !holdsProviderTable(value, table)) {
    modifiedKeys.push(`model_providers.${CODEX_API_ENDPOINT_PROVIDER_ID}`);
  }
  for (const [id, record] of Object.entries(takeover?.mirrors ?? {})) {
    if (mirrorBaseUrl(value, id) !== record.written) modifiedKeys.push(mirrorKey(id));
  }
  return modifiedKeys;
}

/** 生效的 provider：profile 优先于顶层，缺省是内置 openai，它的地址由 openai_base_url 覆盖。 */
function effectiveBaseUrl(
  value: Record<string, unknown>,
  profileTable: Record<string, unknown>,
): string | null {
  const providerId = profileTable.model_provider ?? value.model_provider ?? "openai";
  const providers = value.model_providers;
  const table =
    isRecord(providers) && typeof providerId === "string" ? providers[providerId] : undefined;
  let baseUrl: unknown;
  if (providerId === "openai") {
    baseUrl = value.openai_base_url;
  } else if (isRecord(table)) {
    baseUrl = table.base_url;
  }
  return typeof baseUrl === "string" && baseUrl.trim() !== "" ? baseUrl.trim() : null;
}

type ParseResult =
  | { kind: "parsed"; program: AST.TOMLProgram; value: Record<string, unknown> }
  | Unparsable;

/** 解析器不认 BOM：先摘下来，改完再放回去。 */
function splitBom(text: string): [string, string] {
  return text.startsWith(BOM) ? [BOM, text.slice(BOM.length)] : ["", text];
}

function parse(text: string): AST.TOMLProgram {
  return parseTOML(text, { tomlVersion: TOML_VERSION });
}

function parseConfig(text: string): ParseResult {
  let program: AST.TOMLProgram;
  try {
    program = parse(text);
  } catch (error) {
    return { kind: "unparsable", message: errorMessage(error) };
  }
  const value: unknown = getStaticTOMLValue(program);
  if (!isRecord(value)) {
    return { kind: "unparsable", message: "config.toml is not a table" };
  }
  for (const key of TOP_LEVEL_KEYS) {
    if (value[key] !== undefined && typeof value[key] !== "string") {
      return { kind: "unparsable", message: `"${key}" in config.toml is not a string` };
    }
  }
  if (value.model_providers !== undefined && !isRecord(value.model_providers)) {
    return { kind: "unparsable", message: '"model_providers" in config.toml is not a table' };
  }
  return { kind: "parsed", program, value };
}

/** 拼出来的文本必须仍是合法 TOML 且真的写进去了；做不到（例如内联表没法追加子表）就整个拒绝。 */
function verify(
  text: string,
  holds: (value: Record<string, unknown>) => boolean,
): Unparsable | null {
  const unsafe = "config.toml is laid out in a way Osuna can't edit safely";
  let value: unknown;
  try {
    value = getStaticTOMLValue(parse(text));
  } catch (error) {
    return { kind: "unparsable", message: `${unsafe}: ${errorMessage(error)}` };
  }
  return isRecord(value) && holds(value) ? null : { kind: "unparsable", message: unsafe };
}

/** 专用表整张都归 Osuna：每个写入的字段都要和这次写的一致。 */
function holdsProviderTable(
  value: Record<string, unknown>,
  table: CodexProviderTableRecord,
): boolean {
  const providers = value.model_providers;
  const written = isRecord(providers) ? providers[CODEX_API_ENDPOINT_PROVIDER_ID] : undefined;
  return (
    isRecord(written) &&
    written.name === PROVIDER_TABLE_NAME &&
    written.base_url === table.baseUrl &&
    written.wire_api === "responses" &&
    written.experimental_bearer_token === table.bearerToken
  );
}

function findTopLevelKeyValue(program: AST.TOMLProgram, key: string): AST.TOMLKeyValue | null {
  for (const node of program.body[0].body) {
    if (node.type !== "TOMLKeyValue") continue;
    const [only, ...rest] = node.key.keys;
    if (only && rest.length === 0 && keyName(only) === key) return node;
  }
  return null;
}

function keyName(node: AST.TOMLBare | AST.TOMLQuoted): string {
  return node.type === "TOMLBare" ? node.name : node.value;
}

/** 有这个键就只换值那一段；没有就新起一行，插在最后一个顶层键后面，没有顶层键就放在文件开头。 */
function setTopLevelValue(input: {
  text: string;
  key: TopLevelKey;
  raw: string;
  eol: string;
}): string {
  const { text, key, raw, eol } = input;
  const program = parse(text);
  const existing = findTopLevelKeyValue(program, key);
  if (existing) {
    const [start, end] = existing.value.range;
    return text.slice(0, start) + raw + text.slice(end);
  }
  const line = `${key} = ${raw}`;
  const lastKeyValue = program.body[0].body.findLast((node) => node.type === "TOMLKeyValue");
  if (!lastKeyValue) return line + eol + text;
  const lineEnd = findLineEnd(text, lastKeyValue.range[1]);
  return text.slice(0, lineEnd) + eol + line + text.slice(lineEnd);
}

function removeTopLevelKey(text: string, key: TopLevelKey): string {
  const node = findTopLevelKeyValue(parse(text), key);
  return node ? removeLine(text, node) : text;
}

/** 拿掉一个键值所在的整行。 */
function removeLine(text: string, node: AST.TOMLKeyValue): string {
  const start = findLineStart(text, node.range[0]);
  const lineEnd = findLineEnd(text, node.range[1]);
  // 最后一行没有换行符：拿掉的是它前面那个换行。
  if (lineEnd === text.length) {
    const previous = start > 0 ? start - (text[start - 2] === "\r" ? 2 : 1) : 0;
    return text.slice(0, previous);
  }
  return text.slice(0, start) + text.slice(skipEol(text, lineEnd));
}

/** 用自己的 [model_providers.<id>] 表头写的表；没有（内联表、点号键或干脆没有）为 null。 */
function findOwnTable(program: AST.TOMLProgram, providerId: string): AST.TOMLTable | null {
  const table = program.body[0].body.find(
    (node): node is AST.TOMLTable =>
      node.type === "TOMLTable" &&
      node.kind === "standard" &&
      node.resolvedKey.length === 2 &&
      node.resolvedKey[0] === "model_providers" &&
      node.resolvedKey[1] === providerId,
  );
  return table ?? null;
}

function findTableKeyValue(input: {
  program: AST.TOMLProgram;
  providerId: string;
  key: string;
}): AST.TOMLKeyValue | null {
  const { program, providerId, key } = input;
  for (const node of findOwnTable(program, providerId)?.body ?? []) {
    const [only, ...rest] = node.key.keys;
    if (only && rest.length === 0 && keyName(only) === key) return node;
  }
  return null;
}

/** 表里有 base_url 就只换值那一段；没有就新起一行，插在表的最后一个键后面（空表放在表头下面）。 */
function setTableValue(input: { text: string; id: string; raw: string; eol: string }): string {
  const { text, id, raw, eol } = input;
  const program = parse(text);
  const existing = findTableKeyValue({ program, providerId: id, key: "base_url" });
  if (existing) {
    const [start, end] = existing.value.range;
    return text.slice(0, start) + raw + text.slice(end);
  }
  const table = findOwnTable(program, id);
  if (!table) return text;
  const after = table.body.at(-1)?.range[1] ?? table.range[0];
  const lineEnd = findLineEnd(text, after);
  return `${text.slice(0, lineEnd)}${eol}base_url = ${raw}${text.slice(lineEnd)}`;
}

function removeTableKey(text: string, id: string): string {
  const node = findTableKeyValue({ program: parse(text), providerId: id, key: "base_url" });
  return node ? removeLine(text, node) : text;
}

/** 用自己的 [name] 表头写的一层表；没有（内联表、点号键或干脆没有）为 null。 */
function findNamedTable(program: AST.TOMLProgram, name: string): AST.TOMLTable | null {
  const table = program.body[0].body.find(
    (node): node is AST.TOMLTable =>
      node.type === "TOMLTable" &&
      node.kind === "standard" &&
      node.resolvedKey.length === 1 &&
      node.resolvedKey[0] === name,
  );
  return table ?? null;
}

function findKeyInTable(table: AST.TOMLTable | null, key: string): AST.TOMLKeyValue | null {
  for (const node of table?.body ?? []) {
    const [only, ...rest] = node.key.keys;
    if (only && rest.length === 0 && keyName(only) === key) return node;
  }
  return null;
}

/**
 * 表里有这个键就只换值那一段；没有就新起一行，接在表的最后一个键后面（空表放在表头下面）；没有这张表就在末尾加一张。
 * 表写成内联表或点号键时加出来的表会重复定义，verify 整个拒绝。
 */
function setTableKeyValue(input: {
  text: string;
  tableKey: TableKey;
  raw: string;
  eol: string;
}): string {
  const { text, tableKey, raw, eol } = input;
  const line = `${tableKey.key} = ${raw}`;
  const table = findNamedTable(parse(text), tableKey.table);
  if (!table) {
    const block = `[${tableKey.table}]${eol}${line}${eol}`;
    if (text === "") return block;
    // 文件末尾没有换行时先补上，再空一行。
    if (!text.endsWith("\n")) return text + eol + eol + block;
    return text + eol + block;
  }
  const existing = findKeyInTable(table, tableKey.key);
  if (existing) {
    const [start, end] = existing.value.range;
    return text.slice(0, start) + raw + text.slice(end);
  }
  const after = table.body.at(-1)?.range[1] ?? table.range[0];
  const lineEnd = findLineEnd(text, after);
  return `${text.slice(0, lineEnd)}${eol}${line}${text.slice(lineEnd)}`;
}

/** 表里什么都不剩时连表头与后面的空行一起拿掉；还有键就不动。 */
function removeEmptyTable(text: string, name: string): string {
  const table = findNamedTable(parse(text), name);
  if (!table || table.body.length > 0) return text;
  const start = findLineStart(text, table.range[0]);
  let end = skipEol(text, findLineEnd(text, table.range[1]));
  while (end < text.length && isBlankLine(text, end)) end = skipEol(text, findLineEnd(text, end));
  return text.slice(0, start) + text.slice(end);
}

function providerTables(program: AST.TOMLProgram): AST.TOMLTable[] {
  return program.body[0].body.filter(
    (node): node is AST.TOMLTable =>
      node.type === "TOMLTable" &&
      node.resolvedKey[0] === "model_providers" &&
      node.resolvedKey[1] === CODEX_API_ENDPOINT_PROVIDER_ID,
  );
}

function hasProviderTable(program: AST.TOMLProgram): boolean {
  return providerTables(program).length > 0;
}

function removeProviderTables(text: string): string {
  const tables = providerTables(parse(text));
  if (tables.length === 0) return text;

  let result = text;
  let reachedEnd = false;
  // 从后往前删，前面的位置不受影响。每张表连同紧跟着的空行一起拿掉。
  for (const table of tables.toReversed()) {
    const start = findLineStart(result, table.range[0]);
    let end = skipEol(result, findLineEnd(result, table.range[1]));
    while (end < result.length && isBlankLine(result, end)) {
      end = skipEol(result, findLineEnd(result, end));
    }
    reachedEnd ||= end === result.length;
    result = result.slice(0, start) + result.slice(end);
  }
  if (!reachedEnd) return result;
  // 专用表在末尾：追加时补的空行也收回去。原文件末尾本来就有多个空行时会收成一个。
  if (result.trim() === "") return "";
  const trailing = /(?:\r?\n)+$/.exec(result);
  return trailing ? result.slice(0, trailing.index) + detectEol(text) : result;
}

function appendProviderTable(input: {
  text: string;
  table: CodexProviderTableRecord;
  eol: string;
}): string {
  const { text, table, eol } = input;
  // 口令明文：它不是用户的 key，只用来认出是 Codex，中转站只收本机回环来的请求（ADR 0010）。
  const block = [
    `[model_providers.${CODEX_API_ENDPOINT_PROVIDER_ID}]`,
    `name = ${tomlString(PROVIDER_TABLE_NAME)}`,
    `base_url = ${tomlString(table.baseUrl)}`,
    `wire_api = "responses"`,
    `experimental_bearer_token = ${tomlString(table.bearerToken)}`,
    "",
  ].join(eol);
  if (text === "") return block;
  const separator = text.endsWith("\n") ? eol : eol + eol;
  return text + separator + block;
}

/** TOML 基本字符串：JSON 的转义都合法，只差 DEL 必须转义。 */
function tomlString(value: string): string {
  return JSON.stringify(value).replaceAll("\u007f", "\\u007F");
}

function sliceNode(text: string, node: { range: [number, number] }): string {
  return text.slice(node.range[0], node.range[1]);
}

function findLineStart(text: string, offset: number): number {
  return text.lastIndexOf("\n", offset - 1) + 1;
}

/** 指向该行换行符（\r\n 的 \r）的位置；最后一行没有换行符时是文本末尾。 */
function findLineEnd(text: string, offset: number): number {
  const newline = text.indexOf("\n", offset);
  if (newline === -1) return text.length;
  return text[newline - 1] === "\r" ? newline - 1 : newline;
}

function skipEol(text: string, lineEnd: number): number {
  if (text.startsWith("\r\n", lineEnd)) return lineEnd + 2;
  if (text[lineEnd] === "\n") return lineEnd + 1;
  return lineEnd;
}

function isBlankLine(text: string, lineStart: number): boolean {
  return text.slice(lineStart, findLineEnd(text, lineStart)).trim() === "";
}

function detectEol(text: string): string {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
