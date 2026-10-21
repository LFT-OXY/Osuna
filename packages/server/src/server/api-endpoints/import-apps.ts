// 从别的软件导入（Import）照 magpie（https://github.com/yetone/magpie，7597c132）的 internal/provider/importapps.go、
// import_codex.go、import_opencode.go 与 internal/gui/importapps.go 的指纹。
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。
import { createHmac } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { parse as parseJsonc, type ParseError } from "jsonc-parser";
import { z } from "zod";
import {
  API_ENDPOINT_REQUEST_FORMATS,
  type ApiEndpointImportSkipReason,
  type ApiEndpointImportSourceErrorCode,
  type ApiEndpointImportStatus,
  type ApiEndpointRequestFormat,
} from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { cleanRequestHeaders } from "@getpaseo/protocol/api-endpoint/request-extras";
import { isErrnoException } from "../../utils/errno.js";
import {
  AZURE_TEMPLATE_ID,
  API_ENDPOINT_TEMPLATES,
  findTemplate,
  isAzureHost,
} from "./templates.js";

/*
 * 别的软件里已经配好的中转服务：每个来源只读打开、从不写（数据库用 node:sqlite 的只读模式；SQLite 读时会加共享锁，
 * WAL 模式的库可能碰到 -wal/-shm 文件），
 * 每条换算成 Osuna 会加的那家，再和已有的接口对照，导入窗口据此说哪些是新的、已添加、名称已被占用、同一家 key 不同。
 * key 原文只在 daemon 里，客户端拿到的是打码的 key 和指纹。
 */

export const IMPORT_SOURCE_IDS = ["alma", "cc-switch", "claude-code", "codex", "opencode"] as const;
export type ImportSourceId = (typeof IMPORT_SOURCE_IDS)[number];

const SOURCE_NAMES: Record<ImportSourceId, string> = {
  alma: "Alma",
  "cc-switch": "CC Switch",
  "claude-code": "Claude Code",
  codex: "Codex",
  opencode: "OpenCode",
};

/** 读不了这条的原因（照 magpie 的 Skip 文案，换成代码；清单在 protocol）。 */
export type ImportSkipReason = ApiEndpointImportSkipReason;

/** 默认不选的原因（magpie 的 Off）。 */
export type ImportOffReason = "turned_off";

export type ImportStatus = ApiEndpointImportStatus;

export interface ImportBaseUrl {
  format: ApiEndpointRequestFormat;
  url: string;
}

/** 一条能导入的，照 Osuna 会加的那家：key 原文只在 daemon 里。 */
export interface FoundEndpoint {
  name: string;
  key: string | null;
  baseUrls: ImportBaseUrl[];
  models: string[];
  headers: Record<string, string> | null;
  templateId: string | null;
  region: string | null;
}

export interface ImportEntry {
  ref: string;
  // 在那个软件里的哪儿：Claude Code、Codex、settings.json……
  from: string | null;
  name: string;
  found: FoundEndpoint | null;
  skip: ImportSkipReason | null;
  off: ImportOffReason | null;
}

/** 来源读不了的原因：code 加 params（unreadable 带 errno，no_sqlite 带 Node 版本），message 是同一件事的英文。 */
export interface ImportSourceError {
  code: ApiEndpointImportSourceErrorCode;
  params?: Record<string, string>;
  message: string;
}

export interface ImportSourceRead {
  id: ImportSourceId;
  name: string;
  path: string;
  found: boolean;
  error: ImportSourceError | null;
  entries: ImportEntry[];
}

export interface ImportSourcePaths {
  // CC Switch 的目录：有 cc-switch.db 读它，没有读 config.json。
  ccSwitchDir: string;
  claudeSettings: string;
  codexConfig: string;
  almaDatabase: string;
  openCodeAuth: string;
}

export interface ImportReadContext {
  paths: ImportSourcePaths;
  homeDir: string;
  // 指向 Osuna 中转站的地址：导进来会绕回自己。
  isGatewayUrl: (url: URL) => boolean;
  // Osuna 接管 Claude Code 时 ADR 0004 记下的原值（env 的键 → 原值）；没接管为 null。
  claudeOriginalEnv: () => Record<string, string> | null;
  // Osuna 写给 Codex 的模型目录：不当成用户的。
  osunaCodexCatalog: string;
}

/** 缺省路径（照 magpie）：Alma 在系统的配置目录，OpenCode 在 XDG 数据目录。 */
export function defaultImportSourcePaths(input: {
  homeDir: string;
  env: NodeJS.ProcessEnv;
  claudeSettings: string;
  codexConfig: string;
}): ImportSourcePaths {
  const { homeDir, env } = input;
  return {
    ccSwitchDir: path.join(homeDir, ".cc-switch"),
    claudeSettings: input.claudeSettings,
    codexConfig: input.codexConfig,
    almaDatabase: path.join(userConfigDir({ homeDir, env }), "alma", "chat_threads.db"),
    openCodeAuth: openCodeAuthPath({ homeDir, env }),
  };
}

/** Go 的 os.UserConfigDir。 */
function userConfigDir(input: { homeDir: string; env: NodeJS.ProcessEnv }): string {
  if (process.platform === "darwin")
    return path.join(input.homeDir, "Library", "Application Support");
  if (process.platform === "win32") {
    return input.env.APPDATA ?? path.join(input.homeDir, "AppData", "Roaming");
  }
  return input.env.XDG_CONFIG_HOME || path.join(input.homeDir, ".config");
}

function openCodeAuthPath(input: { homeDir: string; env: NodeJS.ProcessEnv }): string {
  const dataHome = input.env.XDG_DATA_HOME;
  if (dataHome) return path.join(dataHome, "opencode", "auth.json");
  return path.join(input.homeDir, ".local", "share", "opencode", "auth.json");
}

function ccSwitchPath(dir: string): string {
  const db = path.join(dir, "cc-switch.db");
  if (fileExists(db)) return db;
  const json = path.join(dir, "config.json");
  if (fileExists(json)) return json;
  return db;
}

function fileExists(filePath: string): boolean {
  try {
    statSync(filePath);
    return true;
  } catch (error) {
    if (isErrnoException(error)) return false;
    throw error;
  }
}

/** 这个来源读不了：只记在它自己身上，别的来源照常。 */
class SourceReadError extends Error {
  readonly reason: ImportSourceError;

  constructor(reason: ImportSourceError) {
    super(reason.message);
    this.name = "SourceReadError";
    this.reason = reason;
  }
}

interface SourceReader {
  id: ImportSourceId;
  path: (paths: ImportSourcePaths) => string;
  read: (filePath: string, context: ImportReadContext) => ImportEntry[];
  // 只在打开导入窗口时读：OpenCode 的 auth.json 存着它所有的登录，不只是 key。
  askedOnly: boolean;
}

const READERS: readonly SourceReader[] = [
  { id: "alma", path: (paths) => paths.almaDatabase, read: readAlma, askedOnly: false },
  {
    id: "cc-switch",
    path: (paths) => ccSwitchPath(paths.ccSwitchDir),
    read: readCcSwitch,
    askedOnly: false,
  },
  {
    id: "claude-code",
    path: (paths) => paths.claudeSettings,
    read: readClaudeSettings,
    askedOnly: false,
  },
  { id: "codex", path: (paths) => paths.codexConfig, read: readCodexConfig, askedOnly: false },
  { id: "opencode", path: (paths) => paths.openCodeAuth, read: readOpenCodeAuth, askedOnly: true },
];

/** 读每个来源；includeOpenCode 为 false 时不碰 OpenCode。一个来源读不了只记在它自己身上。 */
export function readImportSources(input: {
  context: ImportReadContext;
  includeOpenCode: boolean;
}): ImportSourceRead[] {
  const out: ImportSourceRead[] = [];
  for (const reader of READERS) {
    if (reader.askedOnly && !input.includeOpenCode) continue;
    const filePath = reader.path(input.context.paths);
    const source: ImportSourceRead = {
      id: reader.id,
      name: SOURCE_NAMES[reader.id],
      path: filePath,
      found: false,
      error: null,
      entries: [],
    };
    const there = statOf(filePath);
    if (there.kind === "missing") {
      out.push(source);
      continue;
    }
    source.found = true;
    if (there.kind === "unreadable") {
      // 在那儿、却看不了：不是「没找到」，那会说这个软件什么都没有。
      source.error = there.error;
      out.push(source);
      continue;
    }
    try {
      source.entries = reader.read(filePath, input.context);
    } catch (error) {
      source.error = sourceError(error);
    }
    out.push(source);
  }
  return out;
}

function statOf(
  filePath: string,
): { kind: "there" } | { kind: "missing" } | { kind: "unreadable"; error: ImportSourceError } {
  try {
    statSync(filePath);
    return { kind: "there" };
  } catch (error) {
    if (!isErrnoException(error)) throw error;
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return { kind: "missing" };
    return { kind: "unreadable", error: unreadableError(error) };
  }
}

function unreadableError(error: NodeJS.ErrnoException): ImportSourceError {
  return { code: "unreadable", params: { errno: error.code ?? "" }, message: error.message };
}

function sourceError(error: unknown): ImportSourceError {
  if (error instanceof SourceReadError) return error.reason;
  if (isErrnoException(error) && !isSqliteError(error)) return unreadableError(error);
  throw error;
}

// ---- 换算成 Osuna 的一家 ---------------------------------------------------

interface FormatUrls {
  chat: string;
  responses: string;
  anthropic: string;
}

const NO_URLS: FormatUrls = { chat: "", responses: "", anthropic: "" };

function formatUrlsOf(urls: FormatUrls): ImportBaseUrl[] {
  const byFormat: Record<ApiEndpointRequestFormat, string> = {
    anthropic_messages: urls.anthropic,
    openai_chat: urls.chat,
    openai_responses: urls.responses,
  };
  return API_ENDPOINT_REQUEST_FORMATS.flatMap((format) =>
    byFormat[format] === "" ? [] : [{ format, url: byFormat[format] }],
  );
}

function cleanBase(raw: string): string {
  let url = raw.trim().replace(/\/+$/, "");
  if (url !== "" && !url.includes("://")) url = `https://${url}`;
  return url;
}

function hostOf(raw: string): string {
  if (!URL.canParse(raw)) return "";
  return new URL(raw).host.toLowerCase();
}

type Imported =
  | { kind: "found"; found: FoundEndpoint }
  | { kind: "skip"; reason: ImportSkipReason };

/**
 * 一条换算成要加的那家（magpie imported）：地址是某个模板自己的，就是那个模板的（全部地址、区域或套餐）；
 * 只是同一主机上的别的路径，按「自定义」。没有 key 的只有本机地址与不要 key 的模板能加。
 */
function imported(input: {
  name: string;
  key: string;
  urls: FormatUrls;
  models: string[];
  context: ImportReadContext;
}): Imported {
  const urls: FormatUrls = {
    chat: cleanBase(input.urls.chat),
    responses: cleanBase(input.urls.responses),
    anthropic: cleanBase(input.urls.anthropic),
  };
  const problem = urlProblem({ urls, context: input.context });
  if (problem !== null) return { kind: "skip", reason: problem };
  if (urls.chat === "" && urls.responses === "" && urls.anthropic === "") {
    return { kind: "skip", reason: "no_base_url" };
  }
  const found: FoundEndpoint = {
    name: input.name,
    key: input.key === "" ? null : input.key,
    baseUrls: formatUrlsOf(urls),
    models: cleanList(input.models),
    headers: null,
    templateId: null,
    region: null,
  };
  placeAtTemplate({ found, urls, givenName: input.name });
  if (found.name === "") found.name = hostOf(found.baseUrls[0]?.url ?? "");
  if (found.key === null && !isKeyOptional(found)) return { kind: "skip", reason: "no_api_key" };
  return { kind: "found", found };
}

/** 地址读不懂、不是 http(s)、主机不像个主机名，或指向 Osuna 中转站自己（magpie gatewayURL）。 */
function urlProblem(input: {
  urls: FormatUrls;
  context: ImportReadContext;
}): ImportSkipReason | null {
  const { urls } = input;
  for (const raw of [urls.chat, urls.responses, urls.anthropic]) {
    if (raw === "") continue;
    if (!URL.canParse(raw)) return "invalid_base_url";
    const url = new URL(raw);
    const isHttp = url.protocol === "http:" || url.protocol === "https:";
    const isNamedHost = url.host.includes(".") || url.host.startsWith("localhost");
    if (!isHttp || !isNamedHost) return "invalid_base_url";
    if (input.context.isGatewayUrl(url)) return "points_at_osuna";
  }
  return null;
}

/**
 * Azure 资源的地址按 Azure 模板；正是某个模板自己的地址就用那个模板（全部地址、区域或套餐），名称没起或叫 default 时用模板的名字；
 * 只在模板的主机上就记下模板、地址照原样。
 */
function placeAtTemplate(input: {
  found: FoundEndpoint;
  urls: FormatUrls;
  givenName: string;
}): void {
  const { found } = input;
  const isAzure = found.baseUrls.some(({ url }) => isAzureHost(hostOf(url)));
  if (isAzure) {
    found.templateId = AZURE_TEMPLATE_ID;
    return;
  }
  const match = templateAt(input.urls);
  if (match === null) return;
  if (match.kind === "near") {
    // 同一主机上的别的路径（如编程套餐）：模板的图标与模型资料（在区域的主机上用那个区域的）照用，地址照原样
    // （magpie 的 ID、Icon、Catalog）。
    found.templateId = match.templateId;
    found.region = match.region;
    return;
  }
  const preset = match.place;
  found.templateId = preset.templateId;
  found.region = preset.region;
  found.baseUrls = preset.baseUrls;
  const lower = input.givenName.toLowerCase();
  if (lower === "" || lower === "default") found.name = preset.name;
}

function isKeyOptional(found: FoundEndpoint): boolean {
  if (found.templateId !== null && findTemplate(found.templateId)?.keyOptional === true)
    return true;
  const host = hostOf(found.baseUrls[0]?.url ?? "");
  return ["localhost", "127.0.0.1", "0.0.0.0"].some((prefix) => host.startsWith(prefix));
}

interface TemplatePlace {
  templateId: string;
  region: string | null;
  name: string;
  baseUrls: ImportBaseUrl[];
}

/**
 * 地址在哪个模板（或它的一个区域、套餐）的主机上，是不是正好是它那几个地址（magpie presetAt）。本机模板不算。
 */
/** 地址正好是模板（或它的区域、套餐）的：那个位置；只在它的主机上：模板与对上的区域（没有为 null）。 */
type TemplateMatch =
  | { kind: "exact"; place: TemplatePlace }
  | { kind: "near"; templateId: string; region: string | null };

function templateAt(urls: FormatUrls): TemplateMatch | null {
  const given: Record<ApiEndpointRequestFormat, string> = {
    anthropic_messages: urls.anthropic,
    openai_chat: urls.chat,
    openai_responses: urls.responses,
  };
  // 在不在这几个地址的主机上，是不是正好就是它们。
  const matchOf = (own: readonly ImportBaseUrl[]) => {
    const ownHosts = new Set(own.map(({ url }) => hostOf(url)));
    let hit = false;
    let exact = true;
    for (const format of API_ENDPOINT_REQUEST_FORMATS) {
      const url = given[format];
      if (url === "") continue;
      if (ownHosts.has(hostOf(url))) hit = true;
      const ownUrl = own.find((entry) => entry.format === format)?.url ?? "";
      if (ownUrl.toLowerCase() !== url.toLowerCase()) exact = false;
    }
    return { hit, exact: hit && exact };
  };
  // 正好是某个模板的地址的，胜过前面同一主机上的别的模板（magpie：OpenCode Zen 与 OpenCode Go 都在 opencode.ai）。
  let near: { templateId: string; region: string | null } | null = null;
  for (const template of API_ENDPOINT_TEMPLATES) {
    if (template.group === "local") continue;
    const own = template.baseUrls.flatMap(asImportBaseUrl);
    const match = own.length > 0 ? matchOf(own) : { hit: false, exact: false };
    if (match.exact) {
      return {
        kind: "exact",
        place: { templateId: template.id, region: null, name: template.name, baseUrls: own },
      };
    }
    // 模板自己的主机先算；不在它上面、在某个区域的主机上时记下那个区域（magpie 的 firstNear）。
    let nearRegion: string | null = null;
    for (const region of template.regions ?? []) {
      const regionOwn = region.baseUrls.flatMap(asImportBaseUrl);
      if (regionOwn.length === 0) continue;
      const regionMatch = matchOf(regionOwn);
      if (regionMatch.exact) {
        const place = {
          templateId: template.id,
          region: region.id,
          name: template.name,
          baseUrls: regionOwn,
        };
        return { kind: "exact", place };
      }
      if (regionMatch.hit && nearRegion === null) nearRegion = region.id;
    }
    if (near === null && match.hit) near = { templateId: template.id, region: null };
    else if (near === null && nearRegion !== null)
      near = { templateId: template.id, region: nearRegion };
  }
  return near === null ? null : { kind: "near", ...near };
}

function asImportBaseUrl(entry: { format: string; url: string }): ImportBaseUrl[] {
  const format = API_ENDPOINT_REQUEST_FORMATS.find((candidate) => candidate === entry.format);
  return format === undefined ? [] : [{ format, url: entry.url }];
}

function cleanList(models: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of models) {
    const model = raw.trim();
    if (model !== "" && !out.includes(model)) out.push(model);
  }
  return out;
}

function entryOf(input: {
  ref: string;
  from: string | null;
  name: string;
  result: Imported;
}): ImportEntry {
  if (input.result.kind === "skip") {
    return {
      ref: input.ref,
      from: input.from,
      name: input.name,
      found: null,
      skip: input.result.reason,
      off: null,
    };
  }
  return {
    ref: input.ref,
    from: input.from,
    name: input.result.found.name,
    found: input.result.found,
    skip: null,
    off: null,
  };
}

function skipped(input: {
  ref: string;
  from: string | null;
  name: string;
  reason: ImportSkipReason;
}): ImportEntry {
  return entryOf({ ...input, result: { kind: "skip", reason: input.reason } });
}

// ---- 宽松地取值 ------------------------------------------------------------

type Loose = Record<string, unknown>;

function mapOf(value: unknown): Loose {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value));
}

/** 第一个有内容的字符串值（magpie ccSwitchEntry 的 str）。 */
function textOf(map: Loose, ...keys: string[]): string {
  for (const key of keys) {
    const value = map[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return "";
}

function parseJsonText(input: { text: string; what: string }): unknown {
  const errors: ParseError[] = [];
  const value: unknown = parseJsonc(input.text.replace(/^﻿/, ""), errors, {
    allowTrailingComma: true,
  });
  if (errors.length > 0) {
    throw new SourceReadError({ code: "not_json", message: `${input.what} is not valid JSON` });
  }
  return value;
}

// ---- Claude Code -----------------------------------------------------------

/**
 * Claude Code 自己的 settings.json 指向的中转服务：env 里的地址与 token。Osuna 接管时那里写的是中转站，
 * 读 ADR 0004 记下的原值（magpie 读它的 stash）。
 */
function readClaudeSettings(filePath: string, context: ImportReadContext): ImportEntry[] {
  const settings = mapOf(
    parseJsonText({ text: readFileSync(filePath, "utf8"), what: "Claude Code's settings.json" }),
  );
  let env = mapOf(settings.env);
  const written = textOf(env, "ANTHROPIC_BASE_URL");
  if (written !== "") {
    const url = cleanBase(written);
    if (URL.canParse(url) && context.isGatewayUrl(new URL(url))) {
      env = context.claudeOriginalEnv() ?? {};
    }
  }
  const base = textOf(env, "ANTHROPIC_BASE_URL");
  // 没有地址：Anthropic 官方，CLI 自己的登录。
  if (base === "") return [];
  const entry = claudeEntry({ env, name: hostOf(cleanBase(base)) });
  return [
    entryOf({
      ref: "settings",
      from: "settings.json",
      name: hostOf(cleanBase(base)),
      result: entry.kind === "skip" ? entry : imported({ ...entry, context }),
    }),
  ];
}

interface ReadEntry {
  kind: "read";
  name: string;
  key: string;
  urls: FormatUrls;
  models: string[];
}

/** 软件里的一条读出来是什么：地址与 key，或读不了的原因。 */
type ReadOutcome = ReadEntry | { kind: "skip"; reason: ImportSkipReason };

const CLAUDE_MODEL_KEYS = [
  "ANTHROPIC_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "ANTHROPIC_SMALL_FAST_MODEL",
];

function claudeEntry(input: { env: Loose; name: string }): ReadOutcome {
  let base = textOf(input.env, "ANTHROPIC_BASE_URL");
  const key = textOf(input.env, "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY");
  if (base === "" && key === "") return { kind: "skip", reason: "sign_in" };
  if (base === "") base = "https://api.anthropic.com";
  const models = CLAUDE_MODEL_KEYS.map((name) => textOf(input.env, name)).filter((m) => m !== "");
  return { kind: "read", name: input.name, key, urls: { ...NO_URLS, anthropic: base }, models };
}

// ---- CC Switch -------------------------------------------------------------

// CC Switch 的软件类型，照导入窗口里的叫法。
const CC_SWITCH_APPS: Record<string, string> = {
  claude: "Claude Code",
  "claude-desktop": "Claude Desktop",
  codex: "Codex",
  gemini: "Gemini CLI",
  opencode: "OpenCode",
  openclaw: "OpenClaw",
  pi: "Pi",
  hermes: "Hermes",
};

interface CcEntry {
  id: string;
  app: string;
  name: string;
  settings: Loose;
}

const CcRowSchema = z.object({
  id: z.union([z.string(), z.number()]),
  app_type: z.string(),
  name: z.string().nullable(),
  settings_config: z.string().nullable(),
});

function readCcSwitch(filePath: string, context: ImportReadContext): ImportEntry[] {
  const entries = filePath.endsWith(".db")
    ? readCcSwitchDatabase(filePath)
    : readCcSwitchJson(filePath);
  const out: ImportEntry[] = [];
  for (const entry of entries) {
    const from = CC_SWITCH_APPS[entry.app] ?? entry.app;
    const ref = `${entry.app}/${entry.id}`;
    const read = ccSwitchEntry(entry);
    const result = read.kind === "skip" ? read : imported({ ...read, context });
    out.push(...merged(out, entryOf({ ref, from, name: entry.name.trim(), result })));
  }
  return out;
}

function readCcSwitchDatabase(filePath: string): CcEntry[] {
  const rows = queryReadOnly({
    filePath,
    what: "CC Switch's database",
    sql: `SELECT id, app_type, name, settings_config FROM providers ORDER BY app_type, COALESCE(sort_index, 0), created_at`,
  });
  return rows.flatMap((raw) => {
    const row = CcRowSchema.safeParse(raw);
    if (!row.success) return [];
    return [
      {
        id: String(row.data.id),
        app: row.data.app_type,
        name: row.data.name ?? "",
        settings: mapOf(looseJson(row.data.settings_config ?? "")),
      },
    ];
  });
}

/** CC Switch 有数据库之前：一个 config.json，每个软件一节。 */
function readCcSwitchJson(filePath: string): CcEntry[] {
  const config = mapOf(
    parseJsonText({ text: readFileSync(filePath, "utf8"), what: "CC Switch's config.json" }),
  );
  const entries: CcEntry[] = [];
  for (const [app, section] of Object.entries(config)) {
    for (const [id, raw] of Object.entries(mapOf(mapOf(section).providers))) {
      const provider = mapOf(raw);
      const name = typeof provider.name === "string" ? provider.name : "";
      entries.push({ id, app, name, settings: mapOf(provider.settingsConfig) });
    }
  }
  return entries.sort((a, b) => (a.app + a.id < b.app + b.id ? -1 : 1));
}

/** 读不懂当没有（magpie 的 json.Unmarshal 忽略错误）。 */
function looseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

/**
 * 同一个账号的两条合成一家（magpie merge）：同时给 Claude Code 和 Codex 配的中转服务是一家、两个格式的地址。
 */
function merged(have: ImportEntry[], entry: ImportEntry): ImportEntry[] {
  const found = entry.found;
  if (found === null) return [entry];
  for (const had of have) {
    const into = had.found;
    if (into === null || into.key === null || into.key !== found.key) continue;
    const sameHost = hostOf(into.baseUrls[0]?.url ?? "") === hostOf(found.baseUrls[0]?.url ?? "");
    if (!sameAccount({ have: into, found }) && !sameHost) continue;
    for (const baseUrl of found.baseUrls) {
      if (!into.baseUrls.some((held) => held.format === baseUrl.format))
        into.baseUrls.push(baseUrl);
    }
    into.baseUrls.sort(
      (a, b) =>
        API_ENDPOINT_REQUEST_FORMATS.indexOf(a.format) -
        API_ENDPOINT_REQUEST_FORMATS.indexOf(b.format),
    );
    into.models = cleanList([...into.models, ...found.models]);
    had.from = `${had.from ?? ""}, ${entry.from ?? ""}`;
    return [];
  }
  return [entry];
}

/** CC Switch 的一条：它的设置就是那个软件自己的配置，各软件不一样（magpie ccSwitchEntry）。 */
function ccSwitchEntry(entry: CcEntry): ReadOutcome {
  const { settings } = entry;
  const name = entry.name.trim();
  const env = mapOf(settings.env);
  switch (entry.app) {
    case "claude":
    case "claude-desktop":
      return claudeEntry({ env, name });
    case "codex":
      return codexSwitchEntry({ settings, name });
    case "gemini":
      // Osuna 还没有 Gemini 格式与 Google 模板（子任务 7）。
      if (textOf(env, "GEMINI_API_KEY", "GOOGLE_API_KEY") === "") {
        return { kind: "skip", reason: "sign_in" };
      }
      return { kind: "skip", reason: "gemini_unsupported" };
    default:
      return otherSwitchEntry({ settings, name });
  }
}

function codexSwitchEntry(input: { settings: Loose; name: string }): ReadOutcome {
  let key = textOf(mapOf(input.settings.auth), "OPENAI_API_KEY");
  const config = typeof input.settings.config === "string" ? input.settings.config : "";
  const { top, tables } = parseToml(config);
  const providerId = top.model_provider ?? "";
  const table =
    tables[`model_providers.${providerId}`] ?? tables[`model_providers."${providerId}"`] ?? {};
  let base = table.base_url ?? "";
  if (key === "") key = table.experimental_bearer_token ?? "";
  if (base === "" && key === "") return { kind: "skip", reason: "sign_in" };
  if (base === "") base = "https://api.openai.com/v1";
  const urls =
    table.wire_api === "chat" ? { ...NO_URLS, chat: base } : { ...NO_URLS, responses: base };
  const models = top.model ? [top.model] : [];
  return { kind: "read", name: input.name, key, urls, models };
}

/** OpenCode、OpenClaw、Pi……：地址与 key，格式由 api 或 npm 字段说。 */
function otherSwitchEntry(input: { settings: Loose; name: string }): ReadOutcome {
  const { settings } = input;
  const options = mapOf(settings.options);
  const base =
    textOf(settings, "baseUrl", "baseURL", "base_url") ||
    textOf(options, "baseURL", "baseUrl", "base_url");
  const key = textOf(settings, "apiKey", "api_key") || textOf(options, "apiKey", "api_key");
  if (base === "") return { kind: "skip", reason: "no_base_url" };
  const api = textOf(settings, "api", "npm", "type").toLowerCase();
  let urls: FormatUrls = { ...NO_URLS, chat: base };
  if (api.includes("anthropic")) urls = { ...NO_URLS, anthropic: base };
  else if (api.includes("responses")) urls = { ...NO_URLS, responses: base };
  const models: string[] = [];
  const listed = settings.models;
  if (Array.isArray(listed)) {
    for (const item of listed) {
      const id = typeof item === "string" ? item : textOf(mapOf(item), "id");
      if (id !== "") models.push(id);
    }
  } else {
    models.push(...Object.keys(mapOf(listed)).sort());
  }
  return { kind: "read", name: input.name, key, urls, models };
}

/** Codex 配置里的字符串值：顶层的键与每张表的键（magpie parseTOML，照它一样宽松）。 */
export function parseToml(text: string): {
  top: Record<string, string>;
  tables: Record<string, Record<string, string>>;
} {
  const top: Record<string, string> = {};
  const tables: Record<string, Record<string, string>> = {};
  let current = top;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    if (line.startsWith("[") && line.endsWith("]")) {
      const name = line.replace(/^\[+|\]+$/g, "").trim();
      current = {};
      tables[name] = current;
      continue;
    }
    const equals = line.indexOf("=");
    if (equals < 0) continue;
    let value = line.slice(equals + 1).trim();
    const comment = value.indexOf(" #");
    if (comment > 0 && !value.startsWith('"')) value = value.slice(0, comment).trim();
    const quote = value[0];
    if (value.length >= 2 && (quote === '"' || quote === "'")) {
      const end = value.lastIndexOf(quote);
      if (end > 0) value = value.slice(1, end);
    }
    const key = line
      .slice(0, equals)
      .trim()
      .replace(/^"+|"+$/g, "");
    current[key] = value;
  }
  return { top, tables };
}

// ---- Codex -----------------------------------------------------------------

function readCodexConfig(filePath: string, context: ImportReadContext): ImportEntry[] {
  const { top, tables } = parseToml(readFileSync(filePath, "utf8"));
  const ids: string[] = [];
  const profiles: string[] = [];
  for (const table of Object.keys(tables)) {
    const providerId = codexTableId(table, "model_providers.");
    if (providerId !== null) ids.push(providerId);
    else if (codexTableId(table, "profiles.") !== null) profiles.push(table);
  }
  ids.sort();
  profiles.sort();
  const out: ImportEntry[] = [];
  for (const providerId of ids) {
    let tableName = `model_providers.${providerId}`;
    let table = tables[tableName];
    if (table === undefined) {
      tableName = `model_providers."${providerId}"`;
      table = tables[tableName] ?? {};
    }
    const name = table.name || providerId;
    if (providerId === "osuna_api_endpoint") {
      out.push(skipped({ ref: providerId, from: "config.toml", name, reason: "points_at_osuna" }));
      continue;
    }
    const models = codexModelsOf({ providerId, top, tables, profiles, filePath, context });
    const base = table.base_url ?? "";
    const urls =
      table.wire_api === "chat" ? { ...NO_URLS, chat: base } : { ...NO_URLS, responses: base };
    const result = imported({
      name,
      key: table.experimental_bearer_token ?? "",
      urls,
      models,
      context,
    });
    if (result.kind === "found") {
      result.found.headers = cleanRequestHeaders(tables[`${tableName}.http_headers`]);
    }
    out.push(entryOf({ ref: providerId, from: "config.toml", name, result }));
  }
  return out;
}

/** 这个服务商用到的模型：顶层与各 profile 的 model，以及它们的 model_catalog_json 里列的。 */
function codexModelsOf(input: {
  providerId: string;
  top: Record<string, string>;
  tables: Record<string, Record<string, string>>;
  profiles: readonly string[];
  filePath: string;
  context: ImportReadContext;
}): string[] {
  const { providerId, top, filePath, context } = input;
  const isTopProvider = top.model_provider === providerId;
  const topCatalog = top.model_catalog_json ?? "";
  const models: string[] = [];
  if (isTopProvider) {
    models.push(top.model ?? "");
    models.push(...codexCatalogModels({ filePath, catalog: topCatalog, context }));
  }
  for (const profileName of input.profiles) {
    const profile = input.tables[profileName] ?? {};
    const usesProvider = (profile.model_provider || top.model_provider) === providerId;
    if (!usesProvider) continue;
    models.push(profile.model ?? "");
    let catalog = profile.model_catalog_json ?? "";
    if (catalog === "" && isTopProvider) catalog = topCatalog;
    models.push(...codexCatalogModels({ filePath, catalog, context }));
  }
  return models;
}

function codexTableId(table: string, prefix: string): string | null {
  if (!table.startsWith(prefix)) return null;
  const id = table.slice(prefix.length);
  if (id === "") return null;
  if (id.startsWith('"')) {
    if (!id.endsWith('"')) return null;
    const unquoted = id.replace(/^"+|"+$/g, "");
    return unquoted === "" ? null : unquoted;
  }
  return id.includes(".") ? null : id;
}

const CodexCatalogSchema = z.object({
  models: z.array(
    z.object({ slug: z.string().optional(), visibility: z.string().optional() }).passthrough(),
  ),
});

/** model_catalog_json 里没藏起来的模型；Osuna 自己写的那份不算。读不了当没有。 */
function codexCatalogModels(input: {
  filePath: string;
  catalog: string;
  context: ImportReadContext;
}): string[] {
  let catalogPath = input.catalog;
  if (catalogPath === "") return [];
  if (catalogPath.startsWith("~/"))
    catalogPath = path.join(input.context.homeDir, catalogPath.slice(2));
  else if (!path.isAbsolute(catalogPath))
    catalogPath = path.join(path.dirname(input.filePath), catalogPath);
  if (path.resolve(catalogPath) === path.resolve(input.context.osunaCodexCatalog)) return [];
  let text: string;
  try {
    text = readFileSync(catalogPath, "utf8");
  } catch (error) {
    if (isErrnoException(error)) return [];
    throw error;
  }
  const parsed = CodexCatalogSchema.safeParse(looseJson(text));
  if (!parsed.success) return [];
  return parsed.data.models.flatMap((model) =>
    model.slug && model.visibility !== "hide" ? [model.slug] : [],
  );
}

// ---- Alma ------------------------------------------------------------------

// Alma 内置的服务商类型对应的模板（Google 等子任务 7）。
const ALMA_TEMPLATES: Record<string, string> = {
  openai: "openai",
  anthropic: "anthropic",
  deepseek: "deepseek",
  openrouter: "openrouter",
  moonshot: "moonshot",
  xai: "xai",
  mistral: "mistral",
  groq: "groq",
  aihubmix: "aihubmix",
  together: "together",
  fireworks: "fireworks",
  siliconflow: "siliconflow",
  ollama: "ollama",
  lmstudio: "lmstudio",
  "opencode-go": "opencode-go",
};

// Alma 里是某个软件自己的登录、不是 key 的类型。
const ALMA_SIGN_INS = new Set([
  "acp",
  "copilot",
  "claude-subscription",
  "codex-subscription",
  "gemini-cli",
  "antigravity",
  "cursor",
]);

const AlmaRowSchema = z.object({
  id: z.union([z.string(), z.number()]),
  name: z.string().nullable(),
  type: z.string().nullable(),
  api_key: z.string().nullable(),
  models: z.string().nullable(),
  base_url: z.string(),
  enabled: z.union([z.number(), z.boolean(), z.bigint()]).nullable(),
  api_format: z.string(),
  is_response_api: z.union([z.number(), z.boolean(), z.bigint()]),
  custom_headers: z.string(),
});

function readAlma(filePath: string, context: ImportReadContext): ImportEntry[] {
  const rows = queryReadOnly({
    filePath,
    what: "Alma's database",
    sql: `SELECT id, name, type, api_key, models, COALESCE(base_url,'') AS base_url, enabled, COALESCE(api_format,'') AS api_format, COALESCE(is_response_api,0) AS is_response_api, COALESCE(custom_headers,'') AS custom_headers FROM providers ORDER BY created_at`,
  });
  const out: ImportEntry[] = [];
  for (const raw of rows) {
    const row = AlmaRowSchema.safeParse(raw);
    if (!row.success) continue;
    out.push(almaEntry(row.data, context));
  }
  return out;
}

function almaEntry(row: z.infer<typeof AlmaRowSchema>, context: ImportReadContext): ImportEntry {
  const ref = String(row.id);
  const name = row.name ?? "";
  const type = row.type ?? "";
  const listed = looseJson(row.models ?? "");
  const models = Array.isArray(listed) ? listed.filter((m) => typeof m === "string") : [];
  const place = almaUrls({ row, type });
  if (place.kind === "skip") return skipped({ ref, from: null, name, reason: place.reason });
  const urls = place.urls;
  const result = imported({ name, key: row.api_key ?? "", urls, models, context });
  if (result.kind === "found") {
    if (type === "azure") result.found.templateId = AZURE_TEMPLATE_ID;
    result.found.headers = cleanRequestHeaders(stringMap(looseJson(row.custom_headers)));
  }
  const entry = entryOf({ ref, from: null, name, result });
  if (entry.found !== null && !row.enabled) entry.off = "turned_off";
  return entry;
}

/** Alma 的一条按类型与格式落在哪种格式的地址上；登录、Gemini、没有地址的 Azure 读不了。 */
function almaUrls(input: {
  row: z.infer<typeof AlmaRowSchema>;
  type: string;
}): { kind: "urls"; urls: FormatUrls } | { kind: "skip"; reason: ImportSkipReason } {
  const { row, type } = input;
  const base = row.base_url;
  const format = row.api_format;
  const templateId = ALMA_TEMPLATES[type];
  const template = templateId === undefined ? null : findTemplate(templateId);
  if (ALMA_SIGN_INS.has(type)) return { kind: "skip", reason: "sign_in" };
  if (type === "azure" && base === "") return { kind: "skip", reason: "no_azure_endpoint" };
  if (type === "azure") return { kind: "urls", urls: { ...NO_URLS, chat: base } };
  if (base === "" && template !== null) return { kind: "urls", urls: urlsOf(template.baseUrls) };
  if (format === "anthropic" || type === "anthropic") {
    return { kind: "urls", urls: { ...NO_URLS, anthropic: base } };
  }
  const isGemini = format === "gemini" || (type === "google" && base !== "");
  if (isGemini) return { kind: "skip", reason: "gemini_unsupported" };
  const isResponses = Boolean(row.is_response_api) || format === "openai-responses";
  if (isResponses) return { kind: "urls", urls: { ...NO_URLS, responses: base } };
  return { kind: "urls", urls: { ...NO_URLS, chat: base } };
}

function urlsOf(baseUrls: readonly { format: string; url: string }[]): FormatUrls {
  const of = (format: ApiEndpointRequestFormat) =>
    baseUrls.find((entry) => entry.format === format)?.url ?? "";
  return {
    chat: of("openai_chat"),
    responses: of("openai_responses"),
    anthropic: of("anthropic_messages"),
  };
}

function stringMap(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(mapOf(value))) {
    if (typeof item === "string") out[key] = item;
  }
  return out;
}

// ---- OpenCode --------------------------------------------------------------

// OpenCode 的服务商 id（models.dev 的）对应同一地址的模板；地址不在模板主机上的不收，key 会被发去别处。
const OPENCODE_TEMPLATES: Record<string, string> = {
  opencode: "opencode-zen",
  "opencode-go": "opencode-go",
  openai: "openai",
  anthropic: "anthropic",
  deepseek: "deepseek",
  xai: "xai",
  moonshotai: "moonshot",
  "moonshotai-cn": "moonshot-cn",
  mistral: "mistral",
  groq: "groq",
  openrouter: "openrouter",
  togetherai: "together",
  "fireworks-ai": "fireworks",
  "siliconflow-cn": "siliconflow",
  nvidia: "nvidia",
  aihubmix: "aihubmix",
  "302ai": "302ai",
  "ollama-cloud": "ollama-cloud",
};

const OpenCodeAuthSchema = z.object({ type: z.string(), key: z.string().optional() });

/** OpenCode 自己的登录（opencode auth login）：只有 key，没有地址，有对应模板的才能导入。 */
function readOpenCodeAuth(filePath: string, context: ImportReadContext): ImportEntry[] {
  const all = mapOf(
    parseJsonText({ text: readFileSync(filePath, "utf8"), what: "OpenCode's auth.json" }),
  );
  const out: ImportEntry[] = [];
  for (const providerId of Object.keys(all).sort()) {
    const parsed = OpenCodeAuthSchema.safeParse(all[providerId]);
    // OpenCode 自己也跳过读不懂的。
    if (!parsed.success) continue;
    const auth = parsed.data;
    const templateId = OPENCODE_TEMPLATES[providerId];
    const template = templateId === undefined ? null : findTemplate(templateId);
    const name = template?.name ?? providerId;
    const from = "auth.json";
    if (auth.type === "oauth" || auth.type === "wellknown") {
      out.push(skipped({ ref: providerId, from, name, reason: "sign_in" }));
      continue;
    }
    if (auth.type !== "api") continue;
    if (providerId === "google") {
      out.push(skipped({ ref: providerId, from, name, reason: "gemini_unsupported" }));
      continue;
    }
    if (template === null) {
      out.push(skipped({ ref: providerId, from, name, reason: "no_base_url" }));
      continue;
    }
    const key = auth.key?.trim() ?? "";
    if (key === "") {
      out.push(skipped({ ref: providerId, from, name, reason: "no_api_key" }));
      continue;
    }
    const result = imported({ name, key, urls: urlsOf(template.baseUrls), models: [], context });
    out.push(entryOf({ ref: providerId, from, name, result }));
  }
  return out;
}

// ---- 只读的 SQLite ---------------------------------------------------------

interface SqliteDatabase {
  prepare(sql: string): { all(): unknown[] };
  close(): void;
}
interface Sqlite {
  DatabaseSync: new (
    filePath: string,
    options: { readOnly: boolean; timeout: number },
  ) => SqliteDatabase;
}
const SqliteModuleSchema = z.object({
  DatabaseSync: z.custom<Sqlite["DatabaseSync"]>((value) => typeof value === "function"),
});
const SqliteErrorSchema = z.object({ errcode: z.number() });

// SQLite 的结果码：没有权限、库被别的连接锁着、打不开文件、要密码、文件不是数据库。
const SQLITE_PERM = 3;
const SQLITE_BUSY = 5;
const SQLITE_LOCKED = 6;
const SQLITE_CANTOPEN = 14;
const SQLITE_AUTH = 23;
const SQLITE_NOTADB = 26;
const SQLITE_UNREADABLE: Record<number, string> = {
  [SQLITE_PERM]: "SQLITE_PERM",
  [SQLITE_CANTOPEN]: "SQLITE_CANTOPEN",
  [SQLITE_AUTH]: "SQLITE_AUTH",
};

/**
 * 取 node:sqlite：没有 getBuiltinModule（Node 20.16 以前）或这个 Node 不给 node:sqlite（Node 22.13 以前要开实验开关）时为 null。
 * Node 22、23 第一次取时报一条「SQLite 是实验功能」的 ExperimentalWarning：只把这一条按下，别的警告照常。
 */
function loadSqlite(): Sqlite | null {
  if (typeof process.getBuiltinModule !== "function") return null;
  let module: unknown;
  try {
    module = withoutSqliteExperimentalWarning(() => process.getBuiltinModule("node:sqlite"));
  } catch (error) {
    if (isErrnoException(error) && error.code === "ERR_UNKNOWN_BUILTIN_MODULE") return null;
    throw error;
  }
  const parsed = SqliteModuleSchema.safeParse(module);
  return parsed.success ? parsed.data : null;
}

/** run 期间只丢掉「SQLite 是实验功能」那一条 ExperimentalWarning，别的警告照常发出；之后放回原来的 emitWarning。 */
export function withoutSqliteExperimentalWarning<T>(run: () => T): T {
  const emitWarning = process.emitWarning;
  process.emitWarning = function emitWarningExceptSqlite(
    warning: string | Error,
    ...rest: unknown[]
  ) {
    const text = typeof warning === "string" ? warning : warning.message;
    const type = typeof rest[0] === "string" ? rest[0] : mapOf(rest[0]).type;
    const isSqliteExperimental = type === "ExperimentalWarning" && text.includes("SQLite");
    if (isSqliteExperimental) return;
    Reflect.apply(emitWarning, process, [warning, ...rest]);
  };
  try {
    return run();
  } finally {
    process.emitWarning = emitWarning;
  }
}

/** 只读打开别的软件的数据库（不写；SQLite 读时加共享锁，WAL 库可能碰到 -wal/-shm），等它自己的写入最多 3 秒（magpie busy_timeout）。 */
function queryReadOnly(input: { filePath: string; what: string; sql: string }): unknown[] {
  const sqlite = loadSqlite();
  if (sqlite === null) {
    throw new SourceReadError({
      code: "no_sqlite",
      params: { node: process.version },
      message: `The Node.js running Osuna (${process.version}) can't open SQLite databases`,
    });
  }
  let db: SqliteDatabase;
  try {
    db = new sqlite.DatabaseSync(input.filePath, { readOnly: true, timeout: 3000 });
  } catch (error) {
    if (isSqliteError(error)) throw sqliteReadError({ error, what: input.what, stage: "open" });
    throw error;
  }
  try {
    return db.prepare(input.sql).all();
  } catch (error) {
    if (isSqliteError(error)) throw sqliteReadError({ error, what: input.what, stage: "query" });
    throw error;
  } finally {
    db.close();
  }
}

/**
 * 打开或查询失败的原因，按 SQLite 的结果码分：没权限或打不开文件是 unreadable，被锁着是 busy，不是数据库是 not_database；
 * 打开时别的码也算打不开，查询时别的码是没有 Osuna 认得的 providers 表。
 */
function sqliteReadError(input: {
  error: unknown;
  what: string;
  stage: "open" | "query";
}): SourceReadError {
  const parsed = SqliteErrorSchema.safeParse(input.error);
  const errcode = parsed.success ? parsed.data.errcode : null;
  if (errcode === SQLITE_BUSY || errcode === SQLITE_LOCKED) {
    return new SourceReadError({ code: "busy", message: `${input.what} is locked by its app` });
  }
  if (errcode === SQLITE_NOTADB) {
    const message = `${input.what} is not a database Osuna can open`;
    return new SourceReadError({ code: "not_database", message });
  }
  const unreadable = errcode === null ? undefined : SQLITE_UNREADABLE[errcode];
  if (unreadable !== undefined || input.stage === "open") {
    const errno = unreadable ?? `SQLITE_${errcode ?? "ERROR"}`;
    const message = `Osuna can't open ${input.what} (${errno})`;
    return new SourceReadError({ code: "unreadable", params: { errno }, message });
  }
  return new SourceReadError({
    code: "no_providers_table",
    message: `${input.what} has no providers table Osuna can read`,
  });
}

/** node:sqlite 抛的错（打不开、不是数据库、没有这张表或这些列、库被锁）。 */
function isSqliteError(error: unknown): boolean {
  return isErrnoException(error) && error.code === "ERR_SQLITE_ERROR";
}

// ---- 对照已有的接口 --------------------------------------------------------

export interface HeldEndpoint {
  id: string;
  name: string;
  slug: string;
  baseUrls: readonly { url: string }[];
  headers: Record<string, string> | undefined;
  key: string | null;
}

export interface SettledEntry extends ImportEntry {
  source: ImportSourceId;
  fingerprint: string;
  status: ImportStatus;
  // 对上的那家：已添加的、名称撞上的、或同一家 key 不同的。
  existing: { id: string; name: string } | null;
  // 同一地址、另一把 key 的那家（magpie 的 KeyOf）：名称撞上时也记着，这样的默认选上、新增一家。
  otherKey: { id: string; name: string } | null;
}

/**
 * 每条和已有的接口对照（magpie settle）：key、主机、请求头都同是「已添加」；名称或标识撞上是「名称已被占用」；
 * 地址和请求头同、key 不同是「同一家、key 不同」。
 */
export function settleImports(input: {
  sources: ImportSourceRead[];
  held: readonly HeldEndpoint[];
  // daemon 存在 0600 文件里的随机密钥：指纹不能拿来试猜 key，重启后不变（已忽略的发现要认得）。
  fingerprintSecret: Buffer;
}): { source: ImportSourceRead; entries: SettledEntry[] }[] {
  return input.sources.map((source) => {
    const entries = source.entries.map((entry) =>
      settleEntry({ source: source.id, entry, held: input.held, secret: input.fingerprintSecret }),
    );
    // 能导入的在前（magpie 的稳定排序）。
    const sorted = [
      ...entries.filter((e) => e.skip === null),
      ...entries.filter((e) => e.skip !== null),
    ];
    return { source, entries: sorted };
  });
}

function settleEntry(input: {
  source: ImportSourceId;
  entry: ImportEntry;
  held: readonly HeldEndpoint[];
  secret: Buffer;
}): SettledEntry {
  const { entry } = input;
  const settled: SettledEntry = {
    ...entry,
    source: input.source,
    fingerprint: importFingerprint({ source: input.source, entry, secret: input.secret }),
    status: "new",
    existing: null,
    otherKey: null,
  };
  const found = entry.found;
  if (found === null) return settled;
  const same = input.held.find((held) => sameAccount({ have: held, found }));
  if (same !== undefined) {
    return { ...settled, status: "added", existing: { id: same.id, name: same.name } };
  }
  const otherKeyHeld = input.held.find(
    (held) => held.key !== null && sameAccount({ have: { ...held, key: found.key }, found }),
  );
  const otherKey =
    otherKeyHeld === undefined ? null : { id: otherKeyHeld.id, name: otherKeyHeld.name };
  const taken = input.held.find((held) => isNameTaken({ held, name: found.name }));
  if (taken !== undefined) {
    return {
      ...settled,
      status: "name_taken",
      existing: { id: taken.id, name: taken.name },
      otherKey,
    };
  }
  if (otherKey !== null) return { ...settled, status: "other_key", existing: otherKey, otherKey };
  return settled;
}

/**
 * 导入窗口打开时会默认选上的（magpie importapps/discovery 的条件，与客户端 initialImportPicks 一致）：读得了、
 * 还没添加、在那个软件里开着；只是名称撞上的要用户自己选，名称撞上又是同一家 key 不同的算。
 */
export function isOfferedImport(entry: SettledEntry): boolean {
  if (entry.skip !== null || entry.off !== null || entry.status === "added") return false;
  return entry.status !== "name_taken" || entry.otherKey !== null;
}

/** 名称不分大小写相同，或由名称生成的标识就是那家的。 */
export function isNameTaken(input: { held: HeldEndpoint; name: string }): boolean {
  const { held, name } = input;
  if (held.name.toLowerCase() === name.toLowerCase()) return true;
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug !== "" && held.slug === slug;
}

/** 同一个账号（magpie sameProvider）：同一把 key、同样的请求头、至少一个地址在同一主机上。 */
export function sameAccount(input: {
  have: {
    baseUrls: readonly { url: string }[];
    headers?: Record<string, string> | null;
    key: string | null;
  };
  found: {
    baseUrls: readonly { url: string }[];
    headers: Record<string, string> | null;
    key: string | null;
  };
}): boolean {
  const { have, found } = input;
  if (!sameHeaders(have.headers ?? null, found.headers)) return false;
  if ((have.key ?? "") !== (found.key ?? "")) return false;
  const hosts = new Set(have.baseUrls.map(({ url }) => hostOf(url)).filter((host) => host !== ""));
  return found.baseUrls.some(({ url }) => hosts.has(hostOf(url)));
}

function sameHeaders(a: Record<string, string> | null, b: Record<string, string> | null): boolean {
  const left = cleanRequestHeaders(a ?? undefined) ?? {};
  const right = cleanRequestHeaders(b ?? undefined) ?? {};
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) => left[key] === right[key]);
}

/**
 * 不透明的指纹（magpie importFingerprint）：来源、位置与要加的那家（含 key），导入时据此找回 key。
 * 用 daemon 存下的随机密钥做 HMAC：客户端没法拿猜的 key 去比对；同一条重启前后指纹相同，已忽略的记录据此认出它。
 */
function importFingerprint(input: {
  source: ImportSourceId;
  entry: ImportEntry;
  secret: Buffer;
}): string {
  const { entry } = input;
  const body = JSON.stringify({
    source: input.source,
    ref: entry.ref,
    name: entry.name,
    skip: entry.skip,
    found: entry.found,
  });
  return createHmac("sha256", input.secret).update(body).digest("hex");
}
