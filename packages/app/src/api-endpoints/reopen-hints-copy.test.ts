import { createInstance } from "i18next";
import { beforeAll, describe, expect, it } from "vitest";
import { en } from "@/i18n/resources/en";
import type { ReopenHintView } from "./internal/agent-settings";
import { describeReopenHints } from "./reopen-hints-copy";

const i18n = createInstance();

beforeAll(async () => {
  await i18n.init({ lng: "en", resources: { en: { translation: en } } });
});

const AT_0912 = new Date(2026, 9, 19, 9, 12);

function hint(overrides: Partial<ReopenHintView> & Pick<ReopenHintView, "kind">): ReopenHintView {
  return {
    count: null,
    since: null,
    app: null,
    command: null,
    message: "host's words",
    ...overrides,
  };
}

function copy(input: { provider: string; providerLabel: string; hints: ReopenHintView[] }) {
  return describeReopenHints({ t: i18n.t, locale: "en-GB", ...input });
}

describe("who to reopen", () => {
  it("is nothing when there is nothing to reopen", () => {
    expect(copy({ provider: "codex", providerLabel: "Codex", hints: [] })).toBeNull();
  });

  it("says, one line per kind, how each is reopened, with the command whole", () => {
    expect(
      copy({
        provider: "codex",
        providerLabel: "Codex",
        hints: [
          hint({ kind: "osunaSessions", count: 2 }),
          hint({ kind: "cli", count: 1, since: AT_0912 }),
          hint({ kind: "ide", count: 2, since: AT_0912 }),
          hint({ kind: "app", count: 1, since: AT_0912 }),
          hint({ kind: "embedded", count: 1, since: AT_0912, app: "Agents Anywhere" }),
          hint({ kind: "appServer", since: AT_0912, command: "codex app-server daemon restart" }),
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
          text: "In a terminal (1, first started at 09:12): quit Codex and start it again.",
          command: null,
        },
        {
          text: "In an editor such as VS Code or Cursor (2, first started at 09:12): reload the editor's window.",
          command: null,
        },
        {
          text: "The Codex app (started at 09:12): closing its window keeps it running. Quit it with ⌘Q and open it again.",
          command: null,
        },
        {
          text: "Agents Anywhere's own Codex (started at 09:12): quit Agents Anywhere and open it again.",
          command: null,
        },
        {
          text: "The background app-server Codex sessions share (started at 09:12) still has the settings from before. Restart it with:",
          command: "codex app-server daemon restart",
        },
      ],
      note: null,
    });
  });

  it("says plainly what Claude Code takes at once and what only once reopened", () => {
    expect(
      copy({
        provider: "claude",
        providerLabel: "Claude Code",
        hints: [hint({ kind: "osunaSessions", count: 1 })],
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
    expect(
      copy({
        provider: "codex",
        providerLabel: "Codex",
        hints: [hint({ kind: "appServerRestarted", since: AT_0912 })],
      }),
    ).toEqual({
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

  it("falls back to the host's words for a kind it doesn't know or a time it can't read", () => {
    expect(
      copy({
        provider: "codex",
        providerLabel: "Codex",
        hints: [
          hint({ kind: "unknown", message: "Something new to reopen" }),
          hint({ kind: "cli", count: 1, message: "Codex in a terminal, started 09:12: quit it" }),
        ],
      }),
    ).toEqual({
      title: "Running copies of Codex still have the settings from before",
      lines: [
        { text: "Something new to reopen", command: null },
        { text: "Codex in a terminal, started 09:12: quit it", command: null },
      ],
      note: null,
    });
  });
});
