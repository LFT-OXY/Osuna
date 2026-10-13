import { useCallback, useMemo, type ReactElement } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  Blocks,
  CalendarClock,
  Gauge,
  History,
  Plus,
  Search,
  type LucideIcon,
} from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { Shortcut } from "@/components/ui/shortcut";
import { Switch } from "@/components/ui/switch";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import {
  builtinSidebarNavSettingsLabelKey,
  builtinSidebarNavShortcutAction,
  builtinSidebarNavTestKey,
  type BuiltinSidebarItemId,
  type SidebarNavItem,
  type SidebarSection,
} from "@/sidebar-nav/model";
import { resolvePluginIcon } from "@/plugins/icons";
import { useSidebarNavItems } from "@/sidebar-nav/use-sidebar-nav-items";
import { settingsStyles } from "@/styles/settings";
import { ICON_SIZE, type Theme } from "@/styles/theme";

const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

const ThemedArrowUp = withUnistyles(ArrowUp);
const ThemedArrowDown = withUnistyles(ArrowDown);

const moveUpIcon = <ThemedArrowUp size={ICON_SIZE.sm} uniProps={mutedColorMapping} />;
const moveDownIcon = <ThemedArrowDown size={ICON_SIZE.sm} uniProps={mutedColorMapping} />;

const BUILTIN_ICONS: Record<BuiltinSidebarItemId, LucideIcon> = {
  "new-workspace": Plus,
  history: History,
  search: Search,
  schedules: CalendarClock,
  usage: Gauge,
};

// 顶部组的 usage 是 Osuna 的「用量」，图标与底部组上游的套餐用量摘要不同；文案与 testID 的差别在模型里。
const HEADER_ICONS: Partial<Record<BuiltinSidebarItemId<"header">, LucideIcon>> = {
  usage: BarChart3,
};

/** Plugin items register no icon, so they share this one; a legacy `addSidebarItem` keeps its own. */
const PLUGIN_ICON = Blocks;

function NavIcon({ Icon, color = "" }: { Icon: LucideIcon; color?: string }) {
  return <Icon size={ICON_SIZE.md} color={color} />;
}

const ThemedNavIcon = withUnistyles(NavIcon);

function navItemIcon(item: SidebarNavItem, section: SidebarSection): LucideIcon {
  if (item.kind === "builtin") {
    return (section === "header" ? HEADER_ICONS[item.id] : undefined) ?? BUILTIN_ICONS[item.id];
  }
  return item.group.kind === "legacy" ? resolvePluginIcon(item.group.icon) : PLUGIN_ICON;
}

function navItemLabel(t: TFunction, item: SidebarNavItem, section: SidebarSection): string {
  return item.kind === "builtin"
    ? t(builtinSidebarNavSettingsLabelKey(item.id, section))
    : item.group.title;
}

/** Plugin rows keep their preference key; the two builtin usage items get keys of their own. */
function navItemTestKey(item: SidebarNavItem, section: SidebarSection): string {
  if (item.kind === "builtin") return builtinSidebarNavTestKey(item.id, section);
  return item.key;
}

/** Own component so the row can stay hook-free about which items have a shortcut. */
function NavItemShortcut({ item }: { item: SidebarNavItem }): ReactElement | null {
  const chord = useShortcutKeys(
    item.kind === "builtin" ? builtinSidebarNavShortcutAction(item.id) : null,
  );
  return chord ? <Shortcut chord={chord} /> : null;
}

interface SidebarNavRowProps {
  item: SidebarNavItem;
  section: SidebarSection;
  isFirst: boolean;
  isLast: boolean;
  onMove: (key: string, direction: "up" | "down") => void;
  onSetVisible: (key: string, visible: boolean) => void;
}

function SidebarNavRow({
  item,
  section,
  isFirst,
  isLast,
  onMove,
  onSetVisible,
}: SidebarNavRowProps): ReactElement {
  const { t } = useTranslation();
  const label = navItemLabel(t, item, section);
  const testKey = navItemTestKey(item, section);

  const handleMoveUp = useCallback(() => onMove(item.key, "up"), [item.key, onMove]);
  const handleMoveDown = useCallback(() => onMove(item.key, "down"), [item.key, onMove]);
  const handleVisibleChange = useCallback(
    (visible: boolean) => onSetVisible(item.key, visible),
    [item.key, onSetVisible],
  );

  const rowStyle = useMemo(
    () => [settingsStyles.row, isFirst ? null : settingsStyles.rowBorder, styles.row],
    [isFirst],
  );

  return (
    <View style={rowStyle} testID={`sidebar-nav-item-${testKey}`}>
      <View style={styles.rowMain}>
        <ThemedNavIcon Icon={navItemIcon(item, section)} uniProps={mutedColorMapping} />
        <Text style={settingsStyles.rowTitle} numberOfLines={1}>
          {label}
        </Text>
        <NavItemShortcut item={item} />
      </View>
      <View style={styles.rowActions}>
        <Button
          variant="ghost"
          size="sm"
          leftIcon={moveUpIcon}
          onPress={handleMoveUp}
          disabled={isFirst}
          accessibilityLabel={t("settings.appearance.sidebar.moveUp")}
          testID={`sidebar-nav-move-up-${testKey}`}
        />
        <Button
          variant="ghost"
          size="sm"
          leftIcon={moveDownIcon}
          onPress={handleMoveDown}
          disabled={isLast}
          accessibilityLabel={t("settings.appearance.sidebar.moveDown")}
          testID={`sidebar-nav-move-down-${testKey}`}
        />
        <Switch
          value={item.visible}
          onValueChange={handleVisibleChange}
          accessibilityLabel={label}
          testID={`sidebar-nav-toggle-${testKey}`}
        />
      </View>
    </View>
  );
}

const SECTION_COPY = {
  header: {
    title: "settings.appearance.sidebar.header.title",
    info: "settings.appearance.sidebar.header.description",
  },
  footer: {
    title: "settings.appearance.sidebar.footer.title",
    info: "settings.appearance.sidebar.footer.description",
  },
} as const satisfies Record<SidebarSection, { title: string; info: string }>;

function SidebarItemsCard({ section }: { section: SidebarSection }): ReactElement {
  const { t } = useTranslation();
  const { items, setVisible, move } = useSidebarNavItems(section);

  return (
    <SettingsSection
      title={t(SECTION_COPY[section].title)}
      info={t(SECTION_COPY[section].info)}
      testID={`sidebar-nav-section-${section}`}
    >
      <View style={settingsStyles.card}>
        {items.map((item, index) => (
          <SidebarNavRow
            key={item.key}
            item={item}
            section={section}
            isFirst={index === 0}
            isLast={index === items.length - 1}
            onMove={move}
            onSetVisible={setVisible}
          />
        ))}
      </View>
    </SettingsSection>
  );
}

/** Settings > Sidebar: one card per section. The footer's bottom line is fixed and not listed. */
export function SidebarNavSection(): ReactElement {
  return (
    <>
      <SidebarItemsCard section="header" />
      <SidebarItemsCard section="footer" />
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    gap: theme.spacing[2],
  },
  rowMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  rowActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
}));
