// 导入链接的确认框照 magpie（https://github.com/yetone/magpie，internal/gui/assets/app.js 的 renderImport，7597c132）。
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。
import React, { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { ApiEndpointImportLinkPreview } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { Text } from "@/components/ui/text";
import { settingsStyles } from "@/styles/settings";
import { ICON_SIZE } from "@/styles/theme";
import { openExternalUrl } from "@/utils/open-external-url";
import { EndpointIcon } from "./endpoint-icon";
import type {
  ImportLinkAddInput,
  ImportLinkAddResult,
  ImportLinkPreviewState,
} from "./use-import-link";

/*
 * 导入链接的确认框（ADR 0013）：链接从不自己保存什么。先说对话与这把 key 会发往哪些主机、只在信任发链接的网站时添加，
 * 名称与 key 可当场改，会替换已有的那家时另外提示；点了添加才加。纯 props，读链接与添加在 use-import-link.ts。
 */

/** 确认框里显示什么：读链接的各个阶段，或加不了（没有主机、主机没连上、主机太旧）。 */
export type ImportLinkView =
  | { kind: "preview"; preview: ImportLinkPreviewState }
  | { kind: "noHost" }
  | { kind: "offline" }
  | { kind: "updateHost" };

export interface ImportLinkSheetProps {
  view: ImportLinkView;
  // 加到的那台主机的名字；没有主机为 null。
  hostLabel: string | null;
  onRetry: () => void;
  onAdd: (input: ImportLinkAddInput) => Promise<ImportLinkAddResult>;
  onAdded: (endpointId: string) => void;
  onClose: () => void;
}

const SNAP_POINTS = ["90%"];

export function ImportLinkSheet({
  view,
  hostLabel,
  onRetry,
  onAdd,
  onAdded,
  onClose,
}: ImportLinkSheetProps) {
  if (view.kind === "preview" && view.preview.status === "ready") {
    return (
      <ImportLinkConfirm
        preview={view.preview.preview}
        hostLabel={hostLabel}
        onAdd={onAdd}
        onAdded={onAdded}
        onClose={onClose}
      />
    );
  }
  return <ImportLinkNotice view={view} hostLabel={hostLabel} onRetry={onRetry} onClose={onClose} />;
}

/** 还在读、读不到、拒收、加不了：一句话加「关闭」（读不到时还有「重试」）。 */
function ImportLinkNotice({
  view,
  hostLabel,
  onRetry,
  onClose,
}: {
  view: ImportLinkView;
  hostLabel: string | null;
  onRetry: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const header = useMemo<SheetHeader>(
    () => ({ title: t("settings.apiEndpoints.importLink.title") }),
    [t],
  );
  const host = hostLabel ?? "";
  const isFailedRead = view.kind === "preview" && view.preview.status === "error";
  const footer = useMemo(
    () => (
      <View style={styles.actions}>
        {isFailedRead ? (
          <Button
            variant="outline"
            size="sm"
            onPress={onRetry}
            testID="api-endpoint-import-link-retry"
          >
            {t("settings.apiEndpoints.importLink.retry")}
          </Button>
        ) : null}
        <Button
          variant="secondary"
          size="sm"
          onPress={onClose}
          testID="api-endpoint-import-link-close"
        >
          {t("settings.apiEndpoints.importLink.close")}
        </Button>
      </View>
    ),
    [isFailedRead, onClose, onRetry, t],
  );
  let body: React.ReactNode = null;
  if (view.kind === "noHost") {
    body = <Alert variant="warning" description={t("settings.apiEndpoints.importLink.noHost")} />;
  } else if (view.kind === "offline") {
    const text = t("settings.apiEndpoints.importLink.offline", { host });
    body = <Alert variant="warning" description={text} />;
  } else if (view.kind === "updateHost") {
    const text = t("settings.apiEndpoints.importLink.updateHost", { host });
    body = (
      <Alert variant="warning" description={text} testID="api-endpoint-import-link-update-host" />
    );
  } else if (view.preview.status === "loading") {
    body = (
      <Text color="foregroundMuted" testID="api-endpoint-import-link-loading">
        {t("settings.apiEndpoints.importLink.reading")}
      </Text>
    );
  } else if (view.preview.status === "error") {
    const text = t("settings.apiEndpoints.importLink.readFailed", {
      message: view.preview.message,
    });
    body = (
      <Alert variant="error" description={text} testID="api-endpoint-import-link-read-error" />
    );
  } else if (view.preview.status === "refused") {
    const text = t("settings.apiEndpoints.importLink.refused", { reason: view.preview.reason });
    body = <Alert variant="error" description={text} testID="api-endpoint-import-link-refused" />;
  }
  return (
    <AdaptiveModalSheet
      header={header}
      visible
      onClose={onClose}
      desktopMaxWidth={520}
      snapPoints={SNAP_POINTS}
      footer={footer}
      testID="api-endpoint-import-link-sheet"
    >
      {body}
    </AdaptiveModalSheet>
  );
}

function ImportLinkConfirm({
  preview,
  hostLabel,
  onAdd,
  onAdded,
  onClose,
}: {
  preview: ApiEndpointImportLinkPreview;
  hostLabel: string | null;
  onAdd: (input: ImportLinkAddInput) => Promise<ImportLinkAddResult>;
  onAdded: (endpointId: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(preview.name);
  const [key, setKey] = useState(preview.key ?? "");
  const [isKeyVisible, setIsKeyVisible] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const isReplacing = preview.replaces !== null;
  const hasNoName = name.trim() === "";
  const keyFromLink = preview.key !== null;
  const showsKeysPage = !keyFromLink && preview.keysUrl !== null;

  const handleAdd = useCallback(async () => {
    if (hasNoName) {
      setFailure(t("settings.apiEndpoints.importLink.nameRequired"));
      return;
    }
    setIsAdding(true);
    setFailure(null);
    const result = await onAdd({ name: name.trim(), key: key.trim() });
    setIsAdding(false);
    if (result.status === "failed") {
      setFailure(result.message);
      return;
    }
    onAdded(result.endpointId);
  }, [hasNoName, key, name, onAdd, onAdded, t]);
  const toggleKey = useCallback(() => setIsKeyVisible((visible) => !visible), []);
  const openKeysPage = useCallback(() => {
    if (preview.keysUrl !== null) void openExternalUrl(preview.keysUrl);
  }, [preview.keysUrl]);

  const header = useMemo<SheetHeader>(() => {
    // 加到哪台主机：窗口当前所在的那台。
    let subtitleText = t("settings.apiEndpoints.importLink.subtitle");
    if (hostLabel) {
      subtitleText = t("settings.apiEndpoints.importLink.subtitleHost", { host: hostLabel });
    }
    const subtitle = (
      <Text variant="caption" color="foregroundMuted" testID="api-endpoint-import-link-host">
        {subtitleText}
      </Text>
    );
    const leading = (
      <View style={settingsStyles.rowIconFrame}>
        <EndpointIcon
          icon={null}
          templateId={preview.templateId}
          name={preview.name}
          size={ICON_SIZE.md}
          initialVariant="label"
        />
      </View>
    );
    return { title: preview.name, subtitle, leading };
  }, [hostLabel, preview.name, preview.templateId, t]);

  const submitKey = isReplacing
    ? "settings.apiEndpoints.importLink.replace"
    : "settings.apiEndpoints.importLink.add";
  const submitLabel = t(submitKey);
  const footer = useMemo(
    () => (
      <View style={styles.footer}>
        {failure ? (
          <Text
            variant="caption"
            color="statusDanger"
            selectable
            testID="api-endpoint-import-link-error"
          >
            {failure}
          </Text>
        ) : null}
        <View style={styles.actions}>
          <Button
            variant="secondary"
            size="sm"
            onPress={onClose}
            disabled={isAdding}
            testID="api-endpoint-import-link-cancel"
          >
            {t("common.actions.cancel")}
          </Button>
          <Button
            variant="default"
            size="sm"
            onPress={handleAdd}
            loading={isAdding}
            testID="api-endpoint-import-link-add"
          >
            {submitLabel}
          </Button>
        </View>
      </View>
    ),
    [failure, handleAdd, isAdding, onClose, submitLabel, t],
  );

  const hosts = preview.hosts.join(t("settings.apiEndpoints.listSeparator"));
  let keyHint: string | undefined;
  let keyPlaceholder: string | undefined;
  if (keyFromLink) keyHint = t("settings.apiEndpoints.importLink.keyFromLink");
  else keyPlaceholder = t("settings.apiEndpoints.importLink.keyPlaceholder");
  const keyToggleKey = isKeyVisible
    ? "settings.apiEndpoints.form.hideKey"
    : "settings.apiEndpoints.form.showKey";
  const keyToggleLabel = t(keyToggleKey);
  let replacesText: string | null = null;
  if (preview.replaces !== null) {
    replacesText = t("settings.apiEndpoints.importLink.replaces", { name: preview.replaces.name });
  }

  return (
    <AdaptiveModalSheet
      header={header}
      visible
      onClose={onClose}
      desktopMaxWidth={520}
      snapPoints={SNAP_POINTS}
      footer={footer}
      testID="api-endpoint-import-link-sheet"
    >
      <View style={styles.body}>
        <Alert
          variant="warning"
          description={t("settings.apiEndpoints.importLink.risk", { hosts })}
          testID="api-endpoint-import-link-risk"
        />
        <Field label={t("settings.apiEndpoints.form.name")}>
          <FormTextInput
            initialValue={preview.name}
            onChangeText={setName}
            placeholder={t("settings.apiEndpoints.form.namePlaceholder")}
            autoCorrect={false}
            testID="api-endpoint-import-link-name"
          />
        </Field>
        <Field label={t("settings.apiEndpoints.form.apiKeyOptionalLabel")} hint={keyHint}>
          <View style={styles.inlineRow}>
            <View style={styles.flex}>
              <FormTextInput
                initialValue={preview.key ?? ""}
                onChangeText={setKey}
                placeholder={keyPlaceholder}
                secureTextEntry={!isKeyVisible}
                autoCapitalize="none"
                autoCorrect={false}
                testID="api-endpoint-import-link-key"
              />
            </View>
            <Button
              variant="outline"
              size="sm"
              onPress={toggleKey}
              testID="api-endpoint-import-link-show-key"
            >
              {keyToggleLabel}
            </Button>
          </View>
        </Field>
        {showsKeysPage ? (
          <View style={styles.keysPage}>
            <Button
              variant="outline"
              size="sm"
              onPress={openKeysPage}
              testID="api-endpoint-import-link-get-key"
            >
              {t("settings.apiEndpoints.templates.getKey")}
            </Button>
          </View>
        ) : null}
        <BaseUrlList preview={preview} />
        {preview.models.length > 0 ? <ModelList models={preview.models} /> : null}
        {replacesText ? (
          <Alert
            variant="warning"
            description={replacesText}
            testID="api-endpoint-import-link-replaces"
          />
        ) : null}
      </View>
    </AdaptiveModalSheet>
  );
}

function BaseUrlList({ preview }: { preview: ApiEndpointImportLinkPreview }) {
  const { t } = useTranslation();
  return (
    <View style={styles.group}>
      <Text variant="label" weight="medium">
        {t("settings.apiEndpoints.importLink.baseUrls")}
      </Text>
      {preview.baseUrls.map((entry) => (
        <View key={entry.format} style={styles.urlRow}>
          <Text variant="caption" color="foregroundMuted" style={styles.urlFormat}>
            {formatLabel(t, entry.format)}
          </Text>
          <Text variant="caption" selectable style={styles.url}>
            {entry.url}
          </Text>
        </View>
      ))}
      {preview.ignoredGemini ? (
        <Text variant="caption" color="foregroundMuted" testID="api-endpoint-import-link-gemini">
          {t("settings.apiEndpoints.importLink.geminiIgnored")}
        </Text>
      ) : null}
    </View>
  );
}

function ModelList({ models }: { models: string[] }) {
  const { t } = useTranslation();
  return (
    <View style={styles.group}>
      <Text variant="label" weight="medium">
        {t("settings.apiEndpoints.importLink.models", { count: models.length })}
      </Text>
      <Text variant="caption" color="foregroundMuted" selectable>
        {models.join(t("settings.apiEndpoints.listSeparator"))}
      </Text>
    </View>
  );
}

function formatLabel(t: ReturnType<typeof useTranslation>["t"], format: string): string {
  switch (format) {
    case "anthropic_messages":
      return t("settings.apiEndpoints.formats.anthropic_messages");
    case "openai_chat":
      return t("settings.apiEndpoints.formats.openai_chat");
    case "openai_responses":
      return t("settings.apiEndpoints.formats.openai_responses");
    default:
      return format;
  }
}

const styles = StyleSheet.create((theme) => ({
  body: {
    gap: theme.spacing[4],
  },
  footer: {
    width: "100%",
    gap: theme.spacing[2],
  },
  actions: {
    width: "100%",
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
  inlineRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  flex: {
    flex: 1,
    minWidth: 0,
  },
  keysPage: {
    flexDirection: "row",
  },
  group: {
    gap: theme.spacing[1],
  },
  urlRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    columnGap: theme.spacing[2],
  },
  urlFormat: {
    minWidth: 120,
  },
  url: {
    flexShrink: 1,
  },
}));
