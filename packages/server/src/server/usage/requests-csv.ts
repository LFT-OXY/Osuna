// 请求的 CSV（英文蛇形列名、时间写成带偏移的 RFC 3339、成本按美元 6 位小数且没有价时留空、首字等待与次数没有时留空、
// encoding/csv 的引号规则与 \n 换行）照 magpie（https://github.com/yetone/magpie，internal/usage/ledger.go 的
// CSVHeader 与 WriteCSV，Go 标准库 encoding/csv 的 Writer.fieldNeedsQuotes）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。
import type { UsageRequestRow } from "@getpaseo/protocol/usage/types";

/**
 * The Requests list's columns, then the ones only the file has: reasoning
 * tokens, the failure, the tries, the reply id and the session. Names are
 * magpie's where magpie has the column.
 */
export const USAGE_REQUESTS_CSV_HEADER = [
  "time",
  "agent",
  "model",
  "endpoint",
  "input_tokens",
  "output_tokens",
  "cache_read_tokens",
  "cache_write_tokens",
  "reasoning_tokens",
  "cost_usd",
  "duration_ms",
  "ttft_ms",
  "output_tokens_per_second",
  "status",
  "error_type",
  "error_message",
  "tries",
  "response_id",
  "session",
] as const;

/** What the endpoint column says for a request no relay carried. */
const OFFICIAL_ENDPOINT = "Official";

/**
 * Rows as CSV, the header first, one line each ending in `\n`. Times are in
 * `timezone` with its offset; the cost is in USD, empty for a model with no
 * price. A direct reply has no timing and no tries, so those cells are empty.
 */
export function writeUsageRequestsCsv(rows: readonly UsageRequestRow[], timezone: string): string {
  const time = createRfc3339Formatter(timezone);
  const lines = [USAGE_REQUESTS_CSV_HEADER.join(",")];
  for (const row of rows) {
    const failed = row.status !== "ok";
    const cells = [
      time(row.at),
      row.cli,
      row.model,
      row.endpointId === null ? OFFICIAL_ENDPOINT : (row.endpointName ?? row.endpointId),
      String(row.totals.input),
      String(row.totals.output),
      String(row.totals.cachedInput),
      String(row.totals.cacheWrite),
      String(row.totals.reasoning),
      row.priced ? row.estimatedCost.toFixed(6) : "",
      optionalNumber(row.durationMs),
      optionalNumber(row.ttftMs),
      row.outputSpeed === null ? "" : row.outputSpeed.toFixed(1),
      row.status,
      failed ? (row.attempts.at(-1)?.failure ?? "") : "",
      row.error ?? "",
      row.through === "gateway" ? String(row.attempts.length) : "",
      row.replyId ?? "",
      row.sessionId ?? "",
    ];
    lines.push(cells.map(csvField).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function optionalNumber(value: number | null): string {
  return value === null ? "" : String(value);
}

/** Go's encoding/csv: quote a field with a comma, a quote, a line break or leading white space, doubling its quotes. */
function csvField(field: string): string {
  const needsQuotes = field === "\\." || /[",\r\n]/.test(field) || /^\s/u.test(field);
  return needsQuotes ? `"${field.replaceAll('"', '""')}"` : field;
}

/** `2026-10-23T14:03:05+08:00`, or `…Z` where the zone's offset is zero then. */
function createRfc3339Formatter(timezone: string): (at: string) => string {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZoneName: "longOffset",
  });
  return (at) => {
    const parts = formatter.formatToParts(new Date(at));
    const part = (type: Intl.DateTimeFormatPartTypes): string =>
      parts.find((candidate) => candidate.type === type)?.value ?? "";
    // longOffset 写成「GMT+08:00」；偏移为零时像 Go 一样写 Z。
    const written = part("timeZoneName").replace("GMT", "");
    const offset = written === "" || written === "+00:00" || written === "-00:00" ? "Z" : written;
    return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}:${part("second")}${offset}`;
  };
}
