// 用例取自 magpie（https://github.com/yetone/magpie，internal/gateway/codex_spawn_models_test.go 的 TestSpawnAgentNamesEveryModel、
// TestSpawnAgentNamesEveryModelAfterToolSearch；spawn_agent 的说明取自其中 Codex 0.162.0 的真实请求）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { describe, expect, it } from "vitest";
import { withSpawnAgentModels, type SpawnChoice } from "./codex-spawn-models.js";

const LISTED =
  "\n        \n        Available model overrides (optional; inherited parent model is preferred):\n- `gpt-6.1-sol`: Latest workhorse model.\n- `gpt-5.6-sol`: Older generation workhorse model.\n";
const TEXT = "        Spawn a sub-agent for a well-scoped task.";

function spawnAgent(description = LISTED + TEXT) {
  return {
    type: "function",
    name: "spawn_agent",
    description,
    parameters: { type: "object", properties: { model: { type: "string" } } },
  };
}

function choices(count: number): SpawnChoice[] {
  return Array.from({ length: count }, (_, index) => ({
    slug: `fake/m${index + 1}`,
    name: `M${index + 1}`,
  }));
}

function shaped(body: unknown, offered: SpawnChoice[]): unknown {
  return JSON.parse(withSpawnAgentModels({ text: JSON.stringify(body), choices: offered }));
}

const MORE = "More models that may be set as `model`:";

describe("withSpawnAgentModels", () => {
  it("adds the models Codex didn't name after its own list, ahead of its text, in Codex's collaboration namespace", () => {
    const body = {
      model: "gpt-6.1-sol",
      tools: [{ type: "namespace", name: "multi_agent_v1", tools: [spawnAgent()] }],
    };
    const offered = [
      { slug: "gpt-6.1-sol", name: "GPT-6.1 Sol" },
      { slug: "relay/glm-5", name: "GLM 5" },
      { slug: "kimi-k2", name: "kimi-k2" },
    ];

    expect(shaped(body, offered)).toEqual({
      model: "gpt-6.1-sol",
      tools: [
        {
          type: "namespace",
          name: "multi_agent_v1",
          tools: [spawnAgent(`${LISTED}${MORE}\n- \`relay/glm-5\`: GLM 5\n- \`kimi-k2\`\n${TEXT}`)],
        },
      ],
    });
  });

  it("widens the spawn_agent a tool_search_output hands the model, and names 200 models at most", () => {
    const body = { input: [{ type: "tool_search_output", tools: [spawnAgent()] }] };
    const lines = choices(200).map((choice) => `- \`${choice.slug}\`: ${choice.name}`);

    expect(shaped(body, choices(250))).toEqual({
      input: [
        {
          type: "tool_search_output",
          tools: [spawnAgent(`${LISTED}${MORE}\n${lines.join("\n")}\n${TEXT}`)],
        },
      ],
    });
  });

  it("leaves alone a request without Codex's spawn_agent, one already widened, one with nothing to add, and one whose spawn_agent takes no model", () => {
    const widened = spawnAgent(`${LISTED}${MORE}\n- \`a\`\n${TEXT}`);
    const noModel = { ...spawnAgent(), parameters: { type: "object", properties: {} } };
    for (const body of [
      { tools: [{ type: "function", name: "shell", description: "Available model overrides" }] },
      { tools: [widened] },
      { tools: [noModel] },
    ]) {
      const text = JSON.stringify(body);
      expect(withSpawnAgentModels({ text, choices: choices(3) })).toBe(text);
    }
    const listedOnly = JSON.stringify({ tools: [spawnAgent()] });
    expect(
      withSpawnAgentModels({ text: listedOnly, choices: [{ slug: "gpt-5.6-sol", name: "" }] }),
    ).toBe(listedOnly);
  });
});
