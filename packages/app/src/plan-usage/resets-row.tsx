// 重置卡照 magpie（https://github.com/yetone/magpie，internal/gui/assets/app.js 的 resetsWords、resetsEach，7597c132）。
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。
import { ChevronDown, ChevronUp } from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { Text as UiText } from "@/components/ui/text";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { isWeb } from "@/constants/platform";
import { resetsLine, resetTimeText } from "@/api-endpoints/balance-copy";
import { useHostFeature } from "@/runtime/host-features";
import type { UsageResetOutcome } from "@getpaseo/protocol/messages";
import type { AvailableUsageReport, UsageReportEntry } from "@/usage/types";
import { canConsumeReset, RESET_USE_KEY, resetOutcomeLine } from "./reset-consume";
import { ResetConsumeSheet } from "./reset-consume-sheet";
import { useResetConsume } from "./use-reset-consume";

type UsageResets = NonNullable<AvailableUsageReport["resets"]>;

/**
 * 有重置次数的报告才有这一行；能用的来源再带「用掉一次重置」。用掉之后次数归零时，结果那一句仍留着。
 */
export function UsageResetsRow({ serverId, entry }: { serverId: string; entry: UsageReportEntry }) {
  // COMPAT(planUsageResets): added in v0.17.0, remove gate after 2027-04-22. 老主机不认用掉重置。
  const hostSupports = useHostFeature(serverId, "planUsageResets");
  const [isAsking, setIsAsking] = useState(false);
  const { state, consume, dismiss, clearFailure } = useResetConsume({
    serverId,
    reportId: entry.id,
  });
  const ask = useCallback(() => {
    // 上一次的结果在再问一次时收起
    dismiss();
    setIsAsking(true);
  }, [dismiss]);
  // 手机上确认框卸下时也会回调这里，所以只收起失败，刚用完的结果留着
  const close = useCallback(() => {
    setIsAsking(false);
    clearFailure();
  }, [clearFailure]);
  const confirm = useCallback(() => consume(() => setIsAsking(false)), [consume]);
  const report = entry.report;
  const resets =
    report.status === "available" && report.resets && report.resets.count > 0
      ? report.resets
      : null;
  const offersUse = canConsumeReset({ entry, hostSupports });
  if (!resets && state.status !== "done") return null;
  return (
    <View style={styles.container} testID="usage-resets">
      {resets ? <ResetsRow resets={resets} /> : null}
      {offersUse ? (
        <View style={styles.actions}>
          <UseResetButton until={resets?.until ?? null} onPress={ask} />
        </View>
      ) : null}
      {state.status === "done" ? (
        <ConsumeOutcome outcome={state.outcome} onDismiss={dismiss} />
      ) : null}
      {isAsking ? (
        <ResetConsumeSheet entry={entry} state={state} onConfirm={confirm} onClose={close} />
      ) : null}
    </View>
  );
}

/** 「用掉一次重置」：桌面上悬停说明用掉哪一张（照 magpie 的按钮提示），读屏也读这一句。 */
function UseResetButton({ until, onPress }: { until: string | null; onPress: () => void }) {
  const { t, i18n } = useTranslation();
  const hint = until
    ? t(`${RESET_USE_KEY}.hintSoonest`, {
        when: resetTimeText({ iso: until, locale: i18n.language }),
      })
    : t(`${RESET_USE_KEY}.hintNoExpiry`);
  return (
    <Tooltip delayDuration={300} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          onPress={onPress}
          accessibilityHint={hint}
          testID="usage-resets-use"
        >
          {t(`${RESET_USE_KEY}.action`)}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">
        <Text style={styles.tooltipText}>{hint}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

/** 用掉之后的结果，留到再用一次或关掉。 */
function ConsumeOutcome({
  outcome,
  onDismiss,
}: {
  outcome: UsageResetOutcome;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const line = resetOutcomeLine({ t, outcome });
  return (
    <View style={styles.resultRow} testID="usage-resets-result">
      <UiText
        variant="caption"
        color={line.tone === "success" ? "statusSuccess" : "foregroundMuted"}
        selectable
        style={styles.result}
      >
        {line.text}
      </UiText>
      <Button
        variant="ghost"
        size="sm"
        onPress={onDismiss}
        style={styles.toggle}
        testID="usage-resets-result-dismiss"
      >
        {t("common.actions.dismiss")}
      </Button>
    </View>
  );
}

const KEY = "settings.apiEndpoints.balance.resets";

// 按窗口计的重置写是哪个窗口的（照 magpie resetsEach），别的写第几次
const WINDOW_KEYS: Record<string, { expires: string; never: string }> = {
  fiveHour: { expires: `${KEY}.eachFiveHourExpires`, never: `${KEY}.eachFiveHourNever` },
  weekly: { expires: `${KEY}.eachWeeklyExpires`, never: `${KEY}.eachWeeklyNever` },
};

/**
 * 「还有 2 次重置 · 最早 10月25日 22:30 过期」：账号还有几次重置；daemon 给了每张的清单时可以展开，
 * 每张一行写过期时间（magpie 放在悬停提示里，这里点开看，手机上也能看）。
 */
function ResetsRow({ resets }: { resets: UsageResets }) {
  const { t, i18n } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const toggle = useCallback(() => setIsOpen((open) => !open), []);
  // 清单不带 id：按过期先后排好，第几张就是它的身份
  const each = useMemo(
    () =>
      (resets.each ?? []).map((card, index) => ({
        until: card.until,
        window: card.window,
        n: index + 1,
      })),
    [resets.each],
  );
  const soonest = resets.until
    ? t(`${KEY}.soonest`, { when: resetTimeText({ iso: resets.until, locale: i18n.language }) })
    : null;
  const accessibilityState = useMemo(() => ({ expanded: isOpen }), [isOpen]);
  // React Native Web 不会把 accessibilityState.expanded 映射成 aria-expanded。
  const webExpandedProps = useMemo(
    () => (isWeb ? ({ "aria-expanded": isOpen } as const) : null),
    [isOpen],
  );
  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <Text style={styles.summary} testID="usage-resets-summary">
          {resetsLine({ t, resets })}
          {soonest ? <Text style={styles.soonest}>{` · ${soonest}`}</Text> : null}
        </Text>
        {each.length > 0 ? (
          <Button
            {...webExpandedProps}
            variant="ghost"
            size="sm"
            leftIcon={isOpen ? ChevronUp : ChevronDown}
            onPress={toggle}
            accessibilityLabel={t(isOpen ? `${KEY}.hideEach` : `${KEY}.showEach`)}
            accessibilityState={accessibilityState}
            style={styles.toggle}
            testID="usage-resets-toggle"
          />
        ) : null}
      </View>
      {isOpen
        ? each.map((card) => (
            <Text key={card.n} style={styles.card} testID="usage-resets-card">
              {cardLine({ t, card, locale: i18n.language })}
            </Text>
          ))
        : null}
    </View>
  );
}

function cardLine(input: {
  t: TFunction;
  card: { until: string | null; window?: string; n: number };
  locale: string;
}): string {
  const { t, card } = input;
  const keys = card.window ? WINDOW_KEYS[card.window] : undefined;
  // 每张写完整的日期时间（magpie 的 toLocaleString），跨年的也看得出
  const when = card.until ? new Date(card.until).toLocaleString(input.locale) : null;
  if (keys) return when ? t(keys.expires, { when }) : t(keys.never);
  return when ? t(`${KEY}.eachExpires`, { n: card.n, when }) : t(`${KEY}.eachNever`, { n: card.n });
}

const styles = StyleSheet.create((theme) => ({
  container: {
    gap: theme.spacing[1],
  },
  // 文字折行时箭头对着第一行
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[2],
  },
  summary: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  soonest: {
    color: theme.colors.foregroundMuted,
  },
  // 按钮的点击区比字高，向上下溢出，不撑高这一行
  toggle: {
    marginVertical: -theme.spacing[1],
  },
  card: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  actions: {
    flexDirection: "row",
  },
  resultRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  result: {
    flex: 1,
  },
  tooltipText: {
    color: theme.colors.popoverForeground,
    fontSize: theme.fontSize.sm,
    maxWidth: 320,
  },
}));
