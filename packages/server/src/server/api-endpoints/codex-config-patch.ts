import { getStaticTOMLValue, parseTOML, type AST } from "toml-eslint-parser";
import { z } from "zod";

/*
 * Codex 的 config.toml 补丁（编辑规则见 ADR 0004，写什么见 ADR 0007 与 0010）：用 toml-eslint-parser 拿到节点的精确位置，
 * 按位置拼接文本，其余字节不动；每次拼完再解析一遍，拼不出合法文件就整个拒绝。
 *
 * 负责的键：顶层 model_provider / model / model_catalog_json，以及整张专用表
 * [model_providers.osuna_api_endpoint]（daemon 中转站地址与口令明文）。切回官方时三个顶层键还原、专用表留着：
 * 记在这个服务商名下的 Codex 对话关掉开关后还要能续（ADR 0010），daemon 每次启动按新端口改写它。
 */

/**
 * 专用 provider id。带下划线：自定义提供方的 id 只能是 [a-z][a-z0-9-]*，
 * 请求级注入的 model_providers 永远合并不到这张表上。
 */
export const CODEX_API_ENDPOINT_PROVIDER_ID = "osuna_api_endpoint";

const TOML_VERSION = "1.0";
const BOM = "\uFEFF";
const TOP_LEVEL_KEYS = ["model_provider", "model", "model_catalog_json"] as const;
// 专用表的 name：Codex 在状态与报错里显示它。
const PROVIDER_TABLE_NAME = "Osuna";
type TopLevelKey = (typeof TOP_LEVEL_KEYS)[number];

// raw 是原值在文件里的写法（含引号），恢复时原样放回。
const CodexOriginalValueSchema = z.discriminatedUnion("present", [
  z.object({ present: z.literal(true), raw: z.string() }),
  z.object({ present: z.literal(false) }),
]);
type CodexOriginalValue = z.infer<typeof CodexOriginalValueSchema>;

const CodexProviderTableRecordSchema = z.object({ baseUrl: z.string(), bearerToken: z.string() });
export type CodexProviderTableRecord = z.infer<typeof CodexProviderTableRecordSchema>;

/**
 * 接管记录：顶层负责的键接管前的写法，以及上次写入的值（检测外部改动用）。
 * v0.15 的记录没有 table 与 fileCreated（那时专用表用 auth.command 读 key）。
 */
export const CodexConfigTakeoverSchema = z.object({
  keys: z.record(z.string(), z.object({ original: CodexOriginalValueSchema, written: z.string() })),
  // 专用表上次写入的地址与口令。
  table: CodexProviderTableRecordSchema.optional(),
  // 接管前文件不存在：切回官方后只剩 Osuna 写的东西时把文件删掉。
  fileCreated: z.boolean().optional(),
});
export type CodexConfigTakeover = z.infer<typeof CodexConfigTakeoverSchema>;

/** CLI 指向的中转站：地址（以 /v1 结尾）、该 Agent 的口令、新会话的起始模型、模型目录文件。 */
export interface CodexGatewayWiring {
  baseUrl: string;
  token: string;
  model: string;
  catalogPath: string;
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
}): CodexConfigPatchResult {
  const [bom, baseText] = splitBom(input.text ?? "");
  const parsed = parseConfig(baseText);
  if (parsed.kind === "unparsable") return parsed;

  const eol = detectEol(baseText);
  const { wiring } = input;
  const values: Record<TopLevelKey, string> = {
    model_provider: CODEX_API_ENDPOINT_PROVIDER_ID,
    model: wiring.model,
    model_catalog_json: wiring.catalogPath,
  };
  const table: CodexProviderTableRecord = { baseUrl: wiring.baseUrl, bearerToken: wiring.token };
  const keys: CodexConfigTakeover["keys"] = {};
  for (const key of TOP_LEVEL_KEYS) {
    const node = findTopLevelKeyValue(parsed.program, key);
    const original: CodexOriginalValue =
      input.takeover?.keys[key]?.original ??
      (node ? { present: true, raw: sliceNode(baseText, node.value) } : { present: false });
    keys[key] = { original, written: values[key] };
  }

  let text = baseText;
  for (const key of TOP_LEVEL_KEYS) {
    text = setTopLevelValue({ text, key, raw: tomlString(values[key]), eol });
  }
  // 旧版本写的 auth.command 子表一并拿掉。
  text = appendProviderTable({ text: removeProviderTables(text), table, eol });
  // COMPAT(codexLegacyProviderTable): v0.15 的记录没有 fileCreated，按文件原本存在处理；remove after 2027-04-14.
  const fileCreated = input.takeover ? (input.takeover.fileCreated ?? false) : input.text === null;

  const failure = verify(
    text,
    (value) =>
      TOP_LEVEL_KEYS.every((key) => value[key] === values[key]) && holdsProviderTable(value, table),
  );
  return (
    failure ?? {
      kind: "patched",
      text: bom + text,
      takeover: { keys, table, fileCreated },
    }
  );
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
    if (!record) continue;
    text = record.original.present
      ? setTopLevelValue({ text, key, raw: record.original.raw, eol })
      : removeTopLevelKey(text, key);
  }
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

  const modifiedKeys: string[] = [];
  for (const key of TOP_LEVEL_KEYS) {
    const record = input.takeover?.keys[key];
    if (record && value[key] !== record.written) modifiedKeys.push(key);
  }
  const table = input.takeover?.table;
  if (table && !holdsProviderTable(value, table)) {
    modifiedKeys.push(`model_providers.${CODEX_API_ENDPOINT_PROVIDER_ID}`);
  }

  const profile = typeof value.profile === "string" ? value.profile : null;
  const profiles = isRecord(value.profiles) ? value.profiles : {};
  const selected = profile ? profiles[profile] : undefined;
  const profileTable = isRecord(selected) ? selected : {};
  const overriddenKeys = TOP_LEVEL_KEYS.filter((key) => profileTable[key] !== undefined);
  const profileOverride =
    profile && overriddenKeys.length > 0 ? { profile, keys: overriddenKeys } : null;

  return {
    kind: "parsed",
    modifiedKeys,
    profileOverride,
    baseUrl: effectiveBaseUrl(value, profileTable),
  };
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
  if (!node) return text;
  const start = findLineStart(text, node.range[0]);
  const lineEnd = findLineEnd(text, node.range[1]);
  // 最后一行没有换行符：拿掉的是它前面那个换行。
  if (lineEnd === text.length) {
    const previous = start > 0 ? start - (text[start - 2] === "\r" ? 2 : 1) : 0;
    return text.slice(0, previous);
  }
  return text.slice(0, start) + text.slice(skipEol(text, lineEnd));
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
