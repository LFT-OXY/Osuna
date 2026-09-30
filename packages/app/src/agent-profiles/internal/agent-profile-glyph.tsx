import { withUnistyles } from "react-native-unistyles";
import {
  BookOpen,
  Boxes,
  Brain,
  Bug,
  Cloud,
  Code,
  Compass,
  Cpu,
  Database,
  Eye,
  Feather,
  FileText,
  FlaskConical,
  GitBranch,
  Globe,
  Hammer,
  Layers,
  Microscope,
  Package,
  Palette,
  Pencil,
  Rocket,
  Search,
  Server,
  Shield,
  Sparkles,
  Star,
  Terminal,
  TestTube,
  Wrench,
  type LucideIcon,
} from "lucide-react-native";
import type { ProviderIconComponent } from "@/components/provider-icons";
import { identityForeground } from "@/styles/identity-colors";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import {
  AGENT_PROFILE_COLORS,
  AGENT_PROFILE_ICON_KEYS,
  resolveAgentProfileColor,
  resolveAgentProfileIconKey,
  type AgentProfileColor,
  type AgentProfileIconKey,
} from "./profile-appearance";

/** Drawn when a profile names no icon, and as the "default" cell in the picker grid. */
const ThemedDefaultIcon = withUnistyles(Star);

function FallbackIconSlot({
  Icon,
  size,
  color,
}: {
  Icon: ProviderIconComponent;
  size: number;
  color: string;
}) {
  return <Icon size={size} color={color} />;
}

const ThemedFallbackIcon = withUnistyles(FallbackIconSlot);

const PROFILE_ICONS: Record<AgentProfileIconKey, LucideIcon> = {
  code: Code,
  terminal: Terminal,
  bug: Bug,
  wrench: Wrench,
  hammer: Hammer,

  flask: FlaskConical,
  testTube: TestTube,
  microscope: Microscope,
  search: Search,
  eye: Eye,

  palette: Palette,
  feather: Feather,
  pencil: Pencil,
  fileText: FileText,
  book: BookOpen,

  rocket: Rocket,
  package: Package,
  boxes: Boxes,
  server: Server,
  database: Database,

  cpu: Cpu,
  cloud: Cloud,
  globe: Globe,
  gitBranch: GitBranch,
  layers: Layers,

  compass: Compass,
  brain: Brain,
  sparkles: Sparkles,
  shield: Shield,
};

/** `withUnistyles` has to wrap each icon once at module scope, not per render. */
const THEMED_ICONS = new Map(
  AGENT_PROFILE_ICON_KEYS.map((key) => [key, withUnistyles(PROFILE_ICONS[key])]),
);

/** The raw icon for callers that theme it themselves; `null` when the profile names none we know. */
export function getAgentProfileIcon(icon: string | undefined): LucideIcon | null {
  const iconKey = resolveAgentProfileIconKey(icon);
  return iconKey ? PROFILE_ICONS[iconKey] : null;
}

const mutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

/**
 * One `uniProps` mapping per colour, built once. Building these inline would
 * hand `withUnistyles` a new function every render and defeat its tracking.
 */
const COLOR_MAPPINGS: Record<AgentProfileColor, (theme: Theme) => { color: string }> = (() => {
  const byColor = {} as Record<AgentProfileColor, (theme: Theme) => { color: string }>;
  for (const color of AGENT_PROFILE_COLORS) {
    byColor[color] =
      color === "none"
        ? mutedMapping
        : (theme: Theme) => ({ color: identityForeground(color, theme.colorScheme) });
  }
  return byColor;
})();

export function agentProfileColorMapping(
  color: AgentProfileColor,
): (theme: Theme) => { color: string } {
  return COLOR_MAPPINGS[color];
}

/**
 * How a profile is drawn everywhere it appears — settings list, model picker,
 * and the picker grid's own cells. One component so the three can't drift.
 */
export function AgentProfileGlyph({
  icon,
  color,
  size = ICON_SIZE.md,
  fallbackIcon,
}: {
  icon?: string | undefined;
  color?: string | undefined;
  size?: number;
  /** 认不出 icon 时代替默认星形，如 `@` 列表里用所属 provider 的图标。 */
  fallbackIcon?: ProviderIconComponent;
}) {
  const iconKey = resolveAgentProfileIconKey(icon);
  const mapping = COLOR_MAPPINGS[resolveAgentProfileColor(color)];
  if (!iconKey && fallbackIcon) {
    return <ThemedFallbackIcon Icon={fallbackIcon} size={size} uniProps={mapping} />;
  }
  const Icon = (iconKey && THEMED_ICONS.get(iconKey)) || ThemedDefaultIcon;
  return <Icon size={size} uniProps={mapping} />;
}
