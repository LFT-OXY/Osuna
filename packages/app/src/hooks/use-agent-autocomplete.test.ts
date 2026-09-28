import { beforeAll, describe, expect, it } from "vitest";
import { i18n } from "@/i18n/i18next";
import {
  buildCommandAutocompleteOptions,
  resolveAutocompleteIsLoading,
  resolveAutocompleteIsVisible,
  resolveAutocompleteTexts,
} from "./use-agent-autocomplete";

const t = i18n.t;

beforeAll(async () => {
  if (!i18n.isInitialized) {
    await i18n.init();
  }
  await i18n.changeLanguage("en");
});

const review = { name: "review", description: "Review changes", argumentHint: "" };

function commandOptions(input: { commands: (typeof review)[]; isCommandsLoading: boolean }) {
  return buildCommandAutocompleteOptions({
    isVisible: true,
    mode: "command",
    commands: input.commands,
    isCommandsLoading: input.isCommandsLoading,
    pluginCommands: [],
    isDraftContext: true,
    commandFilterQuery: "",
    activeSlashCommand: { start: 0, end: 1, query: "", position: "start" },
    activeFileMention: null,
    fileSuggestions: [],
    t,
  });
}

describe("command menu visibility", () => {
  it("shows the menu before any command has arrived", () => {
    expect(
      resolveAutocompleteIsVisible({
        mode: "command",
        canLoadCommands: true,
        commandsAvailable: true,
        serverId: "server-1",
        autocompleteCwd: "/repo",
      }),
    ).toBe(true);
  });

  it("hides the menu when commands can neither be fetched nor read from cache", () => {
    expect(
      resolveAutocompleteIsVisible({
        mode: "command",
        canLoadCommands: true,
        commandsAvailable: false,
        serverId: "server-1",
        autocompleteCwd: "/repo",
      }),
    ).toBe(false);
  });
});

describe("command menu options", () => {
  it("offers nothing to select while the loading row is showing", () => {
    expect(commandOptions({ commands: [review], isCommandsLoading: true })).toEqual([]);
  });

  it("maps provider commands to selectable options once the list has arrived", () => {
    expect(commandOptions({ commands: [review], isCommandsLoading: false })).toEqual([
      {
        type: "provider_command",
        id: "review",
        label: "/review",
        detail: undefined,
        description: "Review changes",
        kind: "command",
      },
    ]);
  });
});

describe("resolveAutocompleteIsLoading", () => {
  it("shows the loading row whenever the command list has not arrived", () => {
    expect(
      resolveAutocompleteIsLoading({
        mode: "command",
        isCommandsLoading: true,
        fileSuggestionsIsPending: false,
        fileSuggestionsIsLoading: false,
        optionsLength: 0,
      }),
    ).toBe(true);
  });
});

describe("resolveAutocompleteTexts", () => {
  it("adds the send-a-message hint when the command list is partial", () => {
    expect(resolveAutocompleteTexts({ mode: "command", isCommandListPartial: true, t })).toEqual({
      loadingText: "Loading commands...",
      emptyText: "No commands found",
      footerText: "Send a message to load all commands",
    });
  });

  it("shows no hint when the list is complete or the daemon predates the field", () => {
    expect(resolveAutocompleteTexts({ mode: "command", isCommandListPartial: false, t })).toEqual({
      loadingText: "Loading commands...",
      emptyText: "No commands found",
      footerText: undefined,
    });
  });

  it("never shows the hint in the file list", () => {
    expect(resolveAutocompleteTexts({ mode: "file", isCommandListPartial: true, t })).toEqual({
      loadingText: "Searching workspace...",
      emptyText: "No files or directories found",
    });
  });
});
