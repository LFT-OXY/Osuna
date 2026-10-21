// 用例取自 magpie（https://github.com/yetone/magpie，internal/upstream/upstream_test.go，7597c132）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。
import pino from "pino";
import { describe, expect, test } from "vitest";
import { VendorStatusPages, vendorOfBaseUrls } from "./vendor-status.js";

const FIVE_MINUTES = 5 * 60_000;

/** status.claude.com 的 summary.json（2026-10-06 的样子），各项状态由用例给。 */
function claudePage(input: { api: string; code: string; web: string; incidents?: string }) {
  return `{"page":{"id":"tymt9n04zgry","name":"Claude","url":"https://status.claude.com"},
"status":{"indicator":"none","description":"All Systems Operational"},
"components":[{"id":"rwppv331jlwc","name":"claude.ai","status":"${input.web}","group":false},
{"id":"0qbwn08sd68x","name":"Claude Console (platform.claude.com)","status":"operational","group":false},
{"id":"k8w3r06qmzrp","name":"Claude API (api.anthropic.com)","status":"${input.api}","group":false},
{"id":"yyzkbfz2thpt","name":"Claude Code","status":"${input.code}","group":false}],
"incidents":[${input.incidents ?? ""}]}`;
}

/** status.openai.com（incident.io）：没有分组，事件不写影响哪几项。 */
function openAIPage(input: { responses: string; desktop: string; incidents?: string }) {
  return `{"page":{"id":"01JMDK9XYNY6RXSED6SDWW50WY","name":"OpenAI","url":"https://status.openai.com/"},
"components":[{"id":"01JMXBRMFE6N2NNT7DG6XZQ6PW","name":"Chat Completions","status":"operational","group":null},
{"id":"01JP8CD9JR3HR6Y7G4Q75N4DVW","name":"Responses","status":"${input.responses}","group":null},
{"id":"01KMKFAMWKQ81YWSE1Z18R6VHR","name":"Codex in ChatGPT Desktop","status":"${input.desktop}","group":null},
{"id":"01JMXBNJXGGT5SR5DB9J7GYY48","name":"Voice mode","status":"major_outage","group":null}],
"incidents":[${input.incidents ?? ""}]}`;
}

interface FakePages {
  pages: VendorStatusPages;
  asked: string[];
  setClock: (ms: number) => void;
  answer: { status: number; body: string };
  // 下一次请求挂住，直到 release 被调用。
  hold: () => () => void;
  // 等候的计时器：由用例手动到点。
  fireWait: () => void;
}

function fakePages(): FakePages {
  let clock = Date.parse("2026-10-21T08:00:00.000Z");
  let held: Promise<void> | null = null;
  let pendingWait: (() => void) | null = null;
  const fake: FakePages = {
    pages: null as unknown as VendorStatusPages,
    asked: [],
    setClock: (ms) => {
      clock = ms;
    },
    answer: { status: 200, body: "{}" },
    hold: () => {
      let release = () => {};
      held = new Promise<void>((resolve) => {
        release = resolve;
      });
      return () => release();
    },
    fireWait: () => {
      const handler = pendingWait;
      pendingWait = null;
      handler?.();
    },
  };
  fake.pages = new VendorStatusPages({
    logger: pino({ level: "silent" }),
    now: () => new Date(clock),
    summaryUrls: { anthropic: "http://127.0.0.1:9/anthropic", openai: "http://127.0.0.1:9/openai" },
    timers: {
      schedule(handler) {
        pendingWait = handler;
        return () => {
          if (pendingWait === handler) pendingWait = null;
        };
      },
    },
    fetch: async (input) => {
      fake.asked.push(String(input));
      const waiting = held;
      held = null;
      if (waiting) await waiting;
      return new Response(fake.answer.body, { status: fake.answer.status });
    },
  });
  return fake;
}

async function one(fake: FakePages, vendor: string) {
  const [status] = await fake.pages.read({ vendors: [vendor] });
  return status;
}

describe("vendor status pages", () => {
  test("the Claude API down is said, with its own open incident only", async () => {
    const fake = fakePages();
    fake.answer.body = claudePage({
      api: "partial_outage",
      code: "operational",
      web: "operational",
      incidents: `{"name":"Elevated errors on Claude API","status":"investigating","impact":"major","shortlink":"https://stspg.io/x","components":[{"id":"k8w3r06qmzrp","name":"Claude API (api.anthropic.com)"}]},
{"name":"claude.ai login issues","status":"investigating","impact":"minor","shortlink":"https://stspg.io/y","components":[{"id":"rwppv331jlwc","name":"claude.ai"}]},
{"name":"Old one","status":"resolved","impact":"major","components":[{"id":"k8w3r06qmzrp"}]}`,
    });
    const status = await one(fake, "anthropic");
    expect(fake.asked).toEqual(["http://127.0.0.1:9/anthropic"]);
    expect(status).toEqual({
      vendor: "anthropic",
      name: "Anthropic",
      page: "https://status.claude.com",
      isLinkOnly: false,
      level: "partial",
      parts: [{ name: "Claude API (api.anthropic.com)", status: "partial_outage" }],
      incidents: [
        { name: "Elevated errors on Claude API", impact: "major", url: "https://stspg.io/x" },
      ],
      readAt: "2026-10-21T08:00:00.000Z",
      error: null,
    });
  });

  test("claude.ai down says nothing of the API", async () => {
    const fake = fakePages();
    fake.answer.body = claudePage({
      api: "operational",
      code: "operational",
      web: "major_outage",
      incidents: `{"name":"claude.ai down","status":"identified","impact":"critical","components":[{"id":"rwppv331jlwc","name":"claude.ai"}]}`,
    });
    const status = await one(fake, "anthropic");
    expect(status).toMatchObject({ level: "ok", parts: [], incidents: [] });
  });

  test("Claude Code degraded is the API degraded", async () => {
    const fake = fakePages();
    fake.answer.body = claudePage({
      api: "operational",
      code: "degraded_performance",
      web: "operational",
    });
    expect((await one(fake, "anthropic")).level).toBe("degraded");
  });

  test("OpenAI's desktop app is not the API; an incident naming no parts counts only while the API is affected", async () => {
    const fake = fakePages();
    const incident = `{"name":"Elevated Work Mode errors","status":"monitoring","impact":"minor","shortlink":null,"components":null}`;
    fake.answer.body = openAIPage({
      responses: "operational",
      desktop: "degraded_performance",
      incidents: incident,
    });
    expect(await one(fake, "openai")).toMatchObject({ level: "ok", incidents: [] });

    fake.setClock(Date.parse("2026-10-21T08:05:00.000Z"));
    fake.answer.body = openAIPage({
      responses: "major_outage",
      desktop: "operational",
      incidents: incident,
    });
    expect(await one(fake, "openai")).toMatchObject({
      level: "major",
      incidents: [{ name: "Elevated Work Mode errors", impact: "minor", url: null }],
    });
  });

  test("a page that fails is unknown, never all well, and does not keep saying the outage it said before", async () => {
    const fake = fakePages();
    const start = Date.parse("2026-10-21T08:00:00.000Z");
    fake.answer.body = claudePage({ api: "major_outage", code: "operational", web: "operational" });
    expect((await one(fake, "anthropic")).level).toBe("major");

    fake.setClock(start + FIVE_MINUTES);
    fake.answer = { status: 503, body: "" };
    expect(await one(fake, "anthropic")).toMatchObject({
      level: null,
      parts: [],
      error: { code: "vendor_status_http", params: { status: "503" } },
    });

    fake.setClock(start + 3 * FIVE_MINUTES);
    fake.answer = { status: 200, body: "<html>Just a moment...</html>" };
    expect(await one(fake, "anthropic")).toMatchObject({
      level: null,
      error: { code: "vendor_status_unreadable" },
    });

    // 不再列出 API 依赖的那几项：页面改了，说不出 API 怎样。
    fake.setClock(start + 5 * FIVE_MINUTES);
    fake.answer.body = `{"components":[{"id":"a","name":"Something else","status":"operational"}],"incidents":[]}`;
    expect(await one(fake, "anthropic")).toMatchObject({
      level: null,
      error: { code: "vendor_status_no_api_parts" },
    });
  });

  test("a page is read once in five minutes however often it is asked for; a stale one is read again", async () => {
    const fake = fakePages();
    const start = Date.parse("2026-10-21T08:00:00.000Z");
    fake.answer.body = claudePage({ api: "operational", code: "operational", web: "operational" });
    await Promise.all([one(fake, "anthropic"), one(fake, "anthropic")]);
    fake.setClock(start + FIVE_MINUTES - 1);
    await one(fake, "anthropic");
    expect(fake.asked).toHaveLength(1);

    fake.setClock(start + FIVE_MINUTES);
    fake.answer.body = claudePage({ api: "major_outage", code: "operational", web: "operational" });
    expect((await one(fake, "anthropic")).level).toBe("major");
    expect(fake.asked).toHaveLength(2);
  });

  test("a read that takes longer than the wait answers with the last reading, and the page is still read", async () => {
    const fake = fakePages();
    const start = Date.parse("2026-10-21T08:00:00.000Z");
    fake.answer.body = claudePage({ api: "operational", code: "operational", web: "operational" });
    await one(fake, "anthropic");

    fake.setClock(start + FIVE_MINUTES);
    const release = fake.hold();
    fake.answer.body = claudePage({ api: "major_outage", code: "operational", web: "operational" });
    const reading = fake.pages.read({ vendors: ["anthropic"] });
    await expect.poll(() => fake.asked.length).toBe(2);
    fake.fireWait();
    expect((await reading)[0].level).toBe("ok");

    release();
    await expect.poll(async () => (await one(fake, "anthropic")).level).toBe("major");
    expect(fake.asked).toHaveLength(2);
  });

  test("DeepSeek's page is only linked, never asked; unknown vendors are left out", async () => {
    const fake = fakePages();
    const statuses = await fake.pages.read({ vendors: ["deepseek", "nobody"] });
    expect(statuses).toEqual([
      {
        vendor: "deepseek",
        name: "DeepSeek",
        page: "https://status.deepseek.com",
        isLinkOnly: true,
        level: null,
        parts: [],
        incidents: [],
        readAt: null,
        error: null,
      },
    ]);
    expect(fake.asked).toEqual([]);
  });

  test("unread statuses ask nothing", () => {
    const fake = fakePages();
    expect(fake.pages.unread(["anthropic", "moonshot"]).map((s) => [s.vendor, s.level])).toEqual([
      ["anthropic", null],
      ["moonshot", null],
    ]);
    expect(fake.asked).toEqual([]);
  });

  test("an endpoint is matched to a vendor by any of its base URLs' hosts", () => {
    const cases: [string[], string | null][] = [
      [["https://api.anthropic.com"], "anthropic"],
      [["https://api.openai.com/v1"], "openai"],
      [["https://chatgpt.com/backend-api/codex"], "openai"],
      [["https://api.deepseek.com/v1", "https://api.deepseek.com/anthropic"], "deepseek"],
      [["https://api.moonshot.cn/v1"], "moonshot"],
      [["https://API.Moonshot.ai:443/v1"], "moonshot"],
      [["https://relay.example.com/v1", "https://relay.example.com"], null],
      [["https://api.anthropic.com.evil.example/v1"], null],
      [["http://127.0.0.1:11434/v1"], null],
    ];
    for (const [urls, vendor] of cases) expect(vendorOfBaseUrls(urls)).toBe(vendor);
  });
});
