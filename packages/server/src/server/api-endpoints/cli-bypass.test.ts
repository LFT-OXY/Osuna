import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { findCliBypass, readCliUse, type FindCliBypassInput } from "./cli-bypass.js";

const GATEWAY = "http://127.0.0.1:6768/api-endpoint-gateway";
const T0 = new Date("2026-10-18T10:00:00.000Z");

function at(seconds: number): Date {
  return new Date(T0.getTime() + seconds * 1000);
}

function bypassInput(overrides: Partial<FindCliBypassInput>): FindCliBypassInput {
  return {
    use: { lastPromptAt: null, lastRequest: null },
    startedAt: T0,
    rewrittenAt: at(10),
    lastSeen: null,
    gatewayUrls: [GATEWAY],
    now: at(600),
    ...overrides,
  };
}

describe("findCliBypass", () => {
  test("used after the rewrite with nothing reaching the gateway is bypassed", () => {
    const use = { lastPromptAt: at(100), lastRequest: null };
    expect(findCliBypass(bypassInput({ use }))).toEqual({ how: "used", at: at(100) });
  });

  test("a request the gateway saw since, or two seconds before, counts as coming through", () => {
    const use = { lastPromptAt: at(100), lastRequest: null };
    expect(findCliBypass(bypassInput({ use, lastSeen: at(105) }))).toBeNull();
    expect(findCliBypass(bypassInput({ use, lastSeen: at(98) }))).toBeNull();
    expect(findCliBypass(bypassInput({ use, lastSeen: at(97) }))).toEqual({
      how: "used",
      at: at(100),
    });
  });

  test("a use before the rewrite, before the daemon started, or still within thirty seconds doesn't count", () => {
    const before = { lastPromptAt: at(5), lastRequest: null };
    expect(findCliBypass(bypassInput({ use: before, startedAt: at(-60) }))).toBeNull();
    const beforeStart = { lastPromptAt: at(100), lastRequest: null };
    expect(
      findCliBypass(bypassInput({ use: beforeStart, startedAt: at(200), rewrittenAt: null })),
    ).toBeNull();
    const recent = { lastPromptAt: at(100), lastRequest: null };
    expect(findCliBypass(bypassInput({ use: recent, now: at(130) }))).toBeNull();
    expect(findCliBypass(bypassInput({ use: recent, now: at(131) }))).toEqual({
      how: "used",
      at: at(100),
    });
  });

  test("Codex's newest connection to somewhere else is bypassed unless the gateway saw it", () => {
    const use = {
      lastPromptAt: null,
      lastRequest: {
        at: at(100),
        to: "wss://chatgpt.com/backend-api/codex/responses",
        isRefused: false,
      },
    };
    expect(findCliBypass(bypassInput({ use }))).toEqual({
      how: "elsewhere",
      at: at(100),
      host: "chatgpt.com",
    });
    expect(findCliBypass(bypassInput({ use, lastSeen: at(99) }))).toBeNull();
  });

  test("a connection to the gateway that nothing answered is bypassed; one that went through isn't", () => {
    const refused = {
      lastPromptAt: null,
      lastRequest: {
        at: at(100),
        to: "ws://127.0.0.1:6768/api-endpoint-gateway/v1/responses",
        isRefused: true,
      },
    };
    expect(findCliBypass(bypassInput({ use: refused }))).toEqual({ how: "refused", at: at(100) });
    const answered = { ...refused, lastRequest: { ...refused.lastRequest, isRefused: false } };
    expect(findCliBypass(bypassInput({ use: answered }))).toBeNull();
  });

  test("the address written in the CLI's config counts as the gateway too, the port included", () => {
    const use = {
      lastPromptAt: null,
      lastRequest: { at: at(100), to: "ws://127.0.0.1:7000/v1/responses", isRefused: false },
    };
    expect(findCliBypass(bypassInput({ use }))).toEqual({
      how: "elsewhere",
      at: at(100),
      host: "127.0.0.1:7000",
    });
    expect(
      findCliBypass(bypassInput({ use, gatewayUrls: [GATEWAY, "http://127.0.0.1:7000/x"] })),
    ).toBeNull();
  });
});

describe("readCliUse", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "osuna-cli-bypass-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("Claude Code: the newest timestamp in history.jsonl, in milliseconds, slash commands passed over", () => {
    writeFileSync(
      path.join(dir, "history.jsonl"),
      [
        JSON.stringify({ display: "fix the bug", timestamp: at(100).getTime() + 400 }),
        JSON.stringify({ display: " /model", timestamp: at(300).getTime() }),
        "not json",
        JSON.stringify({ display: "add a test", timestamp: at(200).getTime() }),
      ].join("\n"),
    );
    expect(readCliUse({ provider: "claude", configDir: dir, since: null, now: at(600) })).toEqual({
      lastPromptAt: at(200),
      lastRequest: null,
    });
  });

  test("no history.jsonl reads as never used", () => {
    expect(readCliUse({ provider: "claude", configDir: dir, since: null, now: at(600) })).toEqual({
      lastPromptAt: null,
      lastRequest: null,
    });
  });

  test("Codex: history.jsonl in seconds, and the newest model connection in its log database", () => {
    writeFileSync(
      path.join(dir, "history.jsonl"),
      `${JSON.stringify({ session_id: "s", ts: 1_760_781_700, text: "hello" })}\n`,
    );
    const older = new DatabaseSync(path.join(dir, "logs_1.sqlite"));
    older.exec(
      "CREATE TABLE logs (id INTEGER, ts INTEGER, ts_nanos INTEGER, target TEXT, feedback_log_body TEXT)",
    );
    older.close();
    const db = new DatabaseSync(path.join(dir, "logs_2.sqlite"));
    db.exec(
      "CREATE TABLE logs (id INTEGER, ts INTEGER, ts_nanos INTEGER, target TEXT, feedback_log_body TEXT)",
    );
    const insert = db.prepare(
      "INSERT INTO logs (id, ts, ts_nanos, target, feedback_log_body) VALUES (?, ?, 0, ?, ?)",
    );
    const target = "codex_api::endpoint::responses_websocket";
    const seconds = (date: Date) => Math.trunc(date.getTime() / 1000);
    insert.run(1, seconds(at(50)), target, "connecting to websocket: wss://before.example/v1");
    insert.run(
      2,
      seconds(at(100)),
      target,
      "connecting to websocket: ws://127.0.0.1:6768/v1/responses",
    );
    insert.run(
      3,
      seconds(at(101)),
      target,
      "failed to connect to websocket: IO error: Connection refused (os error 61), url: ws://127.0.0.1:6768/v1/responses",
    );
    insert.run(
      4,
      seconds(at(102)),
      "codex_core::other",
      "connecting to websocket: wss://other.example",
    );
    db.close();

    expect(readCliUse({ provider: "codex", configDir: dir, since: at(60), now: at(600) })).toEqual({
      lastPromptAt: new Date(1_760_781_700_000),
      lastRequest: { at: at(100), to: "ws://127.0.0.1:6768/v1/responses", isRefused: true },
    });
    // 改写之前的连接不算。
    expect(readCliUse({ provider: "codex", configDir: dir, since: at(200), now: at(600) })).toEqual(
      {
        lastPromptAt: new Date(1_760_781_700_000),
        lastRequest: null,
      },
    );
  });

  test("a log database of another shape reads as no connection", () => {
    const db = new DatabaseSync(path.join(dir, "logs_2.sqlite"));
    db.exec("CREATE TABLE something_else (id INTEGER)");
    db.close();
    expect(readCliUse({ provider: "codex", configDir: dir, since: null, now: at(600) })).toEqual({
      lastPromptAt: null,
      lastRequest: null,
    });
  });
});
