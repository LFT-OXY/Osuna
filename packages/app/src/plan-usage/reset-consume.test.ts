import { createInstance } from "i18next";
import { beforeAll, describe, expect, it } from "vitest";
import { en } from "@/i18n/resources/en";
import type { UsageReportEntry } from "@/usage/types";
import { canConsumeReset, resetConfirmation, resetOutcomeLine } from "./reset-consume";

const i18n = createInstance();

beforeAll(async () => {
  await i18n.init({ lng: "en", resources: { en: { translation: en } } });
});

function entry(input: {
  count?: number;
  until?: string | null;
  byWindow?: boolean;
  usedPct?: number;
  consumesResets?: boolean;
  label?: string;
}): UsageReportEntry {
  return {
    id: "codex:work",
    account: input.label ? { label: input.label } : {},
    fetchedAt: "2026-10-22T00:00:00.000Z",
    sourceId: "codex",
    sourceLabel: "Codex",
    ...(input.consumesResets === false ? {} : { consumesResets: true }),
    report: {
      status: "available",
      windows: [{ id: "five_hour", label: "5-hour", usedPct: input.usedPct ?? 40 }],
      resets: {
        count: input.count ?? 2,
        until: input.until === undefined ? "2026-10-25T14:30:00.000Z" : input.until,
        ...(input.byWindow ? { byWindow: true } : {}),
      },
    },
  };
}

describe("using a reset from a plan usage card", () => {
  it("is offered only for a source that can, on a host that knows how, with resets counted as a whole", () => {
    expect(canConsumeReset({ entry: entry({}), hostSupports: true })).toBe(true);
    expect(canConsumeReset({ entry: entry({}), hostSupports: false })).toBe(false);
    expect(canConsumeReset({ entry: entry({ consumesResets: false }), hostSupports: true })).toBe(
      false,
    );
    expect(canConsumeReset({ entry: entry({ count: 0 }), hostSupports: true })).toBe(false);
    expect(canConsumeReset({ entry: entry({ byWindow: true }), hostSupports: true })).toBe(false);
  });

  it("asks first, naming the account, saying it can't be undone and which one is used", () => {
    const asked = resetConfirmation({
      t: i18n.t,
      entry: entry({ label: "me@example.com" }),
      formatTime: () => "Oct 25, 22:30",
    });
    expect(asked).toEqual({
      title: "Use a Codex reset?",
      paragraphs: [
        "Codex (me@example.com) has 2 resets. Using one starts its windows again at once, as if none of them had been used. It can't be undone.",
        "The one used is the one that runs out first, Oct 25, 22:30.",
      ],
    });
  });

  it("says when there is nothing to start again, and leaves out the expiry it doesn't know", () => {
    const asked = resetConfirmation({
      t: i18n.t,
      entry: entry({ count: 1, until: null, usedPct: 0 }),
      formatTime: () => "never",
    });
    expect(asked.paragraphs).toEqual([
      "Codex has 1 reset. Using it starts its windows again at once, as if none of them had been used. It can't be undone.",
      "None of its windows has been used yet, so there is nothing to start again.",
    ]);
  });

  it("says each outcome, only a reset that started windows again as a success", () => {
    const line = (code: string, windows = 0, message?: string) =>
      resetOutcomeLine({ t: i18n.t, outcome: { code, windows, message } });
    expect(line("reset", 1)).toEqual({ text: "1 window started again", tone: "success" });
    expect(line("reset", 3)).toEqual({ text: "3 windows started again", tone: "success" });
    expect(line("nothing_to_reset")).toEqual({
      text: "Nothing to start again — no window has been used, and the reset is kept",
      tone: "notice",
    });
    expect(line("no_credit")).toEqual({ text: "No reset left on the account", tone: "notice" });
    expect(line("already_redeemed")).toEqual({
      text: "That reset was already used",
      tone: "notice",
    });
    expect(line("already_used")).toEqual({ text: "That reset was already used", tone: "notice" });
    expect(line("cooldown", 0, "cooldown")).toEqual({ text: "cooldown", tone: "notice" });
  });
});
