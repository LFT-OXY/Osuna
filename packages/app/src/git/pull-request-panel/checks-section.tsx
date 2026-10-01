import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, Text, View, type GestureResponderEvent } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ChevronDown, ChevronRight, MessageSquarePlus } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import { openExternalUrl } from "@/utils/open-external-url";
import { ICON_SIZE } from "@/styles/theme";
import { classifyCheck, type CheckPresentation } from "@/git/check-presentation";
import { CheckPresentationIcon } from "@/git/check-presentation.view";
import { ChecksRing } from "./checks-ring";
import {
  formatChecksCount,
  formatChecksGroupLabel,
  formatChecksHeadline,
  summarizeChecks,
  type ChecksGroup,
} from "./checks-summary";
import { canAddPullRequestCheckLogsToChat } from "./context-attachment";
import type { PrPaneCheck } from "./data";
import { foregroundMutedColorMapping, sectionKitStyles } from "./section-kit";
import { useCheckGroupState } from "./check-group-state";

const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedChevronRight = withUnistyles(ChevronRight);

/**
 * Roughly eight rows. A repo with thirty checks would otherwise push the activity
 * timeline off the pane entirely, so past this height the list scrolls in place.
 */
const LIST_MAX_HEIGHT = 268;

/**
 * Identifies a check across refreshes. The forge's run id is stable where a forge exposes
 * one; the name/url pair is the fallback for forges that don't.
 */
export function getCheckIdentity(check: PrPaneCheck): string {
  if (check.detailRef?.checkRunId !== undefined) {
    return `${check.provider}:check-run:${check.detailRef.checkRunId}`;
  }
  if (check.detailRef?.workflowRunId !== undefined) {
    return `${check.provider}:workflow-run:${check.detailRef.workflowRunId}`;
  }
  return `${check.provider}:${check.name}:${check.url}`;
}

interface ChecksSectionProps {
  checks: readonly PrPaneCheck[];
  open: boolean;
  onToggle: () => void;
  attachEnabled: boolean;
  loadingCheckKeys: ReadonlySet<string>;
  onAddLogsToChat: (check: PrPaneCheck) => void;
}

/**
 * The CI surface of the PR pane: one line saying how the run went, and the checks behind
 * it grouped by status so a failure never needs scrolling to find.
 */
export function ChecksSection({
  checks,
  open,
  onToggle,
  attachEnabled,
  loadingCheckKeys,
  onAddLogsToChat,
}: ChecksSectionProps) {
  const { t } = useTranslation();
  const summary = useMemo(() => summarizeChecks(checks), [checks]);
  const headline = formatChecksHeadline(t, summary.outcome);
  const detail = formatChecksCount(t, summary.parts, summary.total);
  const { collapsedGroups, toggle: handleToggleGroup } = useCheckGroupState();

  return (
    <View testID="pr-pane-checks">
      <Pressable
        onPress={onToggle}
        style={headerPressableStyle}
        accessibilityRole="button"
        accessibilityLabel={
          detail ? t("workspace.git.pr.checks.accessibilityLabel", { headline, detail }) : headline
        }
      >
        <ChecksRing summary={summary} size={ICON_SIZE.lg} />
        <View style={styles.headerText}>
          <Text style={styles.headline} numberOfLines={1}>
            {headline}
          </Text>
          {detail ? (
            <Text style={styles.detail} numberOfLines={1} testID="pr-pane-check-summary">
              {detail}
            </Text>
          ) : null}
        </View>
        {open ? (
          <ThemedChevronDown size={ICON_SIZE.sm} uniProps={foregroundMutedColorMapping} />
        ) : (
          <ThemedChevronRight size={ICON_SIZE.sm} uniProps={foregroundMutedColorMapping} />
        )}
      </Pressable>

      {open && summary.groups.length > 0 ? (
        <ScrollView
          style={styles.list}
          contentContainerStyle={styles.listContent}
          nestedScrollEnabled
        >
          {summary.groups.map((group) => (
            <CheckGroup
              key={group.status}
              group={group}
              collapsed={collapsedGroups.has(group.status)}
              onToggle={handleToggleGroup}
              attachEnabled={attachEnabled}
              loadingCheckKeys={loadingCheckKeys}
              onAddLogsToChat={onAddLogsToChat}
            />
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

function CheckGroup({
  group,
  collapsed,
  onToggle,
  attachEnabled,
  loadingCheckKeys,
  onAddLogsToChat,
}: {
  group: ChecksGroup;
  collapsed: boolean;
  onToggle: (status: CheckPresentation) => void;
  attachEnabled: boolean;
  loadingCheckKeys: ReadonlySet<string>;
  onAddLogsToChat: (check: PrPaneCheck) => void;
}) {
  const { t } = useTranslation();
  const handlePress = useCallback(() => onToggle(group.status), [group.status, onToggle]);
  return (
    <View testID={`pr-pane-check-group-${group.status}`}>
      <Pressable onPress={handlePress} style={styles.groupHeader} accessibilityRole="button">
        <Text style={styles.groupLabel}>{formatChecksGroupLabel(t, group)}</Text>
        {collapsed ? (
          <ThemedChevronRight size={ICON_SIZE.xs} uniProps={foregroundMutedColorMapping} />
        ) : (
          <ThemedChevronDown size={ICON_SIZE.xs} uniProps={foregroundMutedColorMapping} />
        )}
      </Pressable>
      {collapsed
        ? null
        : group.checks.map((check) => {
            const checkKey = getCheckIdentity(check);
            return (
              <CheckRow
                key={checkKey}
                check={check}
                attachEnabled={attachEnabled}
                isAddingLogsToChat={loadingCheckKeys.has(checkKey)}
                onAddLogsToChat={onAddLogsToChat}
              />
            );
          })}
    </View>
  );
}

function CheckRow({
  check,
  attachEnabled,
  isAddingLogsToChat,
  onAddLogsToChat,
}: {
  check: PrPaneCheck;
  attachEnabled: boolean;
  isAddingLogsToChat: boolean;
  onAddLogsToChat: (check: PrPaneCheck) => void;
}) {
  const { t } = useTranslation();
  const handlePress = useCallback(() => {
    void openExternalUrl(check.url);
  }, [check.url]);
  const handleAddLogsToChat = useCallback(
    (event: GestureResponderEvent) => {
      event.stopPropagation();
      onAddLogsToChat(check);
    },
    [check, onAddLogsToChat],
  );
  return (
    <Pressable onPress={handlePress} style={rowPressableStyle} testID="pr-pane-check-row">
      <CheckPresentationIcon presentation={classifyCheck(check)} size={14} />
      <Text style={sectionKitStyles.checkName} numberOfLines={1}>
        {check.name}
      </Text>
      {check.workflow && (
        <Text style={sectionKitStyles.checkWorkflow} numberOfLines={1}>
          {check.workflow}
        </Text>
      )}
      <View style={sectionKitStyles.checkTrailing}>
        {attachEnabled && canAddPullRequestCheckLogsToChat(check) ? (
          <Button
            variant="ghost"
            size="xs"
            leftIcon={MessageSquarePlus}
            loading={isAddingLogsToChat}
            onPress={handleAddLogsToChat}
            style={styles.addButton}
          >
            {isAddingLogsToChat
              ? t("workspace.git.pr.actions.addingToChat")
              : t("workspace.git.pr.actions.addToChat")}
          </Button>
        ) : null}
        {check.timing && <Text style={sectionKitStyles.checkDuration}>{check.timing}</Text>}
      </View>
    </Pressable>
  );
}

function headerPressableStyle({ hovered }: { hovered?: boolean }) {
  return [styles.header, Boolean(hovered) && styles.hoverable];
}

function rowPressableStyle({ hovered }: { hovered?: boolean }) {
  return [sectionKitStyles.checkRow, Boolean(hovered) && styles.hoverable];
}

const styles = StyleSheet.create((theme) => ({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[3],
  },
  headerText: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing[0.5],
  },
  headline: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
  },
  detail: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  list: {
    maxHeight: LIST_MAX_HEIGHT,
  },
  listContent: {
    paddingBottom: theme.spacing[2],
  },
  groupHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[1],
  },
  groupLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foregroundMuted,
  },
  hoverable: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  addButton: {
    paddingHorizontal: theme.spacing[1],
  },
}));
