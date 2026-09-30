import React, { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Pencil, Plus, Trash2 } from "lucide-react-native";
import type { ApiEndpoint } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { CODE_SURFACE_DATASET } from "@/styles/code-surface";
import { settingsStyles } from "@/styles/settings";

export {
  createApiEndpointFormModel,
  type ApiEndpointFormModel,
  type ApiEndpointFormSeed,
  type ApiEndpointFormState,
  type ApiEndpointSaveRequestInput,
  type ApiEndpointSaveResult,
} from "./internal/form-model";
export {
  apiEndpointErrorMessageKey,
  selectApiEndpointsState,
  type ApiEndpointsLoadState,
} from "./internal/section-state";
import type { ApiEndpointsLoadState } from "./internal/section-state";

/** 能切第三方接口的内置提供方；自定义提供方不在此列。 */
const API_ENDPOINT_PROVIDERS = new Set(["claude", "codex"]);

export function supportsApiEndpoints(provider: string): boolean {
  return API_ENDPOINT_PROVIDERS.has(provider);
}

export interface ApiEndpointsSectionProps {
  // CLI 的名称，如 "Claude Code"。
  providerLabel: string;
  state: ApiEndpointsLoadState;
  busy: boolean;
  // 上一次切换或删除失败的原因；关掉或再次操作前一直显示。
  actionError: string | null;
  onDismissError: () => void;
  onActivate: (endpoint: ApiEndpoint | null) => void;
  onAdd: () => void;
  onEdit: (endpoint: ApiEndpoint) => void;
  onDelete: (endpoint: ApiEndpoint) => void;
}

/** 「官方 / 第三方接口」模式区：官方一行加每个已保存的接口一行，单选启用。 */
export function ApiEndpointsSection({
  providerLabel,
  state,
  busy,
  actionError,
  onDismissError,
  onActivate,
  onAdd,
  onEdit,
  onDelete,
}: ApiEndpointsSectionProps) {
  const { t } = useTranslation();
  const handleUseOfficial = useCallback(() => onActivate(null), [onActivate]);

  const canAdd = !busy && state.status === "ready";
  const addButton = useMemo(
    () => (
      <Button
        variant="ghost"
        size="sm"
        leftIcon={Plus}
        onPress={onAdd}
        disabled={!canAdd}
        accessibilityLabel={t("settings.providers.apiEndpoints.addAccessibility")}
        testID="api-endpoints-add"
      >
        {t("settings.providers.apiEndpoints.add")}
      </Button>
    ),
    [canAdd, onAdd, t],
  );

  return (
    <SettingsSection
      title={t("settings.providers.apiEndpoints.title")}
      trailing={addButton}
      testID="api-endpoints-section"
    >
      <View style={settingsStyles.card}>
        {actionError ? (
          <View style={settingsStyles.row} testID="api-endpoints-action-error">
            <Text variant="caption" color="statusDanger" selectable style={styles.actionError}>
              {actionError}
            </Text>
            <Button variant="ghost" size="sm" onPress={onDismissError}>
              {t("common.actions.dismiss")}
            </Button>
          </View>
        ) : null}
        {state.status === "loading" ? (
          <View style={settingsStyles.row}>
            <Text variant="caption" color="foregroundMuted">
              {t("settings.providers.apiEndpoints.loading")}
            </Text>
          </View>
        ) : null}
        {state.status === "error" ? (
          <View style={settingsStyles.row}>
            <View style={settingsStyles.rowContent}>
              <Text variant="body">{t("settings.providers.apiEndpoints.loadFailed")}</Text>
              <Text variant="caption" color="statusDanger" selectable>
                {state.message}
              </Text>
            </View>
          </View>
        ) : null}
        {state.status === "ready" ? (
          <>
            <View
              style={[settingsStyles.row, actionError ? settingsStyles.rowBorder : null]}
              testID="api-endpoints-official"
            >
              <View style={settingsStyles.rowContent}>
                <Text variant="body">{t("settings.providers.apiEndpoints.official")}</Text>
                <Text variant="caption" color="foregroundMuted">
                  {t("settings.providers.apiEndpoints.officialHint", { name: providerLabel })}
                </Text>
              </View>
              <UseControl
                active={state.activeEndpointId === null}
                busy={busy}
                label={t("settings.providers.apiEndpoints.official")}
                onPress={handleUseOfficial}
                testID="api-endpoints-use-official"
              />
            </View>
            {state.endpoints.map((endpoint) => (
              <ApiEndpointRow
                key={endpoint.id}
                endpoint={endpoint}
                active={state.activeEndpointId === endpoint.id}
                busy={busy}
                onActivate={onActivate}
                onEdit={onEdit}
                onDelete={onDelete}
              />
            ))}
          </>
        ) : null}
      </View>
    </SettingsSection>
  );
}

function ApiEndpointRow({
  endpoint,
  active,
  busy,
  onActivate,
  onEdit,
  onDelete,
}: {
  endpoint: ApiEndpoint;
  active: boolean;
  busy: boolean;
  onActivate: (endpoint: ApiEndpoint) => void;
  onEdit: (endpoint: ApiEndpoint) => void;
  onDelete: (endpoint: ApiEndpoint) => void;
}) {
  const { t } = useTranslation();
  const handleUse = useCallback(() => onActivate(endpoint), [endpoint, onActivate]);
  const handleEdit = useCallback(() => onEdit(endpoint), [endpoint, onEdit]);
  const handleDelete = useCallback(() => onDelete(endpoint), [endpoint, onDelete]);

  return (
    <View
      style={[settingsStyles.row, settingsStyles.rowBorder]}
      testID={`api-endpoint-row-${endpoint.id}`}
    >
      <View style={settingsStyles.rowContent}>
        <Text variant="body" numberOfLines={1}>
          {endpoint.name}
        </Text>
        <View style={styles.meta}>
          <Text
            variant="caption"
            color="foregroundMuted"
            numberOfLines={1}
            style={styles.url}
            dataSet={CODE_SURFACE_DATASET}
          >
            {endpoint.baseUrl}
          </Text>
          <Text variant="caption" color="foregroundMuted" style={styles.modelCount}>
            {t("settings.providers.apiEndpoints.modelCount", { count: endpoint.models.length })}
          </Text>
        </View>
      </View>
      <View style={styles.actions}>
        <Button
          variant="ghost"
          size="sm"
          leftIcon={Pencil}
          onPress={handleEdit}
          disabled={busy}
          accessibilityLabel={t("settings.providers.apiEndpoints.editAccessibility", {
            name: endpoint.name,
          })}
          testID={`api-endpoint-edit-${endpoint.id}`}
        />
        <Button
          variant="ghost"
          size="sm"
          leftIcon={Trash2}
          onPress={handleDelete}
          disabled={busy}
          accessibilityLabel={t("settings.providers.apiEndpoints.deleteAccessibility", {
            name: endpoint.name,
          })}
          testID={`api-endpoint-delete-${endpoint.id}`}
        />
        <UseControl
          active={active}
          busy={busy}
          label={endpoint.name}
          onPress={handleUse}
          testID={`api-endpoint-use-${endpoint.id}`}
        />
      </View>
    </View>
  );
}

function UseControl({
  active,
  busy,
  label,
  onPress,
  testID,
}: {
  active: boolean;
  busy: boolean;
  label: string;
  onPress: () => void;
  testID: string;
}) {
  const { t } = useTranslation();
  if (active) {
    return (
      <Text
        variant="caption"
        color="statusSuccess"
        style={styles.inUse}
        testID={`${testID}-active`}
      >
        {t("settings.providers.apiEndpoints.inUse")}
      </Text>
    );
  }
  return (
    <Button
      variant="outline"
      size="sm"
      onPress={onPress}
      disabled={busy}
      accessibilityLabel={t("settings.providers.apiEndpoints.useAccessibility", { name: label })}
      testID={testID}
    >
      {t("settings.providers.apiEndpoints.use")}
    </Button>
  );
}

const styles = StyleSheet.create((theme) => ({
  meta: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    marginTop: theme.spacing[0.5],
  },
  url: {
    flexShrink: 1,
    fontFamily: theme.fontFamily.mono,
  },
  modelCount: {
    flexShrink: 0,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    flexShrink: 0,
  },
  actionError: {
    flex: 1,
  },
  inUse: {
    // 与「使用」按钮同宽附近，避免切换时行内控件跳动过大。
    paddingHorizontal: theme.spacing[3],
  },
}));
