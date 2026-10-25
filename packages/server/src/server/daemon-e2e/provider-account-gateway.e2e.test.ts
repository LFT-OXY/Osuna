// 用例的场景取自 magpie（MIT，THIRD_PARTY_NOTICES）d5805372 的 internal/gateway/codex_accounts_test.go、
// codex_credits_test.go、strict_affinity_test.go 与 fallback_test.go 里账号之间换号的那几组

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import {
  createServer,
  request as httpRequest,
  type IncomingHttpHeaders,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { AccountUsageReader, AccountUsageResult } from "../provider-accounts/service.js";
import { FakeCliKeychain } from "../test-utils/fake-cli-keychain.js";
import {
  FakeOpenAiAuth,
  accessToken,
  idToken,
  type FakeOpenAiAccount,
} from "../test-utils/fake-openai-auth.js";
import { createTestPaseoDaemon, type TestPaseoDaemon } from "../test-utils/paseo-daemon.js";
import { DaemonClient } from "../test-utils/daemon-client.js";

/*
 * Codex 第二层（工单 06）：开着轮换、有两个以上的号、没开「只换登录」时，Codex 的 ChatGPT 请求经过中转站，
 * 当前号接不了的请求在回复第一个字之前交给下一个号。真实 daemon + 本机假 ChatGPT 后端与假 OpenAI 登录服务；
 * 「Codex」用 node:http 扮演。登录只在临时目录与假钥匙串里，绝不碰真实的 ~/.codex，不连 OpenAI。
 */

const ONE: FakeOpenAiAccount = { accountId: "acct-1", email: "one@example.com", plan: "plus" };
const TWO: FakeOpenAiAccount = { accountId: "acct-2", email: "two@example.com", plan: "pro" };
const THREE: FakeOpenAiAccount = { accountId: "acct-3", email: "three@example.com", plan: "plus" };
const HOUR_MS = 60 * 60_000;
const CODEX_UA = "codex_cli_rs/0.130.0 (Mac OS 26.0; arm64) iTerm.app/3.6.5";

interface RecordedRequest {
  url: string;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

interface Reply {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

function sse(...events: unknown[]): string {
  return events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
}

/** 一段完整的回复：说一句话，带用量（提示词 prompt 个 token，缓存读到 cached 个）。 */
function answer(input: { text: string; id: string; cached?: number; prompt?: number }): string {
  return sse(
    { type: "response.created", response: { id: input.id } },
    { type: "response.output_text.delta", delta: input.text },
    {
      type: "response.completed",
      response: {
        id: input.id,
        status: "completed",
        usage: {
          input_tokens: input.prompt ?? 2000,
          input_tokens_details: { cached_tokens: input.cached ?? 0 },
          output_tokens: 5,
          output_tokens_details: { reasoning_tokens: 0 },
        },
      },
    },
  );
}

const USAGE_LIMIT = JSON.stringify({
  error: {
    type: "usage_limit_reached",
    message: "The usage limit has been reached",
    resets_in_seconds: 3600,
  },
});

function reading(session: number, extra: { onCredits?: boolean } = {}): AccountUsageResult {
  return {
    status: "read",
    fetchedAt: new Date().toISOString(),
    windows: [
      {
        id: "five_hour",
        label: "5-hour",
        usedPct: session,
        resetsAt: new Date(Date.now() + HOUR_MS).toISOString(),
      },
    ],
    ...(extra.onCredits ? { onCredits: true } : {}),
  };
}

type Answer = (request: RecordedRequest, res: ServerResponse) => void;

interface FakeChatGpt {
  url: string;
  requests: RecordedRequest[];
  server: Server;
}

/**
 * 本机假 ChatGPT 后端：按请求里的 ChatGPT-Account-Id 回答（answers 里没有的号回一段正常的回复）；
 * /v1 下的是第三方接口，答一段带接口名的回复。
 */
async function startFakeChatGpt(answers: Map<string, Answer>): Promise<FakeChatGpt> {
  const requests: RecordedRequest[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const recorded = { url: req.url ?? "", headers: req.headers, body: Buffer.concat(chunks) };
      requests.push(recorded);
      answerRequest({ recorded, res, answers });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, requests, server };
}

function answerRequest(input: {
  recorded: RecordedRequest;
  res: ServerResponse;
  answers: Map<string, Answer>;
}): void {
  const { recorded, res } = input;
  if (recorded.url.startsWith("/v1/")) {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end(answer({ text: "answered by the endpoint", id: "resp-endpoint" }));
    return;
  }
  const account = String(recorded.headers["chatgpt-account-id"] ?? "");
  const respond = input.answers.get(account);
  if (respond) {
    respond(recorded, res);
    return;
  }
  res.writeHead(200, { "content-type": "text/event-stream" });
  res.end(answer({ text: `answered by ${account}`, id: `resp-${account}` }));
}

/** 额度用完：ChatGPT 的 429 usage_limit_reached。 */
function usedUp(_request: RecordedRequest, res: ServerResponse): void {
  res.writeHead(429, { "content-type": "application/json", "retry-after": "3600" });
  res.end(USAGE_LIMIT);
}

/** 回复说了第一句就断了。 */
function cutAfterFirstWords(_request: RecordedRequest, res: ServerResponse): void {
  res.writeHead(200, { "content-type": "text/event-stream" });
  res.write(
    sse(
      { type: "response.created", response: { id: "resp-1" } },
      { type: "response.output_text.delta", delta: "half an answ" },
    ),
  );
  setTimeout(() => res.destroy(), 50);
}

/** 假后端依次被问到的号。 */
function accountsAsked(requests: RecordedRequest[]): unknown[] {
  return requests.map((request) => request.headers["chatgpt-account-id"]);
}

describe.skipIf(process.platform === "win32")("Codex accounts through the gateway", () => {
  let root: string;
  let codexHome: string;
  let auth: FakeOpenAiAuth;
  let keychain: FakeCliKeychain;
  let readings: Map<string, AccountUsageResult>;
  let backend: FakeChatGpt;
  // 按请求里的 ChatGPT-Account-Id 回答；没有登记的号回一段正常的回复。
  let answers: Map<string, Answer>;
  let daemons: TestPaseoDaemon[];
  let client: DaemonClient;

  const usage: AccountUsageReader = {
    async read(query) {
      const id = query.login?.accountId ?? query.identity;
      return readings.get(id) ?? reading(10);
    },
  };

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "paseo-account-gateway-"));
    codexHome = path.join(root, "codex-home");
    await mkdir(codexHome, { recursive: true });
    auth = new FakeOpenAiAuth();
    await auth.start();
    keychain = new FakeCliKeychain();
    readings = new Map();
    answers = new Map();
    daemons = [];
    backend = await startFakeChatGpt(answers);
  });

  afterEach(async () => {
    await client?.close();
    await Promise.all(daemons.map((each) => each.close()));
    await auth.close();
    backend.server.closeAllConnections();
    await new Promise<void>((resolve) => backend.server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  });

  async function startDaemon(): Promise<void> {
    const env = { CODEX_HOME: codexHome, CLAUDE_CONFIG_DIR: path.join(root, "claude"), USER: "t" };
    const daemon = await createTestPaseoDaemon({
      paseoHomeRoot: root,
      cleanup: false,
      cliSignInsLaunchEnv: {},
      apiEndpoints: {
        env,
        homeDir: root,
        gatewayChatGptBaseUrl: `${backend.url}/backend-api/codex`,
        gatewayOpenAiApiBaseUrl: "http://127.0.0.1:9/v1",
        // Codex 用 ChatGPT 登录：「使用第三方接口」按 openai_base_url 接（ADR 0010）。
        readCodexSignIn: async () => "chatgpt",
      },
      providerAccounts: {
        env,
        homeDir: root,
        platform: "darwin",
        keychain,
        usage,
        codexSignIn: {
          endpoints: { authorizeUrl: auth.authorizeUrl, tokenUrl: auth.tokenUrl },
          callbackPort: 0,
        },
      },
    });
    daemons.push(daemon);
    client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws`, appVersion: "0.17.0" });
    await client.connect();
  }

  function cliLogin(account: FakeOpenAiAccount): string {
    return JSON.stringify({
      OPENAI_API_KEY: null,
      auth_mode: "chatgpt",
      tokens: {
        id_token: idToken(account),
        access_token: accessToken({
          name: `cli-${account.accountId}`,
          expiresAt: Date.now() + HOUR_MS,
        }),
        refresh_token: auth.issueRefreshToken(account),
        account_id: account.accountId,
      },
      last_refresh: new Date().toISOString(),
    });
  }

  async function addAccount(account: FakeOpenAiAccount): Promise<string> {
    const started = await client.providerAccountSignInStart({ provider: "codex" });
    if (!started.signIn) throw new Error("no sign-in");
    const code = `code-${account.accountId}-${Math.random()}`;
    auth.issueCode(code, account);
    const page = new URL(started.signIn.authUrl);
    const redirect = new URL(page.searchParams.get("redirect_uri") ?? "");
    redirect.searchParams.set("code", code);
    redirect.searchParams.set("state", page.searchParams.get("state") ?? "");
    const done = await client.providerAccountSignInSubmit({
      signInId: started.signIn.id,
      callbackUrl: redirect.toString(),
    });
    if (done.signIn?.status !== "done") throw new Error(`sign-in ${done.signIn?.status}`);
    return done.signIn.result.accountId;
  }

  /** CLI 登录着 ONE，打开轮换（ONE 成为第 1 个号），再加上存着的号。 */
  async function setUp(saved: FakeOpenAiAccount[] = [TWO]): Promise<Record<string, string>> {
    await writeFile(path.join(codexHome, "auth.json"), cliLogin(ONE), { mode: 0o600 });
    await startDaemon();
    const on = await client.providerAccountSetRotation({
      provider: "codex",
      enabled: true,
      acknowledgeRiskNotice: true,
    });
    expect(on.error).toBeNull();
    const ids: Record<string, string> = { [ONE.accountId]: on.accounts[0]!.id };
    for (const account of saved) ids[account.accountId] = await addAccount(account);
    return ids;
  }

  function gatewayUrl(rest = "/responses"): string {
    const port = daemons.at(-1)!.port;
    return `http://127.0.0.1:${port}/api-endpoint-gateway/backend-api/codex${rest}`;
  }

  /** 扮演用 ONE 登录的 Codex 发一轮对话；body 缺省是 gpt-5.5 的一句话。 */
  function turn(
    input: { thread?: string; body?: Record<string, unknown>; account?: string } = {},
  ): Promise<Reply> {
    const body = Buffer.from(
      JSON.stringify(
        input.body ?? {
          model: "gpt-5.5",
          stream: true,
          input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }],
        },
      ),
    );
    const headers: Record<string, string> = {
      authorization: "Bearer cli-token-of-one",
      "chatgpt-account-id": input.account ?? ONE.accountId,
      "user-agent": CODEX_UA,
      originator: "codex_cli_rs",
      "session-id": input.thread ?? "thread-a",
      "thread-id": input.thread ?? "thread-a",
      "x-codex-turn-metadata": '{"turn_id":"t1"}',
      "x-oai-attestation": "attested-by-one",
      accept: "text/event-stream",
      "content-type": "application/json",
      "content-length": String(body.length),
    };
    return new Promise((resolve, reject) => {
      const sent = httpRequest(gatewayUrl(), { method: "POST", headers }, (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        // 回复中途被掐（上游断了）时 Codex 收到的是断开，照收到的算。
        response.on("close", () =>
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
        response.on("error", () => {});
      });
      sent.on("error", reject);
      sent.end(body);
    });
  }

  test("ONE out of its allowance: the turn goes to TWO before any of it reaches Codex, signed as TWO and otherwise as Codex sent it", async () => {
    await setUp();
    answers.set(ONE.accountId, usedUp);

    const reply = await turn();

    expect(reply.status).toBe(200);
    expect(reply.body).toContain("answered by acct-2");
    expect(reply.body).not.toContain("usage_limit_reached");
    const [first, second] = backend.requests;
    expect(backend.requests).toHaveLength(2);
    expect(first?.headers["chatgpt-account-id"]).toBe("acct-1");
    expect(first?.headers.authorization).toBe("Bearer cli-token-of-one");
    expect(second?.headers["chatgpt-account-id"]).toBe("acct-2");
    expect(second?.headers.authorization).not.toBe("Bearer cli-token-of-one");
    expect(second?.headers.authorization).toMatch(/^Bearer /);
    // 只换登录：Codex 的身份头照带，只属于 ONE 的设备证明不带。
    expect(second?.headers["user-agent"]).toBe(CODEX_UA);
    expect(second?.headers.originator).toBe("codex_cli_rs");
    expect(second?.headers["x-codex-turn-metadata"]).toBe('{"turn_id":"t1"}');
    expect(second?.headers["x-oai-attestation"]).toBeUndefined();
    expect(second?.body.equals(first!.body)).toBe(true);
  });

  test("once ONE's reply has begun it stays ONE's: a reply cut off after its first words is not asked of TWO", async () => {
    await setUp();
    answers.set(ONE.accountId, cutAfterFirstWords);

    const reply = await turn();

    expect(reply.body).toContain("half an answ");
    expect(accountsAsked(backend.requests)).toEqual(["acct-1"]);
  });

  test("a conversation too long for the model is too long on every account: Codex gets ONE's 400 and TWO is not asked", async () => {
    await setUp();
    const tooLong = JSON.stringify({
      error: { code: "context_length_exceeded", message: "Your input exceeds the context window" },
    });
    answers.set(ONE.accountId, (_request, res) => {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(tooLong);
    });

    const reply = await turn();

    expect(reply.status).toBe(400);
    expect(JSON.parse(reply.body)).toEqual(JSON.parse(tooLong));
    expect(backend.requests).toHaveLength(1);
  });

  test("an account holding credits is asked once more on its 429 before the turn moves on", async () => {
    readings.set(ONE.accountId, reading(100, { onCredits: true }));
    await setUp();
    // 打开轮换时读过一次额度，daemon 记下 ONE 窗口用满、但有 credits。
    await expect
      .poll(async () => {
        const listed = await client.providerAccountList({ provider: "codex" });
        return listed.accounts[0]?.usage.status;
      })
      .toBe("read");
    let asked = 0;
    answers.set(ONE.accountId, (_request, res) => {
      asked += 1;
      if (asked === 1) {
        usedUp(_request, res);
        return;
      }
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(answer({ text: "spent credits", id: "resp-credits" }));
    });

    const reply = await turn();

    expect(reply.body).toContain("spent credits");
    expect(accountsAsked(backend.requests)).toEqual(["acct-1", "acct-1"]);
  });

  test("every account out of its allowance: Codex gets the last 429 as it came, with when it resets", async () => {
    await setUp([TWO, THREE]);
    for (const account of [ONE, TWO]) answers.set(account.accountId, usedUp);
    answers.set(THREE.accountId, (_request, res) => {
      res.writeHead(429, {
        "content-type": "application/json",
        "retry-after": "1800",
        "x-codex-primary-used-percent": "100",
      });
      res.end(USAGE_LIMIT);
    });

    const reply = await turn();

    expect(reply.status).toBe(429);
    expect(JSON.parse(reply.body)).toEqual(JSON.parse(USAGE_LIMIT));
    expect(reply.headers["retry-after"]).toBe("1800");
    expect(reply.headers["x-codex-primary-used-percent"]).toBe("100");
    expect(accountsAsked(backend.requests)).toEqual(["acct-1", "acct-2", "acct-3"]);
  });

  test("reasoning ONE sealed is taken out when TWO can't read it, and the rest of the turn asked of TWO again", async () => {
    await setUp();
    answers.set(ONE.accountId, usedUp);
    answers.set(TWO.accountId, (request, res) => {
      if (request.body.includes("rs_one")) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            error: {
              code: "invalid_encrypted_content",
              message: "The encrypted content for item rs_one could not be verified.",
            },
          }),
        );
        return;
      }
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(answer({ text: "read without it", id: "resp-2" }));
    });
    const said = { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] };

    const reply = await turn({
      body: {
        model: "gpt-5.5",
        stream: true,
        input: [
          said,
          { type: "reasoning", id: "rs_one", summary: [], encrypted_content: "sealed-by-one" },
          { type: "message", role: "assistant", content: [{ type: "output_text", text: "ok" }] },
          said,
        ],
      },
    });

    expect(reply.body).toContain("read without it");
    const last = JSON.parse(backend.requests.at(-1)!.body.toString("utf8")) as {
      input: Array<{ type: string }>;
    };
    expect(last.input.map((item) => item.type)).toEqual(["message", "message", "message"]);
  });

  describe("stickiness, as magpie's auto", () => {
    const hi = { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] };
    const call = { type: "function_call", call_id: "c1", name: "shell", arguments: "{}" };
    const result = { type: "function_call_output", call_id: "c1", output: "done" };
    const said = {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "ok" }],
    };
    const again = {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "more" }],
    };
    const body = (input: unknown[]) => ({ model: "gpt-5.5", stream: true, input });

    /**
     * ONE 第一次用完，之后又能答；TWO 答时缓存读到 cached 个 token，提示词 prompt 个。
     * OpenAI 不报缓存写入：读到 0 时照 magpie 把这次的提示词算作写进了缓存。
     */
    async function movedToTwo(cached: number, prompt = 2000): Promise<void> {
      await setUp();
      let onesAsked = 0;
      answers.set(ONE.accountId, (_request, res) => {
        onesAsked += 1;
        if (onesAsked === 1) {
          usedUp(_request, res);
          return;
        }
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.end(answer({ text: "answered by acct-1", id: "resp-1" }));
      });
      answers.set(TWO.accountId, (_request, res) => {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.end(answer({ text: "answered by acct-2", id: "resp-2", cached, prompt }));
      });
      expect((await turn({ body: body([hi]) })).body).toContain("answered by acct-2");
      backend.requests.length = 0;
    }

    test("within the turn (Codex handing back a tool's result) the conversation stays on TWO", async () => {
      await movedToTwo(0);

      const reply = await turn({ body: body([hi, call, result]) });

      expect(reply.body).toContain("answered by acct-2");
      expect(accountsAsked(backend.requests)).toEqual(["acct-2"]);
    });

    test("a new turn with at least 1024 tokens cached on TWO within 5 minutes stays on TWO", async () => {
      await movedToTwo(2000);

      const reply = await turn({ body: body([hi, said, again]) });

      expect(reply.body).toContain("answered by acct-2");
    });

    test("a new turn with less than 1024 tokens cached goes back to the account Codex signed it with", async () => {
      await movedToTwo(0, 300);

      const reply = await turn({ body: body([hi, said, again]) });

      expect(reply.body).toContain("answered by acct-1");
    });

    test("another conversation isn't held to TWO", async () => {
      await movedToTwo(2000);

      const reply = await turn({ thread: "thread-b", body: body([again]) });

      expect(reply.body).toContain("answered by acct-1");
    });
  });

  test("the ledger names the account that answered: the Requests list shows Official · its email, and each try's account", async () => {
    await setUp();
    answers.set(ONE.accountId, usedUp);

    await turn();

    const request = { from: null, to: null, timezone: "UTC", offset: 0, limit: 100 };
    await expect
      .poll(async () => (await client.usageRequestsList(request)).requests.length, {
        timeout: 15_000,
      })
      .toBe(1);
    const [row] = (await client.usageRequestsList(request)).requests;
    expect(row).toMatchObject({
      through: "gateway",
      endpointId: null,
      accountEmail: "two@example.com",
      status: "ok",
    });
    expect(
      row?.attempts.map((attempt) => [attempt.endpointId, attempt.accountEmail, attempt.result]),
    ).toEqual([
      [null, "one@example.com", "failed"],
      [null, "two@example.com", "answered"],
    ]);
  });

  describe("Codex's openai_base_url", () => {
    const own = 'model = "gpt-5.5"\nopenai_base_url = "https://my-relay.example/v1" # mine\n';
    const configPath = () => path.join(codexHome, "config.toml");
    const readConfig = () => readFile(configPath(), "utf8");
    const gatewayLine = () =>
      `openai_base_url = "http://127.0.0.1:${daemons.at(-1)!.port}/api-endpoint-gateway/backend-api/codex"`;

    test("two accounts with rotation on point it at the gateway; Only switch the sign-in puts the user's own back, and turns go to ChatGPT as Codex sent them", async () => {
      await writeFile(configPath(), own);
      await setUp();
      await expect.poll(readConfig).toContain(gatewayLine());
      expect(await readConfig()).toContain('model = "gpt-5.5"');

      const switchOnly = await client.providerAccountSetSwitchOnly({
        provider: "codex",
        enabled: true,
      });
      expect(switchOnly.error).toBeNull();
      expect(switchOnly.settings.switchOnly).toBe(true);
      await expect.poll(readConfig).toBe(own);
      answers.set(ONE.accountId, usedUp);
      const reply = await turn();
      expect(reply.status).toBe(429);
      expect(backend.requests).toHaveLength(1);

      await client.providerAccountSetSwitchOnly({ provider: "codex", enabled: false });
      await expect.poll(readConfig).toContain(gatewayLine());
    });

    test("one account left, or rotation off, puts the user's own value back", async () => {
      await writeFile(configPath(), own);
      const ids = await setUp();
      await expect.poll(readConfig).toContain(gatewayLine());

      await client.providerAccountRemove({ provider: "codex", accountId: ids[TWO.accountId]! });
      await expect.poll(readConfig).toBe(own);

      await addAccount(TWO);
      await expect.poll(readConfig).toContain(gatewayLine());
      await client.providerAccountSetRotation({ provider: "codex", enabled: false });
      await expect.poll(readConfig).toBe(own);
    });

    test("Read CLI sign-ins off leaves the key as it is, and the gateway sends turns only as Codex signed them", async () => {
      await setUp();
      await expect.poll(readConfig).toContain(gatewayLine());
      await client.patchDaemonConfig({ readCliSignIns: false });
      answers.set(ONE.accountId, usedUp);

      const reply = await turn();

      expect(reply.status).toBe(429);
      expect(accountsAsked(backend.requests)).toEqual(["acct-1"]);
      expect(await readConfig()).toContain(gatewayLine());
    });

    test("with Use API endpoints on too, the key is written once and shared: endpoint models reach the endpoint, ChatGPT's own move between accounts; switching endpoints off keeps it for the accounts", async () => {
      await writeFile(configPath(), own);
      await setUp();
      await expect.poll(readConfig).toContain(gatewayLine());
      const saved = await client.apiEndpointSave({
        provider: "codex",
        name: "Relay",
        baseUrls: [{ format: "openai_responses", url: `${backend.url}/v1` }],
        apiKey: "sk-relay-secret",
        models: [{ id: "gpt-x" }],
      });
      expect(saved.error).toBeNull();
      const on = await client.apiEndpointSetAgentSettings({ provider: "codex", enabled: true });
      expect(on.error).toBeNull();
      expect((await readConfig()).split("openai_base_url").length - 1).toBe(1);
      expect(await readConfig()).toContain(gatewayLine());

      const endpointTurn = await turn({
        body: { model: "relay/gpt-x", stream: true, input: [] },
      });
      expect(endpointTurn.body).toContain("answered by the endpoint");
      answers.set(ONE.accountId, usedUp);
      expect((await turn()).body).toContain("answered by acct-2");

      const off = await client.apiEndpointSetAgentSettings({ provider: "codex", enabled: false });
      expect(off.error).toBeNull();
      expect(await readConfig()).toContain(gatewayLine());
      await client.providerAccountSetRotation({ provider: "codex", enabled: false });
      await expect
        .poll(readConfig)
        .toContain('openai_base_url = "https://my-relay.example/v1" # mine');
      expect(await readConfig()).not.toContain(gatewayLine());
    });
  });
});
