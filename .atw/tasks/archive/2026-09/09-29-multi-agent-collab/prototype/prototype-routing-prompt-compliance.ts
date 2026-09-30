// PROTOTYPE — 01 号票（路由提示遵从度实测）的一次性脚本，不进 main。
// 起一个隔离的进程内 daemon（临时 PASEO_HOME、随机端口），让真实父智能体收到
// "用户正文 + 路由块"，记录它的 create_agent 调用与所建子智能体；子智能体建出即取消。
//
// 运行：npx tsx packages/server/src/server/prototype-routing-prompt-compliance.ts <outDir> [parents] [reps] [scenarios]
//   parents 例：claude,codex,pi   reps 例：2   scenarios 例：single,same,cross
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import pino from "pino";
import { createPaseoDaemon } from "./bootstrap.js";
import { DaemonClient } from "./test-utils/daemon-client.js";

const PARENT_LABEL = "paseo.parent-agent-id";
const outDir = path.resolve(process.argv[2] ?? "prototype-out");
const parents = (process.argv[3] ?? "claude,codex,pi").split(",");
const reps = Number(process.argv[4] ?? "2");
const scenarioFilter = (process.argv[5] ?? "single,same,cross").split(",");
const routingTemplatePath = process.env.ROUTING_PROMPT_FILE;

interface MentionSpec {
  label: string;
  provider: string;
}

interface Scenario {
  id: string;
  mentions: MentionSpec[];
  text: string;
}

const CODEX: MentionSpec = { label: "[@Codex](paseo://agent/codex)", provider: "codex" };
const CLAUDE: MentionSpec = { label: "[@Claude Code](paseo://agent/claude)", provider: "claude" };

const SCENARIOS: Scenario[] = [
  {
    id: "single",
    mentions: [CODEX],
    text: `${CODEX.label} review src/sum.js for bugs and missed edge cases. Meanwhile, add a one-line JSDoc comment above the function in src/format.js yourself.`,
  },
  {
    id: "same",
    mentions: [CLAUDE, CLAUDE],
    text: `${CLAUDE.label} write unit tests for src/sum.js using node:test, and ${CLAUDE.label} write a short README.md section that documents src/format.js.`,
  },
  {
    id: "cross",
    mentions: [CODEX, CLAUDE],
    text: `${CODEX.label} review src/sum.js for bugs. ${CLAUDE.label} propose a fix plan for the rounding edge cases in src/format.js. When both are done, tell me which issues overlap.`,
  },
].filter((s) => scenarioFilter.includes(s.id));

interface ResolvedMention {
  index: number;
  label: string;
  provider: string;
  model: string;
  settings: { modeId?: string; thinkingOptionId?: string };
}

function buildRoutingBlock(mentions: ResolvedMention[], template: string): string {
  const lines = mentions
    .map(
      (m) =>
        `${m.index}. ${m.label} -> provider "${m.provider}/${m.model}", settings ${JSON.stringify(m.settings)}`,
    )
    .join("\n");
  return template.replace("{{MENTIONS}}", lines);
}

const DEFAULT_TEMPLATE = `<paseo-system>
The user's message above mentions agents as links of the form [@Name](paseo://agent/<id>). Each mention asks you to start a new subagent for the part of the message it refers to. Start them now, before any other work:

{{MENTIONS}}

Rules:
- Call \`create_agent\` exactly once per numbered mention, in the order listed. Two mentions of the same agent mean two separate subagents.
- Pass \`provider\` and \`settings\` exactly as listed. Do not change the model, mode, or thinking option. Do not call \`list_providers\`, \`list_models\`, or \`inspect_provider\` first; the values are already resolved.
- Do not do a mentioned part yourself, and do not hand it to your own subagent or task tools. Only \`create_agent\` counts.
- The subagent cannot see this conversation. Write \`initialPrompt\` so it stands alone: the goal, the relevant files and context, constraints, and what to report back.
- Keep \`notifyOnFinish\` at its default. You will be notified as each subagent finishes; then combine the results for the user.
- If a subagent asks for permission, the user approves it in that subagent's session. Do not answer it with \`respond_to_permission\`.
- Do any part of the message addressed to you (not to a mention) yourself, after the subagents are started.
</paseo-system>`;

async function seedRepo(dir: string): Promise<void> {
  await mkdir(path.join(dir, "src"), { recursive: true });
  await writeFile(
    path.join(dir, "src/sum.js"),
    "export function sum(values) {\n  let total = 0;\n  for (let i = 1; i < values.length; i++) total += values[i];\n  return total;\n}\n",
  );
  await writeFile(
    path.join(dir, "src/format.js"),
    "export function formatPrice(cents) {\n  return '$' + (cents / 100).toFixed(2);\n}\n",
  );
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["add", "."], { cwd: dir });
  execFileSync("git", ["-c", "user.email=p@x", "-c", "user.name=p", "commit", "-qm", "init"], {
    cwd: dir,
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// 在任意消息里找 labels 带父 id 的 agent 快照，不依赖具体消息类型
function collectChildren(value: unknown, parentId: string, out: Map<string, unknown>): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const v of value) collectChildren(v, parentId, out);
    return;
  }
  const obj = value as Record<string, unknown>;
  const labels = obj.labels as Record<string, string> | undefined;
  if (typeof obj.id === "string" && labels && labels[PARENT_LABEL] === parentId) {
    out.set(obj.id, obj);
  }
  for (const v of Object.values(obj)) collectChildren(v, parentId, out);
}

async function main(): Promise<void> {
  await mkdir(outDir, { recursive: true });
  const template = routingTemplatePath
    ? await readFile(routingTemplatePath, "utf8")
    : DEFAULT_TEMPLATE;
  const paseoHomeRoot = await mkdtemp(path.join(os.tmpdir(), "proto-routing-"));
  const paseoHome = path.join(paseoHomeRoot, ".paseo");
  await mkdir(paseoHome, { recursive: true });
  const staticDir = await mkdtemp(path.join(os.tmpdir(), "proto-routing-static-"));

  const daemon = await createPaseoDaemon(
    {
      listen: "127.0.0.1:0",
      paseoHome,
      corsAllowedOrigins: [],
      hostnames: true,
      mcpEnabled: true,
      mcpInjectIntoAgents: true,
      staticDir,
      mcpDebug: false,
      agentClients: {},
      agentStoragePath: path.join(paseoHome, "agents"),
      relayEnabled: false,
      relayEndpoint: "relay.paseo.sh:443",
      appBaseUrl: "https://app.paseo.sh",
    },
    pino({ level: "warn" }),
  );
  await daemon.start();
  const target = daemon.getListenTarget();
  const port = target?.type === "tcp" ? target.port : null;
  const client = new DaemonClient({ url: `ws://127.0.0.1:${port}/ws`, appVersion: "0.1.70" });
  await client.connect();
  await client.fetchAgents({ subscribe: {} });

  try {
    const probeCwd = await mkdtemp(path.join(os.tmpdir(), "proto-routing-probe-"));
    const needed = new Set([...parents, "claude", "codex"]);
    let snapshot = await client.getProvidersSnapshot({ cwd: probeCwd });
    for (let i = 0; i < 60; i++) {
      const pending = snapshot.entries.filter(
        (e) => needed.has(e.provider) && e.status === "loading",
      );
      if (pending.length === 0) break;
      await sleep(2000);
      snapshot = await client.getProvidersSnapshot({ cwd: probeCwd });
    }
    const providerInfo = snapshot.entries
      .filter((e) => needed.has(e.provider))
      .map((e) => ({
        provider: e.provider,
        status: e.status,
        error: e.error,
        defaultModeId: e.defaultModeId,
        modes: e.modes?.map((m) => m.id),
        defaultModel: e.models?.find((m) => m.isDefault)?.id ?? e.models?.[0]?.id,
        thinking: (e.models?.find((m) => m.isDefault) ?? e.models?.[0])?.thinkingOptions?.map(
          (t) => t.id,
        ),
        defaultThinking: (e.models?.find((m) => m.isDefault) ?? e.models?.[0])
          ?.defaultThinkingOptionId,
      }));
    await writeFile(path.join(outDir, "providers.json"), JSON.stringify(providerInfo, null, 2));
    console.log(JSON.stringify(providerInfo, null, 2));

    function resolveMention(spec: MentionSpec, index: number): ResolvedMention {
      const info = providerInfo.find((p) => p.provider === spec.provider);
      if (!info?.defaultModel) throw new Error(`provider ${spec.provider} unavailable`);
      // 故意选一个非默认的思考档位，才能看出父智能体是否照抄
      const thinking =
        info.thinking?.find((t) => t !== info.defaultThinking && t !== "default") ??
        info.defaultThinking;
      const modeId = info.defaultModeId ?? info.modes?.[0];
      return {
        index,
        label: spec.label,
        provider: spec.provider,
        model: info.defaultModel,
        settings: {
          ...(modeId ? { modeId } : {}),
          ...(thinking ? { thinkingOptionId: thinking } : {}),
        },
      };
    }

    function pickParentMode(provider: string): string | undefined {
      const modes = providerInfo.find((p) => p.provider === provider)?.modes ?? [];
      for (const re of [/bypass/i, /full/i, /yolo/i, /auto/i]) {
        const hit = modes.find((m) => re.test(m));
        if (hit) return hit;
      }
      return undefined;
    }

    for (const parentProvider of parents) {
      for (const scenario of SCENARIOS) {
        for (let rep = 1; rep <= reps; rep++) {
          const runId = `${parentProvider}-${scenario.id}-${rep}`;
          const cwd = await mkdtemp(path.join(os.tmpdir(), `proto-routing-${runId}-`));
          await seedRepo(cwd);
          const mentions = scenario.mentions.map((m, i) => resolveMention(m, i + 1));
          const message = `${scenario.text}\n\n${buildRoutingBlock(mentions, template)}`;
          const record: Record<string, unknown> = {
            runId,
            parentProvider,
            scenario: scenario.id,
            expected: mentions,
            message,
          };
          const children = new Map<string, unknown>();
          const childPrompts: Record<string, string | null> = {};
          const canceled = new Set<string>();
          let parentId = "";
          const startedAt = Date.now();
          console.log(`\n=== ${runId}`);
          try {
            const parentMode = pickParentMode(parentProvider);
            // 快照标的默认模型可能不是用户实际在用的（如 Pi），允许用环境变量覆盖
            const parentModel = process.env[`PARENT_MODEL_${parentProvider}`];
            const parent = await client.createAgent({
              provider: parentProvider as never,
              cwd,
              title: `proto ${runId}`,
              ...(parentMode ? { modeId: parentMode } : {}),
              ...(parentModel ? { model: parentModel } : {}),
            });
            parentId = parent.id;
            record.parentId = parentId;
            record.parentModel = parent.model;
            record.parentMode = parent.currentModeId;
            const unsubscribe = client.subscribeRawMessages((msg) =>
              collectChildren(msg, parentId, children),
            );
            await client.sendMessage(parentId, message);
            await sleep(3000);
            const deadline = Date.now() + 6 * 60_000;
            let idleStreak = 0;
            while (Date.now() < deadline) {
              const list = await client.fetchAgents().catch(() => null);
              if (list) collectChildren(list, parentId, children);
              for (const childId of children.keys()) {
                if (canceled.has(childId)) continue;
                canceled.add(childId);
                // 先取子智能体首条 prompt，再取消
                await sleep(1500);
                const tl = await client
                  .fetchAgentTimeline(childId, { direction: "tail", limit: 50 })
                  .catch(() => null);
                const first = tl?.entries.find((e) => e.item.type === "user_message");
                childPrompts[childId] =
                  first && first.item.type === "user_message" ? first.item.text : null;
                const snap = await client.fetchAgent(childId).catch(() => null);
                if (snap) children.set(childId, snap.agent);
                await client.cancelAgent(childId).catch(() => undefined);
              }
              const p = await client.fetchAgent(parentId).catch(() => null);
              for (const perm of p?.agent.pendingPermissions ?? []) {
                console.log(`  auto-allow parent permission ${perm.name ?? perm.id}`);
                await client
                  .respondToPermission(parentId, perm.id, { behavior: "allow" })
                  .catch(() => undefined);
              }
              const status = p?.agent.status;
              idleStreak = status === "running" ? 0 : idleStreak + 1;
              if (idleStreak >= 3) break;
              await sleep(2000);
            }
            unsubscribe();
            record.durationMs = Date.now() - startedAt;
            const timeline = await client.fetchAgentTimeline(parentId, {
              direction: "tail",
              limit: 500,
            });
            record.timeline = timeline.entries.map((e) => e.item);
            record.children = [...children.entries()].map(([id, snap]) => {
              const s = snap as Record<string, unknown>;
              return {
                id,
                provider: s.provider,
                model: s.model,
                currentModeId: s.currentModeId,
                thinkingOptionId: s.thinkingOptionId,
                title: s.title,
                initialPrompt: childPrompts[id] ?? null,
              };
            });
          } catch (error) {
            record.error = error instanceof Error ? error.stack : String(error);
            console.log(`  error: ${String(error)}`);
          } finally {
            for (const id of [...children.keys(), parentId].filter(Boolean)) {
              await client.cancelAgent(id).catch(() => undefined);
              await client.deleteAgent(id).catch(() => undefined);
            }
            await writeFile(path.join(outDir, `${runId}.json`), JSON.stringify(record, null, 2));
            await rm(cwd, { recursive: true, force: true }).catch(() => undefined);
          }
          const toolNames = ((record.timeline as Array<{ type: string; name?: string }>) ?? [])
            .filter((i) => i.type === "tool_call")
            .map((i) => i.name);
          console.log(
            `  children=${(record.children as unknown[] | undefined)?.length ?? 0} tools=${toolNames.join(",")}`,
          );
        }
      }
    }
  } finally {
    await client.close().catch(() => undefined);
    await daemon.stop().catch(() => undefined);
    await rm(paseoHomeRoot, { recursive: true, force: true }).catch(() => undefined);
    await rm(staticDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
