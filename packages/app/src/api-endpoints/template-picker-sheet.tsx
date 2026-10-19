import React, { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Plus } from "lucide-react-native";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { SearchField } from "@/components/ui/search-field";
import { useIsCompactFormFactor } from "@/constants/layout";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { EndpointIcon } from "./endpoint-icon";
import { templateNote } from "./template-copy";
import { templateSections, type TemplateRow } from "./internal/templates";
import type { EndpointTemplatesState } from "./use-endpoint-templates";

const ThemedPlus = withUnistyles(Plus);
const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

export interface TemplatePickerSheetProps {
  templates: EndpointTemplatesState;
  onRetry: () => void;
  // templateId 为 null 是「自定义」。
  onPick: (templateId: string | null) => void;
  onClose: () => void;
}

/**
 * 「+」先出的模板列表（照 magpie 的添加面板）：搜索框、第一项「自定义」、厂商 / 中转服务 / 本机三组；
 * 国际站与中国站合成一行，选了进表单再切。搜不到时给空状态，可直接按「自定义」添加。
 */
export function TemplatePickerSheet({
  templates,
  onRetry,
  onPick,
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
  const handleCustom = useCallback(() => onPick(null), [onPick]);
  const header = useMemo<SheetHeader>(
    () => ({ title: t("settings.apiEndpoints.form.createTitle") }),
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
        <SearchField
          value={query}
          onChangeText={setQuery}
          placeholder={t("settings.apiEndpoints.templates.searchPlaceholder")}
          clearAccessibilityLabel={t("settings.apiEndpoints.search.clear")}
          clearsOnEscape
          testID="api-endpoint-template-search"
          clearTestID="api-endpoint-template-search-clear"
        />
        {isSearching ? null : (
          <Pressable
            style={rowStyle}
            onPress={handleCustom}
            accessibilityRole="button"
            testID="api-endpoint-template-custom"
          >
            <View style={styles.iconFrame}>
              <ThemedPlus size={ICON_SIZE.md} uniProps={foregroundMutedColorMapping} />
            </View>
            <View style={styles.rowText}>
              <Text style={styles.rowName}>{t("settings.apiEndpoints.templates.custom")}</Text>
              <Text style={styles.rowNote}>{t("settings.apiEndpoints.templates.customHint")}</Text>
            </View>
          </Pressable>
        )}
        {templates.status === "loading" ? (
          <Text style={styles.muted} testID="api-endpoint-templates-loading">
            {t("settings.apiEndpoints.templates.loading")}
          </Text>
        ) : null}
        {templates.status === "error" ? (
          <View style={styles.failed} testID="api-endpoint-templates-error">
            <Text style={styles.error}>
              {t("settings.apiEndpoints.templates.loadFailed", { message: templates.message })}
            </Text>
            <Button variant="outline" size="sm" onPress={onRetry}>
              {t("settings.apiEndpoints.templates.retry")}
            </Button>
          </View>
        ) : null}
        {sections.map((section) => (
          <View key={section.group} style={styles.section}>
            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>
                {t(`settings.apiEndpoints.templates.groups.${section.group}`)}
              </Text>
              {section.group === "local" ? null : (
                <Text style={styles.sectionHint}>
                  {t(`settings.apiEndpoints.templates.groupHints.${section.group}`)}
                </Text>
              )}
            </View>
            <View style={styles.grid}>
              {section.rows.map((row) => (
                <TemplateTile
                  key={row.template.id}
                  row={row}
                  isCompact={isCompact}
                  onPick={onPick}
                />
              ))}
            </View>
          </View>
        ))}
        {isSearching && templates.status === "ready" && sections.length === 0 ? (
          <View style={styles.noMatch} testID="api-endpoint-templates-no-match">
            <Text style={styles.noMatchText}>
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
  isCompact,
  onPick,
}: {
  row: TemplateRow;
  isCompact: boolean;
  onPick: (templateId: string | null) => void;
}) {
  const { t } = useTranslation();
  const { template } = row;
  const handlePress = useCallback(() => onPick(template.id), [onPick, template.id]);
  const name = displayNameOf(template.shortName ?? template.name);
  return (
    <Pressable
      style={isCompact ? rowStyle : tileStyle}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={template.name}
      testID={`api-endpoint-template-${template.id}`}
    >
      <View style={styles.iconFrame}>
        <EndpointIcon
          templateId={template.id}
          name={name}
          size={ICON_SIZE.md}
          initialStyle={styles.initial}
        />
      </View>
      <View style={styles.rowText}>
        <Text style={styles.rowName} numberOfLines={1}>
          {name}
        </Text>
        {template.note ? (
          <Text style={styles.rowNote} numberOfLines={1}>
            {templateNote(t, template.note)}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

// 合成一行时只写厂商名：去掉名称末尾括号里的站点（「Kimi (China)」→「Kimi」，照 magpie shortName）。
function displayNameOf(name: string): string {
  return name.replace(/\s*[(（][^()（）]*[)）]\s*$/, "") || name;
}

function rowStyle({ pressed, hovered }: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.row, hovered && styles.rowHovered, pressed && styles.rowPressed];
}

function tileStyle({ pressed, hovered }: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.row, styles.tile, hovered && styles.rowHovered, pressed && styles.rowPressed];
}

const PICKER_SNAP_POINTS = ["90%"];

const styles = StyleSheet.create((theme) => ({
  body: {
    gap: theme.spacing[4],
  },
  section: {
    gap: theme.spacing[1],
  },
  sectionHead: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
  },
  sectionTitle: {
    color: theme.colors.foreground,
    ...theme.typeScale.label,
  },
  sectionHint: {
    color: theme.colors.foregroundMuted,
    ...theme.typeScale.caption,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.radius.md,
    width: "100%",
  },
  // 宽窗口三个一行（照 magpie 的添加面板）。
  tile: {
    width: "33.333%",
  },
  rowHovered: {
    backgroundColor: theme.colors.surface2,
  },
  rowPressed: {
    backgroundColor: theme.colors.surface3,
  },
  iconFrame: {
    width: 28,
    height: 28,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surface2,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  initial: {
    color: theme.colors.foreground,
    ...theme.typeScale.label,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  rowName: {
    color: theme.colors.foreground,
    ...theme.typeScale.body,
  },
  rowNote: {
    color: theme.colors.foregroundMuted,
    ...theme.typeScale.caption,
  },
  muted: {
    color: theme.colors.foregroundMuted,
    ...theme.typeScale.body,
    paddingHorizontal: theme.spacing[2],
  },
  failed: {
    alignItems: "flex-start",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
  },
  error: {
    color: theme.colors.statusDanger,
    ...theme.typeScale.body,
  },
  noMatch: {
    alignItems: "center",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[8],
    paddingHorizontal: theme.spacing[6],
  },
  noMatchText: {
    color: theme.colors.foregroundMuted,
    textAlign: "center",
    fontSize: theme.fontSize.base,
  },
}));
