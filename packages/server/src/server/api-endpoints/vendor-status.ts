// 厂商官方状态页照 magpie（https://github.com/yetone/magpie，internal/upstream/upstream.go 的 Vendors、VendorOf、hostOf、
// Of、Wait、ask、read，internal/gui/providers.go 的 /api/upstream，7597c132）。
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。
import type pino from "pino";
import type {
  ApiEndpointError,
  ApiEndpointVendorLevel,
  ApiEndpointVendorStatus,
} from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { z } from "zod";
import { REAL_PRICING_TIMERS, type UsagePricingTimers } from "../usage/pricing/service.js";

/*
 * 官方 API 出故障时，经它的请求失败看起来像登录或额度问题。读厂商自己的状态页（Statuspage 式的
 * /api/v2/summary.json），只看 API 依赖的那几项（Claude API 与 Claude Code，不看 claude.ai；OpenAI 的 Chat Completions、
 * Responses 与 Codex，不看 ChatGPT 与它的桌面版）。读不到的页是「不知道」，不是「正常」。
 * 只在界面来问时读，每页 5 分钟最多一次，从不在请求的路上读。
 */

export type VendorId = "anthropic" | "openai" | "moonshot" | "deepseek";

interface Vendor {
  id: VendorId;
  name: string;
  page: string;
  // 能读的 summary.json；没有（DeepSeek 的页在 Flashduty 上）时只给链接。
  summary: string | null;
  // 接口调用这家时用的 API 主机。
  hosts: readonly string[];
  isApiPart: (name: string) => boolean;
}

// 2026-10-06 逐页核对过（magpie）。
const VENDORS: readonly Vendor[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    page: "https://status.claude.com",
    summary: "https://status.claude.com/api/v2/summary.json",
    hosts: ["api.anthropic.com"],
    // 「Claude API (api.anthropic.com)」，以及 Claude 订阅的请求走的「Claude Code」。
    isApiPart: (name) => name.startsWith("Claude API") || name === "Claude Code",
  },
  {
    id: "openai",
    name: "OpenAI",
    page: "https://status.openai.com",
    summary: "https://status.openai.com/api/v2/summary.json",
    hosts: ["api.openai.com", "chatgpt.com"],
    // ChatGPT 账号的 Codex 请求是 Responses 请求；页面上的「Codex in ChatGPT Desktop」是桌面版，不是 API。
    isApiPart: (name) => ["Chat Completions", "Responses", "Codex", "Codex CLI"].includes(name),
  },
  {
    id: "moonshot",
    name: "Moonshot AI",
    page: "https://status.moonshot.cn",
    summary: "https://status.moonshot.cn/api/v2/summary.json",
    hosts: ["api.moonshot.cn", "api.moonshot.ai"],
    // 开放平台与它的模型，不是 Kimi 网站或注册。
    isApiPart: (name) =>
      name === "Open API" || name === "API Service" || name === "Model" || name.endsWith(" Model"),
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    page: "https://status.deepseek.com",
    summary: null,
    hosts: ["api.deepseek.com"],
    isApiPart: () => false,
  },
];

/** 一页读数保留多久：故障时页面按分钟变，没人需要精确到秒。 */
export const VENDOR_STATUS_FRESH_MS = 5 * 60_000;
// 界面第一次看时为正在读的页等一会儿（magpie Wait 4 秒）。
const FIRST_LOOK_WAIT_MS = 4_000;
const READ_TIMEOUT_MS = 15_000;
const MAX_SUMMARY_BYTES = 4 << 20;

// 组件状态的严重程度；0 是正常（或不认识的状态）。
const PART_LEVEL: Record<string, number> = {
  under_maintenance: 1,
  degraded_performance: 2,
  partial_outage: 3,
  major_outage: 4,
};
const LEVEL_NAMES: readonly ApiEndpointVendorLevel[] = [
  "ok",
  "maintenance",
  "degraded",
  "partial",
  "major",
];

type VendorStatusFailure =
  | "vendor_status_unreachable"
  | "vendor_status_http"
  | "vendor_status_unreadable"
  | "vendor_status_no_api_parts";

class VendorStatusReadError extends Error {
  readonly code: VendorStatusFailure;
  readonly params: Record<string, string> | undefined;

  constructor(input: {
    code: VendorStatusFailure;
    message: string;
    params?: Record<string, string>;
  }) {
    super(input.message);
    this.name = "VendorStatusReadError";
    this.code = input.code;
    this.params = input.params;
  }
}

// summary.json 里读的部分；OpenAI 的（incident.io）也是这个形状。不认识的字段不管。
const SummarySchema = z.object({
  components: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      status: z.string(),
      group: z.boolean().nullish(),
    }),
  ),
  incidents: z
    .array(
      z.object({
        name: z.string(),
        status: z.string(),
        impact: z.string().nullish(),
        shortlink: z.string().nullish(),
        components: z.array(z.object({ id: z.string(), name: z.string().optional() })).nullish(),
      }),
    )
    .nullish(),
});
type Summary = z.infer<typeof SummarySchema>;

/** 接口的各格式地址里，任一个的主机是某家厂商的 API 主机，就是那家；中转站与本机服务为 null。 */
export function vendorOfBaseUrls(urls: readonly string[]): VendorId | null {
  for (const url of urls) {
    const host = hostOf(url);
    const vendor = VENDORS.find((candidate) => candidate.hosts.includes(host));
    if (vendor) return vendor.id;
  }
  return null;
}

function hostOf(url: string): string {
  let rest = url.trim();
  const scheme = rest.indexOf("://");
  if (scheme >= 0) rest = rest.slice(scheme + 3);
  const pathStart = rest.search(/[/?#]/);
  if (pathStart >= 0) rest = rest.slice(0, pathStart);
  const port = rest.lastIndexOf(":");
  if (port >= 0 && !rest.slice(port).includes("]")) rest = rest.slice(0, port);
  return rest.toLowerCase();
}

export interface VendorStatusPagesOptions {
  logger: pino.Logger;
  now: () => Date;
  // 只给测试：把某家的 summary.json 换成本机假页面。
  summaryUrls?: Partial<Record<VendorId, string>>;
  fetch?: typeof globalThis.fetch;
  // 第一次看时等候的计时器；缺省真的 setTimeout，测试换成手动到点的。
  timers?: UsagePricingTimers;
}

/** 每家的最近读数；过了 5 分钟的再读一次，读的时候照旧答上一次的。 */
export class VendorStatusPages {
  private readonly logger: pino.Logger;
  private readonly now: () => Date;
  private readonly summaryUrls: Partial<Record<VendorId, string>>;
  private readonly fetchApi: typeof globalThis.fetch;
  private readonly timers: UsagePricingTimers;
  private readonly kept = new Map<VendorId, ApiEndpointVendorStatus>();
  private readonly asking = new Map<VendorId, Promise<void>>();

  constructor(options: VendorStatusPagesOptions) {
    this.logger = options.logger;
    this.now = options.now;
    this.summaryUrls = options.summaryUrls ?? {};
    this.fetchApi = options.fetch ?? globalThis.fetch;
    this.timers = options.timers ?? REAL_PRICING_TIMERS;
  }

  /** 不读任何页（「价格表自动更新」关着时）：每家只有名称与链接。 */
  unread(vendorIds: readonly string[]): ApiEndpointVendorStatus[] {
    return knownVendors(vendorIds).map(unreadStatus);
  }

  /** 过期的页去读；为正在读的等最多 4 秒，然后答各家的最近读数。 */
  async read(input: { vendors: readonly string[] }): Promise<ApiEndpointVendorStatus[]> {
    const vendors = knownVendors(input.vendors);
    for (const vendor of vendors) this.askIfStale(vendor);
    const pending = vendors.flatMap((vendor) => this.asking.get(vendor.id) ?? []);
    if (pending.length > 0) await this.waitAtMost(Promise.all(pending));
    return vendors.map((vendor) => this.kept.get(vendor.id) ?? unreadStatus(vendor));
  }

  private askIfStale(vendor: Vendor): void {
    const summaryUrl = this.summaryUrls[vendor.id] ?? vendor.summary;
    if (summaryUrl === null || this.asking.has(vendor.id)) return;
    const kept = this.kept.get(vendor.id);
    const readAt = kept?.readAt ? Date.parse(kept.readAt) : null;
    const isFresh = readAt !== null && this.now().getTime() - readAt < VENDOR_STATUS_FRESH_MS;
    if (isFresh) return;
    const asking = this.ask({ vendor, summaryUrl }).finally(() => {
      this.asking.delete(vendor.id);
    });
    this.asking.set(vendor.id, asking);
  }

  private async ask(input: { vendor: Vendor; summaryUrl: string }): Promise<void> {
    const { vendor } = input;
    const readAt = this.now().toISOString();
    try {
      const summary = await this.fetchSummary(input.summaryUrl);
      this.kept.set(vendor.id, { ...summarize({ vendor, summary }), readAt });
    } catch (error) {
      if (!(error instanceof VendorStatusReadError)) throw error;
      this.logger.info({ vendor: vendor.id, err: error }, "Vendor status page could not be read");
      // 读失败的页是「不知道」：之前说的故障也不再当真；5 分钟内也不再读。
      this.kept.set(vendor.id, { ...unreadStatus(vendor), readAt, error: wireError(error) });
    }
  }

  private async fetchSummary(url: string): Promise<Summary> {
    let response: Response;
    try {
      response = await this.fetchApi(url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(READ_TIMEOUT_MS),
      });
    } catch (error) {
      throw new VendorStatusReadError({
        code: "vendor_status_unreachable",
        message: `The status page could not be reached: ${errorMessage(error)}`,
        params: { detail: errorMessage(error) },
      });
    }
    const body = await readLimited(response);
    if (response.status !== 200) {
      throw new VendorStatusReadError({
        code: "vendor_status_http",
        message: `The status page answered ${response.status}`,
        params: { status: String(response.status) },
      });
    }
    const parsed = SummarySchema.safeParse(parseJson(body));
    if (!parsed.success) {
      throw new VendorStatusReadError({
        code: "vendor_status_unreadable",
        message: "The status page's summary could not be read",
      });
    }
    return parsed.data;
  }

  private async waitAtMost(work: Promise<unknown>): Promise<void> {
    let cancel = () => {};
    const timeout = new Promise<void>((resolve) => {
      cancel = this.timers.schedule(resolve, FIRST_LOOK_WAIT_MS);
    });
    await Promise.race([work, timeout]);
    cancel();
  }
}

function knownVendors(ids: readonly string[]): Vendor[] {
  return ids.flatMap((id) => VENDORS.find((vendor) => vendor.id === id) ?? []);
}

function unreadStatus(vendor: Vendor): ApiEndpointVendorStatus {
  return {
    vendor: vendor.id,
    name: vendor.name,
    page: vendor.page,
    isLinkOnly: vendor.summary === null,
    level: null,
    parts: [],
    incidents: [],
    readAt: null,
    error: null,
  };
}

/** API 依赖的那几项里最差的等级、不正常的项，与它们上面还没解决的事件。 */
function summarize(input: { vendor: Vendor; summary: Summary }): ApiEndpointVendorStatus {
  const { vendor, summary } = input;
  let worst = 0;
  const apiParts = new Set<string>();
  const parts: ApiEndpointVendorStatus["parts"] = [];
  for (const component of summary.components) {
    if (component.group === true || !vendor.isApiPart(component.name)) continue;
    apiParts.add(component.id);
    apiParts.add(component.name);
    const level = PART_LEVEL[component.status] ?? 0;
    if (level === 0) continue;
    worst = Math.max(worst, level);
    parts.push({ name: component.name, status: component.status });
  }
  if (apiParts.size === 0) {
    // 页面改了，API 依赖的项一个都不在：说不出 API 怎样。
    throw new VendorStatusReadError({
      code: "vendor_status_no_api_parts",
      message: "The status page lists none of the API's parts",
    });
  }
  const incidents: ApiEndpointVendorStatus["incidents"] = [];
  for (const incident of summary.incidents ?? []) {
    if (incident.status === "resolved" || incident.status === "postmortem") continue;
    const named = incident.components ?? [];
    // 不写影响哪几项的事件（OpenAI 的都不写）只在 API 的项不正常时算。
    const isUnnamedWhileAffected = named.length === 0 && worst > 0;
    const isOnApi = named.some(
      (component) => apiParts.has(component.id) || apiParts.has(component.name ?? ""),
    );
    if (!isUnnamedWhileAffected && !isOnApi) continue;
    incidents.push({
      name: incident.name,
      impact: incident.impact ?? null,
      url: webUrlOrNull(incident.shortlink),
    });
  }
  return {
    ...unreadStatus(vendor),
    level: LEVEL_NAMES[worst] ?? "ok",
    parts,
    incidents,
  };
}

// 事件链接由界面直接打开：只收 http(s) 的。
function webUrlOrNull(value: string | null | undefined): string | null {
  if (!value) return null;
  return /^https?:\/\//i.test(value) ? value : null;
}

async function readLimited(response: Response): Promise<string> {
  try {
    const bytes = new Uint8Array(await response.arrayBuffer());
    return new TextDecoder().decode(bytes.subarray(0, MAX_SUMMARY_BYTES));
  } catch (error) {
    throw new VendorStatusReadError({
      code: "vendor_status_unreachable",
      message: `The status page could not be read: ${errorMessage(error)}`,
      params: { detail: errorMessage(error) },
    });
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

function wireError(error: VendorStatusReadError): ApiEndpointError {
  return {
    code: error.code,
    ...(error.params ? { params: error.params } : {}),
    message: error.message,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
