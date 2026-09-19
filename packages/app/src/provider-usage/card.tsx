import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { getProviderIcon } from "@/components/provider-icons";
import { StatusBadge } from "@/components/ui/status-badge";
import type { Theme } from "@/styles/theme";
import { renderUsageText } from "@/usage/text";
import { ProviderUsageBalanceBar } from "./balance-bar";
import { describeFooterParts, describeStatus } from "./format";
import type { ProviderUsage } from "./types";
import { ProviderUsageWindowBar } from "./window-bar";

interface ProviderUsageIconProps {
  iconKey: string;
  size: number;
  color?: string;
}

function ProviderUsageIcon({ iconKey, size, color = "" }: ProviderUsageIconProps) {
  const Icon = getProviderIcon(iconKey);
  return <Icon size={size} color={color} />;
}

const ThemedProviderUsageIcon = withUnistyles(ProviderUsageIcon);

const mutedIconColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

/** 外壳由调用方给（「用量」页的 `UsageCard`、环形表弹层），卡片自己不带内边距。 */
export function ProviderUsageCard({ usage }: { usage: ProviderUsage }) {
  const { t } = useTranslation();
  const statusDescription = describeStatus(usage.status);
  const status = statusDescription ? renderUsageText(t, statusDescription) : null;
  const footerParts = describeFooterParts(usage, Date.now());
  const footer =
    footerParts.length > 0 ? footerParts.map((part) => renderUsageText(t, part)).join(" · ") : null;
  const balances = usage.balances ?? [];
  const details = usage.details ?? [];

  const dotStyle = useMemo(
    () => [
      styles.statusDot,
      usage.status === "available" && styles.statusDotAvailable,
      usage.status === "error" && styles.statusDotError,
    ],
    [usage.status],
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <ThemedProviderUsageIcon iconKey={usage.providerId} size={14} uniProps={mutedIconColor} />
        <Text style={styles.name} numberOfLines={1}>
          {usage.displayName}
        </Text>
        {usage.planLabel ? <StatusBadge label={usage.planLabel} variant="muted" /> : null}
        <View style={styles.headerSpacer} />
        {status ? (
          <View style={styles.statusRow}>
            <View style={dotStyle} />
            <Text style={styles.statusLabel}>{status}</Text>
          </View>
        ) : null}
      </View>

      {usage.error ? (
        <Text style={styles.error} numberOfLines={3}>
          {usage.error}
        </Text>
      ) : null}

      {usage.windows.length > 0 || balances.length > 0 ? (
        <View style={styles.bars}>
          {usage.windows.map((window) => (
            <ProviderUsageWindowBar key={window.id} window={window} />
          ))}
          {balances.map((balance) => (
            <ProviderUsageBalanceBar key={balance.id} balance={balance} />
          ))}
        </View>
      ) : null}

      {details.length > 0 ? (
        <View style={styles.details}>
          {details.map((detail) => (
            <View key={detail.id} style={styles.detailRow}>
              <Text style={styles.detailLabel} numberOfLines={1}>
                {detail.label}
              </Text>
              <Text style={styles.detailValue} numberOfLines={1}>
                {detail.value}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {footer ? (
        <Text style={styles.footer} numberOfLines={1}>
          {footer}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    gap: theme.spacing[3],
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  name: {
    flexShrink: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  headerSpacer: {
    flex: 1,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.colors.foregroundMuted,
  },
  statusDotAvailable: {
    backgroundColor: theme.colors.statusSuccess,
  },
  statusDotError: {
    backgroundColor: theme.colors.statusDanger,
  },
  statusLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  bars: {
    gap: theme.spacing[3],
  },
  details: {
    gap: theme.spacing[1],
  },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  detailLabel: {
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  detailValue: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  error: {
    color: theme.colors.palette.red[300],
    fontSize: theme.fontSize.sm,
    lineHeight: theme.fontSize.sm * 1.4,
  },
  footer: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));
