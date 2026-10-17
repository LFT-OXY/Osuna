// 工具参数的根包成 object 移植自 magpie（https://github.com/yetone/magpie，internal/provider/grok.go 的 ObjectRoot、
// objectRootIn、nestedUnion、appendDistinct、grokRef，internal/gateway/anthropic.go 的 objectSchema 与 object_root.go）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { isRecord } from "../../upstream-http.js";

/*
 * 工具参数的根是 anyOf、oneOf 或 allOf 时（Codex 桌面版的 automation_update），
 * Anthropic、xAI 和照 OpenAI 那样校验工具的上游都不收：包成根是 object 的 schema。
 * allOf 的各支全并进来；anyOf、oneOf 只留 object 的支，字段并进来，每支都要求的字段仍然必填。
 */

type Schema = Record<string, unknown>;

// 支里又套联合时最多往下折这么多层。
const MOST_DEPTH = 8;

const UNION_KEYS = ["anyOf", "oneOf", "allOf"];

/** Messages 的 input_schema：里面有联合（`Of"`）时把根包成 object；不用改就交回同一个对象（magpie objectSchema）。 */
export function objectSchema(schema: unknown): unknown {
  if (!isRecord(schema)) return schema;
  const mentionsUnion = JSON.stringify(schema).includes('Of"');
  return mentionsUnion ? objectRoot(schema) : schema;
}

/** 根包成 object 的 schema；根已经是没有联合的 object 时交回同一个对象（magpie ObjectRoot）。 */
export function objectRoot(schema: Schema): Schema {
  if (!needsFold(schema)) return schema;
  const copy = structuredClone(schema);
  fold({ root: copy, schema: copy, depth: 0 });
  return copy;
}

function needsFold(schema: Schema): boolean {
  const plainObject = schema.type === "object" && !hasUnion(schema);
  return !plainObject;
}

function hasUnion(schema: Schema): boolean {
  return UNION_KEYS.some((key) => key in schema);
}

/** 就地折 `schema`；`root` 是本地 $ref 指向的 $defs 所在。 */
function fold(input: { root: Schema; schema: Schema; depth: number }): void {
  const { root, schema } = input;
  const props: Schema = isRecord(schema.properties) ? schema.properties : {};
  const required: unknown[] = Array.isArray(schema.required) ? [...schema.required] : [];
  for (const branch of listOf(schema.allOf)) {
    const found = refTarget({ root, branch });
    if (found === null) continue;
    const given = isRecord(found.properties) ? found.properties : {};
    for (const [key, value] of Object.entries(given)) {
      if (!(key in props)) props[key] = value;
    }
    required.push(...listOf(found.required));
  }
  delete schema.allOf;
  const branches = objectBranches(input);
  const common = commonRequired(branches);
  for (const [key, schemas] of branchProperties({ props, branches })) {
    props[key] = schemas.length === 1 ? schemas[0] : { anyOf: schemas };
  }
  const merged = distinctNames([...required, ...common]);
  schema.type = "object";
  schema.properties = props;
  if (merged.length > 0) schema.required = merged;
  else delete schema.required;
}

/** anyOf、oneOf 里是 object 的支（套着联合的先在副本上折好）；两个键都去掉。 */
function objectBranches(input: { root: Schema; schema: Schema; depth: number }): Schema[] {
  const { root, schema, depth } = input;
  const branches: Schema[] = [];
  for (const key of ["anyOf", "oneOf"]) {
    for (const branch of listOf(schema[key])) {
      let found = refTarget({ root, branch });
      if (found === null) continue;
      if (depth < MOST_DEPTH && hasUnion(found)) {
        // 在副本上折：这一支可能是别处也引用的 $def。
        found = { ...found };
        fold({ root, schema: found, depth: depth + 1 });
      }
      const isObject = found.type === "object" || "properties" in found;
      if (isObject) branches.push(found);
    }
    delete schema[key];
  }
  return branches;
}

/** 每一支都要求的字段。 */
function commonRequired(branches: Schema[]): unknown[] {
  let common: unknown[] = [];
  branches.forEach((branch, index) => {
    const required = listOf(branch.required);
    common = index === 0 ? [...required] : common.filter((name) => required.includes(name));
  });
  return common;
}

/** 根自己没定义的字段在各支里给的 schema，按出现的顺序；同一个 schema 只算一次。 */
function branchProperties(input: { props: Schema; branches: Schema[] }): Map<string, unknown[]> {
  const from = new Map<string, unknown[]>();
  for (const branch of input.branches) {
    const given = isRecord(branch.properties) ? branch.properties : {};
    for (const key of Object.keys(given).sort()) {
      if (key in input.props) continue;
      const schemas = from.get(key) ?? [];
      const seen = schemas.some((schema) => sameSchema(schema, given[key]));
      if (!seen) schemas.push(given[key]);
      from.set(key, schemas);
    }
  }
  return from;
}

function distinctNames(names: unknown[]): unknown[] {
  const seen = new Set<string>();
  return names.filter((name) => {
    if (typeof name !== "string") return true;
    if (seen.has(name)) return false;
    seen.add(name);
    return true;
  });
}

/** 一支 schema，或它的本地 $ref 在 $defs / definitions 里指的那个；指不到为 null（magpie grokRef）。 */
function refTarget(input: { root: Schema; branch: unknown }): Schema | null {
  const { root, branch } = input;
  if (!isRecord(branch)) return null;
  const ref = typeof branch.$ref === "string" ? branch.$ref : "";
  if (ref === "") return branch;
  for (const key of ["$defs", "definitions"]) {
    const prefix = `#/${key}/`;
    if (!ref.startsWith(prefix)) continue;
    const defs = isRecord(root[key]) ? root[key] : {};
    const target = defs[ref.slice(prefix.length)];
    return isRecord(target) ? target : null;
  }
  return null;
}

function listOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** 两个 schema 写出来一样（键按字母序比，像 Go 的 json.Marshal）。 */
function sameSchema(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b);
}

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) => {
    if (!isRecord(inner)) return inner;
    const entries = Object.entries(inner);
    const sorted = entries.sort(([a], [b]) => (a < b ? -1 : 1));
    return Object.fromEntries(sorted);
  });
}
