import { expect, test } from "vitest";

import type { ProviderSnapshotEntry } from "./agent-sdk-types.js";
import { resolveRoutingBlock, type RoutingBlockProviderSource } from "./routing-block.js";

const TEXT = "[@Codex](osuna://agent/provider/codex) review it";

function providersReturning(entry: ProviderSnapshotEntry): RoutingBlockProviderSource {
  return {
    hasProvider: () => true,
    getProvider: async () => entry,
  };
}

function mentionLines(block: string | null): string[] {
  const match = /Start them now, before any other work:\n\n([\s\S]*?)\n\nRules:/.exec(block ?? "");
  return match?.[1]?.split("\n") ?? [];
}

test("a provider whose catalog failed to load still dispatches with the provider id only", async () => {
  const block = await resolveRoutingBlock({
    text: TEXT,
    cwd: "/tmp/project",
    canCreateAgents: true,
    mentionDefaults: () => undefined,
    agentProfiles: [],
    providers: providersReturning({
      provider: "codex",
      status: "error",
      enabled: true,
      error: "model list timed out",
    }),
  });

  expect(mentionLines(block)).toEqual(['1. @Codex -> provider "codex", settings {}']);
});

test("a provider still loading after the wait gets the configured values as written", async () => {
  const block = await resolveRoutingBlock({
    text: TEXT,
    cwd: "/tmp/project",
    canCreateAgents: true,
    mentionDefaults: () => ({ model: "gpt-9", thinkingOptionId: "xhigh", modeId: "read-only" }),
    agentProfiles: [],
    providers: providersReturning({ provider: "codex", status: "loading", enabled: true }),
  });

  expect(mentionLines(block)).toEqual([
    '1. @Codex -> provider "codex/gpt-9", settings {"modeId":"read-only","thinkingOptionId":"xhigh"}',
  ]);
});

test("a provider still loading after the wait dispatches with the provider id only", async () => {
  const block = await resolveRoutingBlock({
    text: TEXT,
    cwd: "/tmp/project",
    canCreateAgents: true,
    mentionDefaults: () => undefined,
    agentProfiles: [],
    providers: providersReturning({ provider: "codex", status: "loading", enabled: true }),
  });

  expect(mentionLines(block)).toEqual(['1. @Codex -> provider "codex", settings {}']);
});

test("a snapshot read that throws rejects instead of guessing defaults", async () => {
  const failure = new Error("Provider codex is not configured");

  await expect(
    resolveRoutingBlock({
      text: TEXT,
      cwd: "/tmp/project",
      canCreateAgents: true,
      mentionDefaults: () => undefined,
      agentProfiles: [],
      providers: {
        hasProvider: () => true,
        getProvider: async () => {
          throw failure;
        },
      },
    }),
  ).rejects.toBe(failure);
});

test("a provider without a default mode dispatches in its first mode instead of the parent's", async () => {
  const block = await resolveRoutingBlock({
    text: TEXT,
    cwd: "/tmp/project",
    canCreateAgents: true,
    mentionDefaults: () => undefined,
    agentProfiles: [],
    providers: providersReturning({
      provider: "codex",
      status: "ready",
      enabled: true,
      defaultModeId: null,
      models: [],
      modes: [
        { id: "build", label: "Build" },
        { id: "plan", label: "Plan" },
      ],
    }),
  });

  expect(mentionLines(block)).toEqual([
    '1. @Codex -> provider "codex", settings {"modeId":"build"}',
  ]);
});

test("a default mode missing from the catalog falls back to the first mode", async () => {
  const block = await resolveRoutingBlock({
    text: TEXT,
    cwd: "/tmp/project",
    canCreateAgents: true,
    mentionDefaults: () => undefined,
    agentProfiles: [],
    providers: providersReturning({
      provider: "codex",
      status: "ready",
      enabled: true,
      defaultModeId: "auto-review",
      models: [],
      modes: [
        { id: "read-only", label: "Read only" },
        { id: "auto", label: "Auto" },
      ],
    }),
  });

  expect(mentionLines(block)).toEqual([
    '1. @Codex -> provider "codex", settings {"modeId":"read-only"}',
  ]);
});

test("a provider with no modes at all dispatches without a mode", async () => {
  const block = await resolveRoutingBlock({
    text: TEXT,
    cwd: "/tmp/project",
    canCreateAgents: true,
    mentionDefaults: () => ({ modeId: "plan" }),
    agentProfiles: [],
    providers: providersReturning({
      provider: "codex",
      status: "ready",
      enabled: true,
      defaultModeId: null,
      models: [],
      modes: [],
    }),
  });

  expect(mentionLines(block)).toEqual(['1. @Codex -> provider "codex", settings {}']);
});

test("a profile whose provider's catalog failed to load gets its fields over Mention defaults as written", async () => {
  const block = await resolveRoutingBlock({
    text: "[@Reviewer](osuna://agent/profile/reviewer) review it",
    cwd: "/tmp/project",
    canCreateAgents: true,
    mentionDefaults: () => ({ model: "gpt-9", modeId: "read-only" }),
    agentProfiles: [
      {
        id: "reviewer",
        name: "Reviewer",
        provider: "codex",
        thinkingOptionId: "xhigh",
        modeId: "auto",
        featureValues: { fast_mode: true },
      },
    ],
    providers: providersReturning({
      provider: "codex",
      status: "error",
      enabled: true,
      error: "model list timed out",
    }),
  });

  expect(mentionLines(block)).toEqual([
    '1. @Reviewer -> provider "codex/gpt-9", settings {"modeId":"auto","thinkingOptionId":"xhigh","features":{"fast_mode":true}}',
  ]);
});

test("a profile whose provider is unavailable gets a cannot-start line", async () => {
  const block = await resolveRoutingBlock({
    text: "[@Reviewer](osuna://agent/profile/reviewer) review it",
    cwd: "/tmp/project",
    canCreateAgents: true,
    mentionDefaults: () => undefined,
    agentProfiles: [{ id: "reviewer", name: "Reviewer", provider: "codex" }],
    providers: providersReturning({ provider: "codex", status: "unavailable", enabled: true }),
  });

  expect(mentionLines(block)).toEqual([
    '1. @Reviewer -> cannot start: provider "codex" is not available. Tell the user.',
  ]);
});
