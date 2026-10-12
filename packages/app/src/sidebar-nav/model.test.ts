import { describe, expect, it } from "vitest";
import type { PluginSidebarGroup } from "@/plugins/sidebar-groups";
import {
  builtinSidebarNavLabelKey,
  builtinSidebarNavSettingsLabelKey,
  builtinSidebarNavShortcutAction,
  builtinSidebarNavTestKey,
  moveSidebarNavItem,
  pluginSidebarNavKey,
  resolveSidebarNavItems,
  setSidebarNavItemVisible,
  type SidebarNavItem,
  type SidebarNavPreference,
} from "./model";

function group(pluginId: string, contributionId: string): PluginSidebarGroup {
  return {
    kind: "item",
    key: `${pluginId}/sidebar/${contributionId}`,
    pluginId,
    contributionId,
    title: contributionId,
    targets: [],
  };
}

const kanban = group("kanban", "board");
const notes = group("notes", "inbox");
const kanbanKey = pluginSidebarNavKey(kanban);
const notesKey = pluginSidebarNavKey(notes);

function summarize(items: readonly SidebarNavItem[]): SidebarNavPreference[] {
  return items.map(({ key, visible }) => ({ key, visible }));
}

describe("resolveSidebarNavItems", () => {
  it("yields builtins then plugins, all visible, when nothing is stored", () => {
    const items = resolveSidebarNavItems({
      section: "header",
      pluginGroups: [kanban, notes],
      preferences: [],
    });

    expect(summarize(items)).toEqual([
      { key: "new-workspace", visible: true },
      { key: "history", visible: true },
      { key: "search", visible: true },
      { key: "schedules", visible: true },
      { key: "usage", visible: true },
      { key: kanbanKey, visible: true },
      { key: notesKey, visible: true },
    ]);
    expect(items[5]).toEqual({ kind: "plugin", key: kanbanKey, group: kanban, visible: true });
    expect(items[0]).toEqual({
      kind: "builtin",
      key: "new-workspace",
      id: "new-workspace",
      visible: true,
    });
  });

  it("keeps the stored order and appends newly available items as visible", () => {
    const items = resolveSidebarNavItems({
      section: "header",
      pluginGroups: [notes, kanban],
      preferences: [
        { key: kanbanKey, visible: false },
        { key: "schedules", visible: true },
        { key: "new-workspace", visible: false },
      ],
    });

    expect(summarize(items)).toEqual([
      { key: kanbanKey, visible: false },
      { key: "schedules", visible: true },
      { key: "new-workspace", visible: false },
      { key: "history", visible: true },
      { key: "search", visible: true },
      { key: "usage", visible: true },
      { key: notesKey, visible: true },
    ]);
  });

  it("skips keys that are unknown or not currently available", () => {
    const items = resolveSidebarNavItems({
      section: "header",
      pluginGroups: [],
      preferences: [
        { key: notesKey, visible: false },
        { key: "bogus", visible: true },
        { key: "history", visible: true },
      ],
    });

    expect(items.map((item) => item.key)).toEqual([
      "history",
      "new-workspace",
      "search",
      "schedules",
      "usage",
    ]);
  });

  it("lets the first of duplicate keys win", () => {
    const items = resolveSidebarNavItems({
      section: "header",
      pluginGroups: [],
      preferences: [
        { key: "history", visible: false },
        { key: "history", visible: true },
      ],
    });

    expect(summarize(items)).toEqual([
      { key: "history", visible: false },
      { key: "new-workspace", visible: true },
      { key: "search", visible: true },
      { key: "schedules", visible: true },
      { key: "usage", visible: true },
    ]);
  });
});

describe("the footer Plan usage summary", () => {
  it("starts hidden until it is turned on", () => {
    const resolve = (preferences: SidebarNavPreference[]) =>
      summarize(resolveSidebarNavItems({ section: "footer", pluginGroups: [], preferences }));

    expect(resolve([])).toEqual([{ key: "usage", visible: false }]);
    expect(resolve([{ key: "usage", visible: true }])).toEqual([{ key: "usage", visible: true }]);
  });
});

// Osuna 的「用量」条目与上游的套餐用量摘要编号同为 usage，分属顶部与底部两组。
describe("the header Usage item", () => {
  it("reads a stored header order with Usage hidden back as-is", () => {
    const stored: SidebarNavPreference[] = [
      { key: "new-workspace", visible: true },
      { key: "history", visible: true },
      { key: "search", visible: true },
      { key: "schedules", visible: true },
      { key: "usage", visible: false },
    ];

    expect(
      summarize(
        resolveSidebarNavItems({ section: "header", pluginGroups: [], preferences: stored }),
      ),
    ).toEqual(stored);
  });

  it("reads a stored header order with Usage moved to the top back as-is", () => {
    const stored: SidebarNavPreference[] = [
      { key: "usage", visible: true },
      { key: "search", visible: true },
      { key: "new-workspace", visible: true },
      { key: "history", visible: true },
      { key: "schedules", visible: true },
    ];

    expect(
      summarize(
        resolveSidebarNavItems({ section: "header", pluginGroups: [], preferences: stored }),
      ),
    ).toEqual(stored);
  });

  it("is visible by default while the footer summary starts hidden", () => {
    const header = resolveSidebarNavItems({ section: "header", pluginGroups: [], preferences: [] });
    const footer = resolveSidebarNavItems({ section: "footer", pluginGroups: [], preferences: [] });

    expect(summarize(header).at(-1)).toEqual({ key: "usage", visible: true });
    expect(summarize(footer)).toEqual([{ key: "usage", visible: false }]);
  });

  it("takes its own copy, settings label and testID, apart from the footer summary", () => {
    expect(builtinSidebarNavLabelKey("usage", "header")).toBe("sidebar.sections.usage");
    expect(builtinSidebarNavLabelKey("usage", "footer")).toBe("sidebar.footer.usage");
    expect(builtinSidebarNavSettingsLabelKey("usage", "header")).toBe("sidebar.sections.usage");
    expect(builtinSidebarNavSettingsLabelKey("usage", "footer")).toBe(
      "sidebar.footer.usageSummary",
    );
    expect(builtinSidebarNavSettingsLabelKey("history", "header")).toBe(
      builtinSidebarNavLabelKey("history", "header"),
    );
    expect(builtinSidebarNavTestKey("usage", "header")).toBe("usage-stats");
    expect(builtinSidebarNavTestKey("usage", "footer")).toBe("usage");
    expect(builtinSidebarNavTestKey("history", "header")).toBe("history");
  });
});

describe("setSidebarNavItemVisible", () => {
  it("toggles one item and writes the full resolved order", () => {
    const items = resolveSidebarNavItems({
      section: "header",
      pluginGroups: [kanban],
      preferences: [],
    });

    const next = setSidebarNavItemVisible({ items, key: "search", visible: false, previous: [] });

    expect(next).toEqual([
      { key: "new-workspace", visible: true },
      { key: "history", visible: true },
      { key: "search", visible: false },
      { key: "schedules", visible: true },
      { key: "usage", visible: true },
      { key: kanbanKey, visible: true },
    ]);
  });

  it("carries preferences for unavailable plugins through an unrelated edit", () => {
    const previous: SidebarNavPreference[] = [
      { key: notesKey, visible: false },
      { key: "history", visible: true },
    ];
    const items = resolveSidebarNavItems({
      section: "header",
      pluginGroups: [],
      preferences: previous,
    });

    const next = setSidebarNavItemVisible({ items, key: "history", visible: false, previous });

    expect(next).toEqual([
      { key: notesKey, visible: false },
      { key: "history", visible: false },
      { key: "new-workspace", visible: true },
      { key: "search", visible: true },
      { key: "schedules", visible: true },
      { key: "usage", visible: true },
    ]);
  });

  it("keeps an unavailable plugin in its configured position", () => {
    const previous: SidebarNavPreference[] = [
      { key: "new-workspace", visible: true },
      { key: notesKey, visible: false },
      { key: "history", visible: true },
      { key: "search", visible: true },
      { key: "schedules", visible: true },
      { key: "usage", visible: true },
    ];
    const items = resolveSidebarNavItems({
      section: "header",
      pluginGroups: [],
      preferences: previous,
    });

    const next = setSidebarNavItemVisible({ items, key: "history", visible: false, previous });

    expect(next).toEqual([
      { key: "new-workspace", visible: true },
      { key: notesKey, visible: false },
      { key: "history", visible: false },
      { key: "search", visible: true },
      { key: "schedules", visible: true },
      { key: "usage", visible: true },
    ]);
    expect(
      summarize(
        resolveSidebarNavItems({
          section: "header",
          pluginGroups: [notes],
          preferences: next,
        }),
      ),
    ).toEqual(next);
  });

  it("returns the normalized list unchanged for an unknown key", () => {
    const items = resolveSidebarNavItems({
      section: "header",
      pluginGroups: [],
      preferences: [],
    });

    const next = setSidebarNavItemVisible({ items, key: "bogus", visible: false, previous: [] });

    expect(next).toEqual(summarize(items));
  });
});

describe("moveSidebarNavItem", () => {
  const items = resolveSidebarNavItems({
    section: "header",
    pluginGroups: [kanban],
    preferences: [],
  });

  it("moves an item up", () => {
    const next = moveSidebarNavItem({ items, key: "search", direction: "up", previous: [] });

    expect(next.map((preference) => preference.key)).toEqual([
      "new-workspace",
      "search",
      "history",
      "schedules",
      "usage",
      kanbanKey,
    ]);
  });

  it("moves an item down", () => {
    const next = moveSidebarNavItem({ items, key: "schedules", direction: "down", previous: [] });

    expect(next.map((preference) => preference.key)).toEqual([
      "new-workspace",
      "history",
      "search",
      "usage",
      "schedules",
      kanbanKey,
    ]);
  });

  it("leaves the order alone at the boundaries", () => {
    const first = moveSidebarNavItem({
      items,
      key: "new-workspace",
      direction: "up",
      previous: [],
    });
    const last = moveSidebarNavItem({ items, key: kanbanKey, direction: "down", previous: [] });

    expect(first).toEqual(summarize(items));
    expect(last).toEqual(summarize(items));
  });

  it("returns the normalized list unchanged for an unknown key", () => {
    const next = moveSidebarNavItem({ items, key: "bogus", direction: "down", previous: [] });

    expect(next).toEqual(summarize(items));
  });

  it("drops duplicate carried-over keys", () => {
    const previous: SidebarNavPreference[] = [
      { key: notesKey, visible: false },
      { key: notesKey, visible: true },
    ];

    const next = moveSidebarNavItem({ items, key: "history", direction: "up", previous });

    expect(next.filter((preference) => preference.key === notesKey)).toEqual([
      { key: notesKey, visible: false },
    ]);
  });
});

describe("builtinSidebarNavShortcutAction", () => {
  it("maps only the builtins that have a keyboard shortcut", () => {
    expect(builtinSidebarNavShortcutAction("new-workspace")).toBe("new-workspace");
    expect(builtinSidebarNavShortcutAction("search")).toBe("toggle-command-center");
    expect(builtinSidebarNavShortcutAction("history")).toBeNull();
    expect(builtinSidebarNavShortcutAction("schedules")).toBeNull();
    expect(builtinSidebarNavShortcutAction("usage")).toBeNull();
  });
});

describe("footer section", () => {
  const sync = group("sync", "status");
  const syncKey = pluginSidebarNavKey(sync);

  it("resolves the Usage item first, then plugin rows", () => {
    const items = resolveSidebarNavItems({
      section: "footer",
      pluginGroups: [sync],
      preferences: [],
    });

    // Osuna：底部的套餐用量摘要默认隐藏（上游此时默认可见）。
    expect(summarize(items)).toEqual([
      { key: "usage", visible: false },
      { key: syncKey, visible: true },
    ]);
  });

  it("ignores header built-ins stored in footer preferences", () => {
    const items = resolveSidebarNavItems({
      section: "footer",
      pluginGroups: [],
      preferences: [{ key: "history", visible: false }],
    });

    expect(summarize(items)).toEqual([{ key: "usage", visible: false }]);
  });

  it("ignores the footer icon buttons, which are fixed and not items", () => {
    const items = resolveSidebarNavItems({
      section: "footer",
      pluginGroups: [sync],
      preferences: [
        { key: "add-project", visible: false },
        { key: "hosts", visible: false },
        { key: "import", visible: false },
        { key: "help", visible: false },
        { key: syncKey, visible: true },
        { key: "usage", visible: false },
      ],
    });

    expect(summarize(items)).toEqual([
      { key: syncKey, visible: true },
      { key: "usage", visible: false },
    ]);
  });

  it("moves and shows footer rows while keeping an unavailable plugin's entry", () => {
    const notesPreference = { key: notesKey, visible: false };
    const previous: SidebarNavPreference[] = [notesPreference];
    const items = resolveSidebarNavItems({
      section: "footer",
      pluginGroups: [sync],
      preferences: previous,
    });

    const moved = moveSidebarNavItem({ items, key: syncKey, direction: "up", previous });
    const shown = setSidebarNavItemVisible({
      items: resolveSidebarNavItems({
        section: "footer",
        pluginGroups: [sync],
        preferences: moved,
      }),
      key: "usage",
      visible: true,
      previous: moved,
    });

    expect(shown).toEqual([
      notesPreference,
      { key: syncKey, visible: true },
      { key: "usage", visible: true },
    ]);
  });
});
