import React, { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Pressable,
  type NativeSyntheticEvent,
  type PressableStateCallbackType,
  type TextInputKeyPressEventData,
  View,
} from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Plus, Search, Trash2 } from "lucide-react-native";
import { compareMatchScores, scoreTextFields } from "@getpaseo/protocol/search/text-match";
import type { AgentModelDefinition } from "@getpaseo/protocol/agent-types";
import type { ProviderProfileModel } from "@getpaseo/protocol/provider-config";
import { AdaptiveTextInput } from "@/components/adaptive-text-input";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { Button } from "@/components/ui/button";
import { FormTextInput } from "@/components/ui/form-field";
import { mutedIconColorMapping } from "@/components/ui/icon-color";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { Text as UiText } from "@/components/ui/text";
import { CODE_SURFACE_DATASET } from "@/styles/code-surface";
import { settingsStyles } from "@/styles/settings";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { useTimeAgoLabel } from "./time-ago";

/*
 * 详情里的 Models 节：搜索行 → 就地添加行 →「已发现」组 →「自定义 Models」组，同在一张卡片里。
 * 搜索词和添加行都是这一节自己的状态，调用方按提供方加 key，换提供方时一起清掉。
 */

export interface ProviderModelsSectionProps {
  providerEnabled: boolean;
  providerLoading: boolean;
  // 出错时原文和「刷新」在顶部错误卡里，这里只说明为什么没有模型。
  providerFailed: boolean;
  fetchedAt: string | undefined;
  discoveredModels: AgentModelDefinition[];
  additionalModels: ProviderProfileModel[];
  deletingModelId: string | null;
  onDeleteCustomModel: (modelId: string) => void;
  // 写入配置；reject 时原位显示原因，resolve 后添加行收起。
  onAddCustomModel: (modelId: string) => Promise<void>;
}

const ThemedSearch = withUnistyles(Search);
const ThemedTrash2 = withUnistyles(Trash2);
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const destructiveIconColorMapping = (theme: Theme) => ({ color: theme.colors.destructive });
// FormTextInput 会压平 style 拆成外框与文字，Unistyles 样式在 Web 上压平后没有值，所以用普通对象。
const ADD_MODEL_INPUT_STYLE = { flex: 1 };

function rankModels<T>(items: T[], query: string, fields: (item: T) => string[]): T[] {
  if (!query) return items;
  const scored = items
    .map((item) => ({ item, score: scoreTextFields(query, fields(item)) }))
    .filter(
      (entry): entry is { item: T; score: NonNullable<typeof entry.score> } => entry.score !== null,
    );
  scored.sort((a, b) => compareMatchScores(a.score, b.score));
  return scored.map((entry) => entry.item);
}

function ModelRow({
  label,
  id,
  description,
  bordered,
  children,
}: {
  label: string;
  id: string;
  description?: string;
  bordered: boolean;
  // 行末的操作，比如自定义模型的删除按钮。
  children?: React.ReactNode;
}) {
  return (
    <View style={[styles.modelRow, bordered ? settingsStyles.rowBorder : null]}>
      <UiText style={styles.noShrink} numberOfLines={1}>
        {label}
      </UiText>
      {label === id ? null : (
        <UiText
          variant="caption"
          color="foregroundMuted"
          style={styles.monoHint}
          numberOfLines={1}
          selectable
          dataSet={CODE_SURFACE_DATASET}
        >
          {id}
        </UiText>
      )}
      {description ? (
        <UiText
          variant="caption"
          color="foregroundMuted"
          style={styles.descriptionInline}
          numberOfLines={1}
        >
          {description}
        </UiText>
      ) : (
        <View style={styles.modelRowFiller} />
      )}
      {children}
    </View>
  );
}

function DeleteCustomModelButton({
  modelId,
  deleting,
  onDelete,
}: {
  modelId: string;
  deleting: boolean;
  onDelete: (modelId: string) => void;
}) {
  const { t } = useTranslation();
  const handleDelete = useCallback(() => onDelete(modelId), [modelId, onDelete]);
  const deleteButtonStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.iconButton,
      (Boolean(hovered) || pressed) && styles.iconButtonHovered,
      deleting ? styles.disabled : null,
    ],
    [deleting],
  );
  return (
    <Pressable
      onPress={handleDelete}
      disabled={deleting}
      hitSlop={8}
      style={deleteButtonStyle}
      accessibilityRole="button"
      accessibilityLabel={t("settings.providers.models.removeModel", { id: modelId })}
    >
      <ThemedTrash2 size={ICON_SIZE.sm} uniProps={destructiveIconColorMapping} />
    </Pressable>
  );
}

function GroupHeader({
  title,
  count,
  bordered,
}: {
  title: string;
  count: number;
  bordered: boolean;
}) {
  return (
    <View style={[styles.groupHeader, bordered ? settingsStyles.rowBorder : null]}>
      <UiText variant="caption" color="foregroundMuted" weight="medium">
        {title}
      </UiText>
      <UiText variant="caption" color="foregroundMuted" weight="medium">
        {count}
      </UiText>
    </View>
  );
}

type AddModelStatus = { kind: "idle" } | { kind: "adding" } | { kind: "failed"; reason: string };

function AddModelRow({
  additionalModels,
  bordered,
  onAdd,
  onClose,
}: {
  additionalModels: ProviderProfileModel[];
  bordered: boolean;
  onAdd: (modelId: string) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<AddModelStatus>({ kind: "idle" });
  const trimmed = draft.trim();
  const isAdding = status.kind === "adding";
  const canAdd =
    !isAdding && trimmed.length > 0 && !additionalModels.some((model) => model.id === trimmed);

  const handleAdd = useCallback(() => {
    if (!canAdd) return;
    setStatus({ kind: "adding" });
    onAdd(trimmed).then(onClose, (error: unknown) => {
      setStatus({ kind: "failed", reason: error instanceof Error ? error.message : "" });
    });
  }, [canAdd, onAdd, onClose, trimmed]);

  const handleKeyPress = useCallback(
    (event: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
      if (event.nativeEvent.key === "Escape" && !isAdding) onClose();
    },
    [isAdding, onClose],
  );

  return (
    <View style={[styles.addRow, bordered ? settingsStyles.rowBorder : null]}>
      <View style={styles.addRowControls}>
        <FormTextInput
          size="sm"
          autoFocus
          initialValue=""
          onChangeText={setDraft}
          onSubmitEditing={handleAdd}
          onKeyPress={handleKeyPress}
          editable={!isAdding}
          placeholder={t("settings.providers.models.modelIdPlaceholder")}
          accessibilityLabel={t("settings.providers.models.addModel")}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          style={ADD_MODEL_INPUT_STYLE}
          testID="provider-add-model-input"
        />
        <Button
          variant="default"
          size="sm"
          onPress={handleAdd}
          disabled={!canAdd}
          testID="provider-add-model-submit"
        >
          {isAdding ? t("settings.providers.models.adding") : t("settings.providers.models.add")}
        </Button>
        <Button variant="ghost" size="sm" onPress={onClose} disabled={isAdding}>
          {t("common.actions.cancel")}
        </Button>
      </View>
      {status.kind === "failed" ? (
        <View style={styles.addError} testID="provider-add-model-error">
          <UiText variant="caption" color="statusDanger">
            {t("settings.providers.models.failedToSave")}
          </UiText>
          {status.reason ? (
            <UiText variant="caption" color="statusDanger" selectable>
              {status.reason}
            </UiText>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function EmptyState({ loading, children }: { loading?: boolean; children: string }) {
  return (
    <View style={styles.emptyState}>
      {loading ? <ThemedLoadingSpinner size="small" uniProps={mutedIconColorMapping} /> : null}
      <UiText color="foregroundMuted" style={styles.emptyText}>
        {children}
      </UiText>
    </View>
  );
}

export function ProviderModelsSection({
  providerEnabled,
  providerLoading,
  providerFailed,
  fetchedAt,
  discoveredModels,
  additionalModels,
  deletingModelId,
  onDeleteCustomModel,
  onAddCustomModel,
}: ProviderModelsSectionProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [isAddOpen, setIsAddOpen] = useState(false);
  const updatedLabel = useTimeAgoLabel(fetchedAt);
  const openAddRow = useCallback(() => setIsAddOpen(true), []);
  const closeAddRow = useCallback(() => setIsAddOpen(false), []);

  const totalCount = discoveredModels.length + additionalModels.length;
  const searchQuery = totalCount > 0 ? query.trim() : "";
  const filteredDiscovered = useMemo(
    () => rankModels(discoveredModels, searchQuery, (m) => [m.label, m.id, m.description ?? ""]),
    [discoveredModels, searchQuery],
  );
  const filteredCustom = useMemo(
    () => rankModels(additionalModels, searchQuery, (m) => [m.label, m.id]),
    [additionalModels, searchQuery],
  );

  const trailing = useMemo(
    () => (
      <View style={styles.trailing}>
        {updatedLabel ? (
          <UiText variant="caption" color="foregroundMuted" numberOfLines={1}>
            {t("settings.providers.models.updated", { time: updatedLabel })}
          </UiText>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          leftIcon={Plus}
          onPress={openAddRow}
          testID="provider-add-model"
        >
          {t("settings.providers.models.addModel")}
        </Button>
      </View>
    ),
    [openAddRow, t, updatedLabel],
  );

  let emptyMessage: { text: string; loading?: boolean } | null = null;
  if (totalCount === 0) {
    if (!providerEnabled) {
      emptyMessage = { text: t("settings.providers.models.disabledHint") };
    } else if (providerLoading) {
      emptyMessage = { text: t("settings.providers.models.loading"), loading: true };
    } else if (providerFailed) {
      emptyMessage = { text: t("settings.providers.models.startFailed") };
    } else {
      emptyMessage = { text: t("settings.providers.models.noneDetected") };
    }
  }

  const hasSearchRow = totalCount > 0;
  const hasDiscovered = filteredDiscovered.length > 0;
  const hasCustom = filteredCustom.length > 0;

  let body: React.ReactNode = null;
  if (emptyMessage) {
    // 添加行展开时卡片里只放添加行。
    body = isAddOpen ? null : (
      <EmptyState loading={emptyMessage.loading}>{emptyMessage.text}</EmptyState>
    );
  } else if (!hasDiscovered && !hasCustom) {
    body = (
      <View style={settingsStyles.rowBorder}>
        <EmptyState>{t("settings.providers.models.noSearchMatches")}</EmptyState>
      </View>
    );
  } else {
    body = (
      <>
        {hasDiscovered ? (
          <View testID="provider-models-discovered">
            <GroupHeader
              title={t("settings.providers.models.discovered")}
              count={filteredDiscovered.length}
              bordered
            />
            {filteredDiscovered.map((model, index) => (
              <ModelRow
                key={model.id}
                label={model.label}
                id={model.id}
                description={model.description}
                bordered={index > 0}
              />
            ))}
          </View>
        ) : null}
        {hasCustom ? (
          <View testID="provider-models-custom">
            <GroupHeader
              title={t("settings.providers.models.custom")}
              count={filteredCustom.length}
              bordered
            />
            {filteredCustom.map((model, index) => (
              <ModelRow key={model.id} label={model.label} id={model.id} bordered={index > 0}>
                <DeleteCustomModelButton
                  modelId={model.id}
                  deleting={deletingModelId === model.id}
                  onDelete={onDeleteCustomModel}
                />
              </ModelRow>
            ))}
          </View>
        ) : null}
      </>
    );
  }

  return (
    <SettingsSection
      title={t("settings.providers.models.title")}
      count={totalCount > 0 ? totalCount : undefined}
      trailing={trailing}
      testID="provider-models-section"
    >
      <View style={settingsStyles.card}>
        {hasSearchRow ? (
          <View style={styles.searchRow}>
            <ThemedSearch size={ICON_SIZE.md} uniProps={mutedIconColorMapping} />
            <AdaptiveTextInput
              style={styles.searchInput}
              onChangeText={setQuery}
              placeholder={t("settings.providers.models.searchPlaceholder")}
              accessibilityLabel={t("settings.providers.models.searchPlaceholder")}
              autoCapitalize="none"
              autoCorrect={false}
              testID="provider-models-search"
            />
          </View>
        ) : null}
        {isAddOpen ? (
          <AddModelRow
            additionalModels={additionalModels}
            bordered={hasSearchRow}
            onAdd={onAddCustomModel}
            onClose={closeAddRow}
          />
        ) : null}
        {body}
      </View>
    </SettingsSection>
  );
}

const styles = StyleSheet.create((theme) => ({
  trailing: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flexShrink: 1,
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minHeight: 40,
    paddingHorizontal: theme.spacing[4],
  },
  // 卡片里的无边框输入：焦点只靠光标，不画外框。
  searchInput: {
    flex: 1,
    minWidth: 0,
    paddingVertical: theme.spacing[2],
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    outlineColor: "transparent",
    outlineWidth: 0,
  },
  addRow: {
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
    gap: theme.spacing[1.5],
  },
  addRowControls: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  addError: {
    gap: theme.spacing[0.5],
  },
  groupHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[1.5],
    paddingHorizontal: theme.spacing[4],
  },
  emptyText: {
    textAlign: "center",
  },
  noShrink: {
    flexShrink: 0,
  },
  monoHint: {
    fontFamily: theme.fontFamily.mono,
    flexShrink: 0,
  },
  descriptionInline: {
    flex: 1,
  },
  iconButton: {
    width: 28,
    height: 28,
    marginVertical: -6,
    marginRight: -6,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  iconButtonHovered: {
    backgroundColor: theme.colors.surface2,
  },
  disabled: {
    opacity: 0.5,
  },
  modelRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 34,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
    gap: theme.spacing[3],
  },
  modelRowFiller: {
    flex: 1,
  },
  emptyState: {
    paddingVertical: theme.spacing[8],
    paddingHorizontal: theme.spacing[4],
    alignItems: "center",
    gap: theme.spacing[3],
  },
}));
