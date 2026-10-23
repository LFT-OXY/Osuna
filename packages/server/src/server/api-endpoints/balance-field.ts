// 取值写法（余额字段）的读法移植自 magpie（https://github.com/yetone/magpie，internal/provider/balance.go 的
// readBalanceParts、readBalanceOne、balanceShare、balanceAmount、balanceExpr、balanceOp、balanceFuncs、balanceSegments，7597c132）。
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。
import type { ApiEndpointBalanceItem } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { isRecord } from "./upstream-http.js";

/*
 * 取值写法：从余额查询的回复里取出余额（纯函数，语法全照 magpie）。
 * - 点分路径与数组下标（data.balance_infos.0.total_balance）；+ - * /、括号、前缀负号与数字。
 * - 前缀 $ ¥ € £ 只加符号；后缀 % 把 0.25 显示成 25% 并带进度条。
 * - a.*.x 展开列表（或对象的各值，按键排序），a[k=v] / a[k!=v] 筛选，可叠加；多个值要放进 sum() max() min() count()。
 * - 「;」分隔几项，每项可加「标签:」；取不到的那一项是「—」，其余照常，全取不到才算取不到。
 * - 单条路径取到字符串原样显示。
 * 说不通的地方用 magpie 的英文原句说明，作为「取不到值」的对方原话给界面。
 */

export type BalanceFieldRead =
  | { kind: "items"; items: ApiEndpointBalanceItem[] }
  | { kind: "no_value"; detail: string };

const NO_PATH = "no balance path: where in the reply the amount is, e.g. data.balance";
const SIGNS = ["$", "¥", "€", "£"] as const;
const SIGN_UNITS: Record<(typeof SIGNS)[number], string> = {
  $: "USD",
  "¥": "CNY",
  "€": "EUR",
  "£": "GBP",
};
const MISSING = "—";

class FieldError extends Error {}

/** 照写法从回复里取出余额各项。 */
export function readBalanceField(reply: unknown, field: string): BalanceFieldRead {
  try {
    return { kind: "items", items: readParts(reply, field) };
  } catch (error) {
    if (error instanceof FieldError) return { kind: "no_value", detail: error.message };
    throw error;
  }
}

// 写成十进制的数（Go strconv.ParseFloat 认的写法；0x、0b 这类 JS 才认的不算）。
const DECIMAL = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/** JSON 数或写成数的字符串（magpie number）。 */
export function numberOf(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !DECIMAL.test(value.trim())) return null;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function readParts(reply: unknown, field: string): ApiEndpointBalanceItem[] {
  if (!field.includes(";") && !field.includes(":")) return [readOne(reply, field, null)];
  const items: ApiEndpointBalanceItem[] = [];
  let first: FieldError | null = null;
  let isRead = false;
  for (const part of field.split(";")) {
    if (part.trim() === "") continue;
    const colon = part.indexOf(":");
    const label = colon < 0 ? "" : part.slice(0, colon).trim();
    const expr = colon < 0 ? part : part.slice(colon + 1);
    try {
      items.push(readOne(reply, expr, label === "" ? null : label));
      isRead = true;
    } catch (error) {
      if (!(error instanceof FieldError)) throw error;
      // 回复里没有的一项（下标超出、上限为 0 的窗口）是「—」，其余照常（magpie #1993）。
      first ??= label === "" ? error : new FieldError(`${label}: ${error.message}`);
      items.push({
        label: label === "" ? null : label,
        text: MISSING,
        value: null,
        unit: null,
        ratio: null,
      });
    }
  }
  if (items.length === 0) throw new FieldError(NO_PATH);
  if (!isRead && first !== null) throw first;
  return items;
}

function readOne(reply: unknown, raw: string, label: string | null): ApiEndpointBalanceItem {
  let path = raw.trim();
  let sign: (typeof SIGNS)[number] | null = null;
  for (const candidate of SIGNS) {
    if (!path.startsWith(candidate)) continue;
    sign = candidate;
    path = path.slice(candidate.length).trim();
    break;
  }
  let isPercent = false;
  if (path.endsWith("%")) {
    isPercent = true;
    path = path.slice(0, -1).trim();
  }
  if (path === "") throw new FieldError(NO_PATH);
  const expr = new Expr(path, reply);
  let n: number;
  if (expr.isLone()) {
    // 只有一条路径：取到的值，是不是数都行。
    const value = expr.at(path);
    const parsed = numberOf(value);
    if (parsed === null) {
      if (typeof value === "string" && value !== "" && !isPercent) {
        return { label, text: `${sign ?? ""}${value}`, value: null, unit: null, ratio: null };
      }
      throw new FieldError(`${JSON.stringify(path)} in the reply is not an amount`);
    }
    n = parsed;
  } else {
    n = expr.number();
    if (!Number.isFinite(n)) throw new FieldError("the balance path divides by nothing");
  }
  if (isPercent) {
    const percent = n * 100;
    const text = `${sign ?? ""}${percent.toFixed(1).replace(/\.0$/, "")}%`;
    return { label, text, value: percent, unit: "%", ratio: n };
  }
  return {
    label,
    text: `${sign ?? ""}${n.toFixed(2)}`,
    value: n,
    unit: sign === null ? null : SIGN_UNITS[sign],
    ratio: null,
  };
}

/** 一个数，或路径经过列表时的几个数（many）；NaN 是没有这一项。items 是路径自己的值，count() 数它们。 */
interface Value {
  n: number;
  ns: number[];
  isMany: boolean;
  items: unknown[] | null;
}

function single(n: number): Value {
  return { n, ns: [], isMany: false, items: null };
}

type Aggregate = (ns: number[]) => number;

function extreme(name: string, sign: number): Aggregate {
  return (ns) => {
    let best = 0;
    let isFound = false;
    for (const n of ns) {
      if (Number.isNaN(n)) continue;
      if (!isFound || (n - best) * sign > 0) {
        best = n;
        isFound = true;
      }
    }
    if (!isFound) throw new FieldError(`${name}() of the balance path has nothing to take it of`);
    return best;
  };
}

const AGGREGATES: Record<string, Aggregate> = {
  sum: (ns) => ns.reduce((total, n) => (Number.isNaN(n) ? total : total + n), 0),
  count: (ns) => ns.filter((n) => !Number.isNaN(n)).length,
  max: extreme("max", 1),
  min: extreme("min", -1),
};

function isDigit(c: string | undefined): boolean {
  return c !== undefined && c >= "0" && c <= "9";
}

/** v op w；有一边是几个数时逐项算：同一路径的两个列表一一对应，一个数与列表的每一项。 */
function operate(v: Value, w: Value, op: string): Value {
  const one = (a: number, b: number): number => {
    if (op === "+") return a + b;
    if (op === "-") return a - b;
    if (op === "*") return a * b;
    return b === 0 ? Number.NaN : a / b;
  };
  if (!v.isMany && !w.isMany) {
    if (op === "/" && w.n === 0) throw new FieldError("the balance path divides by 0");
    return single(one(v.n, w.n));
  }
  if (v.isMany && w.isMany && v.ns.length !== w.ns.length) {
    throw new FieldError(`the balance path puts ${v.ns.length} values with ${w.ns.length}`);
  }
  const size = Math.max(v.ns.length, w.ns.length);
  const ns = Array.from({ length: size }, (_, index) =>
    one(v.isMany ? v.ns[index] : v.n, w.isMany ? w.ns[index] : w.n),
  );
  return { n: 0, ns, isMany: true, items: null };
}

/** 递归下降：和 → 积 → 一元（负号、括号、数、函数、路径）。 */
class Expr {
  private i = 0;

  constructor(
    private readonly src: string,
    private readonly reply: unknown,
  ) {}

  /** 整个写法就是一条到一个值的路径。 */
  isLone(): boolean {
    return !/[+\-*/() []/.test(this.src) && this.src !== "" && !isDigit(this.src[0]);
  }

  number(): number {
    const v = this.sum();
    if (this.i < this.src.length) {
      throw new FieldError(
        `the balance path has ${JSON.stringify(this.src.slice(this.i))} it can't read`,
      );
    }
    if (v.isMany) {
      throw new FieldError(
        "the balance path has several values where one is wanted: put them in sum(), max(), min() or count()",
      );
    }
    return v.n;
  }

  /** 路径上的一个值。 */
  at(path: string): unknown {
    const { values, isMany } = this.all(path);
    if (isMany) {
      throw new FieldError(
        `${JSON.stringify(path)} is several values: put it in sum(), max(), min() or count()`,
      );
    }
    return values[0];
  }

  private space(): void {
    while (this.src[this.i] === " ") this.i += 1;
  }

  private sum(): Value {
    let v = this.product();
    for (;;) {
      this.space();
      const op = this.src[this.i];
      if (op !== "+" && op !== "-") return v;
      this.i += 1;
      v = operate(v, this.product(), op);
    }
  }

  private product(): Value {
    let v = this.unary();
    for (;;) {
      this.space();
      const op = this.src[this.i];
      if (op !== "*" && op !== "/") return v;
      this.i += 1;
      v = operate(v, this.unary(), op);
    }
  }

  private unary(): Value {
    this.space();
    if (this.i >= this.src.length) {
      throw new FieldError("the balance path ends where a number or a path should be");
    }
    const c = this.src[this.i];
    if (c === "-") {
      this.i += 1;
      return operate(single(0), this.unary(), "-");
    }
    if (c === "(") {
      this.i += 1;
      return this.closed(this.sum());
    }
    if (isDigit(c) || c === ".") return this.literal();
    const path = this.pathText();
    const aggregate = AGGREGATES[path];
    if (aggregate !== undefined && this.src[this.i] === "(") {
      this.i += 1;
      const v = this.closed(this.sum());
      let ns = v.isMany ? v.ns : [v.n];
      if (path === "count" && v.items !== null) {
        ns = v.items.filter((item) => item !== null && item !== undefined).map(() => 1);
      }
      return single(aggregate(ns));
    }
    const { values, isMany } = this.all(path);
    if (!isMany) {
      const n = numberOf(values[0]);
      if (n === null) throw new FieldError(`${JSON.stringify(path)} in the reply is not a number`);
      return single(n);
    }
    const ns = values.map((value) => numberOf(value) ?? Number.NaN);
    return { n: 0, ns, isMany: true, items: values };
  }

  private literal(): Value {
    let j = this.i;
    while (isDigit(this.src[j]) || this.src[j] === ".") j += 1;
    const text = this.src.slice(this.i, j);
    if (!/^(\d+\.?\d*|\.\d+)$/.test(text)) {
      throw new FieldError(`the balance path has ${JSON.stringify(text)}, not a number`);
    }
    this.i = j;
    return single(Number(text));
  }

  /** 一条路径的文字：[…] 整段算进去，开头或点后的 * 是列表的每一项。 */
  private pathText(): string {
    let j = this.i;
    while (j < this.src.length) {
      const c = this.src[j];
      if (c === "[") {
        const close = this.src.indexOf("]", j);
        if (close < 0) throw new FieldError("the balance path has a [ without its ]");
        j = close + 1;
        continue;
      }
      if (c === "*" && (j === this.i || this.src[j - 1] === ".")) {
        j += 1;
        continue;
      }
      if ("+-*/() ".includes(c)) break;
      j += 1;
    }
    if (j === this.i) {
      throw new FieldError(
        `the balance path has ${JSON.stringify(this.src.slice(this.i))} where a number or a path should be`,
      );
    }
    const path = this.src.slice(this.i, j);
    this.i = j;
    return path;
  }

  private closed(v: Value): Value {
    this.space();
    if (this.src[this.i] !== ")") throw new FieldError("the balance path has a ( without its )");
    this.i += 1;
    return v;
  }

  /** 路径上的值：一个，或经过 * 与 […] 时每一项的（isMany），没有后半段路径的项为 undefined。 */
  private all(path: string): PathValues {
    let values: unknown[] = [this.reply];
    let isMany = false;
    for (const segment of segmentsOf(path)) {
      values = values.flatMap((value) =>
        value === null || value === undefined ? [undefined] : step(segment, value),
      );
      isMany ||= segment.key === "*" || segment.tests.length > 0;
      const isMissing = values.length !== 1 || values[0] === null || values[0] === undefined;
      if (!isMany && isMissing)
        throw new FieldError(`nothing at ${JSON.stringify(path)} in the reply`);
    }
    return { values, isMany };
  }
}

/** 路径上的值：一个，或经过列表时每一项的（isMany）。 */
interface PathValues {
  values: unknown[];
  isMany: boolean;
}

/** 一条筛选：项里这条路径的值等于（isNot 时不等于）want。 */
interface SegmentTest {
  path: string[];
  isNot: boolean;
  want: string;
}

/** 路径的一段：键、下标或 *，以及项要满足的筛选（[status=active]）。 */
interface Segment {
  key: string;
  tests: SegmentTest[];
}

function step(segment: Segment, value: unknown): unknown[] {
  if (segment.key === "*") {
    const items = itemsOf(value);
    return segment.tests.length === 0 ? items : items.filter((item) => passesAll(segment, item));
  }
  const current = segment.key === "" ? value : childOf(value, segment.key);
  if (segment.tests.length === 0) return [current];
  // 列表里满足的项，或对象本身满足时它自己。
  const candidates = Array.isArray(current) ? current : [current];
  return candidates.filter((item) => passesAll(segment, item));
}

function passesAll(segment: Segment, item: unknown): boolean {
  return item !== null && item !== undefined && passes(segment, item);
}

/** 数写成筛选比较用的文字：照 Go 的 FormatFloat(n, 'f', -1, 64)，最短的位数、不用科学计数法。 */
function plainNumber(n: number): string {
  const shortest = String(n);
  const match = /^(-?)(\d)(?:\.(\d+))?e([+-]\d+)$/.exec(shortest);
  if (match === null) return shortest;
  const [, sign = "", lead = "", rest = "", exponentText = "0"] = match;
  const digits = lead + rest;
  const point = 1 + Number(exponentText);
  if (point <= 0) return `${sign}0.${"0".repeat(-point)}${digits}`;
  if (point >= digits.length) return `${sign}${digits}${"0".repeat(point - digits.length)}`;
  return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`;
}

function passes(segment: Segment, item: unknown): boolean {
  for (const test of segment.tests) {
    let value: unknown = item;
    for (const key of test.path) {
      value = childOf(value, key);
      if (value === null || value === undefined) break;
    }
    let got = "";
    if (typeof value === "string") got = value;
    else if (typeof value === "number") got = plainNumber(value);
    else if (typeof value === "boolean") got = String(value);
    const isThere = value !== null && value !== undefined;
    if ((isThere && got === test.want) === test.isNot) return false;
  }
  return true;
}

/** 对象的一个键，或列表的一个下标。 */
function childOf(value: unknown, key: string): unknown {
  if (Array.isArray(value)) {
    if (!/^[+-]?\d+$/.test(key)) return undefined;
    const index = Number(key);
    return index >= 0 && index < value.length ? value[index] : undefined;
  }
  if (isRecord(value)) return Object.hasOwn(value, key) ? value[key] : undefined;
  return undefined;
}

/** 列表的各项，或对象按键排序后的各值。 */
function itemsOf(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (isRecord(value)) {
    return Object.keys(value)
      .sort()
      .map((key) => value[key]);
  }
  return [];
}

/** 在点处切开路径，[…] 整段保留。 */
function segmentsOf(path: string): Segment[] {
  const segments: Segment[] = [];
  let rest = path;
  for (;;) {
    let end = 0;
    while (end < rest.length && rest[end] !== ".") {
      if (rest[end] === "[") {
        const close = rest.indexOf("]", end);
        if (close < 0) throw new FieldError("the balance path has a [ without its ]");
        end = close;
      }
      end += 1;
    }
    segments.push(segmentOf(rest.slice(0, end), path));
    if (end === rest.length) return segments;
    rest = rest.slice(end + 1);
  }
}

function segmentOf(raw: string, path: string): Segment {
  const bracket = raw.indexOf("[");
  const key = bracket < 0 ? raw : raw.slice(0, bracket);
  let tests = bracket < 0 ? "" : raw.slice(bracket + 1);
  const segment: Segment = { key, tests: [] };
  if (key === "" && tests === "")
    throw new FieldError(`nothing at ${JSON.stringify(path)} in the reply`);
  while (tests !== "") {
    const close = tests.indexOf("]");
    if (close < 0) throw new FieldError("the balance path has a [ without its ]");
    const body = tests.slice(0, close);
    const after = tests.slice(close + 1);
    const equals = body.indexOf("=");
    let left = equals < 0 ? "" : body.slice(0, equals);
    if (equals < 0 || left.trim() === "") {
      throw new FieldError(`the balance path has [${body}], not a test like [status=active]`);
    }
    const isNot = left.endsWith("!");
    if (isNot) left = left.slice(0, -1);
    segment.tests.push({
      path: left.trim().split("."),
      isNot,
      want: body
        .slice(equals + 1)
        .trim()
        .replace(/^['"]+|['"]+$/g, ""),
    });
    tests = after.startsWith("[") ? after.slice(1) : after;
  }
  return segment;
}
