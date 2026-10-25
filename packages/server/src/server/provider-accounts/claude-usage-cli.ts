// 运行 `claude -p /usage` 与解析它的输出移植自 magpie（https://github.com/yetone/magpie，d5805372）：
// internal/provider/claude_usage_cli.go 的 parseClaudeUsage、claudeResetTime，internal/gateway/claude_warmup.go 的
// claudeUsage、claudeResult、claudeUsageArgs。
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import stripAnsi from "strip-ansi";
import type { ProviderAccountWindow } from "@getpaseo/protocol/provider-account/rpc-schemas";
import { runClaudeCli, type ClaudeCliLaunch } from "./claude-cli.js";
import { isRecord } from "./cli-login.js";

/*
 * 存着的 Claude 号的额度：在它的私有配置目录、一个临时工作目录里运行真的 `claude -p /usage`（Claude Code 自己回答、
 * 不问模型），关掉工具、MCP 与用户的设置，不留会话。Osuna 自己不问 Anthropic；登录过期时 Claude Code 在这个目录里自己续。
 * 窗口 ID 与 Claude 套餐用量来源（plugins/claude-usage-source）同一套：five_hour、weekly、weekly_model_<名字>。
 */

const USAGE_ARGS = [
  "-p",
  "/usage",
  "--output-format",
  "json",
  "--tools",
  "",
  "--strict-mcp-config",
  "--setting-sources",
  "",
  "--no-session-persistence",
];
const RUN_TIMEOUT_MS = 60_000;
const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;
const SESSION_SPAN_MS = 5 * HOUR_MS;
const WEEK_SPAN_MS = 7 * DAY_MS;
// 照 magpie：重置时间最多比窗口长度再晚这么久（本机时钟可能比 Anthropic 慢）。
const RESET_SLACK_MS = 2 * HOUR_MS;

// "Current session: 13% used · resets Oct 1 at 3:30pm (Asia/Shanghai)"、"Current week (Fable): 0% used"
const USAGE_LINE =
  /^Current (session|week(?: \(([^)]+)\))?):\s*([0-9.]+)% used(?:\s*·\s*resets (.+))?$/;
// 登录不能用：标「需要重新登录」（magpie 的 claudeUsageDenied 里与登录有关的那些）。
const SIGNED_OUT =
  /\b(401|403)\b|not (logged|signed) in|signed out|sign-in (has )?expired|unauthorized|forbidden|authentication (failed|required)|invalid (access )?token|run \/login|token (has been )?(expired|revoked)/i;
// 号能用，但 /usage 这次没给额度（magpie 的 claudeUsageDenied 里其余的）。
const DENIED = /(session|usage) limit|hit your limit|using your overages/i;
const SUBSCRIPTION_ONLY =
  "You are currently using your subscription to power your Claude Code usage";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DATE_TIME =
  /^([A-Z][a-z]{2}) (\d{1,2})(?:, (\d{4}))?(?: at |, )(\d{1,2})(?::(\d{2}))?(am|pm)$/;
const TIME_ONLY = /^(\d{1,2})(?::(\d{2}))?(am|pm)$/;

export type ClaudeUsageReading =
  | { kind: "read"; windows: ProviderAccountWindow[] }
  | { kind: "signed_out"; reason: string }
  | { kind: "failed"; reason: string };

/** 在 configDir 里跑 `claude -p /usage` 并解析；跑不起来、超时也算 failed。 */
export async function readClaudeUsageCli(input: {
  launch: ClaudeCliLaunch;
  configDir: string;
  now: number;
}): Promise<ClaudeUsageReading> {
  const { launch, configDir } = input;
  const cwd = await mkdtemp(path.join(os.tmpdir(), "paseo-claude-usage-"));
  try {
    const run = await runClaudeCli({
      launch,
      args: USAGE_ARGS,
      cwd,
      configDir,
      extra: { DISABLE_TELEMETRY: "1", DISABLE_ERROR_REPORTING: "1", DISABLE_AUTOUPDATER: "1" },
      timeoutMs: RUN_TIMEOUT_MS,
    });
    const result = claudeResult(run.stdout);
    if (result) {
      return result.isError ? denied(result.text) : parseClaudeUsage(result.text, input.now);
    }
    const said = clip(run.stderr.trim() || run.stdout.trim() || run.error || "no output");
    return SIGNED_OUT.test(said)
      ? { kind: "signed_out", reason: `Claude Code: ${said}` }
      : { kind: "failed", reason: `Claude Code: ${said}` };
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

/** /usage 的文字读成窗口；now 用来给没写年份的重置时间定年。 */
export function parseClaudeUsage(raw: string, now: number): ClaudeUsageReading {
  const text = stripAnsi(raw).trim();
  const lines = text.split("\n").map((line) => line.trim());
  // 账号的错误先于其他（含只读到一部分的）。
  for (const line of lines) {
    if (SIGNED_OUT.test(line) || DENIED.test(line)) return denied(line);
  }
  const windows: ProviderAccountWindow[] = [];
  for (const line of lines) {
    const match = USAGE_LINE.exec(line);
    if (!match) continue;
    const usedPct = Number.parseFloat(match[3] ?? "");
    if (!Number.isFinite(usedPct)) continue;
    const window = windowOf({ kind: match[1] ?? "", scope: match[2]?.trim() });
    if (windows.some((each) => each.id === window.id)) continue;
    const span = window.id === "five_hour" ? SESSION_SPAN_MS : WEEK_SPAN_MS;
    const resetsAt = match[4] ? claudeResetTime({ text: match[4], now, spanMs: span }) : null;
    windows.push({
      ...window,
      usedPct,
      resetsAt: resetsAt === null ? null : new Date(resetsAt).toISOString(),
    });
  }
  if (windows.length > 0) return { kind: "read", windows };
  if (text === "" || lines.some((line) => line.replace(/\.$/, "") === SUBSCRIPTION_ONLY)) {
    return { kind: "failed", reason: "Claude Code's /usage is temporarily unavailable" };
  }
  return {
    kind: "failed",
    reason: `Claude Code's /usage told no allowance: ${clip(lines[0] ?? "")}`,
  };
}

function denied(line: string): ClaudeUsageReading {
  const reason = `Claude Code's /usage told no allowance: ${clip(line.trim())}`;
  return SIGNED_OUT.test(line) ? { kind: "signed_out", reason } : { kind: "failed", reason };
}

function windowOf(input: {
  kind: string;
  scope: string | undefined;
}): Omit<ProviderAccountWindow, "usedPct" | "resetsAt"> {
  if (input.kind === "session") return { id: "five_hour", label: "Session", shortLabel: "5h" };
  const scope = input.scope;
  if (!scope || scope.toLowerCase() === "all models") {
    return { id: "weekly", label: "Weekly", shortLabel: "wk" };
  }
  return {
    id: `weekly_model_${normalizeName(scope)}`,
    label: `Weekly · ${scope}`,
    shortLabel: `wk ${scope}`,
  };
}

// 与 claude-usage-source 的 normalizeName 同一个写法，窗口 ID 才对得上。
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * 读「Oct 1 at 3:30pm (Asia/Shanghai)」「Oct 9, 2:59pm (UTC)」「3pm (Asia/Shanghai)」：时区按括号里的，
 * 没有或认不得用本机时区。窗口长 spanMs，重置时间不会比现在晚出窗口长度（加 2 小时余量）：没写年份的取
 * 第一个过去不到一天、又不超过上限的那年；只有时刻的取从现在起的下一次。都不合适时取最近已经过去的那个
 * （窗口算已经重新开始）。读不懂为 null。夏令时回拨时同一时刻读两次的情况不细分。
 */
export function claudeResetTime(input: {
  text: string;
  now: number;
  spanMs: number;
}): number | null {
  let text = input.text.trim();
  let zone: string | undefined;
  const open = text.lastIndexOf("(");
  if (open >= 0 && text.endsWith(")")) {
    const named = text.slice(open + 1, -1);
    if (isKnownZone(named)) zone = named;
    text = text.slice(0, open).trim();
  }
  text = text.replace(/AM/g, "am").replace(/PM/g, "pm");
  const window = {
    now: input.now,
    latest: input.now + input.spanMs + RESET_SLACK_MS,
    today: wallClock(input.now, zone),
    zone,
  };
  const dated = DATE_TIME.exec(text);
  if (dated) return datedReset(dated, window);
  const timed = TIME_ONLY.exec(text);
  return timed ? timeOnlyReset(timed, window) : null;
}

interface ResetWindow {
  now: number;
  // 重置时间最晚到这一刻。
  latest: number;
  today: WallClock;
  zone: string | undefined;
}

function datedReset(match: RegExpExecArray, window: ResetWindow): number | null {
  const { now, latest, today, zone } = window;
  const month = MONTHS.indexOf(match[1] ?? "");
  if (month === -1) return null;
  const day = Number(match[2]);
  const hour = hour24(Number(match[4]), match[6] ?? "");
  const minute = Number(match[5] ?? 0);
  if (match[3]) return zonedTime({ year: Number(match[3]), month, day, hour, minute }, zone);
  let past: number | null = null;
  for (let year = today.year - 1; year <= today.year + 1; year++) {
    const at = zonedTime({ year, month, day, hour, minute }, zone);
    if (at >= now - DAY_MS && at <= latest) return at;
    if (at < now) past = at;
  }
  return past;
}

function timeOnlyReset(match: RegExpExecArray, window: ResetWindow): number | null {
  const { now, latest, today, zone } = window;
  const hour = hour24(Number(match[1]), match[3] ?? "");
  const minute = Number(match[2] ?? 0);
  for (let offset = 0; offset <= 2; offset++) {
    const at = zonedTime({ ...shiftDays(today, offset), hour, minute }, zone);
    if (at < now) continue;
    if (at <= latest) return at;
    break;
  }
  for (let offset = 0; offset >= -2; offset--) {
    const at = zonedTime({ ...shiftDays(today, offset), hour, minute }, zone);
    if (at < now) return at;
  }
  return null;
}

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function hour24(hour: number, half: string): number {
  return (hour % 12) + (half === "pm" ? 12 : 0);
}

function isKnownZone(zone: string): boolean {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: zone }).resolvedOptions().timeZone !== "";
  } catch {
    return false;
  }
}

/** 这一刻在 zone（没有就是本机时区）里的钟面。 */
function wallClock(at: number, zone: string | undefined): WallClock {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
  }).formatToParts(new Date(at));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((each) => each.type === type)?.value ?? 0);
  return {
    year: part("year"),
    month: part("month") - 1,
    day: part("day"),
    hour: part("hour"),
    minute: part("minute"),
  };
}

function shiftDays(clock: WallClock, days: number): Omit<WallClock, "hour" | "minute"> {
  const date = new Date(Date.UTC(clock.year, clock.month, clock.day + days));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth(), day: date.getUTCDate() };
}

/** zone 里钟面读作 clock 的那一刻。 */
function zonedTime(clock: WallClock, zone: string | undefined): number {
  const asUtc = Date.UTC(clock.year, clock.month, clock.day, clock.hour, clock.minute);
  let at = asUtc;
  // 两次就够：第二次按那一刻真正的偏移校正（跨夏令时切换时）。
  for (let pass = 0; pass < 2; pass++) {
    const seen = wallClock(at, zone);
    const seenUtc = Date.UTC(seen.year, seen.month, seen.day, seen.hour, seen.minute);
    at += asUtc - seenUtc;
  }
  return at;
}

/** `claude -p --output-format json` 的结果：一个对象，或打开了详细输出时的一组消息（最后一条是 result）。 */
function claudeResult(stdout: string): { isError: boolean; text: string } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return null;
  }
  const items = Array.isArray(parsed) ? parsed.toReversed() : [parsed];
  for (const item of items) {
    if (!isRecord(item)) continue;
    if (Array.isArray(parsed) && item.type !== "result") continue;
    if (typeof item.result !== "string") continue;
    return { isError: item.is_error === true, text: item.result };
  }
  return null;
}

function clip(text: string): string {
  const chars = [...text];
  return chars.length > 120 ? `${chars.slice(0, 120).join("")}…` : text;
}
