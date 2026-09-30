import { useCallback, useMemo, useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { View, type LayoutChangeEvent } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { settingsStyles } from "@/styles/settings";
import { renderUsageText } from "@/usage/text";
import { CustomPriceGroup, type CustomPriceRowError } from "./custom-price-group";
import { LiteLLMPriceGroup } from "./litellm-price-group";
import { resolvePriceTableLayout } from "./price-columns";
import {
  EMPTY_PRICE_DRAFT,
  buildPriceDraft,
  dedupePricingModels,
  extractFailureReason,
  groupPricingModels,
  parsePriceDraft,
  upsertPricingOverride,
  type PriceDraft,
  type PriceField,
} from "./pricing";
import { usePriceTable, type PriceTableView } from "./use-price-table";

const PRICE_SAVE_FAILED_KEY = "settings.host.priceTable.saveFailed";
const AUTO_UPDATE_FAILED_KEY = "settings.host.priceTable.autoUpdateFailed";
const REFRESH_FAILED_KEY = "settings.host.priceTable.refreshFailed";

/** 本票还没有从 LiteLLM 行自定义的入口，这一组始终为空。 */
const NO_CUSTOMIZING: ReadonlySet<string> = new Set();

/**
 * 本地化的句子在前，daemon 给的原因在后。只给原因等于把英文异常丢给 9 种语言的
 * 用户；只给句子则把「为什么」整个吞掉，而那正是用户唯一能据以行动的东西。
 */
function describeFailure(t: TFunction, key: string, cause: unknown): string {
  const reason = extractFailureReason(cause);
  return reason ? `${t(key)} ${reason}` : t(key);
}

export function PriceTableSection({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const { view, refetch } = usePriceTable(serverId);
  const { config, patchConfig } = useDaemonConfig(serverId);

  const [drafts, setDrafts] = useState<Record<string, PriceDraft>>({});
  const [savingModel, setSavingModel] = useState<string | null>(null);
  const [rowError, setRowError] = useState<CustomPriceRowError | null>(null);
  const [draftToken, setDraftToken] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  /** LiteLLM 组那两个控件（开关、立即刷新）共用的一行错误。 */
  const [controlError, setControlError] = useState<string | null>(null);
  // 折叠状态只在这一页里：离开再回来又是折叠的，最显眼的始终是要填的那一组。
  const [litellmExpanded, setLitellmExpanded] = useState(false);
  const [contentWidth, setContentWidth] = useState<number | null>(null);
  const isCompact = useIsCompactFormFactor();
  const layout = resolvePriceTableLayout({ contentWidth, isCompact });

  const payload = view.kind === "ready" ? view.payload : null;
  // 开关从 daemon 配置读，和它写回去的是同一条记录：`patchConfig` 会把响应写回这条
  // query，所以开关立刻动，不依赖 daemon 在只改 autoUpdate 时也广播 pricing.updated。
  const autoUpdate = config?.usage?.pricing?.autoUpdate ?? true;
  const models = useMemo(() => dedupePricingModels(payload?.models ?? []), [payload]);
  const groups = useMemo(() => groupPricingModels(models, NO_CUSTOMIZING), [models]);

  const handleEdit = useCallback(
    (model: string) => {
      const row = models.find((candidate) => candidate.model === model);
      setRowError(null);
      setDrafts((current) => ({
        ...current,
        [model]: buildPriceDraft(row?.pricePerMillion ?? null),
      }));
    },
    [models],
  );

  const handleCancel = useCallback((model: string) => {
    setRowError(null);
    setDraftToken((token) => token + 1);
    setDrafts((current) => {
      const { [model]: _dropped, ...rest } = current;
      return rest;
    });
  }, []);

  const handleChangeField = useCallback((model: string, field: PriceField, value: string) => {
    setDrafts((current) => ({
      ...current,
      [model]: { ...(current[model] ?? EMPTY_PRICE_DRAFT), [field]: value },
    }));
  }, []);

  const handleSave = useCallback(
    (model: string) => {
      const pricePerMillion = parsePriceDraft(drafts[model] ?? EMPTY_PRICE_DRAFT);
      if (!pricePerMillion) {
        setRowError({ model, message: t("settings.host.priceTable.invalidPrice"), invalid: true });
        return;
      }
      setRowError(null);
      setSavingModel(model);
      // 覆盖表整段写回：daemon 收到后广播 usage.pricing.updated，报表与这张表一起重算。
      const overrides = upsertPricingOverride(
        config?.usage?.pricing?.overrides ?? [],
        model,
        pricePerMillion,
      );
      void (async () => {
        let saved: Awaited<ReturnType<typeof patchConfig>>;
        try {
          saved = await patchConfig({ usage: { pricing: { overrides } } });
        } catch (cause) {
          console.error("[PriceTable] Failed to save a custom price", cause);
          setRowError({
            model,
            message: describeFailure(t, PRICE_SAVE_FAILED_KEY, cause),
            invalid: false,
          });
          setSavingModel(null);
          return;
        }
        setSavingModel(null);
        // 主机在渲染与点击之间掉线时 patchConfig 直接 resolve undefined，什么也没写；
        // 不拦住的话这一行会静默地变回已计价态。
        if (!saved) {
          setRowError({ model, message: t(PRICE_SAVE_FAILED_KEY), invalid: false });
          return;
        }
        setDraftToken((token) => token + 1);
        setDrafts((current) => {
          const { [model]: _saved, ...rest } = current;
          return rest;
        });
      })();
    },
    [config?.usage?.pricing?.overrides, drafts, patchConfig, t],
  );

  const handleAutoUpdateChange = useCallback(
    (next: boolean) => {
      setControlError(null);
      void (async () => {
        let saved: Awaited<ReturnType<typeof patchConfig>>;
        try {
          saved = await patchConfig({ usage: { pricing: { autoUpdate: next } } });
        } catch (cause) {
          // daemon 拒绝的理由（例如这条路径被启动参数接管）是用户唯一能看懂
          // 「开关为什么弹回去了」的线索。
          console.error("[PriceTable] Failed to change price-table auto-update", cause);
          setControlError(describeFailure(t, AUTO_UPDATE_FAILED_KEY, cause));
          return;
        }
        if (!saved) setControlError(t(AUTO_UPDATE_FAILED_KEY));
      })();
    },
    [patchConfig, t],
  );

  const handleRefresh = useCallback(() => {
    if (!client) return;
    setControlError(null);
    setIsRefreshing(true);
    void (async () => {
      try {
        const result = await client.usagePricingRefresh();
        if (result.result === "failed") {
          setControlError(result.error ?? t(REFRESH_FAILED_KEY));
        }
        refetch();
      } catch (cause) {
        console.error("[PriceTable] Failed to refresh the price table", cause);
        setControlError(describeFailure(t, REFRESH_FAILED_KEY, cause));
      } finally {
        setIsRefreshing(false);
      }
    })();
  }, [client, refetch, t]);

  const handleToggleLitellm = useCallback(() => setLitellmExpanded((current) => !current), []);

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    setContentWidth(event.nativeEvent.layout.width);
  }, []);

  return (
    <View onLayout={handleLayout} testID="host-page-price-table-card">
      {payload && models.length > 0 ? (
        <>
          <CustomPriceGroup
            models={groups.custom}
            layout={layout}
            drafts={drafts}
            draftToken={draftToken}
            savingModel={savingModel}
            rowError={rowError}
            onEdit={handleEdit}
            onCancel={handleCancel}
            onChangeField={handleChangeField}
            onSave={handleSave}
          />
          <LiteLLMPriceGroup
            models={groups.litellm}
            table={payload.table}
            layout={layout}
            controlError={controlError}
            expanded={litellmExpanded}
            onToggleExpanded={handleToggleLitellm}
            autoUpdate={autoUpdate}
            isRefreshing={isRefreshing}
            onAutoUpdateChange={handleAutoUpdateChange}
            onRefresh={handleRefresh}
          />
        </>
      ) : (
        <SettingsSection title={t("settings.host.priceTable.title")}>
          <View style={settingsStyles.card}>
            <PriceTableStatus view={view} onRetry={refetch} />
          </View>
        </SettingsSection>
      )}
    </View>
  );
}

/** 两组还不能画出来时的那一张卡片：加载中、不可用、出错、没用过任何模型。 */
function PriceTableStatus({ view, onRetry }: { view: PriceTableView; onRetry: () => void }) {
  const { t } = useTranslation();

  if (view.kind === "loading") {
    return (
      <Text color="foregroundMuted" style={styles.message}>
        {t("settings.host.priceTable.loading")}
      </Text>
    );
  }
  // 重试对这两种状态没有意义：查询本身是关着的。
  if (view.kind === "unavailable") {
    return (
      <Text color="foregroundMuted" style={styles.message}>
        {renderUsageText(t, view.message)}
      </Text>
    );
  }
  if (view.kind === "error") {
    return (
      <View style={styles.errorBlock}>
        <Text color="statusDanger">{renderUsageText(t, view.message)}</Text>
        <Button variant="ghost" size="sm" onPress={onRetry}>
          {t("common.actions.retry")}
        </Button>
      </View>
    );
  }
  return (
    <Text color="foregroundMuted" style={styles.message}>
      {t("settings.host.priceTable.empty")}
    </Text>
  );
}

const styles = StyleSheet.create((theme) => ({
  message: {
    padding: theme.spacing[4],
  },
  errorBlock: {
    gap: theme.spacing[2],
    alignItems: "flex-start",
    padding: theme.spacing[4],
  },
}));
