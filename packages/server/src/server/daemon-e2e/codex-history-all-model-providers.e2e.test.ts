import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { DaemonClient } from "../test-utils/daemon-client.js";
import { createTestPaseoDaemon, type TestPaseoDaemon } from "../test-utils/paseo-daemon.js";

// 假 Codex：`--version` 报版本；`app-server` 按行收发 JSON-RPC，`thread/list` 照 Codex 的规则过滤
// 夹具里的对话——不传 modelProviders 只列当前服务商（这里是 openai），传空数组列全部，传列表只列这些。
const FAKE_CODEX_SOURCE = String.raw`
const fs = require("node:fs");
const readline = require("node:readline");
if (process.argv[2] === "--version") {
  process.stdout.write("codex-cli 0.163.0\n");
  process.exit(0);
}
if (process.argv[2] !== "app-server") process.exit(1);
const threads = JSON.parse(fs.readFileSync(process.env.FAKE_CODEX_THREADS, "utf8"));
const reply = (message) => process.stdout.write(JSON.stringify(message) + "\n");
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  if (message.method === "initialize") return reply({ id: message.id, result: {} });
  if (message.method === "thread/list") {
    const providers = message.params && message.params.modelProviders;
    const listed = threads.filter((thread) => {
      if (providers === undefined || providers === null) return thread.modelProvider === "openai";
      if (providers.length === 0) return true;
      return providers.includes(thread.modelProvider);
    });
    return reply({ id: message.id, result: { data: listed, nextCursor: null } });
  }
  reply({ id: message.id, error: { code: -32601, message: "not supported by the fake" } });
});
`;

describe("daemon E2E - Session history lists Codex conversations of every Codex model provider", () => {
  let tempRoot: string;
  let cwd: string;
  let daemon: TestPaseoDaemon | undefined;
  let client: DaemonClient | undefined;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(tmpdir(), "codex-history-all-providers-"));
    cwd = path.join(tempRoot, "repo");
    await mkdir(cwd, { recursive: true });
  });

  afterEach(async () => {
    await client?.close().catch(() => undefined);
    await daemon?.close().catch(() => undefined);
    client = undefined;
    daemon = undefined;
    await rm(tempRoot, { recursive: true, force: true });
  }, 60_000);

  test("lists conversations filed under two Codex model providers, each naming its own", async () => {
    const threadsFile = path.join(tempRoot, "threads.json");
    await writeFile(
      threadsFile,
      JSON.stringify([
        {
          id: "thread-official",
          cwd,
          name: "Started on the official setup",
          modelProvider: "openai",
          updatedAt: 1_760_000_200,
        },
        {
          id: "thread-gateway",
          cwd,
          name: "Started through the gateway",
          modelProvider: "osuna_api_endpoint",
          updatedAt: 1_760_000_100,
        },
      ]),
    );
    const fakeCodex = path.join(tempRoot, "bin", "codex");
    await mkdir(path.dirname(fakeCodex), { recursive: true });
    await writeFile(fakeCodex, `#!${process.execPath}\n${FAKE_CODEX_SOURCE}`);
    await chmod(fakeCodex, 0o755);

    daemon = await createTestPaseoDaemon({
      agentClients: {},
      providerOverrides: {
        claude: { enabled: false },
        pi: { enabled: false },
        omp: { enabled: false },
        codex: {
          command: [fakeCodex],
          env: { CODEX_HOME: path.join(tempRoot, "codex-home"), FAKE_CODEX_THREADS: threadsFile },
        },
      },
    });
    client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws` });
    await client.connect();

    const listing = await client.fetchRecentProviderSessions({
      cwd,
      providers: ["codex"],
      includeImported: true,
    });

    expect(listing.providerErrors ?? []).toEqual([]);
    expect(
      listing.entries.map((entry) => [entry.providerHandleId, entry.codexModelProvider]),
    ).toEqual([
      ["thread-official", "openai"],
      ["thread-gateway", "osuna_api_endpoint"],
    ]);
  }, 60_000);
});
