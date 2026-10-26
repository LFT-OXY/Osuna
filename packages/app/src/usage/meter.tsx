import { useMemo } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { clampPct } from "./format";
import type { UsageTone } from "./types";

function fillToneStyle(tone: UsageTone) {
  switch (tone) {
    case "ok":
      return styles.fillOk;
    case "warning":
      return styles.fillWarning;
    case "danger":
      return styles.fillDanger;
    default:
      return styles.fillDefault;
  }
}

/**
 * A window's share as a bar, coloured by its tone. `quiet` fills it with a surface colour instead,
 * for summaries where a row of coloured bars would be noise. The caller sizes the track.
 */
export function UsageMeter({
  percent,
  tone,
  quiet = false,
  markerPct,
  style,
}: {
  percent: number;
  tone: UsageTone;
  quiet?: boolean;
  /** Osuna：在条上这个百分比处画一道竖线（账号窗口的上限）。 */
  markerPct?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const fillWidth = clampPct(percent);
  const fillStyle = useMemo<StyleProp<ViewStyle>>(
    () => [styles.fill, quiet ? styles.fillQuiet : fillToneStyle(tone), { width: `${fillWidth}%` }],
    [fillWidth, quiet, tone],
  );
  const markerStyle = useMemo<StyleProp<ViewStyle>>(
    () => (markerPct === undefined ? null : [styles.marker, { left: `${clampPct(markerPct)}%` }]),
    [markerPct],
  );
  if (markerStyle) {
    // 竖线比条高，画在条外面一层，不被条的 overflow 裁掉。
    return (
      <View style={[styles.markerFrame, style]}>
        <View style={styles.track}>
          <View style={fillStyle} />
        </View>
        <View style={markerStyle} testID="usage-meter-marker" />
      </View>
    );
  }
  return (
    <View style={[styles.track, style]}>
      <View style={fillStyle} />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  track: {
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.colors.surface3,
    overflow: "hidden",
  },
  // Follows the track, so a caller that sizes the track sizes the bar.
  fill: {
    height: "100%",
    borderRadius: theme.borderRadius.full,
  },
  fillQuiet: {
    backgroundColor: theme.colors.surface4,
  },
  fillDefault: {
    backgroundColor: theme.colors.foregroundMuted,
  },
  fillOk: {
    backgroundColor: theme.colors.statusSuccess,
  },
  fillWarning: {
    backgroundColor: theme.colors.statusWarning,
  },
  fillDanger: {
    backgroundColor: theme.colors.statusDanger,
  },
  markerFrame: {
    position: "relative",
    justifyContent: "center",
  },
  marker: {
    position: "absolute",
    top: -3,
    bottom: -3,
    width: 2,
    marginLeft: -1,
    borderRadius: 1,
    backgroundColor: theme.colors.foreground,
  },
}));
