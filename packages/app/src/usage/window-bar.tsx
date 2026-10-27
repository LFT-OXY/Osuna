import { Pin } from "lucide-react-native";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  formatDisplayPct,
  formatProviderUsageLabel,
  formatResetLabel,
  formatRunsOutLabel,
} from "./format";
import { UsageMeter } from "./meter";
import { displayPercent, usageWindowRowLabel } from "./model";
import type { UsageDisplayAs } from "./preferences";
import { windowTone } from "./tone";
import type { UsageTone, UsageWindow, UsageWindowPace } from "./types";
import { useRelativeTimeTick } from "./use-relative-time-tick";

// Pinned rows carry the pinned surface; hovering an unpinned row previews it at half strength,
// so a hover never reads as the selection. Pinned rows do not react to hover.
function highlightStyle(pinned: boolean, hovered: boolean) {
  if (pinned) return styles.highlightPinned;
  return hovered ? styles.highlightHovered : styles.highlightNone;
}

export function UsageWindowBar({
  window,
  displayAs,
  pinnable,
  pinned,
  onTogglePin,
  pinLabel,
  pinTestID,
  count,
  pace,
  limit,
  layout = "inline",
  retained = false,
}: {
  retained?: boolean;
  window: UsageWindow;
  /** Osuna：用户给这个窗口设的上限，条上画出位置，数字后写出 label（如「上限 70%」）。 */
  limit?: { pct: number; label: string };
  displayAs: UsageDisplayAs;
  /** Osuna：百分比前写出的用量，如「$15.00 / $20.00」（接口余额的限额窗口）。 */
  count?: string;
  /** Osuna：重置时间后写出的配速，如「配速 +12%」；over 是照这样会在重置前用完（接口的套餐窗口）。 */
  pace?: UsageWindowPace;
  /**
   * Osuna：inline 是名字与数字一行、名字放不下截断；wrap 是名字照全写，数字放不下时挪到下一行靠右；stack 是名字一行、
   * 数字总在下一行靠右（接口页的窗口名可能很长，如「Video · 24 hours」，窄屏整组同样排）。
   */
  layout?: UsageWindowBarLayout;
  /** Whether the row pins the window to the sidebar. When false the row is a plain bar. */
  pinnable: boolean;
  pinned: boolean;
  onTogglePin: () => void;
  /** What the row pins, naming the source and window: "Pin Claude Session". */
  pinLabel: string;
  pinTestID: string;
}) {
  const { t, i18n } = useTranslation();
  const shownPct = displayPercent(window, displayAs);
  const tone = windowTone(window);

  const now = useRelativeTimeTick({ enabled: window.runsOutAt != null || window.resetsAt != null });
  // Osuna：用完时间已过时 formatRunsOutLabel 不返回，退回显示重置时间。
  const runsOut =
    window.runsOutAt != null && window.shortfallPct != null
      ? formatRunsOutLabel(window.runsOutAt, now, t)
      : null;
  const isAtRisk = runsOut != null;
  const trailing = runsOut ?? formatResetLabel(window.resetsAt, retained, now, t);

  const percent =
    shownPct != null ? formatDisplayPct(shownPct, displayAs, i18n.resolvedLanguage, t) : "—";
  const counted = count ? `${count} · ${percent}` : percent;
  const value = limit ? `${counted} · ${limit.label}` : counted;
  const accessibilityState = useMemo(() => ({ checked: pinned }), [pinned]);
  const content = {
    label: formatProviderUsageLabel(window.id, window.label, t),
    value,
    trailing,
    isAtRisk,
    pace,
    layout,
    percent: shownPct ?? 0,
    tone,
    pinned,
    markerPct: limit ? markerPctOf(limit.pct, displayAs) : undefined,
  };

  // Same padding as the pinnable row, so bars line up in both modes.
  if (!pinnable) {
    return (
      <View style={styles.row}>
        <WindowRowContent {...content} highlight={styles.highlightNone} pinnable={false} />
      </View>
    );
  }

  // The whole row pins the window to the sidebar Usage item. Pinned or not, it keeps the same
  // padding so toggling only changes the background.
  return (
    <Pressable
      onPress={onTogglePin}
      accessibilityRole="checkbox"
      accessibilityLabel={usageWindowRowLabel({ pinLabel, value, trailing })}
      accessibilityState={accessibilityState}
      aria-checked={pinned}
      style={styles.row}
      testID={pinTestID}
    >
      {({ hovered }: { hovered?: boolean }) => (
        <WindowRowContent
          {...content}
          highlight={highlightStyle(pinned, Boolean(hovered))}
          pinnable
        />
      )}
    </Pressable>
  );
}

function WindowRowContent({
  highlight,
  label,
  value,
  trailing,
  isAtRisk,
  pace,
  layout,
  percent,
  tone,
  pinnable,
  pinned,
  markerPct,
}: {
  highlight: StyleProp<ViewStyle>;
  label: string;
  value: string;
  trailing: string | null | undefined;
  isAtRisk: boolean;
  pace: UsageWindowPace | undefined;
  layout: UsageWindowBarLayout;
  percent: number;
  tone: UsageTone;
  pinnable: boolean;
  pinned: boolean;
  markerPct: number | undefined;
}) {
  return (
    <>
      <View style={highlight} pointerEvents="none" />
      <View style={styles.contentRow}>
        <View style={styles.windowContent}>
          <View style={layout === "inline" ? styles.labelRow : styles.labelRowWrapping}>
            <Text style={labelStyleOf(layout)} numberOfLines={1}>
              {label}
            </Text>
            <Text style={layout === "inline" ? styles.value : styles.valueWrapping}>
              {value}
              {trailing ? (
                <Text style={isAtRisk ? styles.atRisk : styles.reset}>{` · ${trailing}`}</Text>
              ) : null}
              {pace ? (
                <Text style={pace.over ? styles.paceOver : styles.reset}>{` · ${pace.text}`}</Text>
              ) : null}
            </Text>
          </View>
          <UsageMeter percent={percent} tone={tone} markerPct={markerPct} />
        </View>
        {pinnable ? <UsagePinGlyph pinned={pinned} /> : null}
      </View>
    </>
  );
}

export type UsageWindowBarLayout = "inline" | "wrap" | "stack";

/** 条是「已用」时上限画在那个百分比处；显示「剩余」时换算成剩余。 */
function markerPctOf(pct: number, displayAs: UsageDisplayAs): number {
  return displayAs === "used" ? pct : 100 - pct;
}

const ThemedPin = withUnistyles(Pin);

function UsagePinGlyph({ pinned }: { pinned: boolean }) {
  const { t } = useTranslation();
  const iconMapping = useMemo(
    () => (theme: { colors: { foregroundMuted: string } }) => ({
      color: theme.colors.foregroundMuted,
      fill: pinned ? theme.colors.foregroundMuted : "none",
    }),
    [pinned],
  );
  return (
    <Tooltip delayDuration={300} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger asChild>
        <View
          style={styles.pin}
          testID={pinned ? "usage-pin-glyph-pinned" : "usage-pin-glyph-unpinned"}
        >
          <ThemedPin size={12} uniProps={iconMapping} />
        </View>
      </TooltipTrigger>
      <TooltipContent side="top">
        <Text style={styles.tooltipText}>
          {pinned ? t("providerUsage.unpin") : t("providerUsage.pin")}
        </Text>
      </TooltipContent>
    </Tooltip>
  );
}

const styles = StyleSheet.create((theme) => ({
  contentRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
  windowContent: { flex: 1, gap: 3 },
  pin: { width: 12, alignItems: "center" },
  tooltipText: { color: theme.colors.popoverForeground, fontSize: theme.fontSize.sm },
  row: {
    gap: 3,
    // The highlight bleeds into the card padding so the label and bar stay on the card's rail.
    marginHorizontal: -theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1.5],
    // Its own stacking context, so the highlight layer paints above the card and below the text.
    zIndex: 0,
  },
  highlightNone: {
    display: "none",
  },
  highlightPinned: {
    ...StyleSheet.absoluteFill,
    zIndex: -1,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface2,
  },
  // The pinned surface at half strength: a separate layer, so the text keeps full opacity.
  highlightHovered: {
    ...StyleSheet.absoluteFill,
    zIndex: -1,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface2,
    opacity: theme.opacity[50],
  },
  labelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  label: {
    flex: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  labelRowWrapping: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: theme.spacing[2],
  },
  labelWhole: {
    flexShrink: 0,
    maxWidth: "100%",
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  labelLine: {
    width: "100%",
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  valueWrapping: {
    marginLeft: "auto",
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  value: {
    flexShrink: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  reset: {
    color: theme.colors.foregroundMuted,
    fontWeight: theme.fontWeight.normal,
  },
  atRisk: {
    color: theme.colors.statusDanger,
    fontWeight: theme.fontWeight.normal,
  },
  paceOver: {
    color: theme.colors.statusWarning,
    fontWeight: theme.fontWeight.normal,
  },
}));

// 在渲染时取样式：模块加载时读 styles 会在主题载入前把样式定死（unistyles-module-scope.test.ts）。
function labelStyleOf(layout: keyof typeof LABEL_STYLE_KEYS) {
  return styles[LABEL_STYLE_KEYS[layout]];
}

const LABEL_STYLE_KEYS = {
  inline: "label",
  wrap: "labelWhole",
  stack: "labelLine",
} as const;
