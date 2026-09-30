import { expect, test } from "vitest";

import type { ProviderSnapshotEntry } from "./agent-sdk-types.js";
import { resolveRoutingBlock, type RoutingBlockProviderSource } from "./routing-block.js";

const TEXT = "[@Codex](paseo://agent/provider/codex) review it";

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
    providers: providersReturning({
      provider: "codex",
      status: "error",
      enabled: true,
      error: "model list timed out",
    }),
  });

  expect(mentionLines(block)).toEqual(['1. @Codex -> provider "codex", settings {}']);
});

test("a provider still loading after the wait dispatches with the provider id only", async () => {
  const block = await resolveRoutingBlock({
    text: TEXT,
    cwd: "/tmp/project",
    canCreateAgents: true,
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
      providers: {
        hasProvider: () => true,
        getProvider: async () => {
          throw failure;
        },
      },
    }),
  ).rejects.toBe(failure);
});
