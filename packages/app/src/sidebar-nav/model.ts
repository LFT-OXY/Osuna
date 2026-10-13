import type { PluginSidebarGroup } from "@/plugins/sidebar-groups";
import type { PluginSidebarSection } from "@/plugins/types";

export type SidebarSection = PluginSidebarSection;

/**
 * Each section's built-in items in their default order. The footer's bottom line
 * (Add project and the Hosts, Help and support, Settings icons) is fixed.
 *
 * 顶部组在上游的四项之后是 Osuna 的「用量」（打开 Usage 页）；底部组是上游的套餐用量摘要。两者的编号
 * 同为 usage，两组各自保存顺序与显隐，凡是两者不同的地方（文案、图标、默认显隐）都按所在的组区分。
 */
export const BUILTIN_SIDEBAR_ITEM_IDS = {
  header: ["new-workspace", "history", "search", "schedules", "usage"],
  footer: ["usage"],
} as const satisfies Record<SidebarSection, readonly string[]>;

export type BuiltinSidebarItemId<Section extends SidebarSection = SidebarSection> =
  (typeof BUILTIN_SIDEBAR_ITEM_IDS)[Section][number];
export type BuiltinSidebarNavId = BuiltinSidebarItemId<"header">;

/** Persisted shape. Array order is the display order. */
export interface SidebarNavPreference {
  key: string;
  visible: boolean;
}

export interface BuiltinSidebarNavItem<Section extends SidebarSection = SidebarSection> {
  kind: "builtin";
  key: BuiltinSidebarItemId<Section>;
  id: BuiltinSidebarItemId<Section>;
  visible: boolean;
}

export interface PluginSidebarNavItem {
  kind: "plugin";
  key: string;
  group: PluginSidebarGroup;
  visible: boolean;
}

export type SidebarNavItem<Section extends SidebarSection = SidebarSection> =
  | BuiltinSidebarNavItem<Section>
  | PluginSidebarNavItem;

const BUILTIN_LABEL_KEYS: Record<BuiltinSidebarItemId, string> = {
  "new-workspace": "sidebar.actions.newWorkspace",
  history: "sidebar.sections.sessions",
  search: "sidebar.sections.search",
  schedules: "sidebar.sections.schedules",
  usage: "sidebar.footer.usage",
};

/**
 * 顶部组的 usage 是 Osuna 的「用量」（打开 Usage 页），底部组的 usage 是上游的套餐用量摘要。两者在文案、
 * 设置页的标签与 testID 上的差别都从这里取，不在别处再判断「usage 在哪一组」。
 */
const HEADER_USAGE_STATS = {
  labelKey: "sidebar.sections.usage",
  testKey: "usage-stats",
} as const;

/** 设置 → 侧边栏里底部摘要的开关叫「套餐用量摘要」，侧栏里那一行与底部图标只叫「套餐用量」。 */
const FOOTER_USAGE_SUMMARY_LABEL_KEY = "sidebar.footer.usageSummary";

function isHeaderUsageStats(id: BuiltinSidebarItemId, section: SidebarSection): boolean {
  return id === "usage" && section === "header";
}

function isFooterUsageSummary(id: BuiltinSidebarItemId, section: SidebarSection): boolean {
  return id === "usage" && section === "footer";
}

/** 两组里编号同为 usage 的条目文案不同，所以要说明取哪一组的。 */
export function builtinSidebarNavLabelKey(
  id: BuiltinSidebarItemId,
  section: SidebarSection,
): string {
  return isHeaderUsageStats(id, section) ? HEADER_USAGE_STATS.labelKey : BUILTIN_LABEL_KEYS[id];
}

/** The label of the item's row on the Sidebar settings page. */
export function builtinSidebarNavSettingsLabelKey(
  id: BuiltinSidebarItemId,
  section: SidebarSection,
): string {
  if (isFooterUsageSummary(id, section)) return FOOTER_USAGE_SUMMARY_LABEL_KEY;
  return builtinSidebarNavLabelKey(id, section);
}

/** The key the settings rows build their testIDs from; the two usage items must not collide. */
export function builtinSidebarNavTestKey(
  id: BuiltinSidebarItemId,
  section: SidebarSection,
): string {
  return isHeaderUsageStats(id, section) ? HEADER_USAGE_STATS.testKey : id;
}

/**
 * Shortcut action ids (`resolveShortcutKeysForAction`) for the builtins that have one.
 * Both the sidebar row and the Appearance settings row read the badge from here so the
 * two never disagree about which shortcut belongs to which item.
 */
const BUILTIN_SHORTCUT_ACTIONS: Record<BuiltinSidebarItemId, string | null> = {
  "new-workspace": "new-workspace",
  history: null,
  search: "toggle-command-center",
  schedules: null,
  usage: null,
};

export function builtinSidebarNavShortcutAction(id: BuiltinSidebarItemId): string | null {
  return BUILTIN_SHORTCUT_ACTIONS[id];
}

/** Builtins that start hidden until the user turns them on: the footer's Plan usage summary is opt-in. */
const HIDDEN_BY_DEFAULT: ReadonlySet<BuiltinSidebarItemId> = new Set(["usage"]);

function builtinVisibleByDefault(section: SidebarSection, id: BuiltinSidebarItemId): boolean {
  return !(section === "footer" && HIDDEN_BY_DEFAULT.has(id));
}

export function pluginSidebarNavKey(
  group: Pick<PluginSidebarGroup, "pluginId" | "contributionId">,
): string {
  return `plugin:${group.pluginId}:${group.contributionId}`;
}

function isBuiltinSidebarItemId<Section extends SidebarSection>(
  section: Section,
  key: string,
): key is BuiltinSidebarItemId<Section> {
  const ids: readonly string[] = BUILTIN_SIDEBAR_ITEM_IDS[section];
  return ids.includes(key);
}

export function resolveSidebarNavItems<Section extends SidebarSection>(input: {
  section: Section;
  pluginGroups: readonly PluginSidebarGroup[];
  preferences: readonly SidebarNavPreference[];
}): SidebarNavItem<Section>[] {
  const builtinIds: readonly BuiltinSidebarItemId<Section>[] =
    BUILTIN_SIDEBAR_ITEM_IDS[input.section];
  const groupsByKey = new Map(
    input.pluginGroups.map((group) => [pluginSidebarNavKey(group), group] as const),
  );
  const items: SidebarNavItem<Section>[] = [];
  const placed = new Set<string>();

  for (const preference of input.preferences) {
    if (placed.has(preference.key)) continue;
    const group = groupsByKey.get(preference.key);
    if (group) {
      placed.add(preference.key);
      items.push({ kind: "plugin", key: preference.key, group, visible: preference.visible });
    } else if (isBuiltinSidebarItemId(input.section, preference.key)) {
      placed.add(preference.key);
      items.push({
        kind: "builtin",
        key: preference.key,
        id: preference.key,
        visible: preference.visible,
      });
    }
  }

  for (const id of builtinIds) {
    if (placed.has(id)) continue;
    items.push({
      kind: "builtin",
      key: id,
      id,
      visible: builtinVisibleByDefault(input.section, id),
    });
  }
  for (const [key, group] of groupsByKey) {
    if (placed.has(key)) continue;
    items.push({ kind: "plugin", key, group, visible: true });
  }
  return items;
}

/**
 * Resolved items lead; entries for keys that are not currently available (a plugin that is
 * disconnected right now) follow so an unrelated edit does not erase them.
 */
function toPreferences(
  items: readonly SidebarNavItem[],
  previous: readonly SidebarNavPreference[],
): SidebarNavPreference[] {
  const remaining = items.map(({ key, visible }) => ({ key, visible }));
  const availableKeys = new Set(remaining.map((preference) => preference.key));
  const preferences: SidebarNavPreference[] = [];
  const seenPrevious = new Set<string>();

  for (const preference of previous) {
    if (seenPrevious.has(preference.key)) continue;
    seenPrevious.add(preference.key);

    if (availableKeys.has(preference.key)) {
      const next = remaining.shift();
      if (next) preferences.push(next);
      continue;
    }

    preferences.push({ key: preference.key, visible: preference.visible });
  }

  preferences.push(...remaining);
  return preferences;
}

export function setSidebarNavItemVisible(input: {
  items: readonly SidebarNavItem[];
  key: string;
  visible: boolean;
  previous: readonly SidebarNavPreference[];
}): SidebarNavPreference[] {
  const items = input.items.map((item) =>
    item.key === input.key ? { ...item, visible: input.visible } : item,
  );
  return toPreferences(items, input.previous);
}

export function moveSidebarNavItem(input: {
  items: readonly SidebarNavItem[];
  key: string;
  direction: "up" | "down";
  previous: readonly SidebarNavPreference[];
}): SidebarNavPreference[] {
  const from = input.items.findIndex((item) => item.key === input.key);
  const to = input.direction === "up" ? from - 1 : from + 1;
  const canMove = from !== -1 && to >= 0 && to < input.items.length;
  if (!canMove) {
    return toPreferences(input.items, input.previous);
  }
  const items = [...input.items];
  const [moved] = items.splice(from, 1);
  items.splice(to, 0, moved);
  return toPreferences(items, input.previous);
}
