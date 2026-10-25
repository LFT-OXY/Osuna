import React, { useCallback, useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { ProviderAccountSwitch } from "@getpaseo/protocol/provider-account/rpc-schemas";
import { Button } from "@/components/ui/button";
import { useIsCompactFormFactor } from "@/constants/layout";
import { settingsStyles } from "@/styles/settings";
import { formatMessageTimestamp } from "@/utils/time";

/** 「最近换号」：最新的在上，默认 5 条，可展开到主机留着的全部（最多 50 条）。不弹通知，只记在这里。 */

const KEY = "settings.providers.accounts.switches";
const COLLAPSED_COUNT = 5;
const KNOWN_REASONS = new Set([
  "use_now",
  "lapsed",
  "used_up",
  "limit",
  "held",
  "room_again",
  "keep_signed_in",
  "not_listed",
]);

export function SwitchLog({ switches }: { switches: ProviderAccountSwitch[] }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  // 窄窗口里时间单独一行，「从 → 到」占满整行，不被时间挤得断开。
  const isCompact = useIsCompactFormFactor();
  const toggle = useCallback(() => setExpanded((value) => !value), []);
  if (switches.length === 0) return null;
  const shown = expanded ? switches : switches.slice(0, COLLAPSED_COUNT);
  return (
    <View style={styles.container} testID="provider-accounts-switches">
      <Text style={styles.title}>{t(`${KEY}.title`)}</Text>
      <View style={settingsStyles.card}>
        {shown.map((entry, index) => (
          <View
            key={`${entry.at}-${entry.from?.accountId ?? ""}-${entry.to.accountId}`}
            style={[
              styles.entry,
              isCompact && styles.entryStacked,
              index > 0 && settingsStyles.rowBorder,
            ]}
            testID="provider-accounts-switch"
          >
            <Text style={styles.time}>{formatMessageTimestamp(new Date(entry.at))}</Text>
            <View style={styles.entryBody}>
              <Text style={settingsStyles.rowTitle}>{switchText(t, entry)}</Text>
              <Text style={settingsStyles.rowHint}>{reasonText(t, entry)}</Text>
            </View>
          </View>
        ))}
      </View>
      {switches.length > COLLAPSED_COUNT ? (
        <View style={styles.toggleRow}>
          <Button
            variant="ghost"
            size="sm"
            onPress={toggle}
            testID="provider-accounts-switches-toggle"
          >
            {expanded ? t(`${KEY}.showFewer`) : t(`${KEY}.showAll`, { count: switches.length })}
          </Button>
        </View>
      ) : null}
    </View>
  );
}

function emailOf(t: TFunction, end: ProviderAccountSwitch["to"] | undefined): string {
  return end?.email ?? t("settings.providers.accounts.unknownEmail");
}

function switchText(t: TFunction, entry: ProviderAccountSwitch): string {
  if (!entry.from) return t(`${KEY}.toOnly`, { to: emailOf(t, entry.to) });
  return t(`${KEY}.fromTo`, { from: emailOf(t, entry.from), to: emailOf(t, entry.to) });
}

/** 已知原因用翻译；新 daemon 加的原因认不出时用通用说法。 */
function reasonText(t: TFunction, entry: ProviderAccountSwitch): string {
  if (!KNOWN_REASONS.has(entry.reason)) return t(`${KEY}.reasons.other`);
  // used_up、limit 要写明哪个窗口到了多少；老记录没有 window 时用通用说法。
  const { window } = entry;
  if ((entry.reason === "used_up" || entry.reason === "limit") && !window) {
    return t(`${KEY}.reasons.other`);
  }
  const usedPct = window ? Math.round(window.usedPct) : 0;
  return t(`${KEY}.reasons.${entry.reason}`, {
    from: emailOf(t, entry.from),
    to: emailOf(t, entry.to),
    window: window?.label ?? "",
    pct: usedPct,
    limit: window?.limitPct ?? 0,
  });
}

const styles = StyleSheet.create((theme) => ({
  container: {
    marginTop: theme.spacing[4],
    gap: theme.spacing[2],
  },
  title: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  entry: {
    flexDirection: "row",
    alignItems: "flex-start",
    flexWrap: "wrap",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
  },
  entryStacked: {
    flexDirection: "column",
    gap: theme.spacing[1],
  },
  time: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    minWidth: 96,
  },
  entryBody: {
    flex: 1,
    minWidth: 180,
    gap: 2,
  },
  toggleRow: {
    flexDirection: "row",
  },
}));
