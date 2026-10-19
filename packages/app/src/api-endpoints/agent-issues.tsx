import React, { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ChevronDown, Copy } from "lucide-react-native";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { createControlGeometry } from "@/components/ui/control-geometry";
import { mutedIconColorMapping } from "@/components/ui/icon-color";
import { Text as UiText } from "@/components/ui/text";
import { isWeb } from "@/constants/platform";
import { useToast } from "@/contexts/toast-context";
import { CODE_SURFACE_DATASET } from "@/styles/code-surface";
import { copyToClipboard } from "@/utils/copy-to-clipboard";
import { ICON_SIZE } from "@/styles/theme";
import { settingsStyles } from "@/styles/settings";
import { shortenPath } from "@/utils/shorten-path";
import { describeBypassed } from "./bypassed-copy";
import { describeUnparsableFile } from "./config-unparsable-copy";
import { describeReopenHints, reopenSignature, type ReopenHintsCopy } from "./reopen-hints-copy";
import type { AgentIssueAction, AgentIssueView, ReopenHintView } from "./internal/agent-settings";

const ThemedChevron = withUnistyles(ChevronDown);

/*
 * 提供方页「第三方接口」区的提示区：Osuna 读状态时查出的「设置被改过」，每条一块，带处理按钮（ADR 0012）。
 * 纯 props，运行时接线在 view.tsx。新情况在 internal/agent-settings.ts 认出 code，这里加文案。
 */

export interface AgentIssuesAreaProps {
  providerLabel: string;
  issues: AgentIssueView[];
  // 要重开才用上新设置的副本（PRD 第 36 条），合成一块显示在最后。
  reopen: ReopenHintView[];
  // 正在做的处理；做的时候所有按钮都不能点。
  pendingAction: AgentIssueAction | null;
  // 上次处理失败的原因，留着直到重试或关掉。
  actionError: { action: AgentIssueAction; message: string } | null;
  onAction: (action: AgentIssueAction) => void;
  onDismissError: () => void;
  // 这台主机这个提供方上次点「知道了」时那些副本的指纹；没点过为 null。
  seenReopen: string | null;
  onDismissReopen: (signature: string) => void;
}

export function AgentIssuesArea({
  providerLabel,
  issues,
  reopen,
  pendingAction,
  actionError,
  onAction,
  onDismissError,
  seenReopen,
  onDismissReopen,
}: AgentIssuesAreaProps) {
  const { t, i18n } = useTranslation();
  const reopenCopy = useMemo(
    () =>
      describeReopenHints({
        t,
        providerLabel,
        hints: reopen,
        locale: i18n.language,
        now: new Date(),
      }),
    [t, providerLabel, reopen, i18n.language],
  );
  const reopenSignatureNow = useMemo(() => reopenSignature(reopen), [reopen]);
  const dismissReopen = useCallback(
    () => onDismissReopen(reopenSignatureNow),
    [onDismissReopen, reopenSignatureNow],
  );
  const isReopenSeen = seenReopen === reopenSignatureNow;
  const shownReopen = isReopenSeen ? null : reopenCopy;
  const isEmpty = issues.length === 0 && actionError === null && shownReopen === null;
  if (isEmpty) return null;
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
      {shownReopen ? <ReopenBlock copy={shownReopen} onDismiss={dismissReopen} /> : null}
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
  const { title, description, fixSteps } = useIssueCopy(providerLabel, issue);
  const [isFixOpen, setIsFixOpen] = useState(false);
  const toggleFix = useCallback(() => setIsFixOpen((open) => !open), []);
  const steps = issue.hasFixSteps ? fixSteps : undefined;
  const hasButtons = steps !== undefined || issue.actions.length > 0;
  const isStepsShown = steps !== undefined && isFixOpen;
  return (
    <Alert
      variant="warning"
      size="sm"
      title={title}
      description={description}
      testID={`agent-api-endpoints-issue-${issue.kind}`}
    >
      {hasButtons ? (
        // 展开的步骤接在说明下面、按钮上面；「如何修复」和处理按钮同一排。
        <View style={styles.fix}>
          {isStepsShown ? <FixStepsView steps={steps} /> : null}
          <View style={styles.actions}>
            {steps !== undefined ? (
              <HowToFixButton isOpen={isFixOpen} onToggle={toggleFix} />
            ) : null}
            {issue.actions.map((action) => (
              <IssueActionButton
                key={action}
                action={action}
                pendingAction={pendingAction}
                onAction={onAction}
              />
            ))}
          </View>
        </View>
      ) : null}
    </Alert>
  );
}

/**
 * 要重开谁：设置卡片里的一行（不是 Alert：提示区同时有问题时，一个区域只放一个 Alert，design.md §11 States），
 * 每类一句；要用户执行的命令另起一行，与安装命令一样等宽、可复制。
 */
function ReopenBlock({ copy, onDismiss }: { copy: ReopenHintsCopy; onDismiss: () => void }) {
  const { t } = useTranslation();
  return (
    <View style={settingsStyles.card} testID="agent-api-endpoints-reopen">
      <View style={[settingsStyles.row, styles.reopenRow]}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>{copy.title}</Text>
          <View style={styles.reopenLines}>
            {copy.lines.map((line) => (
              <View
                key={line.text}
                style={styles.reopenLine}
                testID="agent-api-endpoints-reopen-line"
              >
                <Text style={styles.reopenText}>{line.text}</Text>
                {line.command !== null ? (
                  <CommandLine command={line.command} testID="agent-api-endpoints-reopen-command" />
                ) : null}
              </View>
            ))}
            {copy.note !== null ? (
              <Text style={styles.reopenText} testID="agent-api-endpoints-reopen-note">
                {copy.note}
              </Text>
            ) : null}
          </View>
        </View>
        <Button
          variant="outline"
          size="sm"
          onPress={onDismiss}
          testID="agent-api-endpoints-reopen-dismiss"
        >
          {t("settings.apiEndpoints.agent.reopen.gotIt")}
        </Button>
      </View>
    </View>
  );
}

/** 修复步骤：一段话，或分几步、要执行的命令单独一行。 */
function FixStepsView({ steps }: { steps: FixSteps }) {
  if (typeof steps === "string") {
    return (
      <Text style={styles.fixSteps} testID="agent-api-endpoints-issue-fix-steps">
        {steps}
      </Text>
    );
  }
  return (
    <View style={styles.fixList} testID="agent-api-endpoints-issue-fix-steps">
      {steps.map((step, index) => (
        <View key={step.text} style={styles.fixStep}>
          <Text style={styles.fixSteps}>{`${index + 1}.`}</Text>
          <View style={styles.fixStepBody}>
            <Text style={styles.fixSteps}>{step.text}</Text>
            {step.command !== null ? (
              <CommandLine command={step.command} testID="agent-api-endpoints-issue-fix-command" />
            ) : null}
          </View>
        </View>
      ))}
    </View>
  );
}

/** 一条要用户执行的命令：与同页的安装、升级命令同样的等宽字和「复制」。 */
function CommandLine({ command, testID }: { command: string; testID: string }) {
  const { t } = useTranslation();
  const toast = useToast();
  const handleCopy = useCallback(() => {
    void copyToClipboard(command)
      .then(() => toast.copied(t("settings.providers.install.copyLabel")))
      .catch(() => toast.error(t("settings.providers.install.copyFailed")));
  }, [command, t, toast]);
  return (
    <View style={styles.reopenCommandLine}>
      <UiText
        variant="caption"
        style={styles.reopenCommand}
        selectable
        dataSet={CODE_SURFACE_DATASET}
        testID={testID}
      >
        {command}
      </UiText>
      <Button
        variant="ghost"
        size="sm"
        leftIcon={Copy}
        onPress={handleCopy}
        accessibilityLabel={t("settings.providers.install.copyAccessibility", { command })}
      >
        {t("settings.providers.install.copy")}
      </Button>
    </View>
  );
}

/** 「如何修复」：点一下展开修复步骤，再点收起；箭头朝下是收着，展开后转成朝上。 */
function HowToFixButton({ isOpen, onToggle }: { isOpen: boolean; onToggle: () => void }) {
  const { t } = useTranslation();
  const accessibilityState = useMemo(() => ({ expanded: isOpen }), [isOpen]);
  // React Native Web 不会把 accessibilityState.expanded 映射成 aria-expanded。
  const webExpandedProps = useMemo(
    () => (isWeb ? ({ "aria-expanded": isOpen } as const) : null),
    [isOpen],
  );
  const chevronStyle = useMemo(() => [isOpen && styles.chevronOpen], [isOpen]);
  const chevron = useMemo(
    () => (
      <View style={chevronStyle}>
        <ThemedChevron size={ICON_SIZE.sm} uniProps={mutedIconColorMapping} />
      </View>
    ),
    [chevronStyle],
  );
  return (
    <Button
      {...webExpandedProps}
      variant="outline"
      size="sm"
      onPress={onToggle}
      accessibilityState={accessibilityState}
      trailing={chevron}
      testID="agent-api-endpoints-issue-how-to-fix"
    >
      {t("settings.apiEndpoints.agent.issues.howToFix")}
    </Button>
  );
}

const ACTION_LABEL_KEYS: Record<AgentIssueAction, string> = {
  reapply: "settings.apiEndpoints.agent.issues.reapply",
  switchToOfficial: "settings.apiEndpoints.agent.issues.switchToOfficial",
  keepCurrent: "settings.apiEndpoints.agent.issues.keepCurrent",
  keepReplacedModel: "settings.apiEndpoints.agent.issues.keepCurrent",
  keepClaudeAiLogin: "settings.apiEndpoints.agent.issues.keepClaudeAiLogin",
  stopKeepingClaudeAiLogin: "settings.apiEndpoints.agent.issues.stopKeepingClaudeAiLogin",
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
      style={styles.actionButton}
      textStyle={styles.actionText}
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

/** 修复的一步；要用户执行的命令单独给出，等宽显示、可复制。 */
interface FixStep {
  text: string;
  command: string | null;
}

/** 「如何修复」点开后的内容：一段话，或分几步。 */
type FixSteps = string | FixStep[];

interface IssueCopy {
  title: string;
  description?: string;
  fixSteps?: FixSteps;
}

/** 按 code 与参数翻译；认不出的照主机给的英文原文。文件路径、键名、解析器原文不翻译。 */
function useIssueCopy(providerLabel: string, issue: AgentIssueView): IssueCopy {
  const { t, i18n } = useTranslation();
  const { params } = issue;
  switch (issue.kind) {
    case "notThroughGateway":
      return {
        title: t("settings.apiEndpoints.agent.issues.notThroughGateway", { agent: providerLabel }),
        description: t("settings.apiEndpoints.agent.issues.notThroughGatewayDetail", {
          file: shortenPath(params.file),
          keys: params.keys,
        }),
      };
    case "configUnparsable":
      return {
        title: t("settings.apiEndpoints.agent.issues.configUnparsable", { agent: providerLabel }),
        description: describeUnparsableFile(t, params),
      };
    case "settingsHasComments":
      return {
        title: t("settings.apiEndpoints.agent.issues.settingsHasComments", {
          agent: providerLabel,
        }),
        description: t("settings.apiEndpoints.agent.issues.settingsHasCommentsDetail", {
          agent: providerLabel,
          file: shortenPath(params.file),
        }),
        fixSteps: t("settings.apiEndpoints.agent.issues.settingsHasCommentsFix", {
          agent: providerLabel,
        }),
      };
    case "cloudSwitchOn":
      return cloudSwitchCopy({ t, providerLabel, issue });
    case "managedBaseUrl":
      return {
        title: t("settings.apiEndpoints.agent.issues.managedBaseUrl", { agent: providerLabel }),
        description: t("settings.apiEndpoints.agent.issues.managedBaseUrlDetail", {
          agent: providerLabel,
          file: shortenPath(params.file),
          url: params.url,
        }),
        fixSteps: t("settings.apiEndpoints.agent.issues.managedBaseUrlFix", {
          agent: providerLabel,
        }),
      };
    case "claudeAiLoginTokenSet":
      return {
        title: t("settings.apiEndpoints.agent.issues.claudeAiLoginTokenSet", {
          agent: providerLabel,
        }),
        description: t("settings.apiEndpoints.agent.issues.claudeAiLoginTokenSetDetail", {
          agent: providerLabel,
          file: shortenPath(params.file),
        }),
      };
    case "claudeAiLoginTokenEmpty": {
      const detailKey =
        params.how === "missing"
          ? "settings.apiEndpoints.agent.issues.claudeAiLoginTokenMissingDetail"
          : "settings.apiEndpoints.agent.issues.claudeAiLoginTokenEmptyDetail";
      return {
        title: t("settings.apiEndpoints.agent.issues.claudeAiLoginTokenEmpty", {
          agent: providerLabel,
        }),
        description: t(detailKey, { agent: providerLabel, file: shortenPath(params.file) }),
      };
    }
    case "modelReplaced": {
      const isRemoved = params.model === "";
      const detailKey = isRemoved
        ? "settings.apiEndpoints.agent.issues.modelReplacedToDefaultDetail"
        : "settings.apiEndpoints.agent.issues.modelReplacedDetail";
      return {
        title: t("settings.apiEndpoints.agent.issues.modelReplaced", { agent: providerLabel }),
        description: t(detailKey, {
          agent: providerLabel,
          file: shortenPath(params.file),
          model: params.model,
          defaultModel: params.defaultModel,
        }),
      };
    }
    case "codexProfileOverride":
      return {
        title: t("settings.apiEndpoints.agent.issues.codexProfileOverride", {
          profile: params.profile,
        }),
        description: t("settings.apiEndpoints.agent.issues.codexProfileOverrideDetail", {
          file: shortenPath(params.file),
          profile: params.profile,
          keys: params.keys,
        }),
      };
    case "codexMultiAgentV2On":
      return {
        title: t("settings.apiEndpoints.agent.issues.codexMultiAgentV2On"),
        description: t("settings.apiEndpoints.agent.issues.codexMultiAgentV2OnDetail", {
          file: shortenPath(params.file),
        }),
        fixSteps: t("settings.apiEndpoints.agent.issues.codexMultiAgentV2OnFix", {
          file: shortenPath(params.file),
        }),
      };
    case "codexMultiAgentV2Unreadable":
      return {
        title: t("settings.apiEndpoints.agent.issues.codexMultiAgentV2Unreadable"),
        description: t("settings.apiEndpoints.agent.issues.codexMultiAgentV2UnreadableDetail", {
          file: shortenPath(params.file),
          detail: params.detail,
        }),
        fixSteps: t("settings.apiEndpoints.agent.issues.codexMultiAgentV2UnreadableFix", {
          file: shortenPath(params.file),
        }),
      };
    case "codexProxied":
      return codexProxiedCopy({ t, providerLabel, issue });
    case "bypassed":
      return describeBypassed({
        t,
        providerLabel,
        params,
        message: issue.message,
        locale: i18n.language,
      });
    case "unknown":
      return { title: issue.message };
  }
}

type Translate = ReturnType<typeof useTranslation>["t"];

/** 云平台开关：标题一样，说明与修复步骤按写在哪（params.source）。认不出的来源照主机原文。 */
function cloudSwitchCopy(input: {
  t: Translate;
  providerLabel: string;
  issue: AgentIssueView;
}): IssueCopy {
  const { t, providerLabel, issue } = input;
  const { params } = issue;
  const file = shortenPath(params.file);
  const values = { agent: providerLabel, cloud: params.cloud, key: params.key, file };
  const title = t("settings.apiEndpoints.agent.issues.cloudSwitchOn", values);
  switch (params.source) {
    case "managed":
      return {
        title,
        description: t("settings.apiEndpoints.agent.issues.cloudSwitchOnManagedDetail", values),
        fixSteps: t("settings.apiEndpoints.agent.issues.cloudSwitchOnManagedFix", values),
      };
    case "global_config":
      return {
        title,
        description: t(
          "settings.apiEndpoints.agent.issues.cloudSwitchOnGlobalConfigDetail",
          values,
        ),
        fixSteps: t("settings.apiEndpoints.agent.issues.cloudSwitchOnGlobalConfigFix", values),
      };
    case "shell": {
      // 修复步骤按 daemon 的系统：Windows 没有 shell 配置文件，讲系统的环境变量。
      const fixKey =
        params.platform === "win32"
          ? "settings.apiEndpoints.agent.issues.cloudSwitchOnShellFixWindows"
          : "settings.apiEndpoints.agent.issues.cloudSwitchOnShellFix";
      return {
        title,
        description: t("settings.apiEndpoints.agent.issues.cloudSwitchOnShellDetail", values),
        fixSteps: t(fixKey, values),
      };
    }
    case "settings":
      return {
        title,
        description: t("settings.apiEndpoints.agent.issues.cloudSwitchOnSettingsDetail", values),
      };
    default:
      return { title, description: issue.message };
  }
}

/** 代理写在哪：环境变量照原名，系统的代理设置翻译；认不出为 null。 */
function proxyFromLabel(input: { t: Translate; from: string | undefined }): string | null {
  switch (input.from) {
    case "HTTP_PROXY":
    case "HTTPS_PROXY":
    case "ALL_PROXY":
      return input.from;
    case "windows_settings":
      return input.t("settings.apiEndpoints.agent.issues.codexProxiedFromWindowsSettings");
    case "system_settings":
      return input.t("settings.apiEndpoints.agent.issues.codexProxiedFromSystemSettings");
    default:
      return null;
  }
}

interface ProxyFixInput {
  t: Translate;
  fix: string | undefined;
  values: Record<string, string | undefined>;
}

// 写进 shell 配置文件的那一行（magpie 的说法）；是命令，不翻译。
const NO_PROXY_EXPORT = "export NO_PROXY=127.0.0.1";

/** 「如何修复」中间那一步，按 daemon 判断的代理来源（magpie 的三种说法）；认不出为 null。 */
function proxyFixStep(input: ProxyFixInput): FixStep | null {
  const { t, values } = input;
  switch (input.fix) {
    case "environment":
      return {
        text: t("settings.apiEndpoints.agent.issues.codexProxiedFixEnvironment", values),
        command: null,
      };
    case "windows":
      return {
        text: t("settings.apiEndpoints.agent.issues.codexProxiedFixWindows", values),
        command: null,
      };
    case "other":
      return {
        text: t("settings.apiEndpoints.agent.issues.codexProxiedFixOther", values),
        command: NO_PROXY_EXPORT,
      };
    default:
      return null;
  }
}

/** 代理不转发：写明中转站、代理地址与来源；认不出的来源或修法照主机原文。 */
function codexProxiedCopy(input: {
  t: Translate;
  providerLabel: string;
  issue: AgentIssueView;
}): IssueCopy {
  const { t, providerLabel, issue } = input;
  const { params } = issue;
  const title = t("settings.apiEndpoints.agent.issues.codexProxied", { agent: providerLabel });
  const from = proxyFromLabel({ t, from: params.from });
  if (from === null) return { title, description: issue.message };
  const values = { agent: providerLabel, host: params.host, proxy: params.proxy, from };
  const fixStep = proxyFixStep({ t, fix: params.fix, values });
  if (fixStep === null) return { title, description: issue.message };
  return {
    title,
    description: t("settings.apiEndpoints.agent.issues.codexProxiedDetail", values),
    fixSteps: [
      { text: t("settings.apiEndpoints.agent.issues.codexProxiedFixDirect"), command: null },
      fixStep,
      {
        text: t("settings.apiEndpoints.agent.issues.codexProxiedFixReopen", values),
        command: null,
      },
    ],
  };
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
  // 按钮放不下时整个换到下一行，文字不在词中间断开。
  actionButton: {
    flexShrink: 0,
  },
  actionText: {
    flexShrink: 0,
  },
  fix: {
    flex: 1,
    gap: theme.spacing[3],
  },
  fixList: {
    gap: theme.spacing[2],
  },
  fixStep: {
    flexDirection: "row",
    gap: theme.spacing[2],
  },
  fixStepBody: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing[1],
  },
  // 与 Alert 的说明同字号同色。
  fixSteps: {
    ...createControlGeometry(theme).alert.sm.text,
    color: theme.colors.foregroundMuted,
  },
  // 多行说明时按钮贴着标题，不居中。
  reopenRow: {
    alignItems: "flex-start",
  },
  reopenLines: {
    marginTop: theme.spacing[1],
    gap: theme.spacing[2],
  },
  reopenLine: {
    gap: theme.spacing[1],
  },
  // 与设置行的说明同字号同色。
  reopenText: {
    ...theme.typeScale.caption,
    color: theme.colors.foregroundMuted,
  },
  reopenCommandLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[4],
  },
  // 与安装命令同样的等宽字；长了折行，不顶出框。
  reopenCommand: {
    flex: 1,
    minWidth: 0,
    paddingVertical: theme.spacing[1.5],
    fontFamily: theme.fontFamily.mono,
  },
  chevronOpen: {
    transform: [{ rotate: "180deg" }],
  },
}));
