import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Text, View, type StyleProp, type ViewStyle } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { renderUsageText } from "@/usage/text";
import { clampPct, describeReset, resolveBalanceAmount } from "./format";
import type { ProviderUsageBalance, ProviderUsageTone } from "./types";

function fillToneStyle(tone: ProviderUsageTone) {
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

export function ProviderUsageBalanceBar({ balance }: { balance: ProviderUsageBalance }) {
  const { t } = useTranslation();
  const now = Date.now();
  const { amount, usedPct } = resolveBalanceAmount(balance);
  const tone = balance.tone ?? "default";
  const reset = describeReset(balance.resetsAt, now);

  const fillStyle = useMemo<StyleProp<ViewStyle>>(
    () => [styles.fill, fillToneStyle(tone), { width: `${clampPct(usedPct ?? 0)}%` }],
    [usedPct, tone],
  );

  return (
    <View style={styles.container}>
      <View style={styles.labelRow}>
        <Text style={styles.label} numberOfLines={1}>
          {balance.label}
        </Text>
        <Text style={styles.value}>
          {renderUsageText(t, amount)}
          {reset ? <Text style={styles.reset}>{` · ${renderUsageText(t, reset)}`}</Text> : null}
        </Text>
      </View>
      {usedPct != null ? (
        <View style={styles.track}>
          <View style={fillStyle} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    gap: 3,
  },
  labelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  label: {
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  value: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  reset: {
    color: theme.colors.foregroundMuted,
    fontWeight: theme.fontWeight.normal,
  },
  track: {
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.colors.surface3,
    overflow: "hidden",
  },
  fill: {
    height: 4,
    borderRadius: 2,
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
}));
