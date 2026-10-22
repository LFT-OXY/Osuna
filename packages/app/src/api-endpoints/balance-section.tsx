import React, { useCallback, useMemo } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { RotateCw } from "lucide-react-native";
import type {
  ApiEndpointBalanceReading,
  ApiEndpointBalanceWindow,
} from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { Button } from "@/components/ui/button";
import { Text as UiText } from "@/components/ui/text";
import { settingsStyles } from "@/styles/settings";
import { useAppSettings } from "@/hooks/use-settings";
import { formatAmount } from "@/usage/format";
import type { UsageDisplayAs } from "@/usage/preferences";
import { UsageWindowBar } from "@/usage/window-bar";
import { openExternalUrl } from "@/utils/open-external-url";
import { relativeAgo } from "./reopen-hints-copy";
import { failureTitle, hintOf, itemLabel, windowLabel } from "./balance-copy";
import type { EndpointBalances } from "./use-endpoint-balances";

/**
 * 接口详情页的「余额与套餐用量」区：每项余额一行，标题下写读数时间，右侧「刷新」。
 * 查不到时就地写原因，对方的原话（已打码）接在下面；认不出查法时写明，并给「填写余额查询地址」。
 */
export function ApiEndpointBalanceSection({
  endpointId,
  hasApiKey,
  balances,
  now,
  onFillBalanceUrl,
}: {
  endpointId: string;
  // 没填 key 的接口不查余额（照 magpie），分区说它没 key，不说认不出。
  hasApiKey: boolean;
  balances: Exclude<EndpointBalances, { status: "off" }>;
  now: Date;
  // 打开编辑窗口并定位到余额栏；老主机的编辑窗口没有这几栏时为 null。
  onFillBalanceUrl: (() => void) | null;
}) {
  const { t, i18n } = useTranslation();
  const reading = balances.status === "ready" ? balances.readings.get(endpointId) : undefined;
  const isRefreshing = balances.status === "loading" || balances.isRefreshing;
  const refresh = balances.status === "loading" ? null : balances.refresh;
  const refreshLabel = t("settings.apiEndpoints.balance.refresh");
  const trailing = useMemo(
    () => (
      <Button
        variant="ghost"
        size="sm"
        leftIcon={RotateCw}
        loading={isRefreshing}
        disabled={isRefreshing || refresh === null}
        onPress={refresh ?? undefined}
        accessibilityLabel={refreshLabel}
        testID="api-endpoint-balance-refresh"
      >
        {refreshLabel}
      </Button>
    ),
    [isRefreshing, refresh, refreshLabel],
  );
  const readAt = reading?.readAt ?? null;
  const stale = staleOf(reading);
  const caption = useMemo(
    () =>
      readAt === null ? null : (
        <UiText
          variant="caption"
          // 暂时查不到、显示的是上次读数：用提醒色；开关关着没去读的只是没刷新。
          color={stale === "temporary" ? "statusWarning" : "foregroundMuted"}
          numberOfLines={2}
          testID={stale === null ? "api-endpoint-balance-read-at" : "api-endpoint-balance-stale"}
        >
          {readAtCopy({
            t,
            ago: relativeAgo({ since: new Date(readAt), now, locale: i18n.language }),
            stale,
          })}
        </UiText>
      ),
    [i18n.language, now, readAt, stale, t],
  );
  return (
    <SettingsSection
      title={t("settings.apiEndpoints.balance.title")}
      info={t("settings.apiEndpoints.balance.info")}
      caption={caption}
      trailing={trailing}
      testID="api-endpoint-balance-section"
    >
      <View style={settingsStyles.card}>
        <BalanceBody
          balances={balances}
          reading={reading}
          hasApiKey={hasApiKey}
          onFillBalanceUrl={onFillBalanceUrl}
        />
      </View>
    </SettingsSection>
  );
}

function BalanceBody({
  balances,
  reading,
  hasApiKey,
  onFillBalanceUrl,
}: {
  balances: Exclude<EndpointBalances, { status: "off" }>;
  reading: ApiEndpointBalanceReading | undefined;
  hasApiKey: boolean;
  onFillBalanceUrl: (() => void) | null;
}) {
  const { t } = useTranslation();
  if (balances.status === "loading") {
    return (
      <Notice
        text={t("settings.apiEndpoints.balance.loading")}
        testID="api-endpoint-balance-loading"
      />
    );
  }
  if (balances.status === "error") {
    return (
      <FailureRows
        title={t("settings.apiEndpoints.balance.readFailed")}
        hint={null}
        detail={balances.message}
        seeAt={null}
        testID="api-endpoint-balance-failure"
      />
    );
  }
  if (!reading || reading.status === "unsupported") {
    if (!hasApiKey) {
      return (
        <Notice
          text={t("settings.apiEndpoints.balance.noKey")}
          testID="api-endpoint-balance-unsupported"
        />
      );
    }
    return (
      <View style={settingsStyles.row}>
        <UiText
          variant="caption"
          color="foregroundMuted"
          style={styles.noticeText}
          testID="api-endpoint-balance-unsupported"
        >
          {t("settings.apiEndpoints.balance.unsupported")}
        </UiText>
        {onFillBalanceUrl ? (
          <Button
            variant="outline"
            size="xs"
            onPress={onFillBalanceUrl}
            testID="api-endpoint-balance-fill-url"
          >
            {t("settings.apiEndpoints.balance.fillUrl")}
          </Button>
        ) : null}
      </View>
    );
  }
  if (reading.status !== "ok") {
    return (
      <FailureRows
        title={failureTitle({ t, failure: reading.failure })}
        hint={hintOf({ t, failure: reading.failure })}
        detail={reading.failure?.detail ?? null}
        seeAt={reading.failure?.seeAt ?? null}
        testID="api-endpoint-balance-failure"
      />
    );
  }
  if (reading.items.length === 0) {
    // 读到了，但这家现在没有单独的余额（如 Ollama Cloud 没买过 credits）。
    return (
      <Notice
        text={t("settings.apiEndpoints.balance.noItems")}
        testID="api-endpoint-balance-no-items"
      />
    );
  }
  return (
    <>
      {reading.items.map((item, index) => (
        <View
          key={`${item.label ?? ""}:${item.unit ?? ""}:${item.text}`}
          style={[settingsStyles.row, index > 0 && settingsStyles.rowBorder]}
          testID="api-endpoint-balance-item"
        >
          {/* 赠送 / 充值是上面总额的组成，标题放轻。 */}
          <Text style={[settingsStyles.rowTitle, item.part ? styles.partTitle : null]}>
            {itemLabel({ t, item })}
          </Text>
          <Text style={[settingsStyles.rowValue, styles.amount]} selectable>
            {item.text}
          </Text>
        </View>
      ))}
      {reading.windows && reading.windows.length > 0 ? (
        <BalanceWindows windows={reading.windows} />
      ) : null}
    </>
  );
}

/** 限额窗口（如 sub2api key 的 5 小时 / 1 天 / 7 天）：套餐用量的窗口条，已用 / 剩余照套餐用量的选择，百分比前写用量。 */
function BalanceWindows({ windows }: { windows: ApiEndpointBalanceWindow[] }) {
  const { t, i18n } = useTranslation();
  const { settings } = useAppSettings();
  const displayAs = settings.usage.displayAs;
  const shown = useMemo(
    () =>
      windows.map((window) => ({
        window: { ...window, label: windowLabel({ t, window }) },
        count: windowCount({ window, displayAs, locale: i18n.language }),
      })),
    [displayAs, i18n.language, t, windows],
  );
  return (
    <View style={[styles.windows, settingsStyles.rowBorder]} testID="api-endpoint-balance-windows">
      {shown.map(({ window, count }) => (
        <UsageWindowBar
          key={window.id}
          window={window}
          count={count}
          displayAs={displayAs}
          pinnable={false}
          pinned={false}
          onTogglePin={noop}
          pinLabel=""
          pinTestID=""
        />
      ))}
    </View>
  );
}

function noop() {}

/** 「$15.00 / $20.00」：已用（或剩余）与上限，照 magpie quotaCount；没有上限时不写。 */
function windowCount(input: {
  window: ApiEndpointBalanceWindow;
  displayAs: UsageDisplayAs;
  locale: string;
}): string | undefined {
  const { window, displayAs, locale } = input;
  const limit = window.limit ?? null;
  if (limit === null || limit <= 0) return undefined;
  const used = Math.max(0, window.used ?? 0);
  const shown = displayAs === "remaining" ? Math.max(0, limit - used) : used;
  const format = (value: number) => amountIn({ value, unit: window.unit ?? null, locale });
  return `${format(shown)} / ${format(limit)}`;
}

/** 美元按界面语言写成货币，别的单位写在数后面。 */
function amountIn(input: { value: number; unit: string | null; locale: string }): string {
  if (input.unit === "USD") return formatAmount(input.value, "usd", input.locale);
  const amount = formatAmount(input.value, "credits", input.locale);
  return input.unit ? `${amount} ${input.unit}` : amount;
}

function Notice({ text, testID }: { text: string; testID: string }) {
  return (
    <View style={settingsStyles.row}>
      <UiText variant="caption" color="foregroundMuted" testID={testID}>
        {text}
      </UiText>
    </View>
  );
}

/** 原因一行，具体提示、对方的原话（可能很长）各另起一行，有控制台时末尾给链接。 */
function FailureRows({
  title,
  hint,
  detail,
  seeAt,
  testID,
}: {
  title: string;
  hint: string | null;
  detail: string | null;
  seeAt: string | null;
  testID: string;
}) {
  const { t } = useTranslation();
  const handleOpen = useCallback(() => {
    if (seeAt) void openExternalUrl(seeAt);
  }, [seeAt]);
  return (
    <View style={[settingsStyles.row, styles.failure]} testID={testID}>
      <UiText variant="caption" color="statusWarning" testID={`${testID}-reason`}>
        {title}
      </UiText>
      {hint ? (
        <UiText variant="caption" color="foregroundMuted" testID={`${testID}-hint`}>
          {hint}
        </UiText>
      ) : null}
      {detail ? (
        <UiText
          variant="caption"
          color="foregroundMuted"
          selectable
          numberOfLines={3}
          testID={`${testID}-detail`}
        >
          {detail}
        </UiText>
      ) : null}
      {seeAt ? (
        <Button
          variant="outline"
          size="xs"
          onPress={handleOpen}
          accessibilityRole="link"
          accessibilityLabel={t("settings.apiEndpoints.balance.openConsoleLabel", { url: seeAt })}
          testID={`${testID}-console`}
        >
          {t("settings.apiEndpoints.balance.openConsole")}
        </Button>
      ) : null}
    </View>
  );
}

type StaleKind = "temporary" | "notAsked";

/** 读数是不是上次的：这次暂时查不到，还是开关关着这次没去读。 */
function staleOf(reading: ApiEndpointBalanceReading | undefined): StaleKind | null {
  const stale = reading?.stale;
  if (!stale) return null;
  return stale.hint === "not_asked" ? "notAsked" : "temporary";
}

/** 每种语言一整句：「刚刚读取」「5分钟前读取」；上次的读数写「暂时查不到，显示5分钟前的读数」。 */
function readAtCopy(input: { t: TFunction; ago: string | null; stale: StaleKind | null }): string {
  const { t, ago, stale } = input;
  if (stale !== null) {
    const time = ago ?? t("settings.apiEndpoints.balance.staleMomentAgo");
    return stale === "temporary"
      ? t("settings.apiEndpoints.balance.staleTemporary", { time })
      : t("settings.apiEndpoints.balance.staleNotAsked", { time });
  }
  if (ago === null) return t("settings.apiEndpoints.balance.readJustNow");
  return t("settings.apiEndpoints.balance.readAgo", { time: ago });
}

const styles = StyleSheet.create((theme) => ({
  amount: {
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.medium,
  },
  partTitle: {
    color: theme.colors.foregroundMuted,
  },
  noticeText: {
    flex: 1,
  },
  windows: {
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
  },
  failure: {
    flexDirection: "column",
    alignItems: "flex-start",
    gap: theme.spacing[1],
  },
}));
