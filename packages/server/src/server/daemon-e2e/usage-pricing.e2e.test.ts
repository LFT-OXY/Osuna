import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
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
