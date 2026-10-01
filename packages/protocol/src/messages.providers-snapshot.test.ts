import { describe, expect, test } from "vitest";
import {
  GetProvidersSnapshotResponseMessageSchema,
  ProviderSnapshotEntrySchema,
  ProvidersSnapshotUpdateMessageSchema,
  ServerInfoStatusPayloadSchema,
} from "./messages.js";

describe("provider snapshot message schemas", () => {
  test("defaults missing provider snapshot entry enabled state to true", () => {
    const parsed = ProviderSnapshotEntrySchema.parse({
      provider: "codex",
      status: "ready",
      label: "Codex",
    });

    expect(parsed.enabled).toBe(true);
  });

  test("preserves disabled provider snapshot entries", () => {
    const parsed = ProviderSnapshotEntrySchema.parse({
      provider: "claude",
      status: "unavailable",
      enabled: false,
      label: "Claude",
    });

    expect(parsed.enabled).toBe(false);
  });

  test("preserves enabled provider snapshot entries", () => {
    const parsed = ProviderSnapshotEntrySchema.parse({
      provider: "opencode",
      status: "loading",
      enabled: true,
      label: "OpenCode",
    });

    expect(parsed.enabled).toBe(true);
  });

  test("preserves provider snapshot entry source", () => {
    const parsed = ProviderSnapshotEntrySchema.parse({
      provider: "gemini",
      status: "ready",
      enabled: true,
      source: "custom",
      label: "Gemini",
    });

    expect(parsed.source).toBe("custom");
  });

  test("defaults missing enabled state in providers snapshot response entries", () => {
    const parsed = GetProvidersSnapshotResponseMessageSchema.parse({
      type: "get_providers_snapshot_response",
      payload: {
        entries: [
          {
            provider: "codex",
            status: "ready",
            label: "Codex",
          },
          {
            provider: "claude",
            status: "unavailable",
            enabled: false,
            label: "Claude",
          },
        ],
        generatedAt: "2026-04-24T00:00:00.000Z",
        requestId: "req-providers",
      },
    });

    expect(parsed.payload.entries.map((entry) => entry.enabled)).toEqual([true, false]);
  });

  test("defaults missing enabled state in providers snapshot update entries", () => {
    const parsed = ProvidersSnapshotUpdateMessageSchema.parse({
      type: "providers_snapshot_update",
      payload: {
        cwd: "/tmp/repo",
        entries: [
          {
            provider: "codex",
            status: "ready",
            label: "Codex",
          },
        ],
        generatedAt: "2026-04-24T00:00:00.000Z",
      },
    });

    expect(parsed.payload.entries[0]?.enabled).toBe(true);
  });
});

test("accepts a bodyless announcement with separate discovery freshness", async () => {
  const { validateWSOutboundMessage } = await import("./validation/ws-outbound.js");
  const message = {
    type: "providers_snapshot_update",
    payload: {
      cwd: "/project",
      entries: [],
      snapshotHash: "content-hash",
      fetchedAt: { codex: "2026-09-06T12:00:00.000Z" },
      generatedAt: "2026-09-06T13:00:00.000Z",
    },
  };
  expect(ProvidersSnapshotUpdateMessageSchema.parse(message)).toEqual(message);
  const result = validateWSOutboundMessage({ type: "session", message });
  expect(result.success).toBe(true);
});

// 已装版本号：新字段可选，旧 daemon 不带、旧客户端忽略。
describe("provider snapshot version", () => {
  test("carries the installed CLI version", () => {
    const parsed = ProviderSnapshotEntrySchema.parse({
      provider: "claude",
      status: "ready",
      version: "2.1.280",
    });

    expect(parsed.version).toBe("2.1.280");
  });

  test("reads an entry from an older daemon without a version", () => {
    const parsed = ProviderSnapshotEntrySchema.parse({ provider: "claude", status: "ready" });

    expect(parsed.version).toBeUndefined();
  });

  test("lets an older client parse an entry that has a version", () => {
    const oldClient = ProviderSnapshotEntrySchema.omit({ version: true });

    expect(
      oldClient.safeParse({ provider: "claude", status: "ready", version: "2.1.280" }).success,
    ).toBe(true);
  });

  test("advertises providerVersions as an optional feature", () => {
    const base = { status: "server_info" as const, serverId: "srv_1" };

    expect(
      ServerInfoStatusPayloadSchema.parse({ ...base, features: { providerVersions: true } })
        .features?.providerVersions,
    ).toBe(true);
    expect(
      ServerInfoStatusPayloadSchema.parse({ ...base, features: {} }).features?.providerVersions,
    ).toBeUndefined();
  });
});
