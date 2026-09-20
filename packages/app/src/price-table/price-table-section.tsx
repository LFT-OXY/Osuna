import { RefreshCw } from "lucide-react-native";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import type { UsagePricingModel } from "@osuna/protocol/usage/types";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { Button } from "@/components/ui/button";
import { ScrollView } from "@/components/ui/scroll-view";
import { Switch } from "@/components/ui/switch";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { settingsStyles } from "@/styles/settings";
import { describeTimeAgo } from "@/usage/relative-time";
import { renderUsageText } from "@/usage/text";
import { PRICE_COLUMN_GAP, priceColumns } from "./price-columns";
import { PriceRow } from "./price-row";
import {
  EMPTY_PRICE_DRAFT,
  PRICE_COLUMNS,
  buildPriceDraft,
  dedupePricingModels,
  describePriceTableSubtitle,
  extractFailureReason,
  parsePriceDraft,
  upsertPricingOverride,
  type PriceDraft,
  type PriceField,
} from "./pricing";
import { usePriceTable, type PriceTableView } from "./use-price-table";

const PRICE_SAVE_FAILED_KEY = "settings.host.priceTable.saveFailed";
const AUTO_UPDATE_FAILED_KEY = "settings.host.priceTable.autoUpdateFailed";
const REFRESH_FAILED_KEY = "settings.host.priceTable.refreshFailed";

interface RowError {
  model: string;
  message: string;
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

  const [drafts, setDrafts] = useState<Record<string, PriceDraft>>({});
  const [savingModel, setSavingModel] = useState<string | null>(null);
  const [rowError, setRowError] = useState<RowError | null>(null);
  const [draftToken, setDraftToken] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  /** 卡片头部那两个控件（开关、立即刷新）共用的一行错误。 */
  const [controlError, setControlError] = useState<string | null>(null);

  const payload = view.kind === "ready" ? view.payload : null;
  // 开关从 daemon 配置读，和它写回去的是同一条记录：`patchConfig` 会把响应写回这条
  // query，所以开关立刻动，不依赖 daemon 在只改 autoUpdate 时也广播 pricing.updated。
  const autoUpdate = config?.usage?.pricing?.autoUpdate ?? true;
  const models = useMemo(() => dedupePricingModels(payload?.models ?? []), [payload]);

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
        setRowError({ model, message: t("settings.host.priceTable.invalidPrice") });
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
          setRowError({ model, message: describeFailure(t, PRICE_SAVE_FAILED_KEY, cause) });
          setSavingModel(null);
          return;
        }
        setSavingModel(null);
        // 主机在渲染与点击之间掉线时 patchConfig 直接 resolve undefined，什么也没写；
        // 不拦住的话这一行会静默地变回已计价态。
        if (!saved) {
          setRowError({ model, message: t(PRICE_SAVE_FAILED_KEY) });
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

  const controls = useMemo(() => {
    if (!payload) return null;
    return (
      <View style={styles.controls}>
        <Text style={styles.autoUpdateLabel}>{t("settings.host.priceTable.autoUpdate")}</Text>
        <Switch
          value={autoUpdate}
          onValueChange={handleAutoUpdateChange}
          accessibilityLabel={t("settings.host.priceTable.autoUpdate")}
          testID="price-table-auto-update-switch"
        />
        <Button
          variant="ghost"
          size="sm"
          leftIcon={RefreshCw}
          loading={isRefreshing}
          onPress={handleRefresh}
          accessibilityLabel={t("settings.host.priceTable.refresh")}
          testID="price-table-refresh"
        >
          {isRefreshing
            ? t("settings.host.priceTable.refreshing")
            : t("settings.host.priceTable.refresh")}
        </Button>
      </View>
    );
  }, [autoUpdate, handleAutoUpdateChange, handleRefresh, isRefreshing, payload, t]);

  const subtitle = payload
    ? renderUsageText(
        t,
        describePriceTableSubtitle({
          fetchedAgo: describeTimeAgo(payload.table.fetchedAt, Date.now()),
          modelCount: models.length,
        }),
      )
    : null;

  return (
    <SettingsSection
      title={t("settings.host.priceTable.title")}
      trailing={controls}
      testID="host-page-price-table-card"
    >
      <View style={settingsStyles.card}>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        {/* 常驻一行：条件挂载会在出错时把整张表下推，正好吞掉用户接下来那一次点击。 */}
        <Text style={styles.error} numberOfLines={2} testID="price-table-control-error">
          {controlError ?? ""}
        </Text>
        <PriceTableBody
          view={view}
          models={models}
          drafts={drafts}
          draftToken={draftToken}
          savingModel={savingModel}
          rowError={rowError}
          onRetry={refetch}
          onEdit={handleEdit}
          onCancel={handleCancel}
          onChangeField={handleChangeField}
          onSave={handleSave}
        />
      </View>
    </SettingsSection>
  );
}

interface PriceTableBodyProps {
  view: PriceTableView;
  /** 已按模型名去重，和副标题里的 M 个模型同源。 */
  models: readonly UsagePricingModel[];
  drafts: Record<string, PriceDraft>;
  draftToken: number;
  savingModel: string | null;
  rowError: RowError | null;
  onRetry: () => void;
  onEdit: (model: string) => void;
  onCancel: (model: string) => void;
  onChangeField: (model: string, field: PriceField, value: string) => void;
  onSave: (model: string) => void;
}

function PriceTableBody(props: PriceTableBodyProps): ReactNode {
  const { t } = useTranslation();
  const { view } = props;

  if (view.kind === "loading") {
    return <Text style={styles.message}>{t("settings.host.priceTable.loading")}</Text>;
  }
  // 重试对这两种状态没有意义：查询本身是关着的。
  if (view.kind === "unavailable") {
    return <Text style={styles.message}>{renderUsageText(t, view.message)}</Text>;
  }
  if (view.kind === "error") {
    return (
      <View style={styles.errorBlock}>
        <Text style={styles.error}>{renderUsageText(t, view.message)}</Text>
        <Button variant="ghost" size="sm" onPress={props.onRetry}>
          {t("common.actions.retry")}
        </Button>
      </View>
    );
  }
  if (props.models.length === 0) {
    return <Text style={styles.message}>{t("settings.host.priceTable.empty")}</Text>;
  }

  return (
    // 七列在手机上放不下，整张表横向滚动，而不是把列折成两行。
    <ScrollView horizontal>
      <View style={styles.table}>
        <View style={styles.headerRow}>
          <Text style={[styles.headerCell, styles.modelHeader]}>
            {t("settings.host.priceTable.columns.model")}
          </Text>
          {PRICE_COLUMNS.map((column) => (
            <Text key={column.field} style={[styles.headerCell, styles.priceHeader]}>
              {t(column.labelKey)}
            </Text>
          ))}
          <Text style={[styles.headerCell, styles.sourceHeader]}>
            {t("settings.host.priceTable.columns.source")}
          </Text>
          <Text style={[styles.headerCell, styles.actionsHeader]}>
            {t("settings.host.priceTable.columns.actions")}
          </Text>
        </View>
        {props.models.map((model) => (
          <PriceRow
            key={model.model}
            model={model}
            draft={props.drafts[model.model] ?? (model.priced ? null : EMPTY_PRICE_DRAFT)}
            draftToken={props.draftToken}
            isSaving={props.savingModel === model.model}
            error={props.rowError?.model === model.model ? props.rowError.message : null}
            onEdit={props.onEdit}
            onCancel={props.onCancel}
            onChangeField={props.onChangeField}
            onSave={props.onSave}
          />
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create((theme) => ({
  controls: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  autoUpdateLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  subtitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    paddingHorizontal: theme.spacing[4],
    paddingTop: theme.spacing[3],
  },
  message: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    padding: theme.spacing[4],
  },
  errorBlock: {
    gap: theme.spacing[2],
    alignItems: "flex-start",
    padding: theme.spacing[4],
  },
  error: {
    color: theme.colors.statusDanger,
    fontSize: theme.fontSize.sm,
    lineHeight: theme.fontSize.sm * 1.4,
    // 常驻两行：一句本地化文案加上 daemon 给的原因在设置列里常常折行，只留一行仍会下推。
    minHeight: theme.fontSize.sm * 2.8,
    paddingHorizontal: theme.spacing[4],
    paddingTop: theme.spacing[2],
  },
  table: {
    paddingHorizontal: theme.spacing[3],
    paddingBottom: theme.spacing[2],
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: PRICE_COLUMN_GAP,
    paddingVertical: theme.spacing[2],
  },
  headerCell: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  modelHeader: priceColumns.model,
  priceHeader: {
    ...priceColumns.price,
    textAlign: "right",
  },
  sourceHeader: priceColumns.source,
  actionsHeader: priceColumns.actions,
}));
