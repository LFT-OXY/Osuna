import { useStore } from "zustand";
import { providerSnapshotIcons } from "@/data/provider-icons";
import { Bot } from "lucide-react-native";
import { createElement, useCallback, useId, useMemo, type ComponentType } from "react";
import { SvgXml } from "react-native-svg";
import { PROVIDER_COLOR_ICON_SVGS } from "@/assets/provider-color-icons";
import { TERMINAL_PROFILE_ICON_NAMES } from "@getpaseo/protocol/provider-icon-names";
import { AntigravityIcon } from "@/components/icons/antigravity-icon";
import { ClaudeIcon } from "@/components/icons/claude-icon";
import { CodexIcon } from "@/components/icons/codex-icon";
import { CopilotIcon } from "@/components/icons/copilot-icon";
import { KiroIcon } from "@/components/icons/kiro-icon";
import { MiniMaxIcon } from "@/components/icons/minimax-icon";
import { OpenCodeIcon } from "@/components/icons/opencode-icon";
import { OmpIcon } from "@/components/icons/omp-icon";
import { PiIcon } from "@/components/icons/pi-icon";
import { ACP_PROVIDER_ICON_SVGS } from "@/assets/acp-provider-icons";
import { ACP_PROVIDER_CATALOG } from "@/data/acp-provider-catalog";
import { resolveProviderIconName } from "@/components/provider-icon-name";

export interface ProviderIconProps {
  size: number;
  color: string;
}

export type ProviderIconComponent = ComponentType<ProviderIconProps>;

export type ProviderIconTone = "muted" | "foreground" | "brand";

export interface ProviderGlyphInput {
  provider: string;
  serverId: string | null;
  tone: ProviderIconTone;
}

export interface ProviderGlyph {
  Icon: ProviderIconComponent;
  // 为 null 时由调用方按 tone 取主题色。
  brandColor: string | null;
}

const BUILTIN_PROVIDER_ICONS: Record<string, ProviderIconComponent> = {
  antigravity: AntigravityIcon as unknown as ProviderIconComponent,
  claude: ClaudeIcon as unknown as ProviderIconComponent,
  codex: CodexIcon as unknown as ProviderIconComponent,
  copilot: CopilotIcon as unknown as ProviderIconComponent,
  kiro: KiroIcon as unknown as ProviderIconComponent,
  minimax: MiniMaxIcon as unknown as ProviderIconComponent,
  omp: OmpIcon as unknown as ProviderIconComponent,
  opencode: OpenCodeIcon as unknown as ProviderIconComponent,
  pi: PiIcon as unknown as ProviderIconComponent,
};

// 品牌色不随主题变；没有品牌色的 provider 图标用前景色。
const PROVIDER_BRAND_COLORS: Record<string, string> = {
  claude: "#d97757",
  codex: "#3941ff",
  gemini: "#207cfe",
  kimi: "#1783ff",
  kiro: "#9046ff",
  minimax: "#e73562",
  omp: "#9b4dff",
};

export function getProviderBrandColor(provider: string): string | null {
  return PROVIDER_BRAND_COLORS[provider] ?? null;
}

const CATALOG_ICON_SVGS = new Map<string, string>(
  ACP_PROVIDER_CATALOG.flatMap((entry) => (entry.iconSvg ? [[entry.id, entry.iconSvg]] : [])),
);

for (const name of TERMINAL_PROFILE_ICON_NAMES) {
  const iconSvg = (ACP_PROVIDER_ICON_SVGS as Record<string, string | undefined>)[name];
  if (iconSvg) {
    CATALOG_ICON_SVGS.set(name, iconSvg);
  }
}

const catalogIconComponents = new Map<string, ProviderIconComponent>();
const snapshotIconComponents = new Map<string, ProviderIconComponent>();

/** Renders a sanitized SVG string from a host catalog, tinted through `currentColor`. */
export function SvgIcon({ svg, size, color }: ProviderIconProps & { svg: string }) {
  return createElement(SvgXml, { xml: svg, width: size, height: size, color });
}

function createSvgIcon(provider: string, iconSvg: string): ProviderIconComponent {
  const SvgProviderIcon: ProviderIconComponent = ({ size, color }) =>
    SvgIcon({ svg: iconSvg, size, color });
  SvgProviderIcon.displayName = `SvgProviderIcon(${provider})`;
  return SvgProviderIcon;
}

// 渐变 id 全局可见：Web 上同名 id 取文档里第一份，若它在 display:none 子树里渐变就不渲染，所以每个实例各带后缀。
export function scopeSvgIds(svg: string, suffix: string): string {
  return svg
    .replace(/\sid="([^"]+)"/g, ` id="$1-${suffix}"`)
    .replace(/url\(#([^)]+)\)/g, `url(#$1-${suffix})`);
}

// 彩色版颜色写死在 SVG 里，`color` 只驱动其中的 currentColor 部分（Kimi 的 K）。
function createColorSvgIcon(provider: string, iconSvg: string): ProviderIconComponent {
  const ColorProviderIcon: ProviderIconComponent = ({ size, color }) => {
    const idSuffix = useId().replace(/[^A-Za-z0-9_]/g, "");
    const xml = useMemo(() => scopeSvgIds(iconSvg, idSuffix), [idSuffix]);
    return createElement(SvgXml, { xml, width: size, height: size, color });
  };
  ColorProviderIcon.displayName = `ColorProviderIcon(${provider})`;
  return ColorProviderIcon;
}

const COLOR_PROVIDER_ICONS = new Map<string, ProviderIconComponent>(
  Object.entries(PROVIDER_COLOR_ICON_SVGS).map(([provider, svg]) => [
    provider,
    createColorSvgIcon(provider, svg),
  ]),
);

// brand：有彩色版的 provider 取彩色版，其余取单色版并带上品牌色（Composer toolbar 与模型列表）。
// svg 是主机快照里这个 provider 的图标，没有时为 undefined。
function resolveGlyph({
  provider,
  svg,
  tone,
}: {
  provider: string;
  svg: string | undefined;
  tone: ProviderIconTone;
}): ProviderGlyph {
  if (tone !== "brand") {
    return { Icon: resolveProviderIcon(provider, svg), brandColor: null };
  }
  const name = resolveProviderIconName(provider, svg);
  const colorIcon =
    name.kind === "builtin" || name.kind === "catalog" ? COLOR_PROVIDER_ICONS.get(name.id) : null;
  if (colorIcon) {
    return { Icon: colorIcon, brandColor: null };
  }
  return { Icon: resolveProviderIcon(provider, svg), brandColor: getProviderBrandColor(provider) };
}

/** 按主机快照当前的内容解析，不订阅；组件里用 useProviderGlyph。 */
export function resolveProviderGlyph({
  provider,
  serverId,
  tone,
}: ProviderGlyphInput): ProviderGlyph {
  return resolveGlyph({ provider, svg: readSnapshotIconSvg(provider, serverId), tone });
}

function getCatalogProviderIcon(provider: string): ProviderIconComponent {
  const cached = catalogIconComponents.get(provider);
  if (cached) {
    return cached;
  }
  const iconSvg = CATALOG_ICON_SVGS.get(provider);
  if (!iconSvg) {
    return Bot;
  }
  const icon = createSvgIcon(provider, iconSvg);
  catalogIconComponents.set(provider, icon);
  return icon;
}

function getSnapshotProviderIcon(provider: string, svg: string): ProviderIconComponent {
  const cached = snapshotIconComponents.get(svg);
  if (cached) return cached;
  const component = createSvgIcon(provider, svg);
  snapshotIconComponents.set(svg, component);
  return component;
}

function resolveProviderIcon(provider: string, svg?: string): ProviderIconComponent {
  const name = resolveProviderIconName(provider, svg);
  if (name.kind === "builtin") {
    return BUILTIN_PROVIDER_ICONS[name.id];
  }
  if (name.kind === "catalog") {
    return getCatalogProviderIcon(name.id);
  }
  if (name.kind === "svg") {
    return getSnapshotProviderIcon(provider, name.svg);
  }
  return Bot;
}

function readSnapshotIconSvg(provider: string, serverId?: string | null): string | undefined {
  return serverId ? providerSnapshotIcons.getState().get(serverId)?.get(provider) : undefined;
}

/**
 * 按主机快照当前的内容取图标，不订阅。组件里用 useProviderIcon / useProviderGlyph，快照晚到时图标才会更新；
 * 这个函数留给拿不到 hook 的纯函数（buildAgentMentionOptions，它随提供方快照重算）。
 */
export function getProviderIcon(provider: string, serverId?: string | null): ProviderIconComponent {
  return resolveProviderIcon(provider, readSnapshotIconSvg(provider, serverId));
}

export function useProviderIcon(provider: string, serverId?: string | null): ProviderIconComponent {
  const svg = useStore(providerSnapshotIcons, (state) =>
    serverId ? state.get(serverId)?.get(provider) : undefined,
  );
  return resolveProviderIcon(provider, svg);
}

/** resolveProviderGlyph 的订阅版：主机的提供方快照到达后跟着更新。 */
export function useProviderGlyph({ provider, serverId, tone }: ProviderGlyphInput): ProviderGlyph {
  const svg = useStore(providerSnapshotIcons, (state) =>
    serverId ? state.get(serverId)?.get(provider) : undefined,
  );
  return useMemo(() => resolveGlyph({ provider, svg, tone }), [provider, svg, tone]);
}

/** Subscribe once for consumers that render a collection of providers. */
export function useProviderIcons(serverId?: string | null) {
  const icons = useStore(providerSnapshotIcons, (state) =>
    serverId ? state.get(serverId) : undefined,
  );
  return useCallback(
    (provider: string) => resolveProviderIcon(provider, icons?.get(provider)),
    [icons],
  );
}
