// 请求列表的筛选（失败 = Agent 收到报错；换过家 = 答了且试过不止一次；搜索不分大小写看多列）、
// 每页缺省 100 条与筛选不影响的筛选菜单，照 magpie（https://github.com/yetone/magpie，internal/usage/ledger.go 的
// Filter.keepsRecord、SourceOf，internal/usage/usage.go 的 LostRequest、RetriedRequest，request_page.go 的 QueryPage）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。
import type {
  UsageCli,
  UsageProjectRef,
  UsageRequestFacets,
  UsageRequestFilters,
  UsageRequestRow,
} from "@getpaseo/protocol/usage/types";
import type { UsageListedCall } from "./call-merge.js";
import type { GatewayLedgerRow, UsageCliCall } from "./ledger.js";
import { createLocalTimeResolver } from "./local-time.js";
import type { UsageProjectAttribution } from "./project-attribution.js";
import type { UsageReportPricing } from "./report.js";
import { outputSpeedOf } from "./speed.js";
import type { UsageEndpointIdentity } from "./types.js";

/** The period and the filters, whatever page is asked for. */
export interface UsageRequestsQuery {
  from: string | null;
  to: string | null;
  timezone: string;
  filters?: UsageRequestFilters;
}

export interface UsageRequestsRequest extends UsageRequestsQuery {
  offset: number;
  limit: number;
}

export interface UsageRequestsResult {
  requests: UsageRequestRow[];
  total: number;
  facets: UsageRequestFacets;
}

/** The merged calls and what a row is named and priced by. */
export interface UsageRequestsSource {
  calls: readonly UsageListedCall[];
  projects: ReadonlyMap<string, UsageProjectAttribution>;
  endpointIdentities: ReadonlyMap<string, UsageEndpointIdentity>;
  pricing: UsageReportPricing;
}

export interface BuildUsageRequestsInput extends UsageRequestsSource {
  request: UsageRequestsRequest;
}

/** One listed request before it is priced: the row and the words a search looks in. */
interface ListedRow {
  row: UsageRequestRow;
  haystack: string;
}

/** Newest first, the whole period counted, one page of rows priced and returned. */
export function buildUsageRequests(input: BuildUsageRequestsInput): UsageRequestsResult {
  const { request } = input;
  const { inPeriod, kept } = listRequests(input);
  // 只给这一页的行算价：行是这次现建的，直接填上。
  const page = kept
    .slice(request.offset, request.offset + request.limit)
    .map(({ row }) => priceRow(row, input.pricing));
  return { requests: page, total: kept.length, facets: facetsOf(inPeriod) };
}

/** Every request the filters keep, newest first, priced: what the CSV export writes. */
export function buildAllUsageRequests(
  input: UsageRequestsSource & { request: UsageRequestsQuery },
): UsageRequestRow[] {
  return listRequests(input).kept.map(({ row }) => priceRow(row, input.pricing));
}

/** The period's rows, and the ones the filters keep newest first. */
function listRequests(input: UsageRequestsSource & { request: UsageRequestsQuery }): {
  inPeriod: ListedRow[];
  kept: ListedRow[];
} {
  const { request } = input;
  const local = createLocalTimeResolver(request.timezone);
  const inPeriod: ListedRow[] = [];
  for (const [index, call] of input.calls.entries()) {
    const at = call.kind === "gateway" ? call.ledger.at : call.cli.at;
    const day = local.day(Date.parse(at));
    if (request.from && day < request.from) continue;
    if (request.to && day > request.to) continue;
    inPeriod.push(listedRowOf(call, index, input));
  }
  const kept = inPeriod
    .filter((listed) => keeps(listed, request.filters))
    .sort((a, b) =>
      a.row.at === b.row.at ? compare(b.row.id, a.row.id) : compare(b.row.at, a.row.at),
    );
  return { inPeriod, kept };
}

/** Fills in a freshly built row's cost. */
function priceRow(row: UsageRequestRow, pricing: UsageReportPricing): UsageRequestRow {
  row.estimatedCost = pricing.estimateCost(row.totals, row.model, row.endpointId ?? undefined);
  row.priced = pricing.isPriced(row.model);
  return row;
}

function listedRowOf(call: UsageListedCall, index: number, input: UsageRequestsSource): ListedRow {
  const { cli } = call;
  const ledger = call.kind === "gateway" ? call.ledger : null;
  const project = cli ? projectOf(cli.cwd, input.projects) : null;
  const row =
    call.kind === "gateway"
      ? gatewayRow({ ledger: call.ledger, cli: call.cli, project, index, input })
      : directRow(call.cli, project);
  const words = [
    row.model,
    ledger?.upstreamModel,
    row.endpointName,
    ...row.attempts.map((attempt) => attempt.endpointName),
    row.sessionId,
    project?.displayName,
    project?.rootPath,
    cli?.cwd,
    row.error,
    ...row.attempts.map((attempt) => attempt.reason),
  ];
  return {
    row,
    haystack: words
      .filter((word) => word)
      .join("\n")
      .toLowerCase(),
  };
}

/**
 * A request the gateway carried. A call the log also has is at the log's
 * model, session and project, with the ledger's tokens, timing and endpoint
 * (ADR 0014); a request no one answered names the endpoint it last tried.
 */
function gatewayRow({
  ledger,
  cli,
  project,
  index,
  input,
}: {
  ledger: GatewayLedgerRow;
  cli: UsageCliCall | null;
  project: UsageProjectRef | null;
  /** Tells apart two rows with no reply id that started in the same millisecond. */
  index: number;
  input: UsageRequestsSource;
}): UsageRequestRow {
  const answered = ledger.status === "ok";
  const callName = ledger.replyId ?? `${ledger.at}#${index}`;
  return {
    id: `gateway:${ledger.agent}:${callName}`,
    at: ledger.at,
    cli: ledger.agent,
    model: cli?.model ?? ledger.model,
    through: "gateway",
    ...endpointOf(ledger, input.endpointIdentities),
    totals: {
      input: ledger.input,
      cachedInput: ledger.cachedInput,
      cacheWrite: ledger.cacheWrite,
      output: ledger.output,
      reasoning: ledger.reasoning,
    },
    estimatedCost: 0,
    priced: false,
    durationMs: ledger.durationMs,
    ttftMs: ledger.ttftMs,
    outputSpeed: answered ? outputSpeedOf(ledger) : null,
    status: ledger.status,
    error: ledger.error ?? null,
    attempts: attemptsOf(ledger, input.endpointIdentities),
    replyId: ledger.replyId,
    sessionId: cli?.sessionId ?? ledger.sessionId,
    project,
  };
}

/**
 * The endpoint a row is listed at: the one that answered, or for a request no
 * one answered the one it last tried. Its name is the endpoint's current one,
 * else the name the ledger recorded.
 */
function endpointOf(
  ledger: GatewayLedgerRow,
  identities: ReadonlyMap<string, UsageEndpointIdentity>,
): Pick<UsageRequestRow, "endpointId" | "endpointName" | "endpointDeleted"> {
  const lastTried = ledger.attempts.at(-1)?.endpointId ?? null;
  const endpointId = ledger.status === "ok" ? ledger.endpointId : lastTried;
  if (endpointId === null) return { endpointId, endpointName: null, endpointDeleted: false };
  const recorded =
    ledger.endpointId === endpointId
      ? ledger.endpointName
      : ledger.attempts.findLast((attempt) => attempt.endpointId === endpointId)?.endpointName;
  const identity = identities.get(endpointId);
  return {
    endpointId,
    endpointName: identity?.name ?? recorded ?? endpointId,
    endpointDeleted: identity?.deleted ?? false,
  };
}

/** The tries as recorded, each under its endpoint's current name. */
function attemptsOf(
  ledger: GatewayLedgerRow,
  identities: ReadonlyMap<string, UsageEndpointIdentity>,
): UsageRequestRow["attempts"] {
  const attempts: UsageRequestRow["attempts"] = [];
  for (const attempt of ledger.attempts) {
    const current = attempt.endpointId === null ? null : identities.get(attempt.endpointId);
    attempts.push(
      Object.assign({}, attempt, { endpointName: current?.name ?? attempt.endpointName }),
    );
  }
  return attempts;
}

/** A reply only the CLI's log has: Official, no timing, no tries. */
function directRow(cli: UsageCliCall, project: UsageProjectRef | null): UsageRequestRow {
  return {
    id: `direct:${cli.cli}:${cli.replyId}`,
    at: cli.at,
    cli: cli.cli,
    model: cli.model,
    through: "direct",
    endpointId: null,
    endpointName: null,
    endpointDeleted: false,
    totals: {
      input: cli.input,
      cachedInput: cli.cachedInput,
      cacheWrite: cli.cacheWrite,
      output: cli.output,
      reasoning: cli.reasoning,
    },
    estimatedCost: 0,
    priced: false,
    durationMs: null,
    ttftMs: null,
    outputSpeed: null,
    status: "ok",
    error: null,
    attempts: [],
    replyId: cli.replyId,
    sessionId: cli.sessionId,
    project,
  };
}

function projectOf(
  cwd: string,
  projects: ReadonlyMap<string, UsageProjectAttribution>,
): UsageProjectRef | null {
  const attribution = projects.get(cwd);
  if (!attribution || attribution.unknown) return null;
  return {
    rootPath: attribution.rootPath,
    displayName: attribution.displayName,
    kind: attribution.kind,
  };
}

function keeps(listed: ListedRow, filters: UsageRequestFilters | undefined): boolean {
  if (!filters) return true;
  const { row } = listed;
  if (filters.status === "failed" && row.status === "ok") return false;
  if (filters.status === "switched" && !(row.status === "ok" && row.attempts.length > 1)) {
    return false;
  }
  if (filters.through && filters.through !== "all" && row.through !== filters.through) return false;
  if (filters.clis && !filters.clis.includes(row.cli)) return false;
  if (filters.endpoints && !filters.endpoints.includes(row.endpointId)) return false;
  if (filters.models && !filters.models.includes(row.model)) return false;
  const search = filters.search?.trim().toLowerCase();
  if (search && !listed.haystack.includes(search)) return false;
  return true;
}

/** What the period holds, whatever the filters keep: Official first, then by name. */
function facetsOf(rows: readonly ListedRow[]): UsageRequestFacets {
  const clis = new Set<UsageCli>();
  const models = new Set<string>();
  const endpoints = new Map<string | null, UsageRequestFacets["endpoints"][number]>();
  for (const { row } of rows) {
    clis.add(row.cli);
    models.add(row.model);
    if (!endpoints.has(row.endpointId)) {
      endpoints.set(row.endpointId, {
        endpointId: row.endpointId,
        name: row.endpointName,
        deleted: row.endpointDeleted,
      });
    }
  }
  return {
    clis: Array.from(clis).sort(compare),
    endpoints: Array.from(endpoints.values()).sort((a, b) => {
      if (a.endpointId === null) return -1;
      if (b.endpointId === null) return 1;
      return compare(a.name ?? "", b.name ?? "");
    }),
    models: Array.from(models).sort(compare),
  };
}

function compare(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}
