import { getStaticTOMLValue, parseTOML, type AST } from "toml-eslint-parser";
import { z } from "zod";

/*
 * Codex 的 config.toml 补丁（规则见 ADR 0004）：用 toml-eslint-parser 拿到节点的精确位置，
 * 按位置拼接文本，其余字节不动；每次拼完再解析一遍，拼不出合法文件就整个拒绝。
 */

/**
 * 专用 provider id。带下划线：自定义提供方的 id 只能是 [a-z][a-z0-9-]*，
 * 请求级注入的 model_providers 永远合并不到这张表上。
 */
export const CODEX_API_ENDPOINT_PROVIDER_ID = "osuna_api_endpoint";

const TOML_VERSION = "1.0";
const BOM = "\uFEFF";
const TOP_LEVEL_KEYS = ["model_provider", "model"] as const;
type TopLevelKey = (typeof TOP_LEVEL_KEYS)[number];

// raw 是原值在文件里的写法（含引号），恢复时原样放回。
const CodexOriginalValueSchema = z.discriminatedUnion("present", [
  z.object({ present: z.literal(true), raw: z.string() }),
  z.object({ present: z.literal(false) }),
]);
type CodexOriginalValue = z.infer<typeof CodexOriginalValueSchema>;

/** 接管记录：顶层负责的键接管前的写法，以及上次写入的值（检测外部改动用）。 */
export const CodexConfigTakeoverSchema = z.object({
  keys: z.record(z.string(), z.object({ original: CodexOriginalValueSchema, written: z.string() })),
});
export type CodexConfigTakeover = z.infer<typeof CodexConfigTakeoverSchema>;

export interface CodexAuthCommand {
  command: string;
  args: string[];
  timeoutMs: number;
}

export interface CodexProviderTable {
  name: string;
  // 已按自定义 Codex 提供方的规则归一化（以 /v1 结尾）。
  baseUrl: string;
  auth: CodexAuthCommand;
}

export type CodexConfigPatchResult =
  | { kind: "patched"; text: string; takeover: CodexConfigTakeover }
  | { kind: "unparsable"; message: string };

export type CodexConfigEditResult =
  | { kind: "patched"; text: string }
  | { kind: "missing" }
  | { kind: "unparsable"; message: string };

interface Unparsable {
  kind: "unparsable";
  message: string;
}

/**
 * 把第三方接口写进 config.toml：顶层 model_provider / model 原地替换或插入，专用表整块放到文件末尾。
 * `takeover` 为 null 表示首次接管；已接管时沿用其中的原值。`text` 为 null 表示文件不存在。
 */
export function applyCodexApiEndpoint(input: {
  text: string | null;
  model: string;
  table: CodexProviderTable;
  takeover: CodexConfigTakeover | null;
}): CodexConfigPatchResult {
  const [bom, baseText] = splitBom(input.text ?? "");
  const parsed = parseConfig(baseText);
  if (parsed.kind === "unparsable") return parsed;

  const eol = detectEol(baseText);
  const values: Record<TopLevelKey, string> = {
    model_provider: CODEX_API_ENDPOINT_PROVIDER_ID,
    model: input.model,
  };
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
  text = appendProviderTable({ text: removeProviderTables(text), table: input.table, eol });

  const failure = verify(
    text,
    (value) =>
      value.model_provider === CODEX_API_ENDPOINT_PROVIDER_ID &&
      value.model === input.model &&
      holdsProviderTable(value, input.table),
  );
  return failure ?? { kind: "patched", text: bom + text, takeover: { keys } };
}

/** 只重写专用表，不动顶层键：官方模式下编辑专用表所属的接口时用，旧会话恢复时拿到的是新配置。 */
export function replaceCodexProviderTable(input: {
  text: string | null;
  table: CodexProviderTable;
}): CodexConfigEditResult {
  if (input.text === null) return { kind: "missing" };
  const [bom, original] = splitBom(input.text);
  const parsed = parseConfig(original);
  if (parsed.kind === "unparsable") return parsed;
  const text = appendProviderTable({
    text: removeProviderTables(original),
    table: input.table,
    eol: detectEol(original),
  });
  return (
    verify(text, (value) => holdsProviderTable(value, input.table)) ?? {
      kind: "patched",
      text: bom + text,
    }
  );
}

/** 切回官方：把顶层负责的键恢复成接管前的写法；专用表保留。 */
export function restoreCodexOfficial(input: {
  text: string | null;
  takeover: CodexConfigTakeover;
}): CodexConfigEditResult {
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
  return verify(text, () => true) ?? { kind: "patched", text: bom + text };
}

/** 删除接口时拿掉专用表，连同追加时补的那个空行。 */
export function removeCodexProviderTable(input: { text: string | null }): CodexConfigEditResult {
  if (input.text === null) return { kind: "missing" };
  const [bom, original] = splitBom(input.text);
  const parsed = parseConfig(original);
  if (parsed.kind === "unparsable") return parsed;
  const text = removeProviderTables(original);
  return verify(text, () => true) ?? { kind: "patched", text: text === "" ? "" : bom + text };
}

type ParseResult = { kind: "parsed"; program: AST.TOMLProgram } | Unparsable;

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
  return { kind: "parsed", program };
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

function holdsProviderTable(value: Record<string, unknown>, table: CodexProviderTable): boolean {
  const providers = value.model_providers;
  const written = isRecord(providers) ? providers[CODEX_API_ENDPOINT_PROVIDER_ID] : undefined;
  return (
    isRecord(written) &&
    written.base_url === table.baseUrl &&
    isRecord(written.auth) &&
    written.auth.command === table.auth.command
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

function removeProviderTables(text: string): string {
  const tables = parse(text).body[0].body.filter(
    (node): node is AST.TOMLTable =>
      node.type === "TOMLTable" &&
      node.resolvedKey[0] === "model_providers" &&
      node.resolvedKey[1] === CODEX_API_ENDPOINT_PROVIDER_ID,
  );
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
  table: CodexProviderTable;
  eol: string;
}): string {
  const { text, table, eol } = input;
  const block = [
    `[model_providers.${CODEX_API_ENDPOINT_PROVIDER_ID}]`,
    `name = ${tomlString(table.name)}`,
    `base_url = ${tomlString(table.baseUrl)}`,
    `wire_api = "responses"`,
    "",
    `[model_providers.${CODEX_API_ENDPOINT_PROVIDER_ID}.auth]`,
    `command = ${tomlString(table.auth.command)}`,
    `args = [${table.auth.args.map(tomlString).join(", ")}]`,
    `timeout_ms = ${table.auth.timeoutMs}`,
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
