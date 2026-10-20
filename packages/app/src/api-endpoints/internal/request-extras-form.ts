// 请求头编辑（一行一个头、值可展开成 JSON 编辑、模板提示的头一点就加）与附加请求体的读法移植自 magpie
// （https://github.com/yetone/magpie，internal/gui/assets/app.js 的 headerEditor、headerRows、headersOf、minifyJSON、
// prettyJSON、looksJSON、extraBodyText、extraBodyOf）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import {
  cleanRequestHeaders,
  extraBodyProblem,
  headerProblem,
  type ExtraBodyProblem,
  type HeaderProblem,
} from "@getpaseo/protocol/api-endpoint/request-extras";

/*
 * 添加 / 编辑窗口里「请求头」「附加请求体」两项的纯逻辑：表单里的样子与保存时发出去的样子互相换算，
 * 以及哪里不对（当场提示，挡住保存）。
 */

/** 表单里的一行请求头；isJson 时值框展开成多行、按 JSON 排版。 */
export interface HeaderRow {
  id: number;
  name: string;
  value: string;
  isJson: boolean;
}

export function headerRowsOf(headers: Record<string, string> | undefined): HeaderRow[] {
  return Object.entries(headers ?? {}).map(([name, value], index) => ({
    id: index,
    name,
    value,
    isJson: false,
  }));
}

/** 值看起来是 JSON（以 { 或 [ 开头）。 */
export function looksLikeJson(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

/** 读 JSON 的结果：读通了带值，读不通的没有。 */
type ParsedJson = { ok: true; value: unknown } | { ok: false };

function parsedJson(value: string): ParsedJson {
  try {
    return { ok: true, value: JSON.parse(value) as unknown };
  } catch (error) {
    if (error instanceof SyntaxError) return { ok: false };
    throw error;
  }
}

/** 看起来是 JSON 却读不通的值：值框标红。 */
export function isBrokenJson(value: string): boolean {
  return looksLikeJson(value) && !parsedJson(value).ok;
}

/** 读得通的 JSON 排成多行，读不通的原样。 */
export function prettyJson(value: string): string {
  const parsed = parsedJson(value);
  return parsed.ok ? JSON.stringify(parsed.value, null, 2) : value;
}

/** 读得通的 JSON 压成一行，读不通的原样。 */
export function minifiedJson(value: string): string {
  const parsed = parsedJson(value);
  return parsed.ok ? JSON.stringify(parsed.value) : value;
}

/**
 * 保存时发的请求头（照 magpie headersOf）：值空的行不要，JSON 值压成一行（"2.0" 这种照原样）；
 * 名字空的与大小写不同的同名交给 cleanRequestHeaders（只留后写的）。
 */
export function headersToSave(rows: readonly HeaderRow[]): Record<string, string> {
  const pairs: Record<string, string> = {};
  for (const row of rows) {
    let value = row.value.trim();
    if (value === "") continue;
    if (looksLikeJson(value)) value = minifiedJson(value);
    pairs[row.name] = value;
  }
  return cleanRequestHeaders(pairs) ?? {};
}

/** 表单里的请求头哪里不对（名字不是合法的头名、值里有换行）；没有为 null。 */
export function headerRowsProblem(rows: readonly HeaderRow[]): HeaderProblem | null {
  return headerProblem(headersToSave(rows));
}

/** 模板提示的、表单里还没有（不分大小写）的请求头名。 */
export function headerHintsLeft(hints: readonly string[], rows: readonly HeaderRow[]): string[] {
  const named = new Set(rows.map((row) => row.name.trim().toLowerCase()));
  return hints.filter((hint) => !named.has(hint.toLowerCase()));
}

/** 存的附加请求体在表单里的样子：排成多行；没有为空。 */
export function extraBodyTextOf(extraBody: Record<string, unknown> | undefined): string {
  if (extraBody === undefined || Object.keys(extraBody).length === 0) return "";
  return JSON.stringify(extraBody, null, 2);
}

/** 附加请求体框里哪里不对：读不通、不是一个对象，或 daemon 也会拒收的（ExtraBodyProblem）。 */
export type ExtraBodyTextProblem =
  | { reason: "notJson" }
  | { reason: "notObject" }
  | ExtraBodyProblem;

export type ExtraBodyRead =
  | { kind: "ok"; value: Record<string, unknown> }
  | { kind: "invalid"; problem: ExtraBodyTextProblem };

/** 框里的文字读成要保存的附加请求体（空即 {}，清掉），或它哪里不对（照 magpie extraBodyOf）。 */
export function extraBodyOf(text: string): ExtraBodyRead {
  const trimmed = text.trim();
  if (trimmed === "") return { kind: "ok", value: {} };
  const parsed = parsedJson(trimmed);
  if (!parsed.ok) return { kind: "invalid", problem: { reason: "notJson" } };
  const body = parsed.value;
  if (!isJsonObject(body)) return { kind: "invalid", problem: { reason: "notObject" } };
  const problem = extraBodyProblem(body);
  if (problem !== null) return { kind: "invalid", problem };
  return { kind: "ok", value: body };
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
