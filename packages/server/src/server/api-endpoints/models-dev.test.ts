import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createTestLogger } from "../../test-utils/test-logger.js";
import { MODELS_DEV_URL, ModelsDevCatalog } from "./models-dev.js";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const API_JSON = {
  openai: {
    models: {
      "gpt-6-sol": {
        limit: { context: 1_050_000, input: 922_000, output: 128_000 },
        reasoning_options: [{ type: "effort", values: ["low", "high"] }],
        modalities: { input: ["text", "image"], output: ["text"] },
      },
    },
  },
};

const GPT_6_SOL = { context: 922_000, output: 128_000, efforts: ["low", "high"], images: true };

interface Request {
  url: string;
  ifNoneMatch: string | null;
}

/** 手动推进的定时器与可编排的假网络。 */
class Harness {
  now = Date.parse("2026-10-15T00:00:00.000Z");
  allowed = true;
  updates = 0;
  requests: Request[] = [];
  pending: { handler: () => void; ms: number } | null = null;
  respond: () => Promise<Response> = async () =>
    new Response(JSON.stringify(API_JSON), { status: 200, headers: { etag: "etag-1" } });

  constructor(readonly filePath: string) {}

  create(): ModelsDevCatalog {
    return new ModelsDevCatalog({
      filePath: this.filePath,
      logger: createTestLogger(),
      now: () => this.now,
      isAllowed: () => this.allowed,
      onUpdated: () => {
        this.updates += 1;
      },
      fetch: async (input, init) => {
        const headers = new Headers(init?.headers);
        this.requests.push({ url: String(input), ifNoneMatch: headers.get("if-none-match") });
        return this.respond();
      },
      timers: {
        schedule: (handler, ms) => {
          this.pending = { handler, ms };
          return () => {
            this.pending = null;
          };
        },
      },
    });
  }

  /** 让到期的那次检查跑完；返回它等了多久。 */
  async fire(): Promise<number> {
    const pending = this.pending;
    if (!pending) throw new Error("Nothing scheduled");
    this.pending = null;
    this.now += pending.ms;
    pending.handler();
    for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve));
    return pending.ms;
  }
}

const temps: string[] = [];

afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function harness(): Promise<Harness> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "paseo-models-dev-"));
  temps.push(dir);
  return new Harness(path.join(dir, "api-endpoints", "models-dev.json"));
}

describe("ModelsDevCatalog", () => {
  test("keeps each provider's own word on temperature, by its API host, across restarts", async () => {
    const h = await harness();
    h.respond = async () =>
      new Response(
        JSON.stringify({
          ...API_JSON,
          deepseek: {
            api: "https://api.deepseek.com",
            models: { "deepseek-reasoner": { temperature: false } },
          },
        }),
        { status: 200 },
      );
    const catalog = h.create();
    const ask = { hosts: ["api.deepseek.com"], modelId: "deepseek-reasoner" };
    expect(catalog.takesSampling(ask)).toBeUndefined();

    catalog.start();
    await h.fire();
    catalog.dispose();

    expect(catalog.takesSampling(ask)).toBe(false);
    expect(h.create().takesSampling(ask)).toBe(false);
    expect(h.create().takesSampling({ ...ask, hosts: ["relay.example"] })).toBeUndefined();
  });

  // magpie 的 claudeOwn：models.dev 上 Anthropic 的文字模型，新发布的在前（catalog.Provider、textModel）。
  test("lists Claude Code's own models newest first, across restarts", async () => {
    const h = await harness();
    h.respond = async () =>
      new Response(
        JSON.stringify({
          anthropic: {
            models: {
              "claude-sonnet-4-5": { release_date: "2025-09-29" },
              "claude-opus-4-6": { release_date: "2026-02-05" },
              "claude-opus-4-6-20260205": { release_date: "2026-02-05" },
              "claude-embed-1": { release_date: "2026-05-01" },
              "claude-voice-1": { release_date: "2026-06-01", modalities: { output: ["audio"] } },
            },
          },
          other: { models: { "claude-mythos-9": { release_date: "2026-09-01" } } },
        }),
        { status: 200 },
      );
    const catalog = h.create();
    expect(catalog.claudeCodeModels()).toEqual([]);

    catalog.start();
    await h.fire();
    catalog.dispose();

    const newestFirst = ["claude-opus-4-6", "claude-opus-4-6-20260205", "claude-sonnet-4-5"];
    expect(catalog.claudeCodeModels()).toEqual(newestFirst);
    expect(h.create().claudeCodeModels()).toEqual(newestFirst);
  });

  test("knows nothing before the first download, then keeps what it fetched across restarts", async () => {
    const h = await harness();
    const catalog = h.create();
    expect(catalog.facts("gpt-6-sol")).toEqual({});

    catalog.start();
    expect(await h.fire()).toBe(30_000);

    expect(h.requests).toEqual([{ url: MODELS_DEV_URL, ifNoneMatch: null }]);
    expect(catalog.facts("openai/gpt-6-sol")).toEqual(GPT_6_SOL);
    expect(h.updates).toBe(1);
    // 下一次是一天以后。
    expect(h.pending?.ms).toBe(DAY);
    catalog.dispose();

    expect(h.create().facts("gpt-6-sol")).toEqual(GPT_6_SOL);
  });

  test("a cache younger than a day is not fetched again; an older one asks with its etag", async () => {
    const h = await harness();
    const first = h.create();
    first.start();
    await h.fire();
    first.dispose();

    h.now += 6 * HOUR;
    const restarted = h.create();
    restarted.start();
    await h.fire();
    expect(h.requests).toHaveLength(1);
    // 等到满一天才问，带着上次的 etag；没变不算更新。
    h.respond = async () => new Response(null, { status: 304 });
    expect(await h.fire()).toBe(DAY - 6 * HOUR - 30_000);
    expect(h.requests[1]).toEqual({ url: MODELS_DEV_URL, ifNoneMatch: "etag-1" });
    expect(h.updates).toBe(1);
    expect(restarted.facts("gpt-6-sol")).toEqual(GPT_6_SOL);
    expect(h.pending?.ms).toBe(DAY);
    const saved = JSON.parse(await readFile(h.filePath, "utf8")) as { fetchedAt: string };
    expect(Date.parse(saved.fetchedAt)).toBe(h.now);
  });

  test("a failed download keeps what it had and tries again an hour later", async () => {
    const h = await harness();
    const catalog = h.create();
    catalog.start();
    await h.fire();

    h.respond = async () => new Response("bad gateway", { status: 502 });
    await h.fire();
    expect(catalog.facts("gpt-6-sol")).toEqual(GPT_6_SOL);
    expect(h.pending?.ms).toBe(HOUR);

    h.respond = async () => {
      throw new Error("offline");
    };
    await h.fire();
    expect(catalog.facts("gpt-6-sol")).toEqual(GPT_6_SOL);
    expect(h.updates).toBe(1);
  });

  test("never downloads while it is not allowed; wake asks right away once it is", async () => {
    const h = await harness();
    h.allowed = false;
    const catalog = h.create();
    catalog.start();
    await h.fire();
    await h.fire();
    expect(h.requests).toEqual([]);

    h.allowed = true;
    catalog.wake();
    expect(await h.fire()).toBe(0);
    expect(h.requests).toHaveLength(1);
    expect(catalog.facts("gpt-6-sol")).toEqual(GPT_6_SOL);
  });
});
