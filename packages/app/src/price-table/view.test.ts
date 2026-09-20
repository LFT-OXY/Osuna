import { beforeAll, describe, expect, it } from "vitest";
import { i18n } from "@/i18n/i18next";
import { renderUsageText } from "@/usage/text";
import { resolvePriceTableView, type PriceTablePayload } from "./view";

const PAYLOAD: PriceTablePayload = {
  requestId: "req-1",
  table: { fetchedAt: "2026-06-19T09:00:00.000Z", source: "snapshot", autoUpdate: false },
  models: [],
};

function resolve(overrides: Partial<Parameters<typeof resolvePriceTableView>[0]>) {
  return resolvePriceTableView({
    isConnected: true,
    isSupported: true,
    payload: undefined,
    isError: false,
    error: null,
    ...overrides,
  });
}

beforeAll(async () => {
  if (!i18n.isInitialized) {
    await i18n.init();
  }
  await i18n.changeLanguage("en");
});

describe("the price table's state", () => {
  it("is unavailable, not an error, while the host is offline or too old", () => {
    expect(resolve({ isConnected: false })).toEqual({
      kind: "unavailable",
      message: { key: "settings.host.priceTable.unavailable" },
    });
    expect(resolve({ isSupported: false })).toEqual({
      kind: "unavailable",
      message: { key: "settings.host.priceTable.upgradeRequired" },
    });
  });

  it("reads a disconnected host as offline rather than too old", () => {
    // 未连接的主机没有 server_info，`features.usage` 读出来也是 false；说它「太旧」
    // 是一个还给不出的判断。
    expect(resolve({ isConnected: false, isSupported: false })).toEqual({
      kind: "unavailable",
      message: { key: "settings.host.priceTable.unavailable" },
    });
  });

  it("is ready as soon as a payload is in hand, even while refetching", () => {
    expect(resolve({ payload: PAYLOAD })).toEqual({ kind: "ready", payload: PAYLOAD });
    expect(resolve({ payload: PAYLOAD, isError: true, error: new Error("stale") })).toEqual({
      kind: "ready",
      payload: PAYLOAD,
    });
  });

  it("carries the failure verbatim when the request itself failed", () => {
    expect(resolve({ isError: true, error: new Error("socket closed") })).toEqual({
      kind: "error",
      message: { text: "socket closed" },
    });
    expect(resolve({ isError: true, error: "socket closed" })).toEqual({
      kind: "error",
      message: { text: "socket closed" },
    });
  });

  it("is loading before the first answer arrives", () => {
    expect(resolve({})).toEqual({ kind: "loading" });
  });

  it("renders the two unavailable states in the UI language", () => {
    const offline = resolve({ isConnected: false });
    const tooOld = resolve({ isSupported: false });
    if (offline.kind !== "unavailable" || tooOld.kind !== "unavailable") {
      throw new Error("Expected both to be unavailable.");
    }
    expect(renderUsageText(i18n.t, offline.message)).toBe(
      "Connect to this host to see the price table.",
    );
    expect(renderUsageText(i18n.t, tooOld.message)).toBe("Update the host to see the price table.");
  });
});
