import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { UsageExchangeRate } from "@getpaseo/protocol/usage/rpc-schemas";
import { useFetchQuery } from "@/data/query";
import { useAppSettings } from "@/hooks/use-settings";
import { extractFailureReason } from "@/price-table/pricing";
import { useHostFeatureMap } from "@/runtime/host-features";
import {
  useHostRuntimeClient,
  useHostRuntimeConnectionStatuses,
  useHosts,
} from "@/runtime/host-runtime";
import { setUsageChineseUnits, setUsageCurrency, type UsageCurrency } from "@/usage/preferences";
import { USD_MONEY, type UsageMoney, type UsageTokenUnits } from "./format";

/** The daemon caches the rate a day; asking it again within the hour costs nothing new. */
const EXCHANGE_RATE_STALE_MS = 60 * 60 * 1000;

export type UsageExchangeRateState =
  | { status: "off" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; rate: UsageExchangeRate };

export interface UsageCurrencyChoice {
  currency: UsageCurrency;
  /** False while no connected host can answer the rate: the choice is not offered. */
  isAvailable: boolean;
  setCurrency: (currency: UsageCurrency) => void;
}

export interface UsageChineseUnitsChoice {
  /** Only a Chinese UI offers the switch. */
  isAvailable: boolean;
  isOn: boolean;
  setOn: (on: boolean) => void;
}

/**
 * The host that answers the rate: the first saved host that is online and keeps a
 * gateway ledger. Every surface asks the same one, so they all show the same rate.
 */
function useExchangeRateServerId(): string | null {
  const hosts = useHosts();
  const serverIds = useMemo(() => hosts.map((host) => host.serverId), [hosts]);
  // COMPAT(gatewayLedger): added in v0.17.0, remove gate after 2027-04-23. 老主机没有 usage.exchange_rate.get。
  const supported = useHostFeatureMap(serverIds, "gatewayLedger");
  const connection = useHostRuntimeConnectionStatuses(serverIds);
  return (
    serverIds.find(
      (serverId) => supported.get(serverId) === true && connection.get(serverId) === "online",
    ) ?? null
  );
}

function exchangeRateQueryKey(serverId: string | null) {
  return ["usage-exchange-rate", serverId] as const;
}

/** The rate, asked for only while CNY is chosen; "off" otherwise or when no host can answer. */
export function useUsageExchangeRate(): UsageExchangeRateState {
  const { t } = useTranslation();
  const { settings } = useAppSettings();
  const serverId = useExchangeRateServerId();
  const client = useHostRuntimeClient(serverId ?? "");
  const isWanted = settings.usage.currency === "cny" && serverId !== null;
  const query = useFetchQuery({
    queryKey: exchangeRateQueryKey(serverId),
    dataShape: "value",
    staleTimeMs: EXCHANGE_RATE_STALE_MS,
    enabled: isWanted && Boolean(client),
    retry: false,
    queryFn: async () => {
      if (!client) throw new Error(t("workspace.terminal.hostDisconnected"));
      const { requestId: _requestId, ...rate } = await client.usageExchangeRateGet();
      return rate;
    },
  });
  if (!isWanted) return { status: "off" };
  if (query.data) return { status: "ready", rate: query.data };
  if (query.error) {
    return { status: "error", message: extractFailureReason(query.error) || query.error.message };
  }
  return { status: "loading" };
}

/** What estimated costs are shown in: USD until a CNY rate has arrived. */
export function useUsageMoney(): UsageMoney {
  const rate = useUsageExchangeRate();
  const cnyPerUsd = rate.status === "ready" ? rate.rate.cnyPerUsd : null;
  return useMemo(
    () => (cnyPerUsd === null ? USD_MONEY : { currency: "cny", cnyPerUsd }),
    [cnyPerUsd],
  );
}

/** 万 / 亿 only while the UI is Chinese and the switch is on. */
export function useUsageTokenUnits(): UsageTokenUnits {
  const { i18n } = useTranslation();
  const { settings } = useAppSettings();
  return isChineseLanguage(i18n.language) && settings.usage.chineseUnits ? "wanYi" : "kmb";
}

export function useUsageCurrencyChoice(): UsageCurrencyChoice {
  const { settings, updateSettings } = useAppSettings();
  const serverId = useExchangeRateServerId();
  const setCurrency = useCallback(
    (currency: UsageCurrency) => {
      void updateSettings((current) => ({ usage: setUsageCurrency(current.usage, currency) }));
    },
    [updateSettings],
  );
  return { currency: settings.usage.currency, isAvailable: serverId !== null, setCurrency };
}

export function useUsageChineseUnitsChoice(): UsageChineseUnitsChoice {
  const { i18n } = useTranslation();
  const { settings, updateSettings } = useAppSettings();
  const setOn = useCallback(
    (on: boolean) => {
      void updateSettings((current) => ({ usage: setUsageChineseUnits(current.usage, on) }));
    },
    [updateSettings],
  );
  return {
    isAvailable: isChineseLanguage(i18n.language),
    isOn: settings.usage.chineseUnits,
    setOn,
  };
}

function isChineseLanguage(language: string): boolean {
  return language === "zh" || language.startsWith("zh-");
}
