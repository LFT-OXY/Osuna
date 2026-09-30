import type { UsagePricingOverride } from "@getpaseo/protocol/usage/types";
import { useCallback, useMemo, useReducer, useState } from "react";
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
import { CustomPriceGroup } from "./custom-price-group";
import { LiteLLMPriceGroup } from "./litellm-price-group";
import { resolvePriceTableLayout } from "./price-columns";
import {
  EMPTY_PRICE_DRAFT,
  dedupePricingModels,
  extractFailureReason,
  groupPricingModels,
  parsePriceDraft,
  removePricingOverride,
  upsertPricingOverride,
  type PriceField,
} from "./pricing";
import { INITIAL_PRICE_ROWS, priceRowsReducer } from "./price-rows";
import { usePriceTable, type PriceTableView } from "./use-price-table";

const PRICE_SAVE_FAILED_KEY = "settings.host.priceTable.saveFailed";
const PRICE_REMOVE_FAILED_KEY = "settings.host.priceTable.removeFailed";
const AUTO_UPDATE_FAILED_KEY = "settings.host.priceTable.autoUpdateFailed";
const REFRESH_FAILED_KEY = "settings.host.priceTable.refreshFailed";

interface OverridesWrite {
  model: string;
  failedKey: typeof PRICE_SAVE_FAILED_KEY | typeof PRICE_REMOVE_FAILED_KEY;
  /** 由当前的覆盖表算出要整段写回的新表。 */
  next: (current: readonly UsagePricingOverride[]) => UsagePricingOverride[];
}

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

  const [rows, dispatchRows] = useReducer(priceRowsReducer, INITIAL_PRICE_ROWS);
  const [isRefreshing, setIsRefreshing] = useState(false);
  /** LiteLLM 组那两个控件（开关、立即刷新）共用的一行错误。 */
  const [controlError, setControlError] = useState<string | null>(null);
  // 折叠状态只在这一页里：离开再回来又是折叠的，最显眼的始终是要填的那一组。
  const [litellmExpanded, setLitellmExpanded] = useState(false);
  const [litellmQuery, setLitellmQuery] = useState("");
  const [contentWidth, setContentWidth] = useState<number | null>(null);
  const isCompact = useIsCompactFormFactor();
  const layout = resolvePriceTableLayout({ contentWidth, isCompact });

  const payload = view.kind === "ready" ? view.payload : null;
  // 开关从 daemon 配置读，和它写回去的是同一条记录：`patchConfig` 会把响应写回这条
  // query，所以开关立刻动，不依赖 daemon 在只改 autoUpdate 时也广播 pricing.updated。
  const autoUpdate = config?.usage?.pricing?.autoUpdate ?? true;
  const models = useMemo(() => dedupePricingModels(payload?.models ?? []), [payload]);
  const groups = useMemo(
    () => groupPricingModels(models, rows.customizing),
    [models, rows.customizing],
  );

  const priceOf = useCallback(
    (model: string) =>
      models.find((candidate) => candidate.model === model)?.pricePerMillion ?? null,
    [models],
  );

  const handleEdit = useCallback(
    (model: string) => dispatchRows({ type: "editOpened", model, price: priceOf(model) }),
    [priceOf],
  );

  /** 从 LiteLLM 行自定义：拉进自定义组，以当前 LiteLLM 价格预填。只是界面状态，什么也不写。 */
  const handleCustomize = useCallback(
    (model: string) => dispatchRows({ type: "customizeOpened", model, price: priceOf(model) }),
    [priceOf],
  );

  const handleCancel = useCallback((model: string) => {
    dispatchRows({ type: "cancelled", model });
  }, []);

  const handleChangeField = useCallback((model: string, field: PriceField, value: string) => {
    dispatchRows({ type: "fieldChanged", model, field, value });
  }, []);

  /**
   * 覆盖表整段写回：daemon 收到后广播 usage.pricing.updated，报表与这张表一起重算。
   * 保存与移除共用这一条路径，失败都落在这一行的状态行上。
   */
  const writeOverrides = useCallback(
    async ({ model, failedKey, next }: OverridesWrite): Promise<boolean> => {
      function fail(message: string): false {
        dispatchRows({ type: "writeFailed", model, message });
        return false;
      }
      // 配置还没读到时不能拿空表去算：写回去会把其他模型的覆盖项一起删掉。
      if (!config) return fail(t(failedKey));
      const overrides = next(config.usage?.pricing?.overrides ?? []);
      dispatchRows({ type: "writeStarted", model });
      let saved: Awaited<ReturnType<typeof patchConfig>>;
      try {
        saved = await patchConfig({ usage: { pricing: { overrides } } });
      } catch (cause) {
        console.error("[PriceTable] Failed to write the custom prices", cause);
        return fail(describeFailure(t, failedKey, cause));
      }
      // 主机在渲染与点击之间掉线时 patchConfig 直接 resolve undefined，什么也没写；
      // 不拦住的话这一行会静默地停在写之前的样子。
      if (!saved) return fail(t(failedKey));
      return true;
    },
    [config, patchConfig, t],
  );

  const handleSave = useCallback(
    (model: string) => {
      const pricePerMillion = parsePriceDraft(rows.drafts[model] ?? EMPTY_PRICE_DRAFT);
      if (!pricePerMillion) {
        dispatchRows({
          type: "draftRejected",
          model,
          message: t("settings.host.priceTable.invalidPrice"),
        });
        return;
      }
      void (async () => {
        const saved = await writeOverrides({
          model,
          failedKey: PRICE_SAVE_FAILED_KEY,
          next: (current) => upsertPricingOverride(current, model, pricePerMillion),
        });
        if (saved) dispatchRows({ type: "saved", model });
      })();
    },
    [rows.drafts, t, writeOverrides],
  );

  const handleRemove = useCallback(
    (model: string) => {
      void (async () => {
        const removed = await writeOverrides({
          model,
          failedKey: PRICE_REMOVE_FAILED_KEY,
          next: (current) => removePricingOverride(current, model),
        });
        if (removed) dispatchRows({ type: "removed", model });
      })();
    },
    [writeOverrides],
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
            rows={rows}
            onEdit={handleEdit}
            onCancel={handleCancel}
            onChangeField={handleChangeField}
            onSave={handleSave}
            onRemove={handleRemove}
          />
          <LiteLLMPriceGroup
            models={groups.litellm}
            table={payload.table}
            layout={layout}
            controlError={controlError}
            expanded={litellmExpanded}
            onToggleExpanded={handleToggleLitellm}
            query={litellmQuery}
            onQueryChange={setLitellmQuery}
            onCustomize={handleCustomize}
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
