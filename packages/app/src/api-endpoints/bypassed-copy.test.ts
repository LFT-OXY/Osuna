import { createInstance } from "i18next";
import { beforeAll, describe, expect, it } from "vitest";
import { en } from "@/i18n/resources/en";
import { describeBypassed } from "./bypassed-copy";

const i18n = createInstance();

beforeAll(async () => {
  await i18n.init({ lng: "en", resources: { en: { translation: en } } });
});

function copy(params: Record<string, string>) {
  return describeBypassed({
    t: i18n.t,
    providerLabel: "Codex",
    params,
    message: "Codex was used at 09:12 but none of its requests reached Osuna",
    locale: "en-GB",
  });
}

describe("the Bypassed hint", () => {
  it("says when it was used and how to fix it, the time in the viewer's language", () => {
    const at = new Date(2026, 9, 18, 9, 12).toISOString();
    expect(copy({ how: "elsewhere", at, host: "chatgpt.com" })).toEqual({
      title: "Codex's requests didn't go through Osuna's API endpoints",
      description:
        "Codex's last request (09:12) went to chatgpt.com, not to Osuna. It was likely started before Osuna changed its settings and still runs on the old ones.\nApply again, then quit and reopen Codex.",
    });
  });

  it("falls back to the host's message when the time is missing or can't be read", () => {
    const fallback = {
      title: "Codex's requests didn't go through Osuna's API endpoints",
      description: "Codex was used at 09:12 but none of its requests reached Osuna",
    };
    expect(copy({ how: "used" })).toEqual(fallback);
    expect(copy({ how: "used", at: "yesterday-ish" })).toEqual(fallback);
    expect(copy({ how: "a-future-kind", at: new Date().toISOString() })).toEqual(fallback);
  });
});
