import { useMemo } from "react";
import { z } from "zod";
import type { PluginThemeContribution } from "@osuna/plugin";
import { useBuiltInThemeNames } from "@/appearance/theme-labels";
import { useHostFeatureMap } from "@/runtime/host-features";
import {
  buildDarkSemanticColors,
  buildDarkTheme,
  buildLightSemanticColors,
  buildLightTheme,
  darkTheme,
  lightTheme,
  type Theme,
} from "@/styles/theme";
import {
  getPreferredPluginContributionHost,
  rememberPluginContributionHost,
} from "../contribution-host";
import { useInstalledPlugins } from "../registry";
import type { InstalledPlugin } from "../types";

const hexColorSchema = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, "Must be a hex color");

const contributionSchema: z.ZodType<PluginThemeContribution> = z.strictObject({
  id: z.string(),
  name: z.string().trim().min(1).max(60),
  appearance: z.enum(["light", "dark"]),
  colors: z.strictObject({
    background: hexColorSchema,
    foreground: hexColorSchema,
    raised: hexColorSchema,
    control: hexColorSchema,
    border: hexColorSchema,
    accent: hexColorSchema.optional(),
    mutedForeground: hexColorSchema,
    ring: hexColorSchema,
  }),
});

export interface PluginThemeOption {
  id: string;
  serverId: string;
  name: string;
  /**
   * 只有当这一行的显示名和别人撞上时才非空：内容是贡献它的插件 id，界面用它把两条
   * 一模一样的文字分开。不撞名时为 null，行保持单行。
   */
  qualifier: string | null;
  swatch: string;
  theme: Theme;
}

interface PluginThemeTarget {
  serverId: string;
  pluginId: string;
  contribution: PluginThemeContribution;
}

interface ResolvedPluginTheme extends PluginThemeTarget {
  id: string;
}

export function parsePluginThemeContribution(value: unknown): PluginThemeContribution {
  return contributionSchema.parse(value);
}

function buildDarkPluginTheme(contribution: PluginThemeContribution): Theme {
  const colors = contribution.colors;
  const accent = colors.accent ?? colors.foreground;
  return buildDarkTheme(
    buildDarkSemanticColors({
      surface0: colors.background,
      surface1: colors.raised,
      surface2: colors.control,
      surface3: colors.border,
      surface4: colors.ring,
      surfaceDiffEmpty: colors.raised,
      surfaceSidebar: colors.background,
      foreground: colors.foreground,
      foregroundMuted: colors.mutedForeground,
      foregroundExtraMuted: colors.ring,
      border: colors.border,
      borderAccent: colors.border,
      accent,
      accentBright: accent,
      accentForeground: colors.background,
      destructive: darkTheme.colors.destructive,
      terminalBlack: colors.control,
      terminalBrightBlack: colors.ring,
      ring: colors.ring,
    }),
  );
}

function buildLightPluginTheme(contribution: PluginThemeContribution): Theme {
  const colors = contribution.colors;
  const accent = colors.accent ?? colors.foreground;
  return buildLightTheme(
    buildLightSemanticColors({
      surface0: colors.background,
      surface1: colors.raised,
      surface2: colors.control,
      surface3: colors.border,
      surface4: colors.ring,
      surfaceDiffEmpty: colors.raised,
      surfaceSidebar: colors.control,
      foreground: colors.foreground,
      foregroundMuted: colors.mutedForeground,
      foregroundExtraMuted: colors.ring,
      border: colors.border,
      borderAccent: colors.border,
      accent,
      accentBright: accent,
      accentForeground: colors.background,
      primary: colors.foreground,
      primaryForeground: colors.background,
      destructive: lightTheme.colors.destructive,
      terminalBlack: colors.foreground,
      terminalBrightBlack: colors.ring,
      ring: colors.ring,
    }),
  );
}

function buildPluginTheme(contribution: PluginThemeContribution): Theme {
  return contribution.appearance === "light"
    ? buildLightPluginTheme(contribution)
    : buildDarkPluginTheme(contribution);
}

function resolveTheme(id: string, targets: PluginThemeTarget[]): ResolvedPluginTheme {
  const preferredHost = getPreferredPluginContributionHost(id);
  const target = targets.find((candidate) => candidate.serverId === preferredHost) ?? targets[0];
  return {
    id,
    serverId: target.serverId,
    pluginId: target.pluginId,
    contribution: target.contribution,
  };
}

function pluginNameKey(pluginId: string, name: string): string {
  return `${pluginId}\u0000${name}`;
}

interface NameCollisionIndex {
  byName: ReadonlyMap<string, number>;
  byPluginAndName: ReadonlyMap<string, number>;
  builtInThemeNames: ReadonlySet<string>;
}

function buildCollisionIndex(
  resolved: ResolvedPluginTheme[],
  builtInThemeNames: ReadonlySet<string>,
): NameCollisionIndex {
  const byName = new Map<string, number>();
  const byPluginAndName = new Map<string, number>();
  for (const { pluginId, contribution } of resolved) {
    const name = contribution.name;
    byName.set(name, (byName.get(name) ?? 0) + 1);
    const key = pluginNameKey(pluginId, name);
    byPluginAndName.set(key, (byPluginAndName.get(key) ?? 0) + 1);
  }
  return { byName, byPluginAndName, builtInThemeNames };
}

// 一个插件贡献两个同名主题时，插件 id 分辨不了它们，限定词退化为主题自己的 id。
function qualifierFor(resolved: ResolvedPluginTheme, index: NameCollisionIndex): string | null {
  const { pluginId, contribution } = resolved;
  const collides =
    index.builtInThemeNames.has(contribution.name) ||
    (index.byName.get(contribution.name) ?? 0) > 1;
  if (!collides) return null;
  return (index.byPluginAndName.get(pluginNameKey(pluginId, contribution.name)) ?? 0) > 1
    ? contribution.id
    : pluginId;
}

/**
 * 撞名判定发生在跨 host 合并之后，所以同一个主题出现在两个 host 上不会被当成两条重名。
 * `builtInThemeNames` 是调用方按当前语言解析好的内置主题显示名，判定跟着语言走。
 */
export function collectPluginThemes(
  plugins: InstalledPlugin[],
  supportedHosts: ReadonlySet<string>,
  builtInThemeNames: ReadonlySet<string>,
): PluginThemeOption[] {
  const targetsById = new Map<string, PluginThemeTarget[]>();
  for (const plugin of plugins) {
    if (!supportedHosts.has(plugin.serverId)) continue;
    for (const contribution of plugin.themes) {
      const id = `${plugin.id}/theme/${contribution.id}`;
      const target = { serverId: plugin.serverId, pluginId: plugin.id, contribution };
      const targets = targetsById.get(id);
      if (targets) targets.push(target);
      else targetsById.set(id, [target]);
    }
  }

  const resolved = [...targetsById].map(([id, targets]) => resolveTheme(id, targets));
  const index = buildCollisionIndex(resolved, builtInThemeNames);

  return resolved.map((entry) => {
    const { contribution, serverId } = entry;
    return {
      id: entry.id,
      serverId,
      name: contribution.name,
      qualifier: qualifierFor(entry, index),
      swatch: contribution.colors.background,
      theme: buildPluginTheme(contribution),
    };
  });
}

export function rememberPluginThemeHost(option: PluginThemeOption): void {
  rememberPluginContributionHost(option.id, option.serverId);
}

function supportedThemeHosts(support: ReadonlyMap<string, boolean>): Set<string> {
  const serverIds = new Set<string>();
  for (const [serverId, supported] of support) {
    if (supported) serverIds.add(serverId);
  }
  return serverIds;
}

export function usePluginThemeCatalog(): PluginThemeOption[] {
  const plugins = useInstalledPlugins();
  const builtInThemeNames = useBuiltInThemeNames();
  const serverIds = useMemo(
    () => [...new Set(plugins.map((plugin) => plugin.serverId))],
    [plugins],
  );
  // COMPAT(pluginThemes): added in v0.5.0, remove gate after 2027-08-20.
  const support = useHostFeatureMap(serverIds, "pluginThemes");
  return useMemo(
    () => collectPluginThemes(plugins, supportedThemeHosts(support), builtInThemeNames),
    [plugins, support, builtInThemeNames],
  );
}
