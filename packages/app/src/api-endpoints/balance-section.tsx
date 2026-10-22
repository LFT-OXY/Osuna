import React, { useCallback, useMemo } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { RotateCw } from "lucide-react-native";
import {
  API_ENDPOINT_BALANCE_FAILURES,
  API_ENDPOINT_BALANCE_HINTS,
  API_ENDPOINT_BALANCE_PARTS,
  type ApiEndpointBalanceFailure,
  type ApiEndpointBalanceFailureReason,
  type ApiEndpointBalanceHint,
  type ApiEndpointBalanceItem,
  type ApiEndpointBalancePart,
  type ApiEndpointBalanceReading,
} from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { Button } from "@/components/ui/button";
import { Text as UiText } from "@/components/ui/text";
import { settingsStyles } from "@/styles/settings";
import { openExternalUrl } from "@/utils/open-external-url";
import { relativeAgo } from "./reopen-hints-copy";
import type { EndpointBalances } from "./use-endpoint-balances";

const FAILURE_KEYS: Record<ApiEndpointBalanceFailureReason, string> = {
  wrong_url: "settings.apiEndpoints.balance.failure.wrongUrl",
  token_rejected: "settings.apiEndpoints.balance.failure.tokenRejected",
  not_offered: "settings.apiEndpoints.balance.failure.notOffered",
  no_value: "settings.apiEndpoints.balance.failure.noValue",
  temporary: "settings.apiEndpoints.balance.failure.temporary",
};

const HINT_KEYS: Record<ApiEndpointBalanceHint, string> = {
  opencode_no_balance: "settings.apiEndpoints.balance.hint.opencodeNoBalance",
  siliconflow_retired: "settings.apiEndpoints.balance.hint.siliconflowRetired",
  aihubmix_no_limit: "settings.apiEndpoints.balance.hint.aihubmixNoLimit",
  not_asked: "settings.apiEndpoints.balance.hint.notAsked",
};

const PART_KEYS: Record<ApiEndpointBalancePart, string> = {
  granted: "settings.apiEndpoints.balance.part.granted",
  topped_up: "settings.apiEndpoints.balance.part.toppedUp",
};

/**
 * 接口详情页的「余额与套餐用量」区：每项余额一行，标题下写读数时间，右侧「刷新」。
 * 查不到时就地写原因，对方的原话（已打码）接在下面；认不出查法时写明。
 */
export function ApiEndpointBalanceSection({
  endpointId,
  hasApiKey,
  balances,
  now,
}: {
  endpointId: string;
  // 没填 key 的接口不查余额（照 magpie），分区说它没 key，不说认不出。
  hasApiKey: boolean;
  balances: Exclude<EndpointBalances, { status: "off" }>;
  now: Date;
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
  const caption = useMemo(
    () =>
      readAt === null ? null : (
        <UiText
          variant="caption"
          color="foregroundMuted"
          numberOfLines={1}
          testID="api-endpoint-balance-read-at"
        >
          {readAtCopy({
            t,
            ago: relativeAgo({ since: new Date(readAt), now, locale: i18n.language }),
          })}
        </UiText>
      ),
    [i18n.language, now, readAt, t],
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
        <BalanceBody balances={balances} reading={reading} hasApiKey={hasApiKey} />
      </View>
    </SettingsSection>
  );
}

function BalanceBody({
  balances,
  reading,
  hasApiKey,
}: {
  balances: Exclude<EndpointBalances, { status: "off" }>;
  reading: ApiEndpointBalanceReading | undefined;
  hasApiKey: boolean;
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
    const text = hasApiKey
      ? t("settings.apiEndpoints.balance.unsupported")
      : t("settings.apiEndpoints.balance.noKey");
    return <Notice text={text} testID="api-endpoint-balance-unsupported" />;
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
    </>
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

/** 赠送 / 充值按界面语言写；daemon 以后多出的部分写它给的 label，余额本身写「余额」。 */
function itemLabel(input: { t: TFunction; item: ApiEndpointBalanceItem }): string {
  const part = API_ENDPOINT_BALANCE_PARTS.find((candidate) => candidate === input.item.part);
  if (part) return input.t(PART_KEYS[part]);
  return input.item.label ?? input.t("settings.apiEndpoints.balance.balance");
}

function hintOf(input: { t: TFunction; failure: ApiEndpointBalanceFailure | null }): string | null {
  const hint = API_ENDPOINT_BALANCE_HINTS.find((candidate) => candidate === input.failure?.hint);
  return hint ? input.t(HINT_KEYS[hint]) : null;
}

function failureTitle(input: { t: TFunction; failure: ApiEndpointBalanceFailure | null }): string {
  const reason = input.failure?.reason;
  const known = API_ENDPOINT_BALANCE_FAILURES.find((candidate) => candidate === reason);
  const text = input.t(
    known ? FAILURE_KEYS[known] : "settings.apiEndpoints.balance.rowUnavailable",
  );
  const status = input.failure?.status ?? null;
  if (status === null) return text;
  return input.t("settings.apiEndpoints.balance.withStatus", { text, status });
}

/** 每种语言一整句：「刚刚读取」「5分钟前读取」。 */
function readAtCopy(input: { t: TFunction; ago: string | null }): string {
  if (input.ago === null) return input.t("settings.apiEndpoints.balance.readJustNow");
  return input.t("settings.apiEndpoints.balance.readAgo", { time: input.ago });
}

const styles = StyleSheet.create((theme) => ({
  amount: {
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.medium,
  },
  partTitle: {
    color: theme.colors.foregroundMuted,
  },
  failure: {
    flexDirection: "column",
    alignItems: "flex-start",
    gap: theme.spacing[1],
  },
}));
