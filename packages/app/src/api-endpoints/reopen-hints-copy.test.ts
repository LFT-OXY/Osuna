import { createInstance } from "i18next";
import { beforeAll, describe, expect, it } from "vitest";
import { en } from "@/i18n/resources/en";
import { zhCN } from "@/i18n/resources/zh-CN";
import type { ReopenHintView } from "./internal/agent-settings";
import { agoOf, describeReopenHints, reopenSignature } from "./reopen-hints-copy";

const i18n = createInstance();

beforeAll(async () => {
  await i18n.init({
    lng: "en",
    resources: { en: { translation: en }, "zh-CN": { translation: zhCN } },
  });
});

const NOW = new Date("2026-10-19T12:00:00.000Z");

function hoursAgo(hours: number): Date {
  return new Date(NOW.getTime() - hours * 3_600_000);
}

function copy(input: { providerLabel: string; hints: ReopenHintView[] }) {
  return describeReopenHints({ t: i18n.t, locale: "en", now: NOW, ...input });
}

describe("who to reopen", () => {
  it("is nothing when there is nothing to reopen", () => {
    expect(copy({ providerLabel: "Codex", hints: [] })).toBeNull();
  });

  it("says, one line per kind, how each is reopened and how long ago it started, with the command whole", () => {
    expect(
      copy({
        providerLabel: "Codex",
        hints: [
          { kind: "osunaSessions", count: 2 },
          { kind: "cli", count: 1, since: hoursAgo(3) },
          { kind: "ide", count: 2, since: hoursAgo(50) },
          { kind: "app", app: "ChatGPT", since: hoursAgo(24 * 9) },
          { kind: "app", app: "Codex", since: hoursAgo(0.5) },
          { kind: "embedded", app: "Agents Anywhere", since: hoursAgo(1) },
          { kind: "appServer", since: hoursAgo(5), command: "codex app-server daemon restart" },
        ],
      }),
    ).toEqual({
      title: "Running copies of Codex still have the settings from before",
      lines: [
        {
          text: "2 Codex agents in Osuna: reload each one (Reload agent in its tab's menu).",
          command: null,
        },
        {
          text: "In a terminal (1, first started 3 hours ago): quit Codex and start it again.",
          command: null,
        },
        {
          text: "In an editor such as VS Code or Cursor (2, first started 2 days ago): reload the editor's window.",
          command: null,
        },
        {
          text: "The ChatGPT app (started last week): closing its window keeps it running. Quit it with ⌘Q and open it again.",
          command: null,
        },
        {
          text: "The Codex app (started 30 minutes ago): closing its window keeps it running. Quit it with ⌘Q and open it again.",
          command: null,
        },
        {
          text: "Agents Anywhere's own Codex (started 1 hour ago): quit Agents Anywhere and open it again.",
          command: null,
        },
        {
          text: "Background app-server (started 5 hours ago): restart it with",
          command: "codex app-server daemon restart",
        },
      ],
      note: null,
    });
  });

  it("adds what Claude Code takes at once when the host says so", () => {
    expect(
      copy({
        providerLabel: "Claude Code",
        hints: [{ kind: "osunaSessions", count: 1 }, { kind: "liveEnv" }],
      }),
    ).toEqual({
      title: "Running copies of Claude Code still have the settings from before",
      lines: [
        {
          text: "1 Claude Code agent in Osuna: reload it (Reload agent in its tab's menu).",
          command: null,
        },
      ],
      note: "Claude Code picks up newly written environment variables right away; removed variables, the model and the thinking level take effect only once a session is reopened.",
    });
  });

  it("says the app-server was restarted, on its own as the title", () => {
    expect(copy({ providerLabel: "Codex", hints: [{ kind: "appServerRestarted" }] })).toEqual({
      title: "Osuna restarted the background app-server Codex sessions share",
      lines: [
        {
          text: "No session was using it, so new Codex sessions have the new settings. If the Codex app is open, quit it and open it again to see them there.",
          command: null,
        },
      ],
      note: null,
    });
  });

  it("falls back to the host's words for a kind it doesn't know", () => {
    expect(
      copy({
        providerLabel: "Codex",
        hints: [{ kind: "unknown", message: "Something new to reopen" }],
      }),
    ).toEqual({
      title: "Running copies of Codex still have the settings from before",
      lines: [{ text: "Something new to reopen", command: null }],
      note: null,
    });
  });
});

describe("how long ago", () => {
  it("is said in the reader's language, and just now under a minute", () => {
    const zh = i18n.getFixedT("zh-CN");
    expect(agoOf({ t: zh, since: hoursAgo(3), now: NOW, locale: "zh-CN" })).toBe("3小时前");
    expect(agoOf({ t: zh, since: hoursAgo(24), now: NOW, locale: "zh-CN" })).toBe("昨天");
    expect(
      agoOf({ t: zh, since: new Date(NOW.getTime() - 20_000), now: NOW, locale: "zh-CN" }),
    ).toBe("刚刚");
  });
});

describe("the copies a dismissal covers", () => {
  it("changes when the copies change", () => {
    const one: ReopenHintView[] = [{ kind: "cli", count: 1, since: hoursAgo(3) }];
    const two: ReopenHintView[] = [{ kind: "cli", count: 2, since: hoursAgo(3) }];
    expect(reopenSignature(one)).toBe(
      reopenSignature([{ kind: "cli", count: 1, since: hoursAgo(3) }]),
    );
    expect(reopenSignature(one)).not.toBe(reopenSignature(two));
  });
});
