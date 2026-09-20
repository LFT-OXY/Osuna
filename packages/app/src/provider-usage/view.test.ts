import { beforeAll, describe, expect, it } from "vitest";
import { i18n } from "@/i18n/i18next";
import { renderUsageText } from "@/usage/text";
import type { ProviderUsageListPayload } from "./types";
import {
  PROVIDER_USAGE_CLIENT_UNAVAILABLE_KEY,
  resolveProviderUsageView,
  type ProviderUsageViewInput,
} from "./view";

const PAYLOAD: ProviderUsageListPayload = {
  requestId: "req-1",
  fetchedAt: "2026-06-19T09:00:00.000Z",
  providers: [],
};

function resolve(overrides: Partial<ProviderUsageViewInput>) {
  return resolveProviderUsageView({
    isConnected: true,
    isSupported: true,
    payload: undefined,
    isFetching: false,
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

describe("the plan usage state shared by the card and the tooltip", () => {
  it("asks for a connection before it asks for an update", () => {
    // 未连接的主机没有 server_info，`providerUsageList` 读出来也是 false；先说
    // 「这台机器太旧」是一个还给不出的判断。
    expect(resolve({ isConnected: false, isSupported: false })).toEqual({
      kind: "error",
      message: { key: "usage.planUsage.hostUnavailable" },
    });
    expect(resolve({ isSupported: false })).toEqual({
      kind: "error",
      message: { key: "usage.planUsage.hostUpgradeRequired" },
    });
  });

  it("stays ready while a refresh is in flight, and says so", () => {
    expect(resolve({ payload: PAYLOAD, isFetching: true })).toEqual({
      kind: "ready",
      payload: PAYLOAD,
      isRefreshing: true,
    });
    expect(resolve({ payload: PAYLOAD })).toEqual({
      kind: "ready",
      payload: PAYLOAD,
      isRefreshing: false,
    });
  });

  it("keeps the last answer rather than dropping to an error on a failed refetch", () => {
    expect(resolve({ payload: PAYLOAD, isError: true, error: new Error("boom") })).toEqual({
      kind: "ready",
      payload: PAYLOAD,
      isRefreshing: false,
    });
  });

  it("turns the client-unavailable sentinel back into a translated sentence", () => {
    const view = resolve({
      isError: true,
      error: new Error(PROVIDER_USAGE_CLIENT_UNAVAILABLE_KEY),
    });
    expect(view).toEqual({
      kind: "error",
      message: { key: PROVIDER_USAGE_CLIENT_UNAVAILABLE_KEY },
    });
    if (view.kind !== "error") throw new Error("Expected an error view.");
    expect(renderUsageText(i18n.t, view.message)).toBe("Host connection is not ready");
  });

  it("passes any other failure through as its own words", () => {
    expect(resolve({ isError: true, error: new Error("socket closed") })).toEqual({
      kind: "error",
      message: { text: "socket closed" },
    });
  });

  it("is loading before the first answer arrives", () => {
    expect(resolve({})).toEqual({ kind: "loading" });
  });
});
