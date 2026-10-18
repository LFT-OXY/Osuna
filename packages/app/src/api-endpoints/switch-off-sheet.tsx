import React, { useCallback, useMemo, useState } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { Text, type TextColor } from "@/components/ui/text";
import { useFetchQuery } from "@/data/query";
import { toErrorMessage } from "@/utils/error-messages";
import { describeUnparsableFile } from "./config-unparsable-copy";
import {
  selectSwitchOffPreview,
  type SwitchOffFileView,
  type SwitchOffLineView,
  type SwitchOffPreviewInput,
} from "./internal/switch-off-preview";

export type SwitchOffPreviewClient = Pick<DaemonClient, "apiEndpointPreviewSwitchOff">;

const SHEET_WIDTH = 560;

/**
 * 关「使用第三方接口」前的确认框（照 magpie 的 askDisconnect）：主机在当前文件上算出关掉后会改回、删除、新建的地方，
 * 按文件逐行列出；读取中说正在读，算不出时改用文字说明（带原因），仍可确认。确认后交给调用方关开关。
 */
export function SwitchOffSheet({
  client,
  serverId,
  provider,
  providerLabel,
  onCancel,
  onConfirm,
}: {
  client: SwitchOffPreviewClient;
  serverId: string;
  provider: string;
  providerLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  const previewQuery = useFetchQuery({
    queryKey: ["api-endpoint-switch-off-preview", serverId, provider],
    dataShape: "value",
    staleTimeMs: 0,
    retry: false,
    queryFn: () => client.apiEndpointPreviewSwitchOff(provider),
  });
  const input = useMemo<SwitchOffPreviewInput>(() => {
    const payload = previewQuery.data;
    if (previewQuery.error) {
      return { status: "failed", reason: toErrorMessage(previewQuery.error) };
    }
    if (!payload) return { status: "loading" };
    if (payload.preview) return { status: "answered", preview: payload.preview };
    const { error } = payload;
    if (!error) throw new Error("The host returned neither a preview nor an error");
    // 读不懂的配置文件用界面语言说明原因；其余照主机原文。
    if (error.code === "config_unparsable" && error.params) {
      return { status: "failed", reason: describeUnparsableFile(t, error.params) };
    }
    return { status: "failed", reason: error.message };
  }, [previewQuery.data, previewQuery.error, t]);
  const view = selectSwitchOffPreview(input);
  const keepsCodexModelProvider = view.status !== "loading" && view.keepsCodexModelProvider;

  const header = useMemo<SheetHeader>(
    () => ({
      title: t("settings.apiEndpoints.agent.switchOffPreview.title", { agent: providerLabel }),
    }),
    [providerLabel, t],
  );
  const footer = useMemo(
    () => (
      <View style={styles.actions}>
        <Button variant="secondary" size="sm" onPress={onCancel} testID="switch-off-cancel">
          {t("common.actions.cancel")}
        </Button>
        <Button variant="destructive" size="sm" onPress={onConfirm} testID="switch-off-confirm">
          {t("settings.apiEndpoints.agent.switchOffPreview.confirm")}
        </Button>
      </View>
    ),
    [onCancel, onConfirm, t],
  );

  return (
    <AdaptiveModalSheet
      header={header}
      visible
      onClose={onCancel}
      footer={footer}
      desktopMaxWidth={SHEET_WIDTH}
      testID="switch-off-sheet"
    >
      <View style={styles.body}>
        <Text variant="caption" color="foregroundMuted">
          {t("settings.apiEndpoints.agent.switchOffPreview.intro", { agent: providerLabel })}
        </Text>
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
        {keepsCodexModelProvider ? (
          <Text variant="caption" color="foregroundMuted" testID="switch-off-codex-note">
            {t("settings.apiEndpoints.agent.switchOffPreview.codexNote")}
          </Text>
        ) : null}
      </View>
    </AdaptiveModalSheet>
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
        <Text
          variant="caption"
          weight="medium"
          style={[styles.mono, styles.path]}
          numberOfLines={1}
          ellipsizeMode="head"
        >
          {file.path}
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
        <View style={styles.more}>
          <Button variant="ghost" size="sm" onPress={unfold} testID="switch-off-more-lines">
            {t("settings.apiEndpoints.agent.switchOffPreview.moreLines", {
              count: file.foldedLines.length,
            })}
          </Button>
        </View>
      ) : null}
    </View>
  );
}

/** 一行：拿掉的标 −；放回与改回的标 ↺ 与「打开前的值」，改回的另起一行写现在是什么。 */
function ChangedLine({ line }: { line: SwitchOffLineView }) {
  const { t } = useTranslation();
  const isRemoved = line.kind === "removed";
  const symbol = isRemoved ? "−" : "↺";
  const textColor: TextColor = isRemoved ? "foregroundMuted" : "foreground";
  return (
    <View style={styles.line} testID="switch-off-line">
      <Text variant="caption" color="foregroundMuted" style={styles.symbol}>
        {symbol}
      </Text>
      <View style={styles.lineBody}>
        <View style={styles.lineMain}>
          <Text
            variant="caption"
            color={textColor}
            style={[styles.mono, styles.lineText, isRemoved && styles.removedText]}
          >
            {line.text.trim()}
          </Text>
          {isRemoved ? null : (
            <Text variant="micro" color="foregroundMuted" style={styles.tag}>
              {t("settings.apiEndpoints.agent.switchOffPreview.valueBefore")}
            </Text>
          )}
        </View>
        {line.was === null ? null : (
          <Text variant="micro" color="foregroundMuted" style={styles.mono}>
            {t("settings.apiEndpoints.agent.switchOffPreview.now", { line: line.was.trim() })}
          </Text>
        )}
      </View>
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
  path: {
    flexShrink: 1,
  },
  tag: {
    flexShrink: 0,
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
  lineText: {
    flexShrink: 1,
  },
  removedText: {
    textDecorationLine: "line-through",
  },
  more: {
    alignItems: "flex-start",
  },
  actions: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
}));
