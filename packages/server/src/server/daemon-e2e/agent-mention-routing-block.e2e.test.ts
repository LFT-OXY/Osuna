import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { WebSocket } from "ws";
import { afterEach, describe, expect, test } from "vitest";
import { WSOutboundMessageSchema, type SessionOutboundMessage } from "@osuna/protocol/messages";
import type {
  AgentMode,
  AgentModelDefinition,
  AgentPromptInput,
  ProviderCatalog,
} from "../agent/agent-sdk-types.js";
import {
  createTestAgentClient,
  type TestAgentClientOptions,
} from "../test-utils/fake-agent-client.js";
import { DaemonClient } from "../test-utils/daemon-client.js";
import { createTestOsunaDaemon, type TestOsunaDaemon } from "../test-utils/osuna-daemon.js";
import { getAskModeConfig } from "./agent-configs.js";

const WAIT_MS = 15_000;
const CLAUDE = "[@Claude](osuna://agent/provider/claude)";
const CODEX = "[@Codex](osuna://agent/provider/codex)";
const CLAUDE_MODES: AgentMode[] = [
  { id: "auto", label: "Auto" },
  { id: "plan", label: "Plan" },
];
const CLAUDE_MODELS: AgentModelDefinition[] = [
  {
    provider: "claude",
    id: "haiku",
    label: "Haiku",
    isDefault: true,
    thinkingOptions: [
      { id: "low", label: "Low" },
      { id: "high", label: "High" },
    ],
    defaultThinkingOptionId: "low",
  },
  {
    provider: "claude",
    id: "sonnet",
    label: "Sonnet",
    thinkingOptions: [
      { id: "medium", label: "Medium" },
      { id: "max", label: "Max" },
    ],
    defaultThinkingOptionId: "medium",
  },
];
const PERMISSION_PROMPT =
  'Use your shell tool to run: `printf "ok" > x.txt`. Request permission and wait.';

async function claudeCatalog(): Promise<ProviderCatalog> {
  return { models: CLAUDE_MODELS, modes: CLAUDE_MODES };
}

const tempDirs: string[] = [];
let daemon: TestOsunaDaemon | null = null;
let client: DaemonClient | null = null;
let mcpClient: Client | null = null;

interface Scenario {
  daemon: TestOsunaDaemon;
  client: DaemonClient;
  cwd: string;
  prompts: string[];
}

function promptText(prompt: AgentPromptInput): string {
  if (typeof prompt === "string") return prompt;
  return prompt.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");
}

async function startDaemon(
  options: Parameters<typeof createTestOsunaDaemon>[0] = {},
  claudeOptions: TestAgentClientOptions = {},
): Promise<Scenario> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "osuna-routing-block-"));
  tempDirs.push(cwd);
  const prompts: string[] = [];
  const onStartTurn = (prompt: AgentPromptInput) => prompts.push(promptText(prompt));
  daemon = await createTestOsunaDaemon({
    agentClients: {
      codex: createTestAgentClient("codex", { supportsMcpServers: true, onStartTurn }),
      claude: createTestAgentClient("claude", {
        supportsMcpServers: true,
        onStartTurn,
        ...claudeOptions,
      }),
    },
    ...options,
  });
  client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws` });
  await client.connect();
  await client.fetchAgents({ subscribe: {} });
  return { daemon, client, cwd, prompts };
}

interface SendInput {
  scenario: Scenario;
  agentId: string;
  text: string;
  options?: Parameters<DaemonClient["sendAgentMessage"]>[2];
}

async function sendAndFinish({ scenario, agentId, text, options }: SendInput): Promise<void> {
  await scenario.client.sendAgentMessage(agentId, text, options);
  await scenario.client.waitForFinish(agentId, WAIT_MS);
}

/** The numbered mention lines of the Routing block the provider received. */
function routedLines(prompt: string | undefined): string[] {
  const match = /Start them now, before any other work:\n\n([\s\S]*?)\n\nRules:/.exec(prompt ?? "");
  return match?.[1]?.split("\n") ?? [];
}

interface MessageTextsInput {
  scenario: Scenario;
  agentId: string;
  type: "user_message" | "assistant_message";
}

async function messageTexts({ scenario, agentId, type }: MessageTextsInput): Promise<string[]> {
  const timeline = await scenario.client.fetchAgentTimeline(agentId, {
    direction: "tail",
    limit: 0,
    projection: "canonical",
  });
  return timeline.entries.flatMap((entry) => (entry.item.type === type ? [entry.item.text] : []));
}

function userMessages(scenario: Scenario, agentId: string): Promise<string[]> {
  return messageTexts({ scenario, agentId, type: "user_message" });
}

async function connectAsCaller(port: number, callerAgentId: string): Promise<Client> {
  mcpClient = new Client({ name: "routing-block-test", version: "0.0.0" });
  await mcpClient.connect(
    new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${port}/mcp/agents?callerAgentId=${callerAgentId}`),
    ),
  );
  return mcpClient;
}

interface CreateWithPromptInput {
  scenario: Scenario;
  text: string;
  clientMessageId: string;
}

/** 老客户端的 create_agent_request：直接发原始帧，不经 DaemonClient 的新建协商。 */
async function createViaLegacyRequest({
  scenario,
  text,
  clientMessageId,
}: CreateWithPromptInput): Promise<string> {
  const socket = new WebSocket(`ws://127.0.0.1:${scenario.daemon.port}/ws`);
  const frames: SessionOutboundMessage[] = [];
  socket.on("message", (data) => {
    const frame = WSOutboundMessageSchema.parse(JSON.parse(data.toString()));
    if (frame.type === "session") frames.push(frame.message);
  });
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  try {
    socket.send(
      JSON.stringify({
        type: "hello",
        clientType: "browser",
        clientId: randomUUID(),
        protocolVersion: 1,
        appVersion: "0.8.0",
      }),
    );
    const requestId = randomUUID();
    socket.send(
      JSON.stringify({
        type: "session",
        message: {
          type: "create_agent_request",
          requestId,
          config: { provider: "codex", cwd: scenario.cwd },
          initialPrompt: text,
          clientMessageId,
        },
      }),
    );
    const created = () =>
      frames.flatMap((message) =>
        message.type === "status" &&
        message.payload.status === "agent_created" &&
        message.payload.requestId === requestId
          ? [message.payload.agentId]
          : [],
      )[0];
    await expect.poll(created, { timeout: WAIT_MS }).toBeDefined();
    return created()!;
  } finally {
    socket.close();
  }
}

async function createViaAgentCreateRequest({
  scenario,
  text,
  clientMessageId,
}: CreateWithPromptInput): Promise<string> {
  const agent = await scenario.client.createAgent({
    provider: "codex",
    cwd: scenario.cwd,
    initialPrompt: text,
    clientMessageId,
  });
  return agent.id;
}

async function createViaWorkspaceCreateRequest({
  scenario,
  text,
  clientMessageId,
}: CreateWithPromptInput): Promise<string> {
  const result = await scenario.client.createWorkspace({
    source: { kind: "directory", path: scenario.cwd },
    agent: { provider: "codex", cwd: scenario.cwd, initialPrompt: text, clientMessageId },
  });
  if (!result.agent) throw new Error(result.error ?? "Expected the workspace's first agent");
  return result.agent.id;
}

const CREATE_REQUESTS = [
  { type: "create_agent_request", create: createViaLegacyRequest },
  { type: "agent.create.request", create: createViaAgentCreateRequest },
  { type: "workspace.create.request", create: createViaWorkspaceCreateRequest },
];

interface PersistedProviderConfig {
  mentionDefaults?: unknown;
}

/** config.json 里 claude 这一项，读盘确认持久化结果。 */
async function persistedClaudeConfig(
  scenario: Scenario,
): Promise<PersistedProviderConfig | undefined> {
  const raw: { agents?: { providers?: Record<string, PersistedProviderConfig> } } = JSON.parse(
    await readFile(path.join(scenario.daemon.osunaHome, "config.json"), "utf8"),
  );
  return raw.agents?.providers?.claude;
}

afterEach(async () => {
  await mcpClient?.close().catch(() => undefined);
  await client?.close().catch(() => undefined);
  await daemon?.close().catch(() => undefined);
  mcpClient = null;
  client = null;
  daemon = null;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("Routing block for agent mentions", () => {
  test("appends one line per provider mention in order and keeps the original text in the timeline", async () => {
    const scenario = await startDaemon();
    const parent = await scenario.client.createAgent({ provider: "codex", cwd: scenario.cwd });
    const text = `${CLAUDE} write the code, ${CODEX} review it, ${CLAUDE} write the tests`;

    await sendAndFinish({ scenario, agentId: parent.id, text });

    expect(scenario.prompts.at(-1)).toBe(`${text}

<osuna-system>
The user's message above mentions agents as links of the form [@Name](osuna://agent/...). Each mention asks you to start a new subagent for the part of the message it refers to. Start them now, before any other work:

1. @Claude -> provider "claude/haiku", settings {"modeId":"auto"}
2. @Codex -> provider "codex/gpt-5.4-mini", settings {"modeId":"bypassPermissions"}
3. @Claude -> provider "claude/haiku", settings {"modeId":"auto"}

Rules:
- Call \`create_agent\` exactly once per numbered mention that can start, in the order listed. Two mentions of the same agent mean two separate subagents.
- Pass \`provider\` and \`settings\` exactly as listed. Do not change the model, mode, or thinking option. Do not call \`list_providers\`, \`list_models\`, or \`inspect_provider\` first; the values are already resolved.
- Do not do a mentioned part yourself, and do not hand it to your own subagent, task, or delegation tools, skills, or CLIs. Only \`create_agent\` counts.
- The subagent cannot see this conversation. Write \`initialPrompt\` so it stands alone: the goal, the relevant files and context, constraints, and what to report back.
- Keep \`notifyOnFinish\` at its default. You will be notified as each subagent finishes; then combine the results for the user.
- If a subagent asks for permission, the user approves it in that subagent's session. Do not answer it with \`respond_to_permission\`.
- Do any part of the message addressed to you (not to a mention) yourself, after the subagents are started.
</osuna-system>`);
    expect(await userMessages(scenario, parent.id)).toEqual([text]);
  });

  test("each message sent after the previous one finished (a dequeued send) gets its own Routing block", async () => {
    const scenario = await startDaemon();
    const parent = await scenario.client.createAgent({ provider: "codex", cwd: scenario.cwd });
    const first = `${CLAUDE} write the code`;
    const second = `${CODEX} review it`;

    await sendAndFinish({ scenario, agentId: parent.id, text: first });
    await sendAndFinish({ scenario, agentId: parent.id, text: second });

    expect(scenario.prompts.map(routedLines)).toEqual([
      ['1. @Claude -> provider "claude/haiku", settings {"modeId":"auto"}'],
      ['1. @Codex -> provider "codex/gpt-5.4-mini", settings {"modeId":"bypassPermissions"}'],
    ]);
    expect(await userMessages(scenario, parent.id)).toEqual([first, second]);
  });

  test("a message without mentions is recorded as written even when it ends in a osuna-system block", async () => {
    const scenario = await startDaemon();
    const parent = await scenario.client.createAgent({ provider: "codex", cwd: scenario.cwd });
    const text = "notes I pasted\n\n<osuna-system>\nquoted from a log\n</osuna-system>";

    await sendAndFinish({ scenario, agentId: parent.id, text });

    expect(scenario.prompts).toEqual([text]);
    expect(await userMessages(scenario, parent.id)).toEqual([text]);
  });

  test("a steer into a running turn carries the Routing block too", async () => {
    const scenario = await startDaemon();
    const parent = await scenario.client.createAgent({
      ...getAskModeConfig("codex"),
      cwd: scenario.cwd,
    });
    await scenario.client.sendAgentMessage(parent.id, PERMISSION_PROMPT);
    expect((await scenario.client.waitForFinish(parent.id, WAIT_MS)).status).toBe("permission");

    const text = `${CODEX} take over the file`;
    await sendAndFinish({
      scenario,
      agentId: parent.id,
      text,
      options: { activeTurnBehavior: "steer" },
    });

    expect(routedLines(scenario.prompts.at(-1))).toEqual([
      '1. @Codex -> provider "codex/gpt-5.4-mini", settings {"modeId":"bypassPermissions"}',
    ]);
    expect(await userMessages(scenario, parent.id)).toEqual([PERMISSION_PROMPT, text]);
  });

  test("out-of-band commands see the original text and get no Routing block", async () => {
    const scenario = await startDaemon();
    const parent = await scenario.client.createAgent({ provider: "codex", cwd: scenario.cwd });
    const text = `/fake-oob ${CLAUDE} look at this`;

    await scenario.client.sendAgentMessage(parent.id, text);

    await expect
      .poll(() => messageTexts({ scenario, agentId: parent.id, type: "assistant_message" }), {
        timeout: WAIT_MS,
      })
      .toEqual([`Out-of-band: ${text}`]);
    expect(scenario.prompts).toEqual([]);
  });

  test("a session that cannot create agents gets the original text only", async () => {
    const scenario = await startDaemon({ mcpInjectIntoAgents: false });
    const parent = await scenario.client.createAgent({ provider: "codex", cwd: scenario.cwd });
    const text = `${CLAUDE} write tests`;

    await sendAndFinish({ scenario, agentId: parent.id, text });

    expect(scenario.prompts).toEqual([text]);
  });

  test("a disabled or unknown provider gets a cannot-start line while other mentions still route", async () => {
    const scenario = await startDaemon({
      providerOverrides: { claude: { enabled: false } },
    });
    const parent = await scenario.client.createAgent({ provider: "codex", cwd: scenario.cwd });
    const text = `${CLAUDE} write, [@Grok](osuna://agent/provider/grok) plan, ${CODEX} review`;

    await sendAndFinish({ scenario, agentId: parent.id, text });

    expect(routedLines(scenario.prompts.at(-1))).toEqual([
      '1. @Claude -> cannot start: provider "claude" is disabled. Tell the user.',
      '2. @Grok -> cannot start: provider "grok" is not configured. Tell the user.',
      '3. @Codex -> provider "codex/gpt-5.4-mini", settings {"modeId":"bypassPermissions"}',
    ]);
  });

  test("MCP send_agent_prompt and schedule fires never get a Routing block", async () => {
    const scenario = await startDaemon();
    const caller = await scenario.client.createAgent({ provider: "codex", cwd: scenario.cwd });
    const target = await scenario.client.createAgent({ provider: "codex", cwd: scenario.cwd });
    const text = `${CLAUDE} write tests`;

    const mcp = await connectAsCaller(scenario.daemon.port, caller.id);
    await mcp.callTool({
      name: "send_agent_prompt",
      arguments: { agentId: target.id, prompt: text, background: false },
    });
    expect(scenario.prompts).toEqual([text]);

    const created = await scenario.client.scheduleCreate({
      prompt: text,
      cadence: { type: "cron", expression: "0 0 1 1 *" },
      target: { type: "agent", agentId: target.id },
    });
    if (!created.schedule) throw new Error(created.error ?? "Expected a schedule");
    const fired = await scenario.client.scheduleRunOnce({ id: created.schedule.id });
    await scenario.client.waitForFinish(target.id, WAIT_MS);
    const runId = fired.schedule?.runs.at(-1)?.id;

    expect(scenario.prompts).toEqual([
      text,
      `<osuna-system>\nSchedule fired (id=${created.schedule.id}, run=${runId}).\n${text}\n</osuna-system>`,
    ]);
  });
});

describe("Routing block for the first message of a new agent", () => {
  test.each(CREATE_REQUESTS)(
    "$type sends the Routing block to the provider and keeps the original text in the timeline",
    async ({ create }) => {
      const scenario = await startDaemon();
      const text = `${CLAUDE} write the code, ${CODEX} review it`;

      const agentId = await create({ scenario, text, clientMessageId: randomUUID() });
      await scenario.client.waitForFinish(agentId, WAIT_MS);

      expect(scenario.prompts).toHaveLength(1);
      expect(scenario.prompts[0]?.startsWith(`${text}\n\n<osuna-system>\n`)).toBe(true);
      expect(routedLines(scenario.prompts[0])).toEqual([
        '1. @Claude -> provider "claude/haiku", settings {"modeId":"auto"}',
        '2. @Codex -> provider "codex/gpt-5.4-mini", settings {"modeId":"bypassPermissions"}',
      ]);
      expect(await userMessages(scenario, agentId)).toEqual([text]);
    },
  );

  test.each(CREATE_REQUESTS)(
    "$type sends the original text only when the new session cannot create agents",
    async ({ create }) => {
      const scenario = await startDaemon({ mcpInjectIntoAgents: false });
      const text = `${CLAUDE} write tests`;

      const agentId = await create({ scenario, text, clientMessageId: randomUUID() });
      await scenario.client.waitForFinish(agentId, WAIT_MS);

      expect(scenario.prompts).toEqual([text]);
    },
  );

  test("MCP create_agent never gets a Routing block", async () => {
    const scenario = await startDaemon();
    const caller = await scenario.client.createAgent({ provider: "codex", cwd: scenario.cwd });
    const text = `${CLAUDE} write tests`;

    const mcp = await connectAsCaller(scenario.daemon.port, caller.id);
    await mcp.callTool({
      name: "create_agent",
      arguments: {
        relationship: { kind: "subagent" },
        workspace: { kind: "current" },
        title: "Child",
        provider: "codex/gpt-5.4-mini",
        initialPrompt: text,
      },
    });

    await expect.poll(() => scenario.prompts, { timeout: WAIT_MS }).toEqual([text]);
  });
});

describe("Mention defaults", () => {
  test("values set through set_daemon_config apply to the next send and unset fields follow runtime defaults", async () => {
    const scenario = await startDaemon({}, { fetchCatalog: claudeCatalog });
    const parent = await scenario.client.createAgent({ provider: "codex", cwd: scenario.cwd });
    const claudeDefaults = { model: "sonnet", thinkingOptionId: "max", modeId: "plan" };

    await scenario.client.patchDaemonConfig({
      providers: {
        claude: { mentionDefaults: claudeDefaults },
        codex: { mentionDefaults: { modeId: "always-ask" } },
      },
    });
    const { config } = await scenario.client.getDaemonConfig();
    expect(config.providers.claude?.mentionDefaults).toEqual(claudeDefaults);
    expect(config.providers.codex?.mentionDefaults).toEqual({ modeId: "always-ask" });

    await sendAndFinish({ scenario, agentId: parent.id, text: `${CLAUDE} write, ${CODEX} review` });

    expect(routedLines(scenario.prompts.at(-1))).toEqual([
      '1. @Claude -> provider "claude/sonnet", settings {"modeId":"plan","thinkingOptionId":"max"}',
      '2. @Codex -> provider "codex/gpt-5.4-mini", settings {"modeId":"always-ask"}',
    ]);
  });

  test("stale values fall back field by field and the send still goes out", async () => {
    const scenario = await startDaemon({}, { fetchCatalog: claudeCatalog });
    const parent = await scenario.client.createAgent({ provider: "codex", cwd: scenario.cwd });
    const cases = [
      // 模型不在目录里：退到默认模型及其默认档位，配置的档位不再沿用。
      { model: "opus-retired", thinkingOptionId: "high", modeId: "retired-mode" },
      // 档位不属于所选模型：退到该模型的默认档位。
      { model: "sonnet", thinkingOptionId: "high" },
      // 模型为"默认"时，档位按当时的默认模型校验。
      { thinkingOptionId: "high" },
      { thinkingOptionId: "max" },
    ];

    for (const mentionDefaults of cases) {
      await scenario.client.patchDaemonConfig({ providers: { claude: { mentionDefaults } } });
      await sendAndFinish({ scenario, agentId: parent.id, text: `${CLAUDE} write` });
    }

    expect(scenario.prompts.map(routedLines)).toEqual([
      [
        '1. @Claude -> provider "claude/haiku", settings {"modeId":"auto","thinkingOptionId":"low"}',
      ],
      [
        '1. @Claude -> provider "claude/sonnet", settings {"modeId":"auto","thinkingOptionId":"medium"}',
      ],
      [
        '1. @Claude -> provider "claude/haiku", settings {"modeId":"auto","thinkingOptionId":"high"}',
      ],
      [
        '1. @Claude -> provider "claude/haiku", settings {"modeId":"auto","thinkingOptionId":"low"}',
      ],
    ]);
  });

  test("a provider whose catalog failed to load gets the configured values as written", async () => {
    const scenario = await startDaemon(
      {
        providerOverrides: {
          claude: { mentionDefaults: { model: "sonnet", thinkingOptionId: "max", modeId: "plan" } },
        },
      },
      {
        fetchCatalog: async () => {
          throw new Error("model list timed out");
        },
      },
    );
    const parent = await scenario.client.createAgent({ provider: "codex", cwd: scenario.cwd });

    await sendAndFinish({ scenario, agentId: parent.id, text: `${CLAUDE} write` });

    expect(routedLines(scenario.prompts.at(-1))).toEqual([
      '1. @Claude -> provider "claude/sonnet", settings {"modeId":"plan","thinkingOptionId":"max"}',
    ]);
  });

  test("a patch replaces a provider's values as a whole and removing the provider clears them", async () => {
    const scenario = await startDaemon({}, { fetchCatalog: claudeCatalog });
    const parent = await scenario.client.createAgent({ provider: "codex", cwd: scenario.cwd });

    await scenario.client.patchDaemonConfig({
      providers: { claude: { mentionDefaults: { model: "sonnet", modeId: "plan" } } },
    });
    await scenario.client.patchDaemonConfig({
      providers: { claude: { mentionDefaults: { modeId: "plan" } } },
    });
    expect(
      (await scenario.client.getDaemonConfig()).config.providers.claude?.mentionDefaults,
    ).toEqual({ modeId: "plan" });
    expect((await persistedClaudeConfig(scenario))?.mentionDefaults).toEqual({ modeId: "plan" });

    await scenario.client.patchDaemonConfig({ removeProviders: ["claude"] });
    expect((await scenario.client.getDaemonConfig()).config.providers.claude).toBeUndefined();
    expect(await persistedClaudeConfig(scenario)).toBeUndefined();

    await sendAndFinish({ scenario, agentId: parent.id, text: `${CLAUDE} write` });
    expect(routedLines(scenario.prompts.at(-1))).toEqual([
      '1. @Claude -> provider "claude/haiku", settings {"modeId":"auto","thinkingOptionId":"low"}',
    ]);
  });
});

describe("Agent profile mentions", () => {
  test("profile fields win, missing fields come from Mention defaults, then runtime defaults", async () => {
    const scenario = await startDaemon({}, { fetchCatalog: claudeCatalog });
    const parent = await scenario.client.createAgent({ provider: "codex", cwd: scenario.cwd });
    await scenario.client.patchDaemonConfig({
      providers: {
        claude: { mentionDefaults: { model: "sonnet", thinkingOptionId: "max", modeId: "plan" } },
      },
      agentProfiles: [
        {
          id: "fast-reviewer",
          name: "Fast reviewer",
          provider: "claude",
          model: "haiku",
          thinkingOptionId: "high",
          modeId: "auto",
          featureValues: { fast_mode: true },
        },
        { id: "thinker", name: "Thinker", provider: "claude", thinkingOptionId: "medium" },
        { id: "tester", name: "Tester", provider: "codex" },
      ],
    });
    const text = [
      "[@Fast reviewer](osuna://agent/profile/fast-reviewer) review,",
      "[@Thinker](osuna://agent/profile/thinker) plan,",
      "[@Tester](osuna://agent/profile/tester) test",
    ].join(" ");

    await sendAndFinish({ scenario, agentId: parent.id, text });

    expect(routedLines(scenario.prompts.at(-1))).toEqual([
      '1. @Fast reviewer -> provider "claude/haiku", settings {"modeId":"auto","thinkingOptionId":"high","features":{"fast_mode":true}}',
      '2. @Thinker -> provider "claude/sonnet", settings {"modeId":"plan","thinkingOptionId":"medium"}',
      '3. @Tester -> provider "codex/gpt-5.4-mini", settings {"modeId":"bypassPermissions"}',
    ]);
    expect(await userMessages(scenario, parent.id)).toEqual([text]);
  });

  test("a stale profile value falls back to Mention defaults before runtime defaults", async () => {
    const scenario = await startDaemon({}, { fetchCatalog: claudeCatalog });
    const parent = await scenario.client.createAgent({ provider: "codex", cwd: scenario.cwd });
    await scenario.client.patchDaemonConfig({
      providers: {
        claude: { mentionDefaults: { model: "sonnet", thinkingOptionId: "max", modeId: "plan" } },
      },
      agentProfiles: [
        // 模型已下线：退到 Mention defaults 的模型，profile 的档位随失效的模型一起不用。
        {
          id: "retired",
          name: "Retired",
          provider: "claude",
          model: "opus-retired",
          thinkingOptionId: "high",
          modeId: "retired-mode",
        },
        // 档位不属于 Mention defaults 的模型：退到 Mention defaults 的档位。
        { id: "odd-thinking", name: "Odd thinking", provider: "claude", thinkingOptionId: "low" },
      ],
    });
    const text = [
      "[@Retired](osuna://agent/profile/retired) review,",
      "[@Odd thinking](osuna://agent/profile/odd-thinking) plan",
    ].join(" ");

    await sendAndFinish({ scenario, agentId: parent.id, text });

    expect(routedLines(scenario.prompts.at(-1))).toEqual([
      '1. @Retired -> provider "claude/sonnet", settings {"modeId":"plan","thinkingOptionId":"max"}',
      '2. @Odd thinking -> provider "claude/sonnet", settings {"modeId":"plan","thinkingOptionId":"max"}',
    ]);
  });

  test("a deleted profile or one whose provider is disabled or unknown gets a cannot-start line while other mentions still route", async () => {
    const scenario = await startDaemon({ providerOverrides: { claude: { enabled: false } } });
    const parent = await scenario.client.createAgent({ provider: "codex", cwd: scenario.cwd });
    await scenario.client.patchDaemonConfig({
      agentProfiles: [
        { id: "reviewer", name: "Reviewer", provider: "claude" },
        { id: "planner", name: "Planner", provider: "grok" },
      ],
    });
    const text = [
      "[@Gone](osuna://agent/profile/gone) plan,",
      "[@Reviewer](osuna://agent/profile/reviewer) review,",
      "[@Planner](osuna://agent/profile/planner) plan,",
      `${CODEX} test`,
    ].join(" ");

    await sendAndFinish({ scenario, agentId: parent.id, text });

    expect(routedLines(scenario.prompts.at(-1))).toEqual([
      '1. @Gone -> cannot start: agent profile "gone" no longer exists. Tell the user.',
      '2. @Reviewer -> cannot start: provider "claude" is disabled. Tell the user.',
      '3. @Planner -> cannot start: provider "grok" is not configured. Tell the user.',
      '4. @Codex -> provider "codex/gpt-5.4-mini", settings {"modeId":"bypassPermissions"}',
    ]);
  });
});
