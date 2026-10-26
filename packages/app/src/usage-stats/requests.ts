// 请求列表的状态、每页 100 条与耗时写法移植自 magpie（https://github.com/yetone/magpie，internal/usage/usage.go 的 LostRequest、RetriedRequest，request_page.go 的 QueryPage，internal/gui/assets/app.js 的 ledTook）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。
import type {
  UsageCli,
  UsageRequestFacets,
  UsageRequestFilters,
  UsageRequestRow,
  UsageRequestStatusFilter,
  UsageRequestThroughFilter,
} from "@getpaseo/protocol/usage/types";

/** Rows per page of the Requests tab, as magpie's request page shows them. */
export const USAGE_REQUESTS_PAGE_SIZE = 100;

/** One host's answer for the first `offset + limit` rows. */
export interface UsageRequestsPage {
  serverId: string;
  requests: UsageRequestRow[];
  total: number;
  facets: UsageRequestFacets;
}

export interface MergedUsageRequestRow extends UsageRequestRow {
  serverId: string;
  /** Unique across hosts: the host's id and the daemon's own. */
  key: string;
}

/**
 * An endpoint the filter offers. Endpoints of the same name on several hosts
 * are one option, as the endpoint cards are; `null` names Official.
 */
export interface UsageRequestEndpointOption {
  key: string;
  name: string | null;
  deleted: boolean;
  endpointIds: (string | null)[];
}

export interface MergedUsageRequests {
  rows: MergedUsageRequestRow[];
  total: number;
  clis: UsageCli[];
  endpoints: UsageRequestEndpointOption[];
  models: string[];
}

const OFFICIAL_OPTION_KEY = "official";

/**
 * Every host answered its own newest `offset + limit` rows, so their union
 * holds the page: sort it newest first and cut. The total adds up; the menus
 * take every host's choices.
 */
export function mergeUsageRequestPages(
  pages: readonly UsageRequestsPage[],
  window: { offset: number; limit: number },
): MergedUsageRequests {
  const rows: MergedUsageRequestRow[] = [];
  const clis = new Set<UsageCli>();
  const models = new Set<string>();
  const endpoints = new Map<string, UsageRequestEndpointOption>();
  let total = 0;
  for (const page of pages) {
    total += page.total;
    for (const row of page.requests) {
      rows.push({ ...row, serverId: page.serverId, key: `${page.serverId}:${row.id}` });
    }
    for (const cli of page.facets.clis) clis.add(cli);
    for (const model of page.facets.models) models.add(model);
    for (const endpoint of page.facets.endpoints) {
      const key =
        endpoint.endpointId === null ? OFFICIAL_OPTION_KEY : `name:${endpoint.name ?? ""}`;
      const option = endpoints.get(key);
      if (option) {
        if (!option.endpointIds.includes(endpoint.endpointId)) {
          option.endpointIds.push(endpoint.endpointId);
        }
        option.deleted = option.deleted && endpoint.deleted;
        continue;
      }
      endpoints.set(key, {
        key,
        name: endpoint.name,
        deleted: endpoint.deleted,
        endpointIds: [endpoint.endpointId],
      });
    }
  }
  rows.sort((a, b) => {
    if (a.at !== b.at) return a.at < b.at ? 1 : -1;
    return a.key < b.key ? 1 : -1;
  });
  return {
    rows: rows.slice(window.offset, window.offset + window.limit),
    total,
    clis: Array.from(clis).sort(),
    endpoints: Array.from(endpoints.values()).sort((a, b) => {
      if (a.key === OFFICIAL_OPTION_KEY) return -1;
      if (b.key === OFFICIAL_OPTION_KEY) return 1;
      return (a.name ?? "").localeCompare(b.name ?? "");
    }),
    models: Array.from(models).sort(),
  };
}

/** What the filter bar holds; one choice per menu, `null` is all. */
export interface UsageRequestsFilterState {
  status: UsageRequestStatusFilter;
  through: UsageRequestThroughFilter;
  cli: UsageCli | null;
  /**
   * The endpoint option chosen, with the ids it stood for and its name when it
   * was chosen: the name labels the menu while the period lists none of it.
   */
  endpoint: Pick<UsageRequestEndpointOption, "key" | "endpointIds" | "name" | "deleted"> | null;
  model: string | null;
  search: string;
}

export const INITIAL_USAGE_REQUESTS_FILTERS: UsageRequestsFilterState = {
  status: "all",
  through: "all",
  cli: null,
  endpoint: null,
  model: null,
  search: "",
};

/** What the filter bar starts with when a page sends the user to one endpoint's requests. */
export interface UsageRequestsEndpointIntent {
  endpointId: string;
  endpointName: string;
}

/**
 * The filters with that endpoint chosen, as the menu option of its name would
 * be chosen (same-named endpoints on other hosts are one option); only this
 * endpoint's id is asked for.
 */
export function usageRequestsFiltersFor(
  intent: UsageRequestsEndpointIntent,
): UsageRequestsFilterState {
  return {
    ...INITIAL_USAGE_REQUESTS_FILTERS,
    endpoint: {
      key: `name:${intent.endpointName}`,
      endpointIds: [intent.endpointId],
      name: intent.endpointName,
      deleted: false,
    },
  };
}

/** The filters as the daemon reads them: only what is chosen. */
export function toUsageRequestFilters(state: UsageRequestsFilterState): UsageRequestFilters {
  const filters: UsageRequestFilters = {};
  if (state.status !== "all") filters.status = state.status;
  if (state.through !== "all") filters.through = state.through;
  if (state.cli) filters.clis = [state.cli];
  if (state.endpoint) filters.endpoints = state.endpoint.endpointIds;
  if (state.model) filters.models = [state.model];
  const search = state.search.trim();
  if (search) filters.search = search;
  return filters;
}

/** What the Status column says. */
export type UsageRequestStatus =
  | { kind: "ok" }
  | { kind: "failed"; failure: string | null }
  // accounts：每次都问的官方、在 Codex 的几个号之间换（多号自动轮换），不是换接口。
  | { kind: "switched"; count: number; accounts: boolean };

/**
 * A request the agent got an error for is failed, with the class of its last
 * try; one answered after other tries switched that many times (magpie's
 * LostRequest and RetriedRequest).
 */
export function usageRequestStatus(row: UsageRequestRow): UsageRequestStatus {
  if (row.status !== "ok") {
    return { kind: "failed", failure: row.attempts.at(-1)?.failure ?? null };
  }
  if (row.attempts.length > 1) {
    const accounts = row.attempts.every((attempt) => attempt.accountEmail !== undefined);
    return { kind: "switched", count: row.attempts.length - 1, accounts };
  }
  return { kind: "ok" };
}

/** The failure classes the gateway writes; anything else is shown as written. */
export const USAGE_REQUEST_FAILURES = [
  "credit",
  "quota",
  "rate",
  "auth",
  "proxy",
  "other",
  "refused",
  "too_long",
  "empty",
  "canceled",
] as const;
export type UsageRequestFailure = (typeof USAGE_REQUEST_FAILURES)[number];

export function isKnownUsageRequestFailure(value: string): value is UsageRequestFailure {
  return (USAGE_REQUEST_FAILURES as readonly string[]).includes(value);
}

/** A failure class in the UI's words; one the client does not know is shown as written. */
export function usageRequestFailureLabel(failure: string, t: (key: string) => string): string {
  return isKnownUsageRequestFailure(failure) ? t(`usage.requests.failures.${failure}`) : failure;
}

/**
 * The model a request asked for, and after an arrow the one the endpoint that
 * answered (else the last one tried) was asked, when that one is spelled differently.
 */
export function usageRequestModelLabel(row: Pick<UsageRequestRow, "model" | "attempts">): string {
  const answered = row.attempts.findLast((attempt) => attempt.result === "answered");
  const upstream = (answered ?? row.attempts.at(-1))?.model;
  return upstream && upstream !== row.model ? `${row.model} → ${upstream}` : row.model;
}

/**
 * Official (with the Codex account that answered, when the gateway moved the request between
 * accounts), the endpoint's name, or its name marked deleted in the language's own punctuation.
 */
export function usageRequestEndpointLabel(
  endpoint: { name: string | null; deleted: boolean; account?: string },
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (endpoint.name === null) {
    if (endpoint.account) return t("usage.overview.officialAccount", { email: endpoint.account });
    return t("usage.overview.official");
  }
  if (endpoint.deleted) return t("usage.overview.deletedEndpointName", { name: endpoint.name });
  return endpoint.name;
}

/** A duration or a wait: `850 ms` under a second, `1.2 s` under ten, `12 s` above. */
export function formatRequestMs(ms: number | null): string {
  if (ms === null) return "—";
  const rounded = Math.round(ms);
  if (rounded < 1000) return `${rounded} ms`;
  return `${(rounded / 1000).toFixed(rounded < 10_000 ? 1 : 0)} s`;
}

/** Tokens a second, whole. */
export function formatOutputSpeed(speed: number | null): string {
  if (speed === null) return "—";
  return `${Math.round(speed)} tok/s`;
}

/** `10/23 14:03:05` in the device's zone, the day first where the language puts it first. */
export function formatRequestTime(at: string, locale: string, timezone: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZone: timezone,
  }).format(new Date(at));
}

/** `14:03:05`: the narrow row's time, its day left to the expanded part. */
export function formatRequestClock(at: string, locale: string, timezone: string): string {
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZone: timezone,
  }).format(new Date(at));
}

/** `14:03` of a cooldown's end, in the device's zone. */
export function formatCooldownTime(at: string, locale: string, timezone: string): string {
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: timezone,
  }).format(new Date(at));
}
