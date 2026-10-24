// 导入链接的解析与拒收照 magpie（https://github.com/yetone/magpie，internal/provider/importurl.go 的 ParseImport、endpoint、
// local、page、iconURL，provider.go 的 Slug，presets.go 的 IconForCatalog，7597c132；gemini= 照 c3bef99e）。
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。
import {
  API_ENDPOINT_REQUEST_FORMATS,
  type ApiEndpointImportLinkRefusal,
  type ApiEndpointRequestFormat,
  type ApiEndpointTemplate,
  type ApiEndpointTemplateRegion,
} from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { importLinkAction } from "@getpaseo/protocol/api-endpoint/import-link";
import { API_ENDPOINT_TEMPLATE_ICONS } from "@getpaseo/protocol/api-endpoint/template-icons";
import { isLocalHost } from "../../utils/local-host.js";
import { API_ENDPOINT_TEMPLATES, findTemplate } from "./templates.js";

/*
 * 导入链接（ADR 0013）：`paseo://import?…`，参数（都经 URL 编码）照 magpie：
 *   preset     模板 id，用模板的地址；不收 google-vertex（要用自己的 Google Cloud 项目加）
 *   region     有区域或套餐的模板选哪个
 *   name       名称；没有 preset 时必填
 *   id         标识（照 magpie Find(id) 找会被替换的那家）；没有时由名称生成
 *   key        API key；没有时用户在确认框里填
 *   chat / responses / anthropic / gemini   各格式的地址
 *   models     给 Agent 用的模型，逗号隔开，最多 200 个
 *   catalog    models.dev 的厂商 id：只用来取图标（magpie IconForCatalog）。magpie 还拿它补模型资料，
 *              Osuna 的接口上没有记它的字段，模型资料照常按地址与模板取
 *   keys       去拿 key 的页面（只收 https）
 *   icon       公网主机上的 https 图片，确认框一打开就去取，有它就用它
 * website 在 Osuna 的接口上没有对应的字段，不读。
 * 链接自己从不保存什么：确认框给用户看，用户点了添加才加。拒收的原因与参数里从不带 key。
 */

const MAX_NAME_BYTES = 80;
const MAX_KEY_BYTES = 4096;
const MAX_MODELS = 200;
const VERTEX_TEMPLATE_ID = "google-vertex";

/** 链接里给地址的参数。 */
export type ImportLinkUrlField = "chat" | "responses" | "anthropic" | "gemini";

const FORMAT_FIELDS: Record<ApiEndpointRequestFormat, ImportLinkUrlField> = {
  anthropic_messages: "anthropic",
  openai_chat: "chat",
  openai_responses: "responses",
  gemini: "gemini",
};

export interface ImportLinkBaseUrl {
  format: ApiEndpointRequestFormat;
  url: string;
}

/**
 * 链接说的那一家。identity 是 magpie 的 id：已有接口里标识就是它、或名称就是它的会被替换。
 * icon 是 catalog= 对上的内置图标名，iconUrl 是 icon= 那张图。
 */
export interface ParsedImportLink {
  identity: string;
  name: string;
  key: string | null;
  baseUrls: ImportLinkBaseUrl[];
  models: string[];
  templateId: string | null;
  region: string | null;
  keysUrl: string | null;
  icon: string | null;
  iconUrl: string | null;
}

/** 拒收：reason 见 protocol 的 API_ENDPOINT_IMPORT_LINK_REFUSALS；params 只有参数名、模板与区域，从不带 key。 */
export class ImportLinkRefusedError extends Error {
  readonly reason: ApiEndpointImportLinkRefusal;
  readonly params: Record<string, string> | undefined;

  constructor(input: {
    reason: ApiEndpointImportLinkRefusal;
    message: string;
    params?: Record<string, string>;
  }) {
    super(input.message);
    this.name = "ImportLinkRefusedError";
    this.reason = input.reason;
    this.params = input.params;
  }
}

/** 读一条导入链接（magpie ParseImport）；拒收时抛 ImportLinkRefusedError。 */
export function parseImportLink(link: string): ParsedImportLink {
  if (importLinkAction(link) !== "import") {
    throw new ImportLinkRefusedError({
      reason: "not_import_link",
      message: "Not a paseo://import link",
    });
  }
  const query = new URL(link.trim()).searchParams;
  const get = (name: string) => (query.get(name) ?? "").trim();

  const presetId = get("preset").toLowerCase();
  const endpoint = presetId === "" ? customEndpointOf(get) : templateEndpointOf({ presetId, get });
  const iconUrl = linkIconUrl(get("icon"));

  const givenId = get("id");
  let identity = slug(endpoint.name);
  if (givenId !== "") identity = slug(givenId);
  else if (presetId !== "") identity = presetId;
  if (identity === "") {
    throw new ImportLinkRefusedError({
      reason: "no_id",
      message: "The link's name has no letters or digits to make an id from",
    });
  }

  const key = get("key");
  if (!isKeyLike(key)) {
    throw new ImportLinkRefusedError({ reason: "bad_key", message: "The link's key is not a key" });
  }
  const name = cutImportLinkName(endpoint.name);
  const models = linkModels(query.get("models") ?? "");
  return { ...endpoint, identity, name, key: key === "" ? null : key, models, iconUrl };
}

/** 一把 key 的样子（magpie）：不超过 4096 字节、没有控制字符。空的也算（不带 key）。 */
export function isKeyLike(key: string): boolean {
  if (Buffer.byteLength(key) > MAX_KEY_BYTES) return false;
  return ![...key].some((char) => char < " " || char === "\u007f");
}

/** 名称截到 80 字节，截在一个字的开头（magpie：中文名 27 个字就到 80 字节）。 */
export function cutImportLinkName(text: string): string {
  return cutToBytes({ text, maxBytes: MAX_NAME_BYTES });
}

/** 名称加上后缀（重名时的「 2」）仍不超过 80 字节：截名称、留着后缀。 */
export function importLinkNameWithSuffix(input: { name: string; suffix: string }): string {
  const maxBytes = MAX_NAME_BYTES - Buffer.byteLength(input.suffix);
  return cutToBytes({ text: input.name, maxBytes }) + input.suffix;
}

function cutToBytes(input: { text: string; maxBytes: number }): string {
  let bytes = 0;
  let cut = "";
  for (const char of input.text) {
    bytes += Buffer.byteLength(char);
    if (bytes > input.maxBytes) break;
    cut += char;
  }
  return cut;
}

/** 链接里除标识、key、模型、图片之外的那家：地址、模板与区域、名称、去拿 key 的页面、内置图标。 */
type LinkedEndpoint = Pick<
  ParsedImportLink,
  "name" | "baseUrls" | "templateId" | "region" | "keysUrl" | "icon"
>;

/** preset= 的那家：模板（或它的一个区域、套餐）的地址。 */
function templateEndpointOf(input: {
  presetId: string;
  get: (name: string) => string;
}): LinkedEndpoint {
  const { presetId, get } = input;
  if (presetId === VERTEX_TEMPLATE_ID) {
    throw new ImportLinkRefusedError({
      reason: "vertex",
      message: "Google Vertex AI is added with your own Google Cloud project, not from a link",
    });
  }
  const template = findTemplate(presetId);
  if (template === null) {
    throw new ImportLinkRefusedError({
      reason: "unknown_template",
      message: `Osuna has no template "${presetId}"`,
      params: { template: presetId },
    });
  }
  const region = templateRegion({ template, regionId: get("region") });
  const baseUrls = (region?.baseUrls ?? template.baseUrls).flatMap(asImportLinkBaseUrl);
  if (baseUrls.length === 0) {
    throw new ImportLinkRefusedError({
      reason: "no_base_url",
      message: `${template.name} needs the address of your own resource; add it in the app`,
    });
  }
  const name = get("name") || template.name;
  return {
    name,
    baseUrls,
    templateId: template.id,
    region: region?.id ?? null,
    keysUrl: region?.keysUrl ?? template.keysUrl ?? null,
    icon: null,
  };
}

function templateRegion(input: {
  template: ApiEndpointTemplate;
  regionId: string;
}): ApiEndpointTemplateRegion | null {
  const { template, regionId } = input;
  if (regionId === "") return null;
  const region = template.regions?.find((candidate) => candidate.id === regionId);
  if (region === undefined) {
    throw new ImportLinkRefusedError({
      reason: "unknown_region",
      message: `${template.name} has no region "${regionId}"`,
      params: { template: template.id, region: regionId },
    });
  }
  return region;
}

/** name= 与各格式地址给出的那家（「自定义」）。 */
function customEndpointOf(get: (name: string) => string): LinkedEndpoint {
  const name = get("name");
  if (name === "") {
    throw new ImportLinkRefusedError({
      reason: "no_name",
      message: "The link names no endpoint: it needs preset= or name=",
    });
  }
  const baseUrls: ImportLinkBaseUrl[] = [];
  for (const format of API_ENDPOINT_REQUEST_FORMATS) {
    const field = FORMAT_FIELDS[format];
    const url = linkBaseUrl({ field, raw: get(field) });
    if (url !== null) baseUrls.push({ format, url });
  }
  if (baseUrls.length === 0) {
    throw new ImportLinkRefusedError({
      reason: "no_base_url",
      message: "The link gives no base URL: it needs chat=, responses=, anthropic= or gemini=",
    });
  }
  const keysUrl = httpsPage(get("keys"));
  const icon = catalogIcon(get("catalog").toLowerCase());
  return {
    name,
    baseUrls,
    templateId: null,
    region: null,
    keysUrl,
    icon,
  };
}

/**
 * catalog= 的厂商图标（magpie IconForCatalog）：models.dev 里是这个 id 的模板（或它的区域）的图标；
 * 不像 id 的、没有模板对上的为 null。
 */
function catalogIcon(catalog: string): string | null {
  if (catalog === "" || catalog !== slug(catalog)) return null;
  const template = API_ENDPOINT_TEMPLATES.find(
    (candidate) =>
      candidate.modelsDevIds.includes(catalog) ||
      (candidate.regions ?? []).some((region) => region.modelsDevIds?.includes(catalog)),
  );
  if (template === undefined) return null;
  return API_ENDPOINT_TEMPLATE_ICONS[template.id] ?? null;
}

/**
 * 一个地址（magpie endpoint）：https，或指向这台电脑、局域网的 http；不带账号、查询串、片段（空的「?」「#」照 Go 不算）；
 * 去掉结尾的 /。没给为 null。
 */
function linkBaseUrl(input: { field: ImportLinkUrlField; raw: string }): string | null {
  const { field, raw } = input;
  if (raw === "") return null;
  if (!URL.canParse(raw)) throw badUrl(field);
  const url = new URL(raw);
  const isHttp = url.protocol === "http:" || url.protocol === "https:";
  if (!isHttp) throw needsHttps(field);
  const hasExtras =
    url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "";
  // 「https:///v1」这种没写主机的，WHATWG 会把路径的第一段当主机；照原文看有没有主机。
  const hasHost = url.hostname !== "" && !/^https?:\/\/\//i.test(raw);
  if (hasExtras || !hasHost) throw badUrl(field);
  if (url.protocol === "http:" && !isLocalHost(url.hostname)) throw needsHttps(field);
  // 空的「?」「#」不留在地址里，拼路径时不会夹在中间。
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/+$/, "");
}

function needsHttps(field: ImportLinkUrlField): ImportLinkRefusedError {
  return new ImportLinkRefusedError({
    reason: "needs_https",
    message: `The link's ${field}= must use https`,
    params: { field },
  });
}

function badUrl(field: ImportLinkUrlField): ImportLinkRefusedError {
  return new ImportLinkRefusedError({
    reason: "bad_url",
    message: `The link's ${field}= is not a base URL`,
    params: { field },
  });
}

/** 网页链接只留 https 的（magpie page）。 */
function httpsPage(raw: string): string | null {
  if (!URL.canParse(raw)) return null;
  const url = new URL(raw);
  const isPlain = url.username === "" && url.password === "";
  return url.protocol === "https:" && url.hostname !== "" && isPlain ? url.toString() : null;
}

/** 图标图片（magpie iconURL）：公网主机上的 https，不带账号与片段；不合规矩的拒收，不去猜。 */
function linkIconUrl(raw: string): string | null {
  if (raw === "") return null;
  const refused = new ImportLinkRefusedError({
    reason: "bad_icon",
    message: "The link's icon= must be an https picture on a public host",
    params: { field: "icon" },
  });
  if (!URL.canParse(raw)) throw refused;
  const url = new URL(raw);
  const isPlain = url.username === "" && url.password === "" && url.hash === "";
  if (url.protocol !== "https:" || url.hostname === "" || !isPlain) throw refused;
  if (isLocalHost(url.hostname)) throw refused;
  url.hash = "";
  return url.toString();
}

function linkModels(raw: string): string[] {
  const models: string[] = [];
  for (const part of raw.split(",")) {
    const model = part.trim();
    if (model !== "" && models.length < MAX_MODELS) models.push(model);
  }
  return models;
}

/** magpie Slug：小写，非字母数字的连成一个「-」，去掉两头的「-」。 */
function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function asImportLinkBaseUrl(entry: { format: string; url: string }): ImportLinkBaseUrl[] {
  const format = API_ENDPOINT_REQUEST_FORMATS.find((candidate) => candidate === entry.format);
  return format === undefined ? [] : [{ format, url: entry.url }];
}
