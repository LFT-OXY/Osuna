import { Gift } from "lucide-react-native";
import { type ReactNode, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import {
  type SidebarCalloutAction,
  SidebarCalloutDescriptionText,
} from "@/components/sidebar-callout";
import { Text } from "@/components/ui/text";
import { useSidebarCallouts } from "@/contexts/sidebar-callout-context";
import {
  resolveUpdateCalloutDescriptor,
  type UpdateCalloutActionDescriptor,
  type UpdateCalloutActionRole,
  type UpdateCalloutBody,
  type UpdateCalloutProgress,
} from "@/desktop/updates/resolve-update-callout";
import { useDesktopAppUpdater } from "@/desktop/updates/use-desktop-app-updater";
import { openDesktopReleasesPage } from "@/desktop/updates/desktop-updates";
import { useStableEvent } from "@/hooks/use-stable-event";
import { openChangelog } from "@/changelog";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";

type TranslateFn = ReturnType<typeof useTranslation>["t"];

function renderBody(body: UpdateCalloutBody, t: TranslateFn): ReactNode {
  switch (body.kind) {
    case "available":
      return <UpdateAvailableDescription versionLabel={body.versionLabel} t={t} />;
    case "downloading":
      return body.progress ? (
        <UpdateDownloadProgress progress={body.progress} />
      ) : (
        t("desktop.updates.callout.downloadingDescription")
      );
    case "downloaded":
      return (
        <UpdateDownloadedDescription
          versionLabel={body.versionLabel}
          installsOnQuit={body.installsOnQuit}
          t={t}
        />
      );
    case "installing":
      return t("desktop.updates.callout.installingDescription");
    case "error":
      return body.message;
  }
}

function materializeActions(
  actions: readonly UpdateCalloutActionDescriptor[],
  handlers: Record<UpdateCalloutActionRole, () => void>,
): SidebarCalloutAction[] {
  return actions.map((action) => ({
    label: action.label,
    onPress: handlers[action.role],
    variant: action.variant,
    disabled: action.disabled,
  }));
}

export function UpdateCalloutSource() {
  const { t } = useTranslation();
  const callouts = useSidebarCallouts();
  const { theme } = useUnistyles();
  const {
    isDesktopApp,
    status,
    targetVersion,
    installsOnQuit,
    downloadProgress,
    errorMessage,
    isHidden,
    isCancellingDownload,
    checkForUpdates,
    downloadUpdate,
    cancelDownload,
    installUpdate,
    hide,
  } = useDesktopAppUpdater();

  const download = useStableEvent(() => {
    void downloadUpdate();
  });
  const cancel = useStableEvent(() => {
    void cancelDownload();
  });
  const install = useStableEvent(() => {
    void installUpdate();
  });
  const retry = useStableEvent(() => {
    void checkForUpdates();
  });
  useEffect(() => {
    const descriptor = resolveUpdateCalloutDescriptor({
      isDesktopApp,
      status,
      targetVersion,
      installsOnQuit,
      downloadProgress,
      errorMessage,
      isHidden,
      isCancellingDownload,
    });
    if (!descriptor) return;

    // 不传 dismissalKey：× 只在本次运行内隐藏，由更新状态机记住。
    return callouts.show({
      id: descriptor.id,
      priority: descriptor.priority,
      title: descriptor.title,
      description: renderBody(descriptor.body, t),
      icon: descriptor.showGiftIcon ? (
        <Gift size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />
      ) : undefined,
      variant: descriptor.variant,
      actions: materializeActions(descriptor.actions, {
        later: hide,
        update: download,
        cancel,
        install,
        changelog: openChangelog,
        retry,
        manualDownload: openDesktopReleasesPage,
      }),
      dismissible: descriptor.dismissible,
      onDismiss: hide,
      testID: descriptor.testID,
    });
  }, [
    callouts,
    cancel,
    download,
    downloadProgress,
    errorMessage,
    hide,
    install,
    installsOnQuit,
    isCancellingDownload,
    isDesktopApp,
    isHidden,
    retry,
    status,
    targetVersion,
    theme.colors.foregroundMuted,
    theme.iconSize.sm,
    t,
  ]);

  return null;
}

function UpdateAvailableDescription({
  versionLabel,
  t,
}: {
  versionLabel: string | null;
  t: TranslateFn;
}) {
  return (
    <SidebarCalloutDescriptionText>
      {versionLabel
        ? t("desktop.updates.callout.versionAvailable", { version: versionLabel })
        : t("desktop.updates.callout.newVersionAvailable")}
      {" · "}
      <Text variant="caption" accessibilityRole="link" onPress={openChangelog} style={styles.link}>
        {t("desktop.updates.callout.viewChanges")}
      </Text>
    </SidebarCalloutDescriptionText>
  );
}

function UpdateDownloadedDescription({
  versionLabel,
  installsOnQuit,
  t,
}: {
  versionLabel: string | null;
  installsOnQuit: boolean;
  t: TranslateFn;
}) {
  return (
    <>
      <SidebarCalloutDescriptionText>
        {versionLabel
          ? t("desktop.updates.callout.versionDownloaded", { version: versionLabel })
          : t("desktop.updates.callout.newVersionDownloaded")}{" "}
        {t("desktop.updates.callout.restartWarning")}
      </SidebarCalloutDescriptionText>
      {installsOnQuit ? (
        <SidebarCalloutDescriptionText>
          {t("desktop.updates.callout.installsOnQuit")}
        </SidebarCalloutDescriptionText>
      ) : null}
    </>
  );
}

// 最小进度条，样式参照 DownloadToast 那条；不抽公共组件。
// 宽度每秒都在变，走 inline 样式，避免每个值都往 #unistyles-web 追加一条 CSS 规则。
function UpdateDownloadProgress({ progress }: { progress: UpdateCalloutProgress }) {
  const fillStyle = useMemo(
    () => [
      styles.progressFill,
      inlineUnistylesStyle({ width: `${progress.fraction * 100}%` as const }),
    ],
    [progress.fraction],
  );
  const accessibilityValue = useMemo(
    () => ({ min: 0, max: 100, now: progress.percent }),
    [progress.percent],
  );
  return (
    <>
      <View
        style={styles.progressTrack}
        accessibilityRole="progressbar"
        accessibilityValue={accessibilityValue}
        testID="update-callout-progress"
      >
        <View style={fillStyle} />
      </View>
      <SidebarCalloutDescriptionText>{progress.label}</SidebarCalloutDescriptionText>
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  link: {
    textDecorationLine: "underline",
  },
  progressTrack: {
    height: 4,
    backgroundColor: theme.colors.surface3,
    borderRadius: theme.borderRadius.full,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: theme.colors.primary,
    borderRadius: theme.borderRadius.full,
  },
}));
