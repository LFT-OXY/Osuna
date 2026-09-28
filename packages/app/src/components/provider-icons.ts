import { Bot, PackagePlus } from "lucide-react-native";
import { createElement, useId, useMemo, type ComponentType } from "react";
import { SvgXml } from "react-native-svg";
import { PROVIDER_COLOR_ICON_SVGS } from "@/assets/provider-color-icons";
import { ClaudeIcon } from "@/components/icons/claude-icon";
import { CodexIcon } from "@/components/icons/codex-icon";
import { CopilotIcon } from "@/components/icons/copilot-icon";
import { MiniMaxIcon } from "@/components/icons/minimax-icon";
import { OpenCodeIcon } from "@/components/icons/opencode-icon";
import { OmpIcon } from "@/components/icons/omp-icon";
import { PiIcon } from "@/components/icons/pi-icon";
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
  claude: ClaudeIcon as unknown as ProviderIconComponent,
  codex: CodexIcon as unknown as ProviderIconComponent,
  copilot: CopilotIcon as unknown as ProviderIconComponent,
  kiro: PackagePlus,
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

const CATALOG_ICON_SVGS = new Map(
  ACP_PROVIDER_CATALOG.flatMap((entry) => (entry.iconSvg ? [[entry.id, entry.iconSvg]] : [])),
);

const catalogIconComponents = new Map<string, ProviderIconComponent>();
const snapshotIconComponents = new Map<string, { svg: string; component: ProviderIconComponent }>();

function createSvgIcon(provider: string, iconSvg: string): ProviderIconComponent {
  const SvgProviderIcon: ProviderIconComponent = ({ size, color }) =>
    createElement(SvgXml, {
      xml: iconSvg,
      width: size,
      height: size,
      color,
    });
  SvgProviderIcon.displayName = `SvgProviderIcon(${provider})`;
  return SvgProviderIcon;
}

// 渐变 id 全局可见：Web 上同名 id 取文档里第一份，若它在 display:none 子树里渐变就不渲染，所以每个实例各带后缀。
function scopeSvgIds(svg: string, suffix: string): string {
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
export function resolveProviderGlyph({
  provider,
  serverId,
  tone,
}: ProviderGlyphInput): ProviderGlyph {
  if (tone !== "brand") {
    return { Icon: getProviderIcon(provider, serverId), brandColor: null };
  }
  const name = resolveProviderIconName(provider, serverId);
  const colorIcon =
    name.kind === "builtin" || name.kind === "catalog" ? COLOR_PROVIDER_ICONS.get(name.id) : null;
  if (colorIcon) {
    return { Icon: colorIcon, brandColor: null };
  }
  return { Icon: getProviderIcon(provider, serverId), brandColor: getProviderBrandColor(provider) };
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
  const cached = snapshotIconComponents.get(provider);
  if (cached?.svg === svg) return cached.component;
  const component = createSvgIcon(provider, svg);
  snapshotIconComponents.set(provider, { svg, component });
  return component;
}

export function getProviderIcon(provider: string, serverId?: string | null): ProviderIconComponent {
  const name = resolveProviderIconName(provider, serverId);
  if (name.kind === "builtin") {
    return BUILTIN_PROVIDER_ICONS[name.id];
  }
  if (name.kind === "catalog") {
    return getCatalogProviderIcon(name.id);
  }
  if (name.kind === "svg") {
    return getSnapshotProviderIcon(`${serverId}:${provider}`, name.svg);
  }
  return Bot;
}
