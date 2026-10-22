import React, { useCallback, useMemo } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { RotateCw } from "lucide-react-native";
import type { ApiEndpointAccessKeyVendor } from "@getpaseo/protocol/api-endpoint/balance-settings";
import type {
  ApiEndpointBalanceReading,
  ApiEndpointBalanceResets,
  ApiEndpointBalanceWindow,
} from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { Button } from "@/components/ui/button";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { Text as UiText } from "@/components/ui/text";
import { settingsStyles } from "@/styles/settings";
import { useAppSettings } from "@/hooks/use-settings";
import { useIsCompactFormFactor } from "@/constants/layout";
import { formatAmount } from "@/usage/format";
import { setUsageDisplayAs, type UsageDisplayAs } from "@/usage/preferences";
import type { UsageWindowPace } from "@/usage/types";
import { UsageWindowBar, type UsageWindowBarLayout } from "@/usage/window-bar";
import { openExternalUrl } from "@/utils/open-external-url";
import { relativeAgo } from "./reopen-hints-copy";
import {
  failureTitle,
  hintOf,
  itemLabel,
  resetsLine,
  windowLabel,
  windowUnitLabel,
} from "./balance-copy";
import { paceOf } from "./internal/balance-windows";
import type { EndpointBalances } from "./use-endpoint-balances";

/**
 * 接口详情页的「余额与套餐用量」区：每项余额一行，标题下写读数时间，右侧「刷新」。
 * 查不到时就地写原因，对方的原话（已打码）接在下面；认不出查法时写明，并给「填写余额查询地址」；火山、腾讯的套餐
 * 还没填云账号密钥时写「需要 AccessKey」，并给「填写 AccessKey」。
 */
export function ApiEndpointBalanceSection({
  endpointId,
  hasApiKey,
  balances,
  now,
  onFillBalanceUrl,
  accessKeyVendor,
  onFillAccessKey,
}: {
  endpointId: string;
  // 没填 key 的接口不查余额（照 magpie），分区说它没 key，不说认不出。
  hasApiKey: boolean;
  balances: Exclude<EndpointBalances, { status: "off" }>;
  now: Date;
  // 打开编辑窗口并定位到余额栏；老主机的编辑窗口没有这几栏时为 null。
  onFillBalanceUrl: (() => void) | null;
  // 地址是火山方舟或腾讯云 Token Plan 企业版时是哪家（说要填哪两栏）；别的为 null。
  accessKeyVendor: ApiEndpointAccessKeyVendor | null;
  // 打开编辑窗口并定位到 AccessKey 两栏；同 onFillBalanceUrl。
  onFillAccessKey: (() => void) | null;
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
          accessKeyVendor={accessKeyVendor}
          onFillAccessKey={onFillAccessKey}
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
  accessKeyVendor,
  onFillAccessKey,
}: {
  balances: Exclude<EndpointBalances, { status: "off" }>;
  reading: ApiEndpointBalanceReading | undefined;
  hasApiKey: boolean;
  onFillBalanceUrl: (() => void) | null;
  accessKeyVendor: ApiEndpointAccessKeyVendor | null;
  onFillAccessKey: (() => void) | null;
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
  if (reading.status === "needs_access_key") {
    return (
      <View style={settingsStyles.row}>
        <UiText
          variant="caption"
          color="foregroundMuted"
          style={styles.noticeText}
          testID="api-endpoint-balance-needs-access-key"
        >
          {t(
            accessKeyVendor === "tencent"
              ? "settings.apiEndpoints.balance.needsAccessKeyTencent"
              : "settings.apiEndpoints.balance.needsAccessKeyVolcengine",
          )}
        </UiText>
        {onFillAccessKey ? (
          <Button
            variant="outline"
            size="xs"
            onPress={onFillAccessKey}
            testID="api-endpoint-balance-fill-access-key"
          >
            {t("settings.apiEndpoints.balance.fillAccessKey")}
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
  const windows = reading.windows ?? [];
  if (reading.items.length === 0 && windows.length === 0) {
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
      <PlanNotes reading={reading} />
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
      {windows.length > 0 ? (
        <BalanceWindows
          windows={windows}
          afterItems={reading.items.length > 0}
          isTeam={reading.team === true}
          resets={reading.resets ?? null}
        />
      ) : null}
    </>
  );
}

/**
 * 限额与套餐窗口：套餐用量的窗口条，已用 / 剩余照套餐用量的选择（顶上可切换，各处同一个选择），百分比前写用量，
 * 重置时间后写配速。用完也不挡模型的窗口（GLM 的 MCP 月度、MiniMax 别的桶）另起一组放在后面。
 */
function BalanceWindows({
  windows,
  afterItems,
  isTeam,
  resets,
}: {
  windows: ApiEndpointBalanceWindow[];
  afterItems: boolean;
  // 智谱团队套餐的窗口：顶上写「团队套餐」，窗口后写还有几次重置。
  isTeam: boolean;
  resets: ApiEndpointBalanceResets | null;
}) {
  const { t, i18n } = useTranslation();
  const { settings, updateSettings } = useAppSettings();
  const compact = useIsCompactFormFactor();
  const displayAs = settings.usage.displayAs;
  const setDisplayAs = useCallback(
    (next: UsageDisplayAs) => {
      void updateSettings((current) => ({ usage: setUsageDisplayAs(current.usage, next) }));
    },
    [updateSettings],
  );
  const displayOptions = useMemo<SegmentedControlOption<UsageDisplayAs>[]>(
    () => [
      {
        value: "used",
        label: t("usage.planUsage.displayUsed"),
        testID: "api-endpoint-balance-display-used",
      },
      {
        value: "remaining",
        label: t("usage.planUsage.displayRemaining"),
        testID: "api-endpoint-balance-display-remaining",
      },
    ],
    [t],
  );
  const shown = useMemo(
    () =>
      windows.map((window) => {
        const pace = paceOf({ pacePct: window.pacePct, displayAs });
        const paceText = pace
          ? { ...pace, text: t("settings.apiEndpoints.balance.pace", { pace: pace.text }) }
          : undefined;
        return {
          window: { ...window, label: windowLabel({ t, window }) },
          count: windowCount({ window, displayAs, locale: i18n.language, t }),
          pace: paceText,
        };
      }),
    [displayAs, i18n.language, t, windows],
  );
  // 窄屏整组都是名字一行、数字一行，行高一致；宽屏一行，名字太长时才换行。
  const layout: UsageWindowBarLayout = compact ? "stack" : "wrap";
  const main = shown.filter(({ window }) => !window.aside);
  const aside = shown.filter(({ window }) => window.aside);
  return (
    <View
      style={[styles.windows, afterItems && settingsStyles.rowBorder]}
      testID="api-endpoint-balance-windows"
    >
      <View style={[styles.windowsHeader, isTeam && styles.windowsHeaderTeam]}>
        {isTeam ? (
          <UiText variant="caption" color="foregroundMuted" testID="api-endpoint-balance-team">
            {t("settings.apiEndpoints.balance.teamPlan")}
          </UiText>
        ) : null}
        <SegmentedControl
          options={displayOptions}
          value={displayAs}
          onValueChange={setDisplayAs}
          size="sm"
          testID="api-endpoint-balance-display-as"
        />
      </View>
      {main.map(({ window, count, pace }) => (
        <BalanceWindowBar
          key={window.id}
          window={window}
          count={count}
          pace={pace}
          layout={layout}
          displayAs={displayAs}
        />
      ))}
      {resets ? <ResetsRows resets={resets} /> : null}
      {aside.length > 0 ? (
        <View style={styles.asideGroup} testID="api-endpoint-balance-windows-aside">
          <UiText variant="caption" color="foregroundMuted">
            {t("settings.apiEndpoints.balance.asideTitle")}
          </UiText>
          {aside.map(({ window, count, pace }) => (
            <BalanceWindowBar
              key={window.id}
              window={window}
              count={count}
              pace={pace}
              layout={layout}
              displayAs={displayAs}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function BalanceWindowBar({
  window,
  count,
  pace,
  layout,
  displayAs,
}: {
  window: ApiEndpointBalanceWindow;
  count: string | undefined;
  pace: UsageWindowPace | undefined;
  layout: UsageWindowBarLayout;
  displayAs: UsageDisplayAs;
}) {
  return (
    <View testID={`api-endpoint-balance-window-${window.id}`}>
      <UsageWindowBar
        window={window}
        count={count}
        pace={pace}
        layout={layout}
        displayAs={displayAs}
        pinnable={false}
        pinned={false}
        onTogglePin={noop}
        pinLabel=""
        pinTestID=""
      />
    </View>
  );
}

function noop() {}

/** 还有几次重置，最早什么时候过期（照 magpie 的重置卡，只显示：重置要到厂商自己的页面上用）。 */
function ResetsRows({ resets }: { resets: ApiEndpointBalanceResets }) {
  const { t, i18n } = useTranslation();
  const soonest = resets.until
    ? new Date(resets.until).toLocaleString(i18n.language, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;
  return (
    <View style={styles.resets} testID="api-endpoint-balance-resets">
      <UiText weight="medium" selectable testID="api-endpoint-balance-resets-count">
        {resetsLine({ t, resets })}
      </UiText>
      <UiText variant="caption" color="foregroundMuted">
        {soonest
          ? `${t("settings.apiEndpoints.balance.resets.soonest", { when: soonest })} · ${t("settings.apiEndpoints.balance.resets.info")}`
          : t("settings.apiEndpoints.balance.resets.info")}
      </UiText>
    </View>
  );
}

/**
 * 「$15.00 / $20.00」「1 / 5 个视频」：已用（或剩余）与上限，照 magpie quotaCount——美元每个数写成货币，
 * 别的单位只写在最后；没有上限时不写。
 */
function windowCount(input: {
  window: ApiEndpointBalanceWindow;
  displayAs: UsageDisplayAs;
  locale: string;
  t: TFunction;
}): string | undefined {
  const { window, displayAs, locale, t } = input;
  const limit = window.limit ?? null;
  if (limit === null || limit <= 0) return undefined;
  const used = Math.max(0, window.used ?? 0);
  const shown = displayAs === "remaining" ? Math.max(0, limit - used) : used;
  const unit = window.unit ?? null;
  if (unit === "USD") {
    const format = (value: number) => formatAmount(value, "usd", locale);
    return `${format(shown)} / ${format(limit)}`;
  }
  const format = (value: number) => formatAmount(value, "credits", locale);
  const count = `${format(shown)} / ${format(limit)}`;
  return unit ? `${count} ${windowUnitLabel({ t, unit })}` : count;
}

/**
 * 套餐自己说的（照 magpie 写在套餐名旁）：火山 Agent Plan 的档位、腾讯停用的套餐与原因（提醒色），几个团队时读不到额度的团队。
 */
function PlanNotes({ reading }: { reading: ApiEndpointBalanceReading }) {
  const { t } = useTranslation();
  const stopped = reading.stoppedPlans ?? [];
  const unread = reading.unreadTeams ?? [];
  if (reading.planTier === undefined && stopped.length === 0 && unread.length === 0) return null;
  return (
    <View style={styles.planNotes} testID="api-endpoint-balance-plan-notes">
      {reading.planTier === undefined ? null : (
        <UiText variant="caption" color="foregroundMuted" testID="api-endpoint-balance-plan-tier">
          {t("settings.apiEndpoints.balance.planTier", { tier: reading.planTier })}
        </UiText>
      )}
      {stopped.map((plan) => {
        const status = plan.reason ? `${plan.status}, ${plan.reason}` : plan.status;
        return (
          <UiText
            key={plan.team ?? ""}
            variant="caption"
            color="statusWarning"
            testID="api-endpoint-balance-plan-stopped"
          >
            {plan.team === null
              ? t("settings.apiEndpoints.balance.planStopped", { status })
              : t("settings.apiEndpoints.balance.teamPlanStopped", { team: plan.team, status })}
          </UiText>
        );
      })}
      {unread.length === 0 ? null : (
        <UiText
          variant="caption"
          color="foregroundMuted"
          testID="api-endpoint-balance-unread-teams"
        >
          {t("settings.apiEndpoints.balance.unreadTeams", {
            teams: unread.join(t("settings.apiEndpoints.listSeparator")),
          })}
        </UiText>
      )}
    </View>
  );
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
  windowsHeader: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingVertical: theme.spacing[1],
  },
  windowsHeaderTeam: {
    justifyContent: "space-between",
    alignItems: "center",
  },
  resets: {
    gap: theme.spacing[1],
    marginTop: theme.spacing[2],
  },
  asideGroup: {
    marginTop: theme.spacing[2],
    paddingTop: theme.spacing[2],
    borderTopWidth: 1,
    borderTopColor: theme.colors.borderCardRow,
  },
  planNotes: {
    gap: theme.spacing[1],
    paddingTop: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
  },
  failure: {
    flexDirection: "column",
    alignItems: "flex-start",
    gap: theme.spacing[1],
  },
}));
