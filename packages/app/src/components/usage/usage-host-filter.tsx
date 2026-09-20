import { ChevronDown, Server } from "lucide-react-native";
import { useCallback, useMemo, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Text, View, type StyleProp, type ViewStyle } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { ALL_HOSTS_OPTION_ID } from "@/components/hosts/host-picker-constants";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { MenuTriggerState } from "@/components/ui/menu";
import {
  usageHostStatusKey,
  type UsageHostAvailability,
  type UsageHostOption,
  type UsageHostSelection,
} from "@/usage/host-options";

interface UsageHostFilterProps {
  options: readonly UsageHostOption[];
  selection: UsageHostSelection;
  onSelect: (serverId: string | null) => void;
}

/** Defined once so the trigger does not take a new style function every render. */
function triggerStyle({ hovered, open }: MenuTriggerState): StyleProp<ViewStyle> {
  return [styles.trigger, (hovered || open) && styles.triggerHovered];
}

/**
 * Picks which host the page is reading. Hidden on a single-host setup, where
 * there is nothing to choose between.
 */
export function UsageHostFilter({
  options,
  selection,
  onSelect,
}: UsageHostFilterProps): ReactElement | null {
  const { t } = useTranslation();
  const handleSelectAll = useCallback(() => onSelect(null), [onSelect]);
  const allHostsLeading = useMemo(() => <UsageHostDot availability="available" />, []);
  const allHostsTrailing = useMemo(
    () => (
      <UsageHostPill
        tone="gray"
        label={
          selection.countedCount === 1
            ? t("usage.hostFilter.countedOne")
            : t("usage.hostFilter.countedMany", { count: selection.countedCount })
        }
        testID="usage-host-filter-counted"
      />
    ),
    [selection.countedCount, t],
  );

  if (options.length <= 1) return null;

  const selectedName =
    options.find((option) => option.serverId === selection.selectedServerId)?.serverName ?? null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        accessibilityRole="button"
        accessibilityLabel={t("usage.hostFilter.label")}
        style={triggerStyle}
        testID="usage-host-filter-trigger"
      >
        {({ hovered, open }: MenuTriggerState) => (
          <>
            <Server
              size={14}
              color={hovered || open ? styles.triggerGlyphHovered.color : styles.triggerGlyph.color}
            />
            <Text
              style={[styles.triggerLabel, (hovered || open) && styles.triggerLabelHovered]}
              numberOfLines={1}
            >
              {selectedName ?? t("usage.hostFilter.allHosts")}
            </Text>
            <ChevronDown
              size={14}
              color={hovered || open ? styles.triggerGlyphHovered.color : styles.triggerGlyph.color}
            />
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" minWidth={240} testID="usage-host-filter-menu">
        <DropdownMenuItem
          leading={allHostsLeading}
          trailing={allHostsTrailing}
          selected={selection.selectedServerId === null}
          showSelectedCheck
          onSelect={handleSelectAll}
          testID={`usage-host-filter-item-${ALL_HOSTS_OPTION_ID}`}
        >
          {t("usage.hostFilter.allHosts")}
        </DropdownMenuItem>
        {options.map((option) => (
          <UsageHostFilterItem
            key={option.serverId}
            option={option}
            isSelected={option.serverId === selection.selectedServerId}
            onSelect={onSelect}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UsageHostFilterItem({
  option,
  isSelected,
  onSelect,
}: {
  option: UsageHostOption;
  isSelected: boolean;
  onSelect: (serverId: string | null) => void;
}): ReactElement {
  const { t } = useTranslation();
  const handleSelect = useCallback(() => onSelect(option.serverId), [onSelect, option.serverId]);
  const leading = useMemo(
    () => <UsageHostDot availability={option.availability} />,
    [option.availability],
  );
  const statusKey = usageHostStatusKey(option.availability);
  const trailing = useMemo(
    () =>
      statusKey ? (
        <UsageHostPill
          tone={option.availability === "unsupported" ? "amber" : "gray"}
          label={t(statusKey)}
          testID={`usage-host-filter-status-${option.serverId}`}
        />
      ) : null,
    [option.availability, option.serverId, statusKey, t],
  );

  return (
    <DropdownMenuItem
      leading={leading}
      trailing={trailing}
      disabled={option.availability !== "available"}
      selected={isSelected}
      showSelectedCheck
      onSelect={handleSelect}
      testID={`usage-host-filter-item-${option.serverId}`}
    >
      {option.serverName}
    </DropdownMenuItem>
  );
}

/**
 * Green while a host is answering. A host that is merely behind still shows the
 * live dot — it is reachable, and its pill says what is wrong with it.
 */
function UsageHostDot({ availability }: { availability: UsageHostAvailability }): ReactElement {
  return <View style={[styles.dot, availability !== "disconnected" && styles.dotOnline]} />;
}

function UsageHostPill({
  label,
  tone,
  testID,
}: {
  label: string;
  tone: "gray" | "amber";
  testID?: string;
}): ReactElement {
  return (
    <View style={[styles.pill, tone === "amber" ? styles.pillAmber : styles.pillGray]}>
      <Text
        style={[styles.pillText, tone === "amber" ? styles.pillTextAmber : styles.pillTextGray]}
        numberOfLines={1}
        testID={testID}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => {
  const palette = theme.colors.usage;
  return {
    trigger: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[2],
      height: 32,
      paddingHorizontal: theme.spacing[3],
      borderRadius: theme.borderRadius.md,
      borderWidth: 1,
      borderColor: palette.controlBorder,
      backgroundColor: palette.card,
      maxWidth: 220,
    },
    triggerHovered: {
      borderColor: palette.brand,
    },
    triggerLabel: {
      flexShrink: 1,
      fontSize: 12,
      fontWeight: theme.fontWeight.medium,
      color: palette.ink,
    },
    triggerLabelHovered: {
      color: palette.brand,
    },
    triggerGlyph: {
      color: palette.ink,
    },
    triggerGlyphHovered: {
      color: palette.brand,
    },
    dot: {
      width: 6,
      height: 6,
      borderRadius: theme.borderRadius.full,
      backgroundColor: palette.inkFaint,
    },
    dotOnline: {
      backgroundColor: palette.statusOnline,
    },
    pill: {
      borderRadius: theme.borderRadius.full,
      borderWidth: 1,
      paddingHorizontal: theme.spacing[2],
    },
    pillGray: {
      borderColor: palette.divider2,
      backgroundColor: "transparent",
    },
    pillAmber: {
      borderColor: palette.amberBorder,
      backgroundColor: palette.amberBg,
    },
    pillText: {
      fontSize: 11,
      fontWeight: theme.fontWeight.medium,
    },
    pillTextGray: {
      color: palette.ink2,
    },
    pillTextAmber: {
      color: palette.amberFg,
    },
  };
});
