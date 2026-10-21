// 导入链接的解析与拒收照 magpie（https://github.com/yetone/magpie，internal/provider/importurl.go 的 ParseImport、endpoint、
// local、page、iconURL，provider.go 的 Slug，7597c132）。
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。
import {
  API_ENDPOINT_REQUEST_FORMATS,
  type ApiEndpointImportLinkRefusal,
  type ApiEndpointRequestFormat,
  type ApiEndpointTemplate,
  type ApiEndpointTemplateRegion,
} from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { importLinkAction } from "@getpaseo/protocol/api-endpoint/import-link";
import { findTemplate } from "./templates.js";
import { isLocalHost } from "./site-icon.js";

/*
 * 导入链接（ADR 0013）：`paseo://import?…`，参数（都经 URL 编码）照 magpie：
 *   preset     模板 id，用模板的地址；不收 google-vertex（要用自己的 Google Cloud 项目加）
 *   region     有区域或套餐的模板选哪个
 *   name       名称；没有 preset 时必填
 *   id         标识（同一标识的已有接口会被替换）；没有时由名称生成
 *   key        API key；没有时用户在确认框里填
 *   chat / responses / anthropic   各格式的地址
 *   gemini     Gemini 地址：Osuna 还没有 Gemini 格式（子任务 7），照样校验、不用
 *   models     给 Agent 用的模型，逗号隔开，最多 200 个
 *   keys       去拿 key 的页面（只收 https）
 *   icon       公网主机上的 https 图片，用户点了添加才去取
 * catalog、website 在 Osuna 的接口上没有对应的字段，不读。
 * 链接自己从不保存什么：确认框给用户看，用户点了添加才加。拒收的原因与参数里从不带 key。
 */

const MAX_NAME_BYTES = 80;
const MAX_KEY_BYTES = 4096;
const MAX_MODELS = 200;
const VERTEX_TEMPLATE_ID = "google-vertex";

const LINK_FIELDS: Record<ApiEndpointRequestFormat, string> = {
  anthropic_messages: "anthropic",
  openai_chat: "chat",
  openai_responses: "responses",
};

export interface ImportLinkBaseUrl {
  format: ApiEndpointRequestFormat;
  url: string;
}

/** 链接说的那一家。identity 是 magpie 的 id：已有接口里标识或名称对上它的会被替换。 */
export interface ParsedImportLink {
  identity: string;
  name: string;
  key: string | null;
  baseUrls: ImportLinkBaseUrl[];
  models: string[];
  templateId: string | null;
  region: string | null;
  keysUrl: string | null;
  iconUrl: string | null;
  ignoredGemini: boolean;
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
  const placed = presetId === "" ? customPlace(get) : templatePlace({ presetId, get });
  const iconUrl = linkIconUrl(get("icon"));

  const givenId = get("id");
  let identity = slug(placed.name);
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
  const name = cutToBytes(placed.name, MAX_NAME_BYTES);
  const models = linkModels(query.get("models") ?? "");
  return { ...placed, identity, name, key: key === "" ? null : key, models, iconUrl };
}

/** 一把 key 的样子（magpie）：不超过 4096 字节、没有控制字符。空的也算（不带 key）。 */
export function isKeyLike(key: string): boolean {
  if (Buffer.byteLength(key) > MAX_KEY_BYTES) return false;
  return ![...key].some((char) => char < " " || char === "\u007f");
}

/** 名称截到 maxBytes 字节，截在一个字的开头（magpie：中文名 27 个字就到 80 字节）。 */
export function cutToBytes(text: string, maxBytes: number): string {
  let bytes = 0;
  let cut = "";
  for (const char of text) {
    bytes += Buffer.byteLength(char);
    if (bytes > maxBytes) break;
    cut += char;
  }
  return cut;
}

type Place = Pick<
  ParsedImportLink,
  "name" | "baseUrls" | "templateId" | "region" | "keysUrl" | "ignoredGemini"
>;

function templatePlace(input: { presetId: string; get: (name: string) => string }): Place {
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
    ignoredGemini: false,
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

function customPlace(get: (name: string) => string): Place {
  const name = get("name");
  if (name === "") {
    throw new ImportLinkRefusedError({
      reason: "no_name",
      message: "The link names no endpoint: it needs preset= or name=",
    });
  }
  const baseUrls: ImportLinkBaseUrl[] = [];
  for (const format of API_ENDPOINT_REQUEST_FORMATS) {
    const url = linkBaseUrl({ field: LINK_FIELDS[format], raw: get(LINK_FIELDS[format]) });
    if (url !== null) baseUrls.push({ format, url });
  }
  const gemini = linkBaseUrl({ field: "gemini", raw: get("gemini") });
  if (baseUrls.length === 0) {
    const onlyGemini = gemini !== null;
    throw new ImportLinkRefusedError({
      reason: onlyGemini ? "gemini_only" : "no_base_url",
      message: onlyGemini
        ? "The link only gives a Gemini base URL, which Osuna can't use yet"
        : "The link gives no base URL: it needs chat=, responses= or anthropic=",
    });
  }
  const keysUrl = httpsPage(get("keys"));
  return {
    name,
    baseUrls,
    templateId: null,
    region: null,
    keysUrl,
    ignoredGemini: gemini !== null,
  };
}

/**
 * 一个地址（magpie endpoint）：https，或指向这台电脑、局域网的 http；不带账号、查询串、片段；去掉结尾的 /。
 * 没给为 null。
 */
function linkBaseUrl(input: { field: string; raw: string }): string | null {
  const { field, raw } = input;
  if (raw === "") return null;
  if (!URL.canParse(raw)) throw badUrl(field);
  const url = new URL(raw);
  const isHttp = url.protocol === "http:" || url.protocol === "https:";
  if (!isHttp) {
    throw new ImportLinkRefusedError({
      reason: "needs_https",
      message: `The link's ${field}= must use https`,
      params: { field },
    });
  }
  const hasExtras =
    url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "";
  // 「https:///v1」这种没写主机的，WHATWG 会把路径的第一段当主机；照原文看有没有主机。
  const hasHost = url.hostname !== "" && !/^https?:\/\/\//i.test(raw);
  if (hasExtras || !hasHost || raw.endsWith("?") || raw.endsWith("#")) throw badUrl(field);
  if (url.protocol === "http:" && !isLocalHost(url.hostname)) {
    throw new ImportLinkRefusedError({
      reason: "needs_https",
      message: `The link's ${field}= must use https`,
      params: { field },
    });
  }
  return url.toString().replace(/\/+$/, "");
}

function badUrl(field: string): ImportLinkRefusedError {
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
  const isPlain =
    url.username === "" && url.password === "" && url.hash === "" && !raw.endsWith("#");
  if (url.protocol !== "https:" || url.hostname === "" || !isPlain) throw refused;
  if (isLocalHost(url.hostname)) throw refused;
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
