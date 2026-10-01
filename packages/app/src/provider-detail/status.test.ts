import { describe, expect, it } from "vitest";
import { i18n } from "@/i18n/i18next";
import { resolveProviderStatusLine, type ProviderStatusLineInput } from "./status";

const READY: ProviderStatusLineInput = {
  status: "ready",
  enabled: true,
  modelCount: 3,
  activeApiEndpointName: null,
};

describe("resolveProviderStatusLine", () => {
  it.each([
    [
      "disabled wins over every other state, without guessing whether it is installed",
      { ...READY, enabled: false, status: "unavailable" },
      "muted",
      "Disabled · Enable to check if it's installed",
    ],
    ["loading", { ...READY, status: "loading" }, "loading", "Loading"],
    ["error", { ...READY, status: "error" }, "danger", "Error"],
    [
      "API endpoint in use",
      { ...READY, activeApiEndpointName: "Relay" },
      "success",
      "API endpoint: Relay",
    ],
    ["available", READY, "success", "3 models"],
    ["one model", { ...READY, modelCount: 1 }, "success", "1 model"],
    ["no selectable models", { ...READY, modelCount: 0 }, "success", "0 models"],
    ["not installed", { ...READY, status: "unavailable" }, "warning", "Not installed"],
  ] as const)("%s", (_name, input, tone, english) => {
    const line = resolveProviderStatusLine(input);

    expect(line.tone).toBe(tone);
    expect(i18n.getFixedT("en")(line.label.key, line.label.params)).toBe(english);
  });
});
