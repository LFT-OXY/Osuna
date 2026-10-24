// providers.osuna 里用户自己加的键照留、关开关时别处还用着 osuna/ 就留下服务商、enabledModels 的认法、旧 models.json 的迁移
// 移植自 magpie（https://github.com/yetone/magpie，internal/agent/omp.go 的 ompKept、ompLevel、ompRefKeys 与 dropMagpie，
// internal/agent/omp_scope.go 的 ompTakes，internal/edit/yaml.go 的 JSONToYAML）。
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { parse as parseJsonc, printParseErrorCode, type ParseError } from "jsonc-parser";
import { isDeepStrictEqual } from "node:util";
import {
  isMap,
  isScalar,
  isSeq,
  parseDocument,
  Document,
  Scalar,
  stringify,
  type ToStringOptions,
  type YAMLSeq,
} from "yaml";
import type { CliPicks } from "./cli-model-hold.js";
import { mergeEdits } from "./line-merge.js";
import type { OriginalFile, OriginalValue } from "./jsonc-edit.js";
import type { OmpModelEntry } from "./omp-model-entries.js";
import {
  holds,
  isGlob,
  isRecord,
  isScopeList,
  mergeTheirs,
  namesOsunaModel,
  PI_PROVIDER_ID,
  piTakes,
  placeScope,
  unplaceScope,
  type PiConfigInspection,
  type PiConfigPatchResult,
  type PiConfigRestoreResult,
  type PiConfigUnparsable,
  type PiFileState,
  type PiGatewayAddress,
  type PiModelsTakeover,
  type PiScopePlacement,
  type PiSettingsApplyInput,
  type PiSettingsFile,
  type PiSettingsKeepInput,
  type PiSettingsTakeover,
  type PiStartupFiles,
} from "./pi-config-patch.js";

/*
 * OMP 的 models.yml 与 config.yml 补丁（ADR 0004、0012；任务 10-16-pi-omp-endpoints 工单 04）：按 YAML 节点改，
 * 注释、列表的 flow / block 写法与用户的其他键留着。接管记录与 Pi 的同形（PiModelsTakeover、PiSettingsTakeover）。
 *
 * 负责的键：
 * - models.yml 的 providers.osuna：中转站 /v1、openai-completions、OMP 的中转站口令、auth: apiKey（不写的话 OMP 把自定义的
 *   Anthropic 服务商当 OAuth）、compat.promptCacheSessionHeader 与模型清单。地址、格式、auth、口令与模型清单归 Osuna，
 *   用户在这一项里写的别的键（modelOverrides、discovery、disableStrictTools、remoteCompaction、请求头、compat）留着。
 *   不写 User-Agent：中转站凭口令认 OMP。
 * - config.yml 的 modelRoles.default（osuna/<模型>，原来带「:档位」的换了模型也带着，照 magpie）、设了才写的
 *   defaultThinkingLevel，enabledModels 同 Pi（已有清单时把默认模型挪到最前，关掉时挪回）。
 * 关开关时 config.yml 里别的角色、fallback 链、task.agentModelOverrides 或按目录的 enabledModels 还用着 osuna/，
 * 服务商留在 models.yml（照 magpie 的 dropMagpie）。
 */

export const OMP_ROLE_KEY = "modelRoles.default";
const ROLES = "modelRoles";
const ROLE_PATH = [ROLES, "default"];
const THINKING_KEY = "defaultThinkingLevel";
const SCOPE_KEY = "enabledModels";
const PROVIDER_PATH = ["providers", PI_PROVIDER_ID];
// 这几项变了 OMP 的请求就不再经过中转站。
const ROUTING_FIELDS = ["baseUrl", "apiKey", "api"] as const;
// 这几项归 Osuna：文件里原有的换成 Osuna 的（magpie ompKept 的 own）。
const OWN_FIELDS = new Set(["baseUrl", "api", "auth", "apiKey", "models"]);
// config.yml 里会写模型的地方（magpie ompRefKeys）。
const REF_KEYS = [["modelRoles"], ["retry", "fallbackChains"], ["task", "agentModelOverrides"]];
// OMP 从条目末尾读的档位（magpie ompLevel）：几档 effort、off 与 auto。
const OMP_LEVELS = new Set(["off", "auto", "minimal", "low", "medium", "high", "xhigh", "max"]);

/** Osuna 写进 models.yml 的 providers.osuna。 */
export interface OmpProviderBlock {
  baseUrl: string;
  api: "openai-completions";
  auth: "apiKey";
  apiKey: string;
  compat: { promptCacheSessionHeader: "x-session-affinity" };
  models: OmpModelEntry[];
}

export interface OmpModelsApplyInput {
  // null 为文件不存在。
  text: string | null;
  block: OmpProviderBlock;
  takeover: PiModelsTakeover | null;
}

export interface OmpModelsRestoreInput {
  text: string | null;
  takeover: PiModelsTakeover;
  // 关开关后 config.yml 的内容：别处还用着 osuna/ 时服务商留着。
  configAfter: string | null;
}

export type OmpMigration = { kind: "migrated"; text: string } | PiConfigUnparsable;

/** 只有旧的 models.json：照 OMP 自己的迁移（config-file.ts migrateJsonToYml）按 JSONC 读、写成 YAML。 */
export function migrateOmpModelsJson(jsonText: string): OmpMigration {
  const errors: ParseError[] = [];
  const value: unknown = parseJsonc(jsonText, errors, { allowTrailingComma: true });
  const [firstError] = errors;
  if (firstError) {
    const before = jsonText.slice(0, firstError.offset).split("\n");
    const line = before.length;
    const column = (before.at(-1)?.length ?? 0) + 1;
    return {
      kind: "unparsable",
      message: `${printParseErrorCode(firstError.error)} at line ${line}, column ${column} of models.json`,
      reason: { code: "syntax", line, column },
    };
  }
  if (!isRecord(value)) return rootNotObject("models.json");
  return { kind: "migrated", text: stringify(value, { lineWidth: 0 }) };
}

/** 把 providers.osuna 写进 models.yml；`takeover` 为 null 是首次接管。 */
export function applyOmpModels(input: OmpModelsApplyInput): PiConfigPatchResult<PiModelsTakeover> {
  const opened = openModels(input.text);
  if (opened.kind === "unparsable") return opened;
  const { doc, providers } = opened;
  const existing = providers?.[PI_PROVIDER_ID];
  const written = keptBlock({ existing, block: input.block });
  setBlock({ doc, existing, written });
  return {
    kind: "patched",
    text: render(opened),
    takeover: {
      originalFile: input.takeover?.originalFile ?? classifyYamlOriginal(input.text),
      provider: {
        original: input.takeover?.provider.original ?? originalValue(providers, PI_PROVIDER_ID),
        written,
      },
      providersCreated: input.takeover?.providersCreated ?? providers === undefined,
    },
  };
}

/**
 * 关掉时的 models.yml：config.yml 里别处还用着 osuna/ 就不动（magpie dropMagpie）；否则 providers.osuna 放回接管前的值，
 * 为它新建的 providers 空了就删掉。
 */
export function restoreOmpModels(input: OmpModelsRestoreInput): PiConfigRestoreResult {
  if (input.text === null) return { kind: "missing" };
  const opened = openModels(input.text);
  if (opened.kind === "unparsable") return opened;
  if (ompConfigUsesOsuna(input.configAfter)) return { kind: "kept" };
  const { doc } = opened;
  restoreValue(doc, PROVIDER_PATH, input.takeover.provider.original);
  const providers: unknown = doc.getIn(["providers"]);
  if (input.takeover.providersCreated && isMap(providers) && providers.items.length === 0) {
    doc.deleteIn(["providers"]);
  }
  return finishedRestore({ opened, originalFile: input.takeover.originalFile });
}

/** providers.osuna 的地址、口令或格式不再是 Osuna 写的（或整项没了）即算被外部改过。 */
export function inspectOmpModels(input: PiFileState<PiModelsTakeover | null>): PiConfigInspection {
  const opened = openModels(input.text);
  if (opened.kind === "unparsable") return opened;
  if (!input.takeover) return { kind: "parsed", modifiedKeys: [] };
  const block = opened.providers?.[PI_PROVIDER_ID];
  const { written } = input.takeover.provider;
  const isChanged =
    !isRecord(block) || ROUTING_FIELDS.some((field) => block[field] !== written[field]);
  return { kind: "parsed", modifiedKeys: isChanged ? [PROVIDER_PATH.join(".")] : [] };
}

/** models.yml 里 providers.osuna 现在写的地址与口令；没有或读不懂为 null。 */
export function readOmpGateway(text: string | null): PiGatewayAddress | null {
  const opened = openModels(text);
  if (opened.kind === "unparsable") return null;
  const block = opened.providers?.[PI_PROVIDER_ID];
  if (!isRecord(block)) return null;
  const { baseUrl, apiKey } = block;
  if (typeof baseUrl !== "string" || typeof apiKey !== "string") return null;
  return { baseUrl, apiKey };
}

/**
 * 把默认设置写进 config.yml：modelRoles.default（OMP 里换过、记作它的就不碰），设了的默认思考档位，
 * 以及 enabledModels 里把默认模型挪到最前（没有清单不新建）。
 */
export function applyOmpConfig(
  input: PiSettingsApplyInput,
): PiConfigPatchResult<PiSettingsTakeover> {
  const opened = openConfig(input.text);
  if (opened.kind === "unparsable") return opened;
  const { doc, root } = opened;
  const { wiring, takeover } = input;
  const isRoleHeld =
    takeover !== null &&
    input.shouldRewriteModel !== true &&
    (takeover.modelHeld !== undefined || isRoleChanged(root, takeover));
  const keys: PiSettingsTakeover["keys"] = {};
  if (isRoleHeld) {
    const record = takeover.keys[OMP_ROLE_KEY];
    if (record) keys[OMP_ROLE_KEY] = record;
  } else {
    writeRole({ doc, root, keys, takeover, model: wiring.model });
  }
  const rolesRecord = takeover?.keys[ROLES];
  if (rolesRecord) keys[ROLES] = rolesRecord;
  else if (root[ROLES] === undefined) keys[ROLES] = { original: { present: false }, written: null };
  writeThinking({ doc, root, keys, takeover, thinking: wiring.thinking });
  const placed = placeOmpScope({ doc, takeover });
  const modelHeld = isRoleHeld ? takeover.modelHeld : undefined;
  return {
    kind: "patched",
    text: render(opened),
    takeover: {
      originalFile: takeover?.originalFile ?? classifyYamlOriginal(input.text),
      keys,
      ...(modelHeld === undefined ? {} : { modelHeld }),
      ...(placed === null ? {} : { scope: placed }),
      userOsunaEntries: takeover ? (takeover.userOsunaEntries ?? []) : osunaEntriesIn(root),
    },
  };
}

/**
 * 关掉时的 config.yml（照 Pi 的 restorePiSettings）：默认角色还在 Osuna 上或还是 Osuna 写的就放回原值；默认思考档位
 * 还是 Osuna 写的就放回；enabledModels 挪回原位、去掉 Osuna 加的 osuna/ 条目，删空了整个删掉。
 */
export function restoreOmpConfig(input: PiFileState<PiSettingsTakeover>): PiConfigRestoreResult {
  if (input.text === null) return { kind: "missing" };
  const opened = openConfig(input.text);
  if (opened.kind === "unparsable") return opened;
  const { doc, root } = opened;
  const { takeover } = input;
  const role = roleValue(root);
  const isOnOsuna = role !== null && isOsunaModel(role);
  const isOursStill = takeover.modelHeld === undefined && !isRoleChanged(root, takeover);
  const roleRecord = takeover.keys[OMP_ROLE_KEY];
  if (roleRecord && (isOnOsuna || isOursStill)) restoreValue(doc, ROLE_PATH, roleRecord.original);
  const rolesNode: unknown = doc.getIn([ROLES]);
  if (takeover.keys[ROLES] && isMap(rolesNode) && rolesNode.items.length === 0) {
    doc.deleteIn([ROLES]);
  }
  const thinking = takeover.keys[THINKING_KEY];
  if (thinking && holds(root[THINKING_KEY], thinking.written)) {
    restoreValue(doc, [THINKING_KEY], thinking.original);
  }
  unplaceOmpScope({ doc, takeover });
  return finishedRestore({ opened, originalFile: takeover.originalFile });
}

/** 默认角色不再是 Osuna 记下的写入值（默认思考档位与 enabledModels 是 OMP 自己会存的，不算）。 */
export function inspectOmpConfig(
  input: PiFileState<PiSettingsTakeover | null>,
): PiConfigInspection {
  const opened = openConfig(input.text);
  if (opened.kind === "unparsable") return opened;
  const isChanged = input.takeover !== null && isRoleChanged(opened.root, input.takeover);
  return { kind: "parsed", modifiedKeys: isChanged ? [OMP_ROLE_KEY] : [] };
}

/**
 * OMP 自己存下、与 Osuna 记下的写入值不同的选择：model 是 OMP 新会话实际用的「服务商/模型」（不带档位；enabledModels 不收它时
 * 是清单里第一个能用的），level 是 defaultThinkingLevel。没有接管记录或读不懂为 null。
 */
export function readOmpCliPicks(input: PiSettingsFile): CliPicks | null {
  const { takeover } = input;
  if (!takeover) return null;
  const opened = openConfig(input.text);
  if (opened.kind === "unparsable") return null;
  const { root } = opened;
  const ref = roleModel(root);
  const startup = ompStartup(root);
  const isChanged = isRoleChanged(root, takeover) || startup !== ref;
  const model = isChanged ? { now: startup, isKept: takeover.modelHeld === "kept" } : null;
  const level = root[THINKING_KEY];
  return {
    model,
    level: typeof level === "string" && level !== "" ? level : null,
    isUltraCodeOn: null,
    subagent: null,
    subagentLevel: null,
    memory: null,
  };
}

/** 把文件里现在的默认角色记作 OMP 的：重写不碰。读不懂时原样返回。 */
export function keepOmpCliModel(input: PiSettingsKeepInput): PiSettingsTakeover | null {
  const { takeover } = input;
  if (!takeover) return takeover;
  const opened = openConfig(input.text);
  if (opened.kind === "unparsable") return takeover;
  const keys = { ...takeover.keys };
  const record = keys[OMP_ROLE_KEY];
  if (record) keys[OMP_ROLE_KEY] = { ...record, written: roleRaw(opened.root) };
  return { ...takeover, keys, modelHeld: input.held };
}

/** OMP 启动时读进来、Osuna 替它写的那部分：config.yml 的默认角色、默认思考档位与 enabledModels，models.yml 里 Osuna 的服务商。 */
export function readOmpStartupReads(input: PiStartupFiles): string {
  const config = openConfig(input.settingsText);
  const models = openModels(input.modelsText);
  const configPart =
    config.kind === "unparsable"
      ? (input.settingsText ?? "")
      : [roleRaw(config.root), config.root[THINKING_KEY], config.root[SCOPE_KEY]];
  const modelsPart =
    models.kind === "unparsable" ? (input.modelsText ?? "") : models.providers?.[PI_PROVIDER_ID];
  return JSON.stringify({ settings: configPart, provider: modelsPart });
}

/**
 * OMP 新会话的默认模型，同 Pi 的 readPiModel 的写法：Osuna 的模型只是模型（接口模型的 id），别的是「服务商/模型」；
 * 去掉末尾的「:档位」。没设、是一串备选或读不懂为 null。
 */
export function readOmpModel(text: string | null): string | null {
  const opened = openConfig(text);
  if (opened.kind === "unparsable") return null;
  const model = roleModel(opened.root);
  if (model === null || !isOsunaModel(model)) return model;
  return model.slice(PI_PROVIDER_ID.length + 1);
}

/** 默认角色在 Osuna 的模型上。 */
export function isOmpDefaultOnOsuna(text: string | null): boolean {
  const opened = openConfig(text);
  if (opened.kind === "unparsable") return false;
  const model = roleModel(opened.root);
  return model !== null && isOsunaModel(model);
}

/**
 * config.yml 里还有地方用着 Osuna 的模型（magpie dropMagpie）：各个角色、fallback 链、task.agentModelOverrides，
 * 或按目录的 enabledModels。只是 enabledModels 里平铺的 osuna/ 条目不算，它们跟着服务商一起走。读不懂按用着算，不删服务商。
 */
export function ompConfigUsesOsuna(text: string | null): boolean {
  const opened = openConfig(text);
  if (opened.kind === "unparsable") return true;
  const { root } = opened;
  const values: unknown[] = REF_KEYS.map((path) => valueAt(root, path));
  const scope = root[SCOPE_KEY];
  if (Array.isArray(scope)) values.push(...scope.filter(isRecord));
  return values.some((value) => namesOsunaIn(value));
}

function namesOsunaIn(value: unknown): boolean {
  if (typeof value === "string") {
    return value.split(",").some((part) => isOsunaModel(withoutOmpLevel(part.trim())));
  }
  if (Array.isArray(value)) return value.some((item) => namesOsunaIn(item));
  if (isRecord(value)) return Object.values(value).some((item) => namesOsunaIn(item));
  return false;
}

function valueAt(root: Record<string, unknown>, path: readonly string[]): unknown {
  let value: unknown = root;
  for (const key of path) {
    if (!isRecord(value)) return undefined;
    value = value[key];
  }
  return value;
}

function isOsunaModel(model: string): boolean {
  return model.startsWith(`${PI_PROVIDER_ID}/`);
}

/** 去掉条目末尾 OMP 认的「:档位」（含 auto）；一串备选（带逗号）原样。 */
function withoutOmpLevel(value: string): string {
  if (value.includes(",")) return value;
  const at = value.lastIndexOf(":");
  if (at <= 0) return value;
  return OMP_LEVELS.has(value.slice(at + 1)) ? value.slice(0, at) : value;
}

/** 末尾的「:档位」（带冒号）；没有为空串。 */
function ompLevelSuffix(value: string): string {
  const model = withoutOmpLevel(value);
  return value.slice(model.length);
}

/** OMP 的 enabledModels 条目指着 ref（magpie ompTakes）：先去掉 OMP 的档位，末尾的 ** 收下它下面的一切，其余同 Pi。 */
function ompTakes(pattern: string, ref: string): boolean {
  const bare = withoutOmpLevel(pattern.trim());
  if (bare.endsWith("**")) {
    const base = bare.slice(0, -2);
    if (!isGlob(base) && (base === "" || base.endsWith("/"))) {
      return ref.toLowerCase().startsWith(base.toLowerCase());
    }
  }
  return piTakes(bare, ref);
}

function roleRaw(root: Record<string, unknown>): string | null {
  const value = valueAt(root, ROLE_PATH);
  return typeof value === "string" ? value : null;
}

function roleValue(root: Record<string, unknown>): string | null {
  const raw = roleRaw(root);
  return raw === null || raw.includes(",") ? null : raw;
}

/** 默认角色的模型（不带档位）；没设或是一串备选为 null。 */
function roleModel(root: Record<string, unknown>): string | null {
  const value = roleValue(root);
  if (value === null) return null;
  const model = withoutOmpLevel(value.trim());
  return model === "" ? null : model;
}

function isRoleChanged(root: Record<string, unknown>, takeover: PiSettingsTakeover): boolean {
  const record = takeover.keys[OMP_ROLE_KEY];
  if (record === undefined) return false;
  const now = valueAt(root, ROLE_PATH);
  return !holds(now, record.written);
}

/** OMP 新会话用的模型：默认角色在 enabledModels 平铺的条目里（或没有这样的条目）就是它，否则是清单里第一个具体的模型。 */
function ompStartup(root: Record<string, unknown>): string | null {
  const ref = roleModel(root);
  const plain = plainEntries(root[SCOPE_KEY]);
  if (ref === null || plain.length === 0) return ref;
  if (plain.some((pattern) => ompTakes(pattern, ref))) return ref;
  const first = withoutOmpLevel((plain[0] ?? "").trim());
  if (isGlob(first) || !first.includes("/")) return ref;
  return first;
}

function plainEntries(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function osunaEntriesIn(root: Record<string, unknown>): string[] {
  return plainEntries(root[SCOPE_KEY]).filter(namesOsunaModel);
}

interface RoleWrite {
  doc: Document;
  root: Record<string, unknown>;
  keys: PiSettingsTakeover["keys"];
  takeover: PiSettingsTakeover | null;
  model: string;
}

/** modelRoles.default 写成 osuna/<模型>；原来的值带「:档位」、换的是别的模型时档位跟着（magpie role 的 Set）。 */
function writeRole(input: RoleWrite): void {
  const { doc, root, keys, takeover } = input;
  const ref = `${PI_PROVIDER_ID}/${input.model}`;
  const current = roleValue(root);
  let value = ref;
  if (current !== null) {
    const level = ompLevelSuffix(current.trim());
    if (level !== "" && withoutOmpLevel(current.trim()) !== ref) value = `${ref}${level}`;
  }
  const original = takeover?.keys[OMP_ROLE_KEY]?.original ?? originalValue(roles(root), "default");
  keys[OMP_ROLE_KEY] = { original, written: value };
  if (!isMap(doc.getIn([ROLES]))) doc.setIn([ROLES], doc.createNode({}));
  setValue(doc, ROLE_PATH, value);
}

function roles(root: Record<string, unknown>): Record<string, unknown> | undefined {
  const value = root[ROLES];
  return isRecord(value) ? value : undefined;
}

interface ThinkingWrite {
  doc: Document;
  root: Record<string, unknown>;
  keys: PiSettingsTakeover["keys"];
  takeover: PiSettingsTakeover | null;
  thinking: string | null;
}

/** 设了就写；不再设时 Osuna 写的放回原值，用户在 OMP 里改过的留着。 */
function writeThinking(input: ThinkingWrite): void {
  const { doc, root, keys, takeover, thinking } = input;
  const record = takeover?.keys[THINKING_KEY];
  if (thinking !== null) {
    const original = record?.original ?? originalValue(root, THINKING_KEY);
    keys[THINKING_KEY] = { original, written: thinking };
    setValue(doc, [THINKING_KEY], thinking);
    return;
  }
  if (record && holds(root[THINKING_KEY], record.written)) {
    restoreValue(doc, [THINKING_KEY], record.original);
  }
}

// 清单里不是字符串的条目（按目录的 {path, models}）在挪动时的占位：不含「/」，什么模型都不指。
const ITEM_PLACEHOLDER = "\u0000item:";

interface ScopeItems {
  seq: YAMLSeq;
  // 每一项的字符串；不是字符串的项换成占位。
  list: string[];
}

function readScopeItems(doc: Document): ScopeItems | null {
  const seq: unknown = doc.getIn([SCOPE_KEY]);
  if (!isSeq(seq)) return null;
  const list = seq.items.map((item, index) => {
    const value = isScalar(item) ? item.value : undefined;
    return typeof value === "string" ? value : `${ITEM_PLACEHOLDER}${index}`;
  });
  return { seq, list };
}

/** 按新的字符串清单重排序列：原有的项（连同注释与写法）按值挪过去，新的另建。 */
function writeScopeItems(items: ScopeItems, next: readonly string[]): void {
  const pool = [...items.seq.items];
  const taken = new Set<number>();
  items.seq.items = next.map((value) => {
    const at = items.list.findIndex((candidate, index) => candidate === value && !taken.has(index));
    if (at < 0) return new Scalar(value);
    taken.add(at);
    return pool[at];
  });
}

/** 改 enabledModels 时的文档与接管记录。 */
interface ScopeEdit<Takeover> {
  doc: Document;
  takeover: Takeover;
}

function placeOmpScope(input: ScopeEdit<PiSettingsTakeover | null>): PiScopePlacement | null {
  const items = readScopeItems(input.doc);
  // 只有按目录的条目时，别的目录不受它管，不碰（magpie 只认平铺的条目）。
  if (items === null || !items.list.some((entry) => !entry.startsWith(ITEM_PLACEHOLDER))) {
    return null;
  }
  const role = input.doc.getIn(ROLE_PATH);
  const front =
    typeof role === "string" && !role.includes(",") && isOsunaModel(withoutOmpLevel(role.trim()))
      ? withoutOmpLevel(role.trim())
      : null;
  const placed = placeScope({
    value: items.list,
    previous: input.takeover?.scope ?? null,
    front,
    takes: ompTakes,
  });
  if (placed.list !== null && !isDeepStrictEqual(placed.list, items.list)) {
    writeScopeItems(items, placed.list);
  }
  return placed.scope;
}

function unplaceOmpScope(input: ScopeEdit<PiSettingsTakeover>): void {
  const items = readScopeItems(input.doc);
  if (items === null || !isScopeList(items.list)) return;
  const users = input.takeover.userOsunaEntries ?? [];
  const kept = unplaceScope(items.list, input.takeover.scope ?? null).filter(
    (pattern) => !namesOsunaModel(pattern) || users.includes(pattern),
  );
  if (kept.length === 0) input.doc.deleteIn([SCOPE_KEY]);
  else if (!isDeepStrictEqual(kept, items.list)) writeScopeItems(items, kept);
}

/** Osuna 要写的整项并上文件里这一项已有的：归 Osuna 的键用 Osuna 的，用户加的留着，两边都是对象的往下并。 */
interface KeptBlockInput {
  // 文件里 providers.osuna 现在的值。
  existing: unknown;
  block: OmpProviderBlock;
}

function keptBlock(input: KeptBlockInput): Record<string, unknown> {
  const ours: Record<string, unknown> = structuredClone({ ...input.block });
  if (!isRecord(input.existing)) return ours;
  const theirs = Object.fromEntries(
    Object.entries(input.existing).filter(([key]) => !OWN_FIELDS.has(key)),
  );
  return mergeTheirs({ have: theirs, want: ours, whole: ["models"] });
}

/** 写进整项：已有这一项时只换变了的键，用户键上的注释留着。 */
interface BlockWrite {
  doc: Document;
  existing: unknown;
  written: Record<string, unknown>;
}

function setBlock(input: BlockWrite): void {
  const { doc, existing, written } = input;
  // providers 写成了空值（`providers:`）时先换成空映射，才放得进 osuna。
  if (!isMap(doc.getIn(["providers"]))) doc.setIn(["providers"], doc.createNode({}));
  if (!isRecord(existing)) {
    doc.setIn(PROVIDER_PATH, doc.createNode(written));
    return;
  }
  for (const [key, value] of Object.entries(written)) {
    if (!isDeepStrictEqual(existing[key], value)) setValue(doc, [...PROVIDER_PATH, key], value);
  }
  for (const key of Object.keys(existing)) {
    if (!Object.hasOwn(written, key)) doc.deleteIn([...PROVIDER_PATH, key]);
  }
}

interface OpenedYaml {
  kind: "parsed";
  doc: Document;
  root: Record<string, unknown>;
  // 文件原文（不存在时为空串），写回时没改到的行照它。
  source: string;
  format: ToStringOptions;
}

type OpenResult = OpenedYaml | PiConfigUnparsable;

function openYaml(text: string | null, name: string): OpenResult {
  const source = text ?? "";
  const doc: Document = parseDocument(source);
  const [error] = doc.errors;
  if (error) {
    const position = error.linePos?.[0];
    const line = position?.line ?? 1;
    const column = position?.col ?? 1;
    return {
      kind: "unparsable",
      message: `${error.code} at line ${line}, column ${column} of ${name}`,
      reason: { code: "syntax", line, column },
    };
  }
  const value: unknown = doc.toJS();
  if (value === null || value === undefined) {
    // 空文件（或只有注释）从一个空映射开始写，注释留着。
    const empty = new Document({});
    empty.commentBefore = doc.commentBefore;
    empty.comment = doc.comment;
    return { kind: "parsed", doc: empty, root: {}, source: "", format: formatOf(source) };
  }
  if (!isRecord(value)) return rootNotObject(name);
  return { kind: "parsed", doc, root: value, source, format: formatOf(source) };
}

function openConfig(text: string | null): OpenResult {
  const opened = openYaml(text, "config.yml");
  if (opened.kind === "unparsable") return opened;
  const value = opened.root[ROLES];
  if (value !== undefined && value !== null && !isRecord(value)) {
    return keyNotObject("config.yml", ROLES);
  }
  return opened;
}

type OpenedModels =
  | (OpenedYaml & { providers: Record<string, unknown> | undefined })
  | PiConfigUnparsable;

function openModels(text: string | null): OpenedModels {
  const opened = openYaml(text, "models.yml");
  if (opened.kind === "unparsable") return opened;
  const { providers } = opened.root;
  if (providers === undefined || providers === null) return { ...opened, providers: undefined };
  if (!isRecord(providers)) return keyNotObject("models.yml", "providers");
  return { ...opened, providers };
}

/** 照文件自己的缩进与「- 」相对上一级键的缩进写回；长字符串不折行，flow 列表不加内侧空格。 */
function formatOf(text: string): ToStringOptions {
  const indent = /^( +)\S/m.exec(text)?.[1]?.length ?? 2;
  const seqUnder =
    /^( *)[^\s#-][^\n]*:[ \t]*(?:#[^\n]*)?\r?\n(?:[ \t]*(?:#[^\n]*)?\r?\n)*( *)- /m.exec(text);
  const indentSeq = seqUnder ? (seqUnder[2]?.length ?? 0) > (seqUnder[1]?.length ?? 0) : true;
  return { lineWidth: 0, flowCollectionPadding: false, indent, indentSeq };
}

/** 改完的文档写回成文字：没改到的行用原文（line-merge.ts）。 */
function render(opened: OpenedYaml): string {
  const edited = opened.doc.toString(opened.format);
  if (opened.source === "") return edited;
  const base = parseDocument(opened.source).toString(opened.format);
  return mergeEdits({ original: opened.source, base, edited });
}

/** 写一个值：原来是标量就只换它的值，同一行的注释与引号写法留着。 */
function setValue(doc: Document, path: readonly string[], value: unknown): void {
  const node: unknown = doc.getIn(path, true);
  const isPlain = value === null || ["string", "number", "boolean"].includes(typeof value);
  if (isScalar(node) && isPlain) {
    node.value = value;
    return;
  }
  doc.setIn(path, doc.createNode(value));
}

function classifyYamlOriginal(text: string | null): OriginalFile {
  if (text === null) return { kind: "absent" };
  if (text.trim() === "") return { kind: "empty", text };
  const doc = parseDocument(text);
  const value: unknown = doc.errors.length > 0 ? null : doc.toJS();
  const isEmpty =
    value === null || value === undefined || (isRecord(value) && Object.keys(value).length === 0);
  return isEmpty ? { kind: "empty", text } : { kind: "content" };
}

interface FinishedRestoreInput {
  opened: OpenedYaml;
  originalFile: OriginalFile;
}

function finishedRestore(input: FinishedRestoreInput): PiConfigRestoreResult {
  const { opened, originalFile } = input;
  const value: unknown = opened.doc.toJS();
  const isEmpty = !isRecord(value) || Object.keys(value).length === 0;
  if (isEmpty && originalFile.kind === "absent") return { kind: "delete" };
  if (isEmpty && originalFile.kind === "empty") return { kind: "patched", text: originalFile.text };
  return { kind: "patched", text: render(opened) };
}

function originalValue(container: Record<string, unknown> | undefined, key: string): OriginalValue {
  return container !== undefined && Object.hasOwn(container, key)
    ? { present: true, value: container[key] }
    : { present: false };
}

function restoreValue(doc: Document, path: string[], original: OriginalValue): void {
  if (original.present) setValue(doc, path, original.value);
  else doc.deleteIn(path);
}

function rootNotObject(name: string): PiConfigUnparsable {
  return {
    kind: "unparsable",
    message: `${name} is not a mapping`,
    reason: { code: "root_not_object" },
  };
}

function keyNotObject(name: string, key: string): PiConfigUnparsable {
  return {
    kind: "unparsable",
    message: `"${key}" in ${name} is not a mapping`,
    reason: { code: "key_not_object", key },
  };
}
