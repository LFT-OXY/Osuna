// 用例取自 magpie（https://github.com/yetone/magpie，internal/agent/connect_pick_test.go 的 TestConnectKeepsTheModel）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { describe, expect, test } from "vitest";
import { pickDefaultModel, type DefaultModelPickInput } from "./default-model-pick.js";
import type { ApiEndpointState, StoredApiEndpoint } from "./store.js";

function endpoint(input: Pick<StoredApiEndpoint, "id" | "slug"> & Partial<StoredApiEndpoint>) {
  return {
    name: input.slug,
    baseUrls: [{ format: "anthropic_messages" as const, url: `https://${input.slug}.example` }],
    models: [],
    enabled: true,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...input,
  };
}

const relay = endpoint({
  id: "ep_r",
  slug: "relay",
  models: [{ id: "first" }, { id: "glm-4.6" }],
});
const backup = endpoint({
  id: "ep_b",
  slug: "backup",
  models: [{ id: "claude-opus-4-6" }, { id: "glm-4.6" }],
});

function state(endpoints: StoredApiEndpoint[], defaultModelId: string | null = null) {
  const value: ApiEndpointState = {
    endpoints,
    agents: {
      claude: { enabled: false, defaultModelId },
      codex: { enabled: false, defaultModelId: null },
    },
  };
  return value;
}

function pickInput(overrides: Partial<DefaultModelPickInput>): DefaultModelPickInput {
  return {
    state: state([relay, backup]),
    provider: "claude",
    cliModel: null,
    isWired: false,
    reconnect: null,
    joinsOwnModel: false,
    ...overrides,
  };
}

function pick(overrides: Partial<DefaultModelPickInput>) {
  const picked = pickDefaultModel(pickInput(overrides));
  if (!picked) throw new Error("Expected a default model");
  return picked;
}

describe("pickDefaultModel", () => {
  test("keeps the model of a switch that is already on", () => {
    const on = state([relay, backup], "backup/glm-4.6");
    on.agents.claude.enabled = true;
    expect(pick({ state: on, cliModel: "first" })).toEqual({
      how: "kept",
      defaultModelId: "backup/glm-4.6",
      previousModel: "first",
    });
  });

  test("keeps the model a CLI still wired to the gateway is on", () => {
    expect(pick({ isWired: true, cliModel: "glm-4.6[1m]" })).toMatchObject({
      how: "kept",
      defaultModelId: "glm-4.6",
    });
  });

  test("puts back the model of the last switch-off while the CLI is as it was left", () => {
    const reconnect = { model: "backup/glm-4.6", left: "sonnet" };
    expect(pick({ cliModel: "sonnet", reconnect })).toMatchObject({
      how: "again",
      defaultModelId: "backup/glm-4.6",
    });
    // CLI 的模型之后被改过，或那个模型已没人提供：不再放回。
    expect(pick({ cliModel: "glm-4.6", reconnect }).how).toBe("same");
    expect(pick({ cliModel: "sonnet", reconnect: { model: "gone", left: "sonnet" } }).how).toBe(
      "first",
    );
  });

  test("a Codex signed in with ChatGPT keeps its own model", () => {
    expect(pick({ provider: "codex", cliModel: "gpt-5.5", joinsOwnModel: true })).toEqual({
      how: "joined",
      defaultModelId: "first",
      previousModel: "gpt-5.5",
    });
  });

  test("goes on with the model the CLI is on: its own spelling, an endpoint prefix or [1m] read off", () => {
    expect(pick({ cliModel: "backup/glm-4.6" })).toMatchObject({
      how: "same",
      defaultModelId: "backup/glm-4.6",
    });
    for (const cliModel of ["glm-4.6", "glm-4.6[1m]", "zhipu/glm-4.6", "claude-opus-4.6"]) {
      expect(pick({ cliModel }).how, cliModel).toBe("same");
    }
    expect(pick({ cliModel: "claude-opus-4.6" }).defaultModelId).toBe("claude-opus-4-6");
  });

  test("an alias goes to the model its tier is mapped to, else to a model of its family", () => {
    const mapped = { ...relay, modelMapping: { opus: "glm-4.6" } };
    expect(pick({ state: state([mapped, backup]), cliModel: "opus" })).toMatchObject({
      how: "alike",
      defaultModelId: "relay/glm-4.6",
    });
    // magpie TestConnectKeepsTheModel：opus 去 magpie 提供的 Claude Opus，不去第一家的第一个。
    expect(pick({ cliModel: "opus[1m]" })).toMatchObject({
      how: "alike",
      defaultModelId: "claude-opus-4-6",
    });
  });

  test("takes the first model when no endpoint offers the one the CLI is on, or it has none", () => {
    expect(pick({ cliModel: "gpt-9" })).toEqual({
      how: "first",
      defaultModelId: "first",
      previousModel: "gpt-9",
    });
    expect(pick({ cliModel: null })).toMatchObject({ how: "first", defaultModelId: "first" });
  });

  test("has nothing to pick when no endpoint that is on offers a model", () => {
    expect(
      pickDefaultModel(pickInput({ state: state([{ ...relay, enabled: false }]) })),
    ).toBeNull();
  });
});
