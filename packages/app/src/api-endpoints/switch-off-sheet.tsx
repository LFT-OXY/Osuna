// 确认框照 magpie（https://github.com/yetone/magpie）internal/gui/assets/app.js 的 askDisconnect 与 changesList 摆。
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import React, { useCallback, useMemo, useState } from "react";
import { View } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { ApiEndpointError } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Text, type TextColor } from "@/components/ui/text";
import { useFetchQuery } from "@/data/query";
import { toErrorMessage } from "@/utils/error-messages";
import { shortenPath } from "@/utils/shorten-path";
import { describeUnparsableFile } from "./config-unparsable-copy";
import {
  selectSwitchOffPreview,
  type SwitchOffFileView,
  type SwitchOffLineView,
  type SwitchOffPreviewInput,
} from "./internal/switch-off-preview";

export type SwitchOffClient = Pick<
  DaemonClient,
  "apiEndpointPreviewSwitchOff" | "apiEndpointSetAgentSettings" | "apiEndpointKeepCurrentSettings"
>;

const SHEET_WIDTH = 560;

/** 关掉的两种办法：按接管记录改回（确认），或文件保持现在的样子（保留当前设置）。 */
type SwitchOffWay = "restore" | "keepCurrent";

/** 主机拒绝关掉：给用户看的原因与错误码。 */
class SwitchOffRefusedError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "SwitchOffRefusedError";
  }
}

/**
 * 关「使用第三方接口」前的确认框：总开关与提示区的「切回官方」都从这里关（照 magpie 的 askDisconnect）。
 * 主机在当前文件上算出关掉后会改回、删除、新建的地方，按文件逐行列出；读取中说正在读，算不出时改用文字说明（带原因），
 * 仍可确认。确认由这里发出；主机拒绝时原因留在框里，文件读不懂时另给「保留当前设置」：关掉、文件不动。
 */
export function SwitchOffSheet({
  client,
  serverId,
  provider,
  providerLabel,
  onClose,
}: {
  // 主机没连上时为 null：预览算不出，确认也按不了。
  client: SwitchOffClient | null;
  serverId: string;
  provider: string;
  providerLabel: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const describeError = useCallback(
    (error: ApiEndpointError): string => {
      // 读不懂的配置文件用界面语言说明原因；其余照主机原文。
      if (error.code !== "config_unparsable") return error.message;
      if (!error.params) return error.message;
      return describeUnparsableFile(t, error.params);
    },
    [t],
  );
  const previewQuery = useFetchQuery({
    queryKey: ["api-endpoint-switch-off-preview", serverId, provider],
    dataShape: "value",
    staleTimeMs: 0,
    retry: false,
    enabled: client !== null,
    queryFn: () => {
      if (!client) throw new Error(t("workspace.terminal.hostDisconnected"));
      return client.apiEndpointPreviewSwitchOff(provider);
    },
  });
  const input = useMemo<SwitchOffPreviewInput>(() => {
    if (!client) return { status: "failed", reason: t("workspace.terminal.hostDisconnected") };
    if (previewQuery.error) {
      return { status: "failed", reason: toErrorMessage(previewQuery.error) };
    }
    const payload = previewQuery.data;
    if (!payload) return { status: "loading" };
    if (payload.preview) return { status: "answered", preview: payload.preview };
    if (payload.error) return { status: "failed", reason: describeError(payload.error) };
    return { status: "failed", reason: "The host returned neither a preview nor an error" };
  }, [client, describeError, previewQuery.data, previewQuery.error, t]);
  const view = selectSwitchOffPreview(input);

  const switchOff = useMutation({
    mutationFn: async (way: SwitchOffWay) => {
      if (!client) throw new Error(t("workspace.terminal.hostDisconnected"));
      const payload = await sendSwitchOff({ client, provider, way });
      if (payload.error) {
        throw new SwitchOffRefusedError(describeError(payload.error), payload.error.code);
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["api-endpoints", serverId] });
      onClose();
    },
  });
  const failure = switchOff.error;
  const refusal = failure instanceof SwitchOffRefusedError ? failure : null;
  // 文件读不懂、改不回时，另给「保留当前设置」：关掉，文件保持现在的样子。
  const offersKeepCurrent = refusal?.code === "config_unparsable";
  const isBusy = switchOff.isPending;
  const canSwitchOff = client !== null && !isBusy;
  const { mutate } = switchOff;
  const restore = useCallback(() => mutate("restore"), [mutate]);
  const keepCurrent = useCallback(() => mutate("keepCurrent"), [mutate]);
  // 有逐条可列的才说「以下是要改回的地方」。
  const showsIntro = view.status === "loading" || view.status === "listed";

  const header = useMemo<SheetHeader>(
    () => ({
      title: t("settings.apiEndpoints.agent.switchOffPreview.title", { agent: providerLabel }),
    }),
    [providerLabel, t],
  );
  const footer = useMemo(
    () => (
      <View style={styles.actions}>
        <Button
          variant="secondary"
          size="sm"
          onPress={onClose}
          disabled={isBusy}
          testID="switch-off-cancel"
        >
          {t("common.actions.cancel")}
        </Button>
        {offersKeepCurrent ? (
          <Button
            variant="outline"
            size="sm"
            onPress={keepCurrent}
            disabled={!canSwitchOff}
            testID="switch-off-keep-current"
          >
            {t("settings.apiEndpoints.agent.issues.keepCurrent")}
          </Button>
        ) : null}
        <Button
          variant="destructive"
          size="sm"
          onPress={restore}
          disabled={!canSwitchOff}
          testID="switch-off-confirm"
        >
          {t("settings.apiEndpoints.agent.switchOffPreview.confirm")}
        </Button>
      </View>
    ),
    [canSwitchOff, isBusy, keepCurrent, offersKeepCurrent, onClose, restore, t],
  );

  return (
    <AdaptiveModalSheet
      header={header}
      visible
      onClose={onClose}
      footer={footer}
      desktopMaxWidth={SHEET_WIDTH}
      testID="switch-off-sheet"
    >
      <View style={styles.body}>
        {showsIntro ? (
          <Text variant="caption" color="foregroundMuted">
            {t("settings.apiEndpoints.agent.switchOffPreview.intro", { agent: providerLabel })}
          </Text>
        ) : null}
        {view.status === "loading" ? (
          <Text variant="caption" color="foregroundMuted" testID="switch-off-loading">
            {t("settings.apiEndpoints.agent.switchOffPreview.loading")}
          </Text>
        ) : null}
        {view.status === "listed" ? (
          <View style={styles.files} testID="switch-off-changes">
            {view.files.map((file) => (
              <ChangedFile key={file.path} file={file} />
            ))}
          </View>
        ) : null}
        {view.status === "described" ? (
          <DescribedChanges providerLabel={providerLabel} reason={view.reason} />
        ) : null}
        {provider === "codex" ? (
          <Text variant="caption" color="foregroundMuted" testID="switch-off-codex-note">
            {t("settings.apiEndpoints.agent.switchOffPreview.codexNote")}
          </Text>
        ) : null}
        {failure ? (
          <SwitchOffFailure
            providerLabel={providerLabel}
            message={failure.message}
            offersKeepCurrent={offersKeepCurrent}
          />
        ) : null}
      </View>
    </AdaptiveModalSheet>
  );
}

function sendSwitchOff(input: {
  client: SwitchOffClient;
  provider: string;
  way: SwitchOffWay;
}): Promise<{ error: ApiEndpointError | null }> {
  const { client, provider } = input;
  switch (input.way) {
    case "restore":
      return client.apiEndpointSetAgentSettings({ provider, enabled: false });
    case "keepCurrent":
      return client.apiEndpointKeepCurrentSettings({ provider });
  }
}

/** 关掉没成：原因；文件读不懂时说明「保留当前设置」会怎样。 */
function SwitchOffFailure({
  providerLabel,
  message,
  offersKeepCurrent,
}: {
  providerLabel: string;
  message: string;
  offersKeepCurrent: boolean;
}) {
  const { t } = useTranslation();
  let description = message;
  if (offersKeepCurrent) {
    const keepHint = t("settings.apiEndpoints.agent.switchOffPreview.keepCurrentHint", {
      agent: providerLabel,
    });
    description = `${message}\n${keepHint}`;
  }
  return (
    <Alert
      variant="error"
      size="sm"
      title={t("settings.apiEndpoints.agent.saveFailed", { agent: providerLabel })}
      description={description}
      testID="switch-off-error"
    />
  );
}

/** 列不出逐条改动时的说明；主机算不出时后面跟原因。 */
function DescribedChanges({
  providerLabel,
  reason,
}: {
  providerLabel: string;
  reason: string | null;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.described} testID="switch-off-described">
      <Text variant="caption">
        {t("settings.apiEndpoints.agent.switchOffPreview.fallback", { agent: providerLabel })}
      </Text>
      {reason ? (
        <Text variant="caption" color="foregroundMuted" testID="switch-off-unavailable">
          {t("settings.apiEndpoints.agent.switchOffPreview.unavailable", { reason })}
        </Text>
      ) : null}
    </View>
  );
}

/** 一个文件：路径与新建 / 删除标记，下面是逐行改动，多出来的折叠成「还有 N 行」。 */
function ChangedFile({ file }: { file: SwitchOffFileView }) {
  const { t } = useTranslation();
  const [isUnfolded, setIsUnfolded] = useState(false);
  const unfold = useCallback(() => setIsUnfolded(true), []);
  const hasFoldedLines = file.foldedLines.length > 0;
  const showsMoreButton = hasFoldedLines && !isUnfolded;
  let fileTag: string | null = null;
  if (file.kind === "created") fileTag = t("settings.apiEndpoints.agent.switchOffPreview.created");
  if (file.kind === "removed") fileTag = t("settings.apiEndpoints.agent.switchOffPreview.deleted");
  return (
    <View style={styles.file} testID={`switch-off-file-${file.path}`}>
      <View style={styles.fileHeader}>
        <Text variant="caption" weight="medium" style={[styles.mono, styles.wrapAnywhere]}>
          {shortenPath(file.path)}
        </Text>
        {fileTag ? (
          <Text variant="micro" color="foregroundMuted" style={styles.tag}>
            {fileTag}
          </Text>
        ) : null}
      </View>
      {file.firstLines.map((line) => (
        <ChangedLine key={line.position} line={line} />
      ))}
      {isUnfolded
        ? file.foldedLines.map((line) => <ChangedLine key={line.position} line={line} />)
        : null}
      {showsMoreButton ? (
        <Button
          variant="ghost"
          size="xs"
          onPress={unfold}
          style={styles.more}
          testID="switch-off-more-lines"
        >
          {t("settings.apiEndpoints.agent.switchOffPreview.moreLines", {
            count: file.foldedLines.length,
          })}
        </Button>
      ) : null}
    </View>
  );
}

/**
 * 一行：拿掉的标 −；放回与改回的标 ↺ 与「打开前的值」，另起一行写现在是什么——改回的是现在那一行，
 * 放回的现在文件里没有这一项。
 */
function ChangedLine({ line }: { line: SwitchOffLineView }) {
  const { t } = useTranslation();
  const isRemoved = line.kind === "removed";
  const symbol = isRemoved ? "−" : "↺";
  const textColor: TextColor = isRemoved ? "foregroundMuted" : "foreground";
  let now: string | null = null;
  if (line.kind === "restored" && line.was !== null) {
    now = t("settings.apiEndpoints.agent.switchOffPreview.now", { line: line.was.trim() });
  }
  if (line.kind === "added") now = t("settings.apiEndpoints.agent.switchOffPreview.nowAbsent");
  return (
    <View style={styles.line} testID="switch-off-line">
      <Text variant="caption" color="foregroundMuted" style={styles.symbol}>
        {symbol}
      </Text>
      <View style={styles.lineBody}>
        <View style={styles.lineMain}>
          <ConfigLineText
            text={line.text.trim()}
            variant="caption"
            color={textColor}
            isStruck={isRemoved}
            testID="switch-off-line-text"
          />
          {isRemoved ? null : (
            <Text variant="micro" color="foregroundMuted" style={styles.tag}>
              {t("settings.apiEndpoints.agent.switchOffPreview.valueBefore")}
            </Text>
          )}
        </View>
        {now === null ? null : (
          <ConfigLineText
            text={now}
            variant="micro"
            color="foregroundMuted"
            isStruck={false}
            testID="switch-off-line-now"
          />
        )}
      </View>
    </View>
  );
}

interface ConfigLineTextProps {
  text: string;
  variant: "caption" | "micro";
  color: TextColor;
  isStruck: boolean;
  testID: string;
}

/** 值从哪里开始：JSON 的 `"键": ` 或 TOML 的 `键 = ` 之后；没有键（如 `{`、数组项）为 null。 */
function valueStart(text: string): number | null {
  const jsonKeyEnd = text.indexOf('": ');
  if (jsonKeyEnd >= 0) return jsonKeyEnd + 3;
  const tomlKeyEnd = text.indexOf(" = ");
  if (tomlKeyEnd >= 0) return tomlKeyEnd + 3;
  return null;
}

/**
 * 一行配置：在键之后分成两段，窄窗口里值整段换到下一行，不在模型名中间断开；值比整行还长时截断。
 * 键与值之间的空格留在第一段里，整行文字（textContent）与文件里一致。
 */
function ConfigLineText({ text, variant, color, isStruck, testID }: ConfigLineTextProps) {
  const separatorEnd = valueStart(text);
  const segments =
    separatorEnd === null ? [text] : [text.slice(0, separatorEnd), text.slice(separatorEnd)];
  return (
    <View style={styles.configLine} testID={testID}>
      {segments.map((segment) => (
        <Text
          key={segment}
          variant={variant}
          color={color}
          numberOfLines={1}
          style={[styles.mono, styles.configSegment, isStruck && styles.removedText]}
        >
          {segment}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  body: {
    gap: theme.spacing[3],
  },
  files: {
    gap: theme.spacing[3],
  },
  described: {
    gap: theme.spacing[2],
  },
  file: {
    gap: theme.spacing[1],
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing[2],
  },
  fileHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingBottom: theme.spacing[1],
  },
  mono: {
    fontFamily: theme.fontFamily.mono,
  },
  // 路径与配置行可能很长、没有空格：哪里都能断，不顶出框。
  wrapAnywhere: {
    flexShrink: 1,
    minWidth: 0,
    overflowWrap: "anywhere" as const,
  },
  tag: {
    flexShrink: 0,
  },
  // 第一段末尾的空格在行末会被吞掉，键与值之间的空隙由 columnGap 画出来。
  configLine: {
    flexDirection: "row",
    flexWrap: "wrap",
    columnGap: theme.spacing[1.5],
    flexShrink: 1,
    minWidth: 0,
  },
  configSegment: {
    flexShrink: 1,
    minWidth: 0,
  },
  line: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[2],
  },
  symbol: {
    width: theme.spacing[3],
    textAlign: "center",
  },
  lineBody: {
    flex: 1,
    minWidth: 0,
  },
  lineMain: {
    flexDirection: "row",
    alignItems: "baseline",
    flexWrap: "wrap",
    columnGap: theme.spacing[2],
  },
  removedText: {
    textDecorationLine: "line-through",
  },
  // 按钮文字与上面各行的文字同一起点：−/↺ 那一栏加间距，减去按钮自己的内边距与边框。
  more: {
    alignSelf: "flex-start",
    marginLeft: theme.spacing[3] + theme.spacing[2] - theme.spacing[3] - theme.borderWidth[1],
  },
  actions: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
}));
