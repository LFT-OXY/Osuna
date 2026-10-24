import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { WebSocket } from "ws";
import type { UsagePricingModel, UsageReport } from "@getpaseo/protocol/usage/types";
import { createTestPaseoDaemon, type TestPaseoDaemon } from "../test-utils/paseo-daemon.js";
import { DaemonClient } from "../test-utils/daemon-client.js";
import type { UsagePricingTimers } from "../usage/pricing/service.js";
import { PRICING_TABLE_SCHEMA, type PricingTable } from "../usage/pricing/table.js";

const FIXTURE_DIR = new URL("../usage/fixtures/claude/", import.meta.url);
const PROJECT_DIR = "-work-demo";
const SESSION_ID = "sess-1";
const SCAN_INTERVAL_MS = 50;
const NOW = Date.parse("2026-09-18T23:00:00.000Z");
const DAY = "2026-09-18";
/** Far enough past the shipped snapshot that the first check finds it stale. */
const LATER = Date.parse("2027-06-01T12:00:00.000Z");
const LATER_ISO = "2027-06-01T12:00:00.000Z";

/**
 * A dollar per token in every column, which makes the estimate the plain sum of
 * the four billed columns instead of a float nobody can check by hand.
 */
const ONE_DOLLAR_PER_TOKEN = { input: 1e6, cachedInput: 1e6, cacheWrite: 1e6, output: 1e6 };
const FREE = { input: 0, cachedInput: 0, cacheWrite: 0, output: 0 };
const FABLE_BILLABLE = 7 + 74_560 + 26_884 + 1010;

const USAGE_EVENTS = new Set(["usage.backfill.progress", "usage.updated", "usage.pricing.updated"]);

/**
 * A socket that does not declare `owned_subscriptions`, which is what makes it
 * legacy on the daemon side and routes its events through the implicit-delivery
 * fallback. `DaemonClient` always declares the capability, so it never reaches
 * that branch and cannot show this.
 */
class LegacyPeer {
  readonly frames: { type: string; message?: { type: string; payload?: unknown } }[] = [];

  private constructor(private readonly socket: WebSocket) {
    socket.on("message", (data, binary) => {
      if (!binary) this.frames.push(JSON.parse(data.toString()));
    });
  }

  static async connect(port: number): Promise<LegacyPeer> {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const peer = new LegacyPeer(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    socket.send(
      JSON.stringify({
        type: "hello",
        clientType: "browser",
        clientId: "clid_legacy_usage_peer",
        protocolVersion: 1,
        appVersion: "0.7.2",
        capabilities: {},
      }),
    );
    await expect
      .poll(() =>
        peer.frames.some((frame) => frame.type === "session" && frame.message?.type === "status"),
      )
      .toBe(true);
    peer.frames.length = 0;
    return peer;
  }

  async request(message: Record<string, unknown> & { requestId: string }): Promise<void> {
    this.socket.send(JSON.stringify({ type: "session", message }));
    await expect
      .poll(() =>
        this.frames.some((frame) => {
          const payload = frame.message?.payload;
          return (
            frame.type === "session" &&
            typeof payload === "object" &&
            payload !== null &&
            (payload as { requestId?: string }).requestId === message.requestId
          );
        }),
      )
      .toBe(true);
  }

  eventTypes(): string[] {
    return this.frames
      .map((frame) => frame.message?.type)
      .filter((type): type is string => type !== undefined && USAGE_EVENTS.has(type));
  }

  close(): void {
    this.socket.close();
  }
}

const tempRoots: string[] = [];

/** A table with one model, so the fixture's other model becomes unpriced. */
const UPSTREAM_TABLE = {
  sample_spec: { input_cost_per_token: 0, output_cost_per_token: 0 },
  "claude-fable-5-1": {
    input_cost_per_token: 1e-5,
    cache_read_input_token_cost: 2.5e-7,
    cache_creation_input_token_cost: 1.25e-5,
    output_cost_per_token: 5e-5,
    max_input_tokens: 200_000,
    litellm_provider: "anthropic",
  },
  "text-embedding-3-small": { max_input_tokens: 8191 },
};

/** Records what the daemon asked for so the schedule can be asserted on. */
interface RecordedFetch {
  calls: Array<{ ifNoneMatch: string | null }>;
  fetch: typeof globalThis.fetch;
}

function recordFetch(reply: () => Response | Promise<Response>): RecordedFetch {
  const calls: Array<{ ifNoneMatch: string | null }> = [];
  return {
    calls,
    fetch: async (_input, init) => {
      const headers = new Headers(init?.headers);
      calls.push({ ifNoneMatch: headers.get("if-none-match") });
      return reply();
    },
  };
}

function tableResponse(etag: string): Response {
  return new Response(JSON.stringify(UPSTREAM_TABLE), { status: 200, headers: { etag } });
}

/**
 * The daemon's clock and its refresh timer in one object, so a test can move a
 * day forward and see exactly which checks fire.
 */
class FakeSchedule {
  private nowMs = LATER;
  private nextId = 1;
  private pending = new Map<number, { at: number; handler: () => void }>();

  readonly now = (): number => this.nowMs;

  readonly timers: UsagePricingTimers = {
    schedule: (handler, ms) => {
      const id = this.nextId++;
      this.pending.set(id, { at: this.nowMs + ms, handler });
      return () => this.pending.delete(id);
    },
  };

  async advance(ms: number): Promise<void> {
    const target = this.nowMs + ms;
    for (;;) {
      const due = Array.from(this.pending.entries())
        .filter(([, timer]) => timer.at <= target)
        .sort(([, a], [, b]) => a.at - b.at)[0];
      if (!due) break;
      const [id, timer] = due;
      this.pending.delete(id);
      this.nowMs = timer.at;
      timer.handler();
      await settle();
    }
    this.nowMs = target;
    await settle();
  }
}

/** Lets the refresh's awaits run before the test looks at the result. */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

async function seedClaudeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "paseo-pricing-claude-"));
  tempRoots.push(root);
  const projectDir = path.join(root, PROJECT_DIR);
  await mkdir(projectDir, { recursive: true });
  await writeFile(
    path.join(projectDir, `${SESSION_ID}.jsonl`),
    await readFile(new URL("claude-session.jsonl", FIXTURE_DIR), "utf8"),
  );
  return root;
}

async function emptyRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "paseo-pricing-empty-"));
  tempRoots.push(root);
  return root;
}

async function connect(daemon: TestPaseoDaemon): Promise<DaemonClient> {
  const client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws` });
  await client.connect();
  await client.fetchAgents({ subscribe: {} });
  await client.observeEvents(["usage.pricing.updated"]);
  return client;
}

async function readCache(daemon: TestPaseoDaemon): Promise<PricingTable> {
  const raw = await readFile(path.join(daemon.paseoHome, "usage", "pricing-table.json"), "utf8");
  return PRICING_TABLE_SCHEMA.parse(JSON.parse(raw));
}

async function waitForReport(
  client: DaemonClient,
  accept: (report: UsageReport) => boolean,
): Promise<UsageReport> {
  const deadline = Date.now() + 15_000;
  let last: UsageReport | null = null;
  while (Date.now() < deadline) {
    const { requestId: _requestId, ...report } = await client.usageReportGet({
      from: DAY,
      to: DAY,
      timezone: "UTC",
    });
    last = report;
    if (accept(report)) return report;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Usage report never matched: ${JSON.stringify(last)}`);
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("price table refresh", () => {
  let daemon: TestPaseoDaemon;
  let client: DaemonClient;
  let schedule: FakeSchedule;

  async function start(options: {
    autoUpdate: boolean;
    fetch: typeof globalThis.fetch;
  }): Promise<void> {
    schedule = new FakeSchedule();
    daemon = await createTestPaseoDaemon({
      usage: {
        roots: { claude: [await emptyRoot()], codex: [], pi: [], omp: [] },
        scanIntervalMs: SCAN_INTERVAL_MS,
        now: schedule.now,
        pricing: {
          autoUpdate: options.autoUpdate,
          overrides: [],
          fetch: options.fetch,
          timers: schedule.timers,
        },
      },
    });
    client = await connect(daemon);
  }

  afterEach(async () => {
    await client?.close();
    await daemon?.close();
  });

  test("replaces the table from a fetched file and caches the four columns", async () => {
    const recorded = recordFetch(() => tableResponse("etag-1"));
    await start({ autoUpdate: false, fetch: recorded.fetch });

    const { requestId: _requestId, ...outcome } = await client.usagePricingRefresh();

    expect(outcome).toEqual({
      result: "updated",
      fetchedAt: LATER_ISO,
      error: null,
    });
    expect(await readCache(daemon)).toEqual({
      _meta: {
        source:
          "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json",
        fetchedAt: LATER_ISO,
        etag: "etag-1",
        license: "MIT (c) 2023 Berri AI — see the LICENSE file beside the snapshot",
      },
      models: {
        "claude-fable-5-1": {
          input: 1e-5,
          cachedInput: 2.5e-7,
          cacheWrite: 1.25e-5,
          output: 5e-5,
        },
      },
    });
    const listed = await client.usagePricingList();
    expect(listed.table).toEqual({ fetchedAt: LATER_ISO, source: "cache", autoUpdate: false });
  });

  test("keeps the table and only restamps it when the file has not changed", async () => {
    let status = 200;
    const recorded = recordFetch(() =>
      status === 200 ? tableResponse("etag-1") : new Response(null, { status: 304 }),
    );
    await start({ autoUpdate: false, fetch: recorded.fetch });
    await client.usagePricingRefresh();

    status = 304;
    const { requestId: _requestId, ...outcome } = await client.usagePricingRefresh();

    expect(outcome).toEqual({ result: "not_modified", fetchedAt: LATER_ISO, error: null });
    // The first call carries the shipped snapshot's etag, whatever it is today.
    expect(recorded.calls.length).toBe(2);
    expect(recorded.calls[1]).toEqual({ ifNoneMatch: "etag-1" });
    expect((await readCache(daemon)).models).toEqual({
      "claude-fable-5-1": { input: 1e-5, cachedInput: 2.5e-7, cacheWrite: 1.25e-5, output: 5e-5 },
    });
  });

  test("restamps the built-in snapshot without calling it a cache", async () => {
    const recorded = recordFetch(() => new Response(null, { status: 304 }));
    await start({ autoUpdate: false, fetch: recorded.fetch });

    const { requestId: _requestId, ...outcome } = await client.usagePricingRefresh();

    expect(outcome).toEqual({ result: "not_modified", fetchedAt: LATER_ISO, error: null });
    const listed = await client.usagePricingList();
    expect(listed.table).toEqual({ fetchedAt: LATER_ISO, source: "snapshot", autoUpdate: false });
  });

  test("leaves the cached table alone when the response is not a price table", async () => {
    let body = JSON.stringify(UPSTREAM_TABLE);
    const recorded = recordFetch(
      () => new Response(body, { status: 200, headers: { etag: "etag-1" } }),
    );
    await start({ autoUpdate: false, fetch: recorded.fetch });
    await client.usagePricingRefresh();

    body = "<html>rate limited</html>";
    const { requestId: _requestId, ...outcome } = await client.usagePricingRefresh();

    expect(outcome.result).toBe("failed");
    expect(outcome.error).not.toBe(null);
    expect((await readCache(daemon)).models).toEqual({
      "claude-fable-5-1": { input: 1e-5, cachedInput: 2.5e-7, cacheWrite: 1.25e-5, output: 5e-5 },
    });
  });

  test("never reaches the network while auto-update is off", async () => {
    const recorded = recordFetch(() => tableResponse("etag-1"));
    await start({ autoUpdate: false, fetch: recorded.fetch });

    await schedule.advance(25 * 60 * 60 * 1000);

    expect(recorded.calls).toEqual([]);
  });

  test("checks once half a minute after start and again a day later", async () => {
    const recorded = recordFetch(() => tableResponse("etag-1"));
    await start({ autoUpdate: true, fetch: recorded.fetch });

    await schedule.advance(29_000);
    expect(recorded.calls).toEqual([]);

    await schedule.advance(2_000);
    expect(recorded.calls.length).toBe(1);

    await schedule.advance(24 * 60 * 60 * 1000);
    expect(recorded.calls.length).toBe(2);
    expect(recorded.calls[1]).toEqual({ ifNoneMatch: "etag-1" });
  });
});

describe("custom prices", () => {
  let daemon: TestPaseoDaemon;
  let client: DaemonClient;

  afterEach(async () => {
    await client?.close();
    await daemon?.close();
  });

  async function start(): Promise<UsageReport> {
    daemon = await createTestPaseoDaemon({
      usage: {
        roots: { claude: [await seedClaudeRoot()], codex: [], pi: [], omp: [] },
        scanIntervalMs: SCAN_INTERVAL_MS,
        now: () => NOW,
        pricing: {
          autoUpdate: false,
          // Both fixture models are priced by the built-in snapshot, so the
          // starting point is pinned here instead of to whatever it ships.
          overrides: [
            { model: "claude-fable-5-1", pricePerMillion: FREE },
            { model: "claude-opus-5", pricePerMillion: FREE },
          ],
          fetch: async () => tableResponse("etag-1"),
          timers: { schedule: () => () => undefined },
        },
      },
    });
    client = await connect(daemon);
    return waitForReport(client, (report) => report.backfill.state === "done");
  }

  test("reprices history the moment an override is saved", async () => {
    const before = await start();
    expect(before.summary.estimatedCost).toBe(0);

    const updated = new Promise<void>((resolve) => {
      client.on("usage.pricing.updated", () => resolve());
    });
    await client.patchDaemonConfig({
      usage: {
        pricing: {
          overrides: [
            { model: "claude-fable-5-1", pricePerMillion: ONE_DOLLAR_PER_TOKEN },
            { model: "claude-opus-5", pricePerMillion: FREE },
          ],
        },
      },
    });
    await updated;

    const after = await waitForReport(client, (report) => report.summary.estimatedCost > 0);
    expect(after.summary.estimatedCost).toBe(FABLE_BILLABLE);
    expect(after.models.map((model) => [model.model, model.estimatedCost, model.priced])).toEqual([
      ["claude-fable-5-1", FABLE_BILLABLE, true],
      ["claude-opus-5", 0, true],
    ]);
  });

  test("sends the usage events only to the sockets that asked for them", async () => {
    await start();

    const legacy = await LegacyPeer.connect(daemon.port);
    try {
      const subscribed = new Promise<void>((resolve) => {
        client.on("usage.pricing.updated", () => resolve());
      });
      await client.patchDaemonConfig({
        usage: {
          pricing: {
            overrides: [{ model: "claude-opus-5", pricePerMillion: ONE_DOLLAR_PER_TOKEN }],
          },
        },
      });

      // The subscribing socket still gets it. Without this half, the assertion
      // below also passes when the event is never published at all.
      await subscribed;

      // A round trip on the quiet socket: whatever the daemon had already
      // queued for it was written before this response was.
      await legacy.request({
        type: "usage.report.get.request",
        requestId: "req-quiet",
        from: null,
        to: null,
        timezone: "UTC",
      });

      expect(legacy.eventTypes()).toEqual([]);
    } finally {
      legacy.close();
    }
  });

  test("lists a zero override as priced and says where each price came from", async () => {
    await start();

    const listed = await client.usagePricingList();

    expect(listed.models).toEqual([
      {
        model: "claude-opus-5",
        cli: "claude",
        backend: null,
        priced: true,
        priceSource: "override",
        matchedKey: "claude-opus-5",
        pricePerMillion: FREE,
        lastSeenAt: "2026-09-18T10:00:00.000Z",
      },
      {
        model: "claude-fable-5-1",
        cli: "claude",
        backend: null,
        priced: true,
        priceSource: "override",
        matchedKey: "claude-fable-5-1",
        pricePerMillion: FREE,
        lastSeenAt: "2026-09-18T09:45:00.000Z",
      },
    ] satisfies UsagePricingModel[]);
  });

  test("puts a model the table has no price for first", async () => {
    await start();
    // Refreshing narrows the table to one model, so the other loses its price.
    await client.usagePricingRefresh();
    await client.patchDaemonConfig({ usage: { pricing: { overrides: [] } } });

    const listed = await client.usagePricingList();

    expect(listed.models.map((model) => [model.model, model.priced, model.priceSource])).toEqual([
      ["claude-opus-5", false, null],
      ["claude-fable-5-1", true, "table"],
    ]);
  });
});

/**
 * Stands in for open.er-api.com on loopback. It records every request so a test
 * can assert how often the daemon asked and what it sent.
 */
class FakeRateServer {
  readonly requests: { method: string; url: string; headers: IncomingHttpHeaders }[] = [];
  reply: { status: number; body: string } = rateReply(7.12);
  private constructor(private readonly server: Server) {}

  static async start(): Promise<FakeRateServer> {
    let fake: FakeRateServer | null = null;
    const server = createServer((request, response) => {
      fake?.requests.push({
        method: request.method ?? "",
        url: request.url ?? "",
        headers: request.headers,
      });
      const reply = fake?.reply ?? { status: 500, body: "" };
      response.writeHead(reply.status, { "content-type": "application/json" });
      response.end(reply.body);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    fake = new FakeRateServer(server);
    return fake;
  }

  get url(): string {
    const { port } = this.server.address() as AddressInfo;
    return `http://127.0.0.1:${port}/v6/latest/USD`;
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}

function rateReply(cny: number): { status: number; body: string } {
  return {
    status: 200,
    body: JSON.stringify({ result: "success", base_code: "USD", rates: { USD: 1, CNY: cny } }),
  };
}

const RATE_VERSION = "0.17.0-test";
const HOUR = 60 * 60 * 1000;
const RATE_START = Date.parse("2026-10-23T08:00:00.000Z");

describe("exchange rate", () => {
  let rates: FakeRateServer;
  let homeRoot: string;
  let nowMs = RATE_START;
  const daemons: TestPaseoDaemon[] = [];
  const clients: DaemonClient[] = [];

  async function start(options: { autoUpdate: boolean }): Promise<DaemonClient> {
    const daemon = await createTestPaseoDaemon({
      paseoHomeRoot: homeRoot,
      cleanup: false,
      daemonVersion: RATE_VERSION,
      usage: {
        roots: { claude: [await emptyRoot()], codex: [], pi: [], omp: [] },
        now: () => nowMs,
        pricing: { autoUpdate: options.autoUpdate, overrides: [] },
        exchangeRate: { url: rates.url, fetch: globalThis.fetch },
      },
    });
    daemons.push(daemon);
    const client = await connect(daemon);
    clients.push(client);
    return client;
  }

  async function stopAll(): Promise<void> {
    for (const client of clients.splice(0)) await client.close();
    for (const daemon of daemons.splice(0)) await daemon.close();
  }

  async function rateOf(client: DaemonClient) {
    const { requestId: _requestId, ...rate } = await client.usageExchangeRateGet();
    return rate;
  }

  /** The broadcast that tells clients a fetched rate landed and they should ask again. */
  function nextRateLanding(client: DaemonClient): Promise<void> {
    return new Promise<void>((resolve) => {
      client.on("usage.pricing.updated", () => resolve());
    });
  }

  /** Asks once, which answers at once and fetches behind it, then waits for the rate to land. */
  async function fetchBehind(client: DaemonClient): Promise<void> {
    const landed = nextRateLanding(client);
    await rateOf(client);
    await landed;
  }

  /** Nothing should be sent; give a fetch that was wrongly started the time to reach the server. */
  async function expectNoFetchBeyond(count: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(rates.requests).toHaveLength(count);
  }

  beforeEach(async () => {
    nowMs = RATE_START;
    rates = await FakeRateServer.start();
    homeRoot = await mkdtemp(path.join(os.tmpdir(), "paseo-exchange-rate-home-"));
    tempRoots.push(homeRoot);
  });

  afterEach(async () => {
    await stopAll();
    await rates.close();
  });

  // magpie's page never waits on the network: fx.Soon answers what it knows and
  // fetches behind it (internal/fx/fx.go:132-157, internal/gui/api.go:333-344).
  test("answers 7.2 at once, fetches behind it as Osuna with no credentials, and tells clients", async () => {
    const client = await start({ autoUpdate: true });
    const landed = nextRateLanding(client);

    expect(await rateOf(client)).toEqual({
      cnyPerUsd: 7.2,
      fetchedAt: null,
      fallback: true,
      stale: true,
    });
    await landed;
    expect(await rateOf(client)).toEqual({
      cnyPerUsd: 7.12,
      fetchedAt: "2026-10-23T08:00:00.000Z",
      fallback: false,
      stale: false,
    });
    expect(rates.requests).toHaveLength(1);
    const [sent] = rates.requests;
    expect(sent?.method).toBe("GET");
    expect(sent?.url).toBe("/v6/latest/USD");
    expect(sent?.headers["user-agent"]).toBe(`Osuna/${RATE_VERSION}`);
    expect(sent?.headers.authorization).toBeUndefined();
    expect(sent?.headers.cookie).toBeUndefined();

    const cachePath = path.join(homeRoot, ".paseo", "usage", "exchange-rate.json");
    expect(JSON.parse(await readFile(cachePath, "utf8"))).toEqual({
      cnyPerUsd: 7.12,
      fetchedAt: "2026-10-23T08:00:00.000Z",
    });
    if (process.platform !== "win32") expect((await stat(cachePath)).mode & 0o777).toBe(0o600);
  });

  test("answers from the cache for a day, across a restart, then refreshes it behind the answer", async () => {
    let client = await start({ autoUpdate: true });
    await fetchBehind(client);

    nowMs = RATE_START + 23 * HOUR;
    await stopAll();
    client = await start({ autoUpdate: true });
    rates.reply = rateReply(7.3);
    const cached = {
      cnyPerUsd: 7.12,
      fetchedAt: "2026-10-23T08:00:00.000Z",
      fallback: false,
      stale: false,
    };
    expect(await rateOf(client)).toEqual(cached);
    await expectNoFetchBeyond(1);

    nowMs = RATE_START + 24 * HOUR;
    const landed = nextRateLanding(client);
    expect(await rateOf(client)).toEqual({ ...cached, stale: true });
    await landed;
    expect(await rateOf(client)).toEqual({
      cnyPerUsd: 7.3,
      fetchedAt: "2026-10-24T08:00:00.000Z",
      fallback: false,
      stale: false,
    });
    expect(rates.requests).toHaveLength(2);
  });

  test("keeps the last rate when a fetch fails, and waits ten minutes before trying again", async () => {
    const client = await start({ autoUpdate: true });
    await fetchBehind(client);

    nowMs = RATE_START + 25 * HOUR;
    rates.reply = { status: 503, body: "busy" };
    const lastRate = {
      cnyPerUsd: 7.12,
      fetchedAt: "2026-10-23T08:00:00.000Z",
      fallback: false,
      stale: true,
    };
    expect(await rateOf(client)).toEqual(lastRate);
    await expect.poll(() => rates.requests.length).toBe(2);
    await expectNoFetchBeyond(2);
    expect(await rateOf(client)).toEqual(lastRate);

    rates.reply = rateReply(7.3);
    nowMs += 9 * 60 * 1000;
    expect(await rateOf(client)).toEqual(lastRate);
    await expectNoFetchBeyond(2);

    nowMs += 60 * 1000;
    await fetchBehind(client);
    expect((await rateOf(client)).cnyPerUsd).toBe(7.3);
    expect(rates.requests).toHaveLength(3);
  });

  test("answers 7.2 as the fallback when no rate was ever fetched", async () => {
    rates.reply = { status: 200, body: JSON.stringify({ result: "error", rates: {} }) };
    const client = await start({ autoUpdate: true });
    const fallback = { cnyPerUsd: 7.2, fetchedAt: null, fallback: true, stale: true };

    expect(await rateOf(client)).toEqual(fallback);
    await expect.poll(() => rates.requests.length).toBe(1);
    expect(await rateOf(client)).toEqual(fallback);
    await expectNoFetchBeyond(1);
  });

  test("sends nothing while the price table's auto-update is off", async () => {
    let client = await start({ autoUpdate: false });
    expect(await rateOf(client)).toEqual({
      cnyPerUsd: 7.2,
      fetchedAt: null,
      fallback: true,
      stale: true,
    });
    await expectNoFetchBeyond(0);

    await client.patchDaemonConfig({ usage: { pricing: { autoUpdate: true } } });
    await fetchBehind(client);
    expect(rates.requests).toHaveLength(1);

    nowMs = RATE_START + 48 * HOUR;
    await client.patchDaemonConfig({ usage: { pricing: { autoUpdate: false } } });
    expect(await rateOf(client)).toEqual({
      cnyPerUsd: 7.12,
      fetchedAt: "2026-10-23T08:00:00.000Z",
      fallback: false,
      stale: true,
    });
    await expectNoFetchBeyond(1);
    await stopAll();
    client = await start({ autoUpdate: false });
    expect((await rateOf(client)).cnyPerUsd).toBe(7.12);
    await expectNoFetchBeyond(1);
  });
});
