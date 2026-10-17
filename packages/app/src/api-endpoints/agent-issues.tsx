import React, { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { settingsStyles } from "@/styles/settings";
import type { AgentIssueAction, AgentIssueView } from "./internal/agent-settings";

/*
 * 提供方页「第三方接口」区的提示区：Osuna 读状态时查出的「设置被改过」，每条一块，带处理按钮（ADR 0012）。
 * 纯 props，运行时接线在 view.tsx。新情况在 internal/agent-settings.ts 认出 code，这里加文案。
 */

export interface AgentIssuesAreaProps {
  providerLabel: string;
  issues: AgentIssueView[];
  // 正在做的处理；做的时候所有按钮都不能点。
  pendingAction: AgentIssueAction | null;
  // 上次处理失败的原因，留着直到重试或关掉。
  actionError: { action: AgentIssueAction; message: string } | null;
  onAction: (action: AgentIssueAction) => void;
  onDismissError: () => void;
}

export function AgentIssuesArea({
  providerLabel,
  issues,
  pendingAction,
  actionError,
  onAction,
  onDismissError,
}: AgentIssuesAreaProps) {
  if (issues.length === 0 && actionError === null) return null;
  return (
    <View style={styles.area} testID="agent-api-endpoints-issues">
      {issues.map((issue) => (
        <IssueBlock
          // 每个 Agent 同一种情况至多一条；认不出的按原文区分。
          key={issue.kind === "unknown" ? issue.message : issue.kind}
          providerLabel={providerLabel}
          issue={issue}
          pendingAction={pendingAction}
          onAction={onAction}
        />
      ))}
      {actionError ? (
        <ActionErrorBlock
          providerLabel={providerLabel}
          error={actionError}
          onDismiss={onDismissError}
        />
      ) : null}
    </View>
  );
}

/** 主机没声明 apiEndpointCliWiring：不显示提示区，请用户更新主机。 */
export function AgentIssuesUpdateHost({ providerLabel }: { providerLabel: string }) {
  const { t } = useTranslation();
  return (
    <Text style={settingsStyles.rowHint} testID="agent-api-endpoints-issues-update-host">
      {t("settings.apiEndpoints.agent.issues.updateHost", { agent: providerLabel })}
    </Text>
  );
}

function IssueBlock({
  providerLabel,
  issue,
  pendingAction,
  onAction,
}: {
  providerLabel: string;
  issue: AgentIssueView;
  pendingAction: AgentIssueAction | null;
  onAction: (action: AgentIssueAction) => void;
}) {
  const { title, description } = useIssueCopy(providerLabel, issue);
  return (
    <Alert
      variant="warning"
      size="sm"
      title={title}
      description={description}
      testID={`agent-api-endpoints-issue-${issue.kind}`}
    >
      {issue.actions.length > 0 ? (
        <View style={styles.actions}>
          {issue.actions.map((action) => (
            <IssueActionButton
              key={action}
              action={action}
              pendingAction={pendingAction}
              onAction={onAction}
            />
          ))}
        </View>
      ) : null}
    </Alert>
  );
}

const ACTION_LABEL_KEYS: Record<AgentIssueAction, string> = {
  reapply: "settings.apiEndpoints.agent.issues.reapply",
  switchToOfficial: "settings.apiEndpoints.agent.issues.switchToOfficial",
  keepCurrent: "settings.apiEndpoints.agent.issues.keepCurrent",
};

function IssueActionButton({
  action,
  pendingAction,
  onAction,
}: {
  action: AgentIssueAction;
  pendingAction: AgentIssueAction | null;
  onAction: (action: AgentIssueAction) => void;
}) {
  const { t } = useTranslation();
  const handlePress = useCallback(() => onAction(action), [action, onAction]);
  return (
    <Button
      variant="outline"
      size="sm"
      onPress={handlePress}
      disabled={pendingAction !== null}
      loading={pendingAction === action}
      testID={`agent-api-endpoints-issue-${action}`}
    >
      {t(ACTION_LABEL_KEYS[action])}
    </Button>
  );
}

function ActionErrorBlock({
  providerLabel,
  error,
  onDismiss,
}: {
  providerLabel: string;
  error: { action: AgentIssueAction; message: string };
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Alert
      variant="error"
      size="sm"
      title={t("settings.apiEndpoints.agent.issues.actionFailed", {
        action: t(ACTION_LABEL_KEYS[error.action]),
        agent: providerLabel,
      })}
      description={error.message}
      testID="agent-api-endpoints-issue-error"
    >
      <Button variant="outline" size="sm" onPress={onDismiss}>
        {t("common.actions.dismiss")}
      </Button>
    </Alert>
  );
}

/** 按 code 与参数翻译；认不出的照主机给的英文原文。文件路径、键名、解析器原文不翻译。 */
function useIssueCopy(
  providerLabel: string,
  issue: AgentIssueView,
): { title: string; description?: string } {
  const { t } = useTranslation();
  const { params } = issue;
  switch (issue.kind) {
    case "notThroughGateway":
      return {
        title: t("settings.apiEndpoints.agent.issues.notThroughGateway", { agent: providerLabel }),
        description: t("settings.apiEndpoints.agent.issues.notThroughGatewayDetail", {
          file: params.file,
          keys: params.keys,
        }),
      };
    case "configUnparsable":
      return {
        title: t("settings.apiEndpoints.agent.issues.configUnparsable", { agent: providerLabel }),
        description: t("settings.apiEndpoints.agent.issues.configUnparsableDetail", {
          file: params.file,
          detail: params.detail,
        }),
      };
    case "codexProfileOverride":
      return {
        title: t("settings.apiEndpoints.agent.issues.codexProfileOverride", {
          profile: params.profile,
        }),
        description: t("settings.apiEndpoints.agent.issues.codexProfileOverrideDetail", {
          file: params.file,
          profile: params.profile,
          keys: params.keys,
        }),
      };
    case "unknown":
      return { title: issue.message };
  }
}

const styles = StyleSheet.create((theme) => ({
  area: {
    gap: theme.spacing[2],
    marginBottom: theme.spacing[3],
  },
  actions: {
    flex: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
}));
