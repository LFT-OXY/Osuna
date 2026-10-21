import React, { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Plus } from "lucide-react-native";
import type { ApiEndpoint } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { Row } from "@/components/ui/row";
import { Text } from "@/components/ui/text";
import { useIsCompactFormFactor } from "@/constants/layout";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { EndpointIcon } from "./endpoint-icon";
import { templateNote } from "./template-copy";
import {
  isTemplateRowAdded,
  templatePick,
  templateSections,
  type TemplatePick,
  type TemplateRow,
} from "./internal/templates";
import type { EndpointTemplatesState } from "./use-endpoint-templates";

const ThemedPlus = withUnistyles(Plus);
const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

export interface TemplatePickerSheetProps {
  templates: EndpointTemplatesState;
  // 主机上已有的接口：从模板加过的那一行打绿点，点它打开已有那家（照 magpie）。
  endpoints: readonly ApiEndpoint[];
  onRetry: () => void;
  // templateId 为 null 是「自定义」。
  onAdd: (templateId: string | null) => void;
  onOpenEndpoint: (endpointId: string) => void;
  onClose: () => void;
}

/**
 * 「+」先出的模板列表（照 magpie 的添加面板）：搜索框、第一项「自定义」、厂商 / 中转服务 / 本机三组；
 * 国际站与中国站合成一行，点它加还没加的那一边，两边都加过就打开已有那家。搜不到时给空状态，可直接按「自定义」添加。
 */
export function TemplatePickerSheet({
  templates,
  endpoints,
  onRetry,
  onAdd,
  onOpenEndpoint,
  onClose,
}: TemplatePickerSheetProps) {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const [query, setQuery] = useState("");
  const noteText = useCallback((note: string) => templateNote(t, note), [t]);
  const sections = useMemo(
    () =>
      templates.status === "ready"
        ? templateSections({ templates: templates.templates, query, noteText })
        : [],
    [noteText, query, templates],
  );
  const isSearching = query.trim() !== "";
  const handleCustom = useCallback(() => onAdd(null), [onAdd]);
  const handlePick = useCallback(
    (pick: TemplatePick) => {
      if (pick.kind === "open") onOpenEndpoint(pick.endpointId);
      else onAdd(pick.templateId);
    },
    [onAdd, onOpenEndpoint],
  );
  const header = useMemo<SheetHeader>(
    () => ({
      title: t("settings.apiEndpoints.form.createTitle"),
      search: {
        onChange: setQuery,
        placeholder: t("settings.apiEndpoints.templates.searchPlaceholder"),
        testID: "api-endpoint-template-search",
      },
    }),
    [t],
  );
  const renderCustomLeading = useCallback(
    () => (
      <View style={styles.iconFrame}>
        <ThemedPlus size={ICON_SIZE.md} uniProps={foregroundMutedColorMapping} />
      </View>
    ),
    [],
  );
  const renderCustomMeta = useCallback(
    () => (
      <Text variant="caption" color="foregroundMuted" numberOfLines={1}>
        {t("settings.apiEndpoints.templates.customHint")}
      </Text>
    ),
    [t],
  );

  return (
    <AdaptiveModalSheet
      header={header}
      visible
      onClose={onClose}
      desktopMaxWidth={640}
      snapPoints={PICKER_SNAP_POINTS}
      testID="api-endpoint-template-picker"
    >
      <View style={styles.body}>
        {isSearching ? null : (
          <Row
            title={t("settings.apiEndpoints.templates.custom")}
            onPress={handleCustom}
            testID="api-endpoint-template-custom"
            renderLeading={renderCustomLeading}
            renderMeta={renderCustomMeta}
          />
        )}
        {templates.status === "loading" ? (
          <Text
            color="foregroundMuted"
            style={styles.inset}
            testID="api-endpoint-templates-loading"
          >
            {t("settings.apiEndpoints.templates.loading")}
          </Text>
        ) : null}
        {templates.status === "error" ? (
          <View style={[styles.failed, styles.inset]} testID="api-endpoint-templates-error">
            <Text color="statusDanger">
              {t("settings.apiEndpoints.templates.loadFailed", { message: templates.message })}
            </Text>
            <Button variant="outline" size="sm" onPress={onRetry}>
              {t("settings.apiEndpoints.templates.retry")}
            </Button>
          </View>
        ) : null}
        {sections.map((section) => (
          <View key={section.group} style={styles.section}>
            <View style={[styles.sectionHead, styles.inset]}>
              <Text variant="label" weight="medium">
                {t(`settings.apiEndpoints.templates.groups.${section.group}`)}
              </Text>
              {section.group === "local" ? null : (
                <Text variant="caption" color="foregroundMuted">
                  {t(`settings.apiEndpoints.templates.groupHints.${section.group}`)}
                </Text>
              )}
            </View>
            <View style={styles.grid}>
              {section.rows.map((row) => (
                <View key={row.template.id} style={isCompact ? styles.cellFull : styles.cellThird}>
                  <TemplateTile row={row} endpoints={endpoints} onPick={handlePick} />
                </View>
              ))}
            </View>
          </View>
        ))}
        {isSearching && templates.status === "ready" && sections.length === 0 ? (
          <View style={styles.noMatch} testID="api-endpoint-templates-no-match">
            <Text color="foregroundMuted" style={styles.centered}>
              {t("settings.apiEndpoints.templates.noMatch", { query: query.trim() })}
            </Text>
            <Button
              variant="outline"
              size="sm"
              onPress={handleCustom}
              testID="api-endpoint-templates-add-custom"
            >
              {t("settings.apiEndpoints.templates.addAsCustom")}
            </Button>
          </View>
        ) : null}
      </View>
    </AdaptiveModalSheet>
  );
}

function TemplateTile({
  row,
  endpoints,
  onPick,
}: {
  row: TemplateRow;
  endpoints: readonly ApiEndpoint[];
  onPick: (pick: TemplatePick) => void;
}) {
  const { t } = useTranslation();
  const { template } = row;
  const isAdded = isTemplateRowAdded(row, endpoints);
  const handlePress = useCallback(
    () => onPick(templatePick(row, endpoints)),
    [endpoints, onPick, row],
  );
  const name = displayNameOf(template.shortName ?? template.name);
  const renderLeading = useCallback(
    () => (
      <View style={styles.iconFrame}>
        <EndpointIcon
          icon={null}
          templateId={template.id}
          name={name}
          size={ICON_SIZE.md}
          initialVariant="label"
        />
      </View>
    ),
    [name, template.id],
  );
  const renderTrailing = useCallback(
    () =>
      isAdded ? (
        <View
          style={styles.addedDot}
          accessibilityLabel={t("settings.apiEndpoints.templates.added")}
          testID={`api-endpoint-template-${template.id}-added`}
        />
      ) : null,
    [isAdded, t, template.id],
  );
  const note = template.note ?? null;
  const renderMeta = useCallback(
    () =>
      note === null ? null : (
        <Text variant="caption" color="foregroundMuted" numberOfLines={1}>
          {templateNote(t, note)}
        </Text>
      ),
    [note, t],
  );
  return (
    <Row
      title={name}
      onPress={handlePress}
      accessibilityLabel={
        isAdded ? `${template.name}, ${t("settings.apiEndpoints.templates.added")}` : template.name
      }
      testID={`api-endpoint-template-${template.id}`}
      renderLeading={renderLeading}
      renderTrailing={renderTrailing}
      {...(note === null ? {} : { renderMeta })}
    />
  );
}

// 合成一行时只写厂商名：去掉名称末尾括号里的站点（「Kimi (China)」→「Kimi」，照 magpie shortName）。
function displayNameOf(name: string): string {
  return name.replace(/\s*[(（][^()（）]*[)）]\s*$/, "") || name;
}

const PICKER_SNAP_POINTS = ["90%"];

const styles = StyleSheet.create((theme) => ({
  body: {
    gap: theme.spacing[4],
  },
  // 与 Row 的文字对齐。
  inset: {
    paddingHorizontal: theme.spacing[2],
  },
  section: {
    gap: theme.spacing[1],
  },
  sectionHead: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: theme.spacing[2],
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  cellFull: {
    width: "100%",
  },
  // 宽窗口三个一行（照 magpie 的添加面板）；格子之间留空，绿点不会看成是右边那格的。
  cellThird: {
    width: "33.333%",
    paddingRight: theme.spacing[4],
  },
  // 品牌图标底块：浅色、深色下都看得出（添加窗口顶上的图标同一档）。
  iconFrame: {
    width: 28,
    height: 28,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surface3,
    alignItems: "center",
    justifyContent: "center",
  },
  addedDot: {
    width: 6,
    height: 6,
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.statusSuccess,
  },
  failed: {
    alignItems: "flex-start",
    gap: theme.spacing[2],
  },
  noMatch: {
    alignItems: "center",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[8],
    paddingHorizontal: theme.spacing[6],
  },
  centered: {
    textAlign: "center",
  },
}));
