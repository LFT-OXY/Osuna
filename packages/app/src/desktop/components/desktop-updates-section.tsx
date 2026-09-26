import { LoadingSpinner } from "@/components/ui/loading-spinner";
import React, { useCallback, useMemo, useState } from "react";
import { Alert, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { settingsStyles } from "@/styles/settings";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { Alert as InlineAlert } from "@/components/ui/alert";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { ArrowUpRight, Copy, FileText, Activity } from "lucide-react-native";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { openExternalUrl } from "@/utils/open-external-url";
import { isVersionMismatch } from "@/desktop/updates/desktop-updates";
import {
  getCliDaemonStatus,
  shouldUseDesktopDaemon,
  confirmAndStopDesktopDaemon,
} from "@/desktop/daemon/desktop-daemon";
import { useBuiltInDaemonManagement } from "@/desktop/hooks/use-built-in-daemon-management";
import { useDaemonStatus } from "@/desktop/hooks/use-daemon-status";
import { useDesktopSettings, type DesktopSettings } from "@/desktop/settings/desktop-settings";
import { resolveAppVersion } from "@/utils/app-version";
import { CODE_SURFACE_DATASET } from "@/styles/code-surface";

type DesktopDaemonSettings = DesktopSettings["daemon"];

const ThemedArrowUpRight = withUnistyles(ArrowUpRight);
const ThemedCopy = withUnistyles(Copy);
const ThemedFileText = withUnistyles(FileText);
const ThemedActivity = withUnistyles(Activity);
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);

const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

const advancedSettingsIcon = (
  <ThemedArrowUpRight size={ICON_SIZE.sm} uniProps={foregroundMutedColorMapping} />
);
const copyIcon = <ThemedCopy size={ICON_SIZE.sm} uniProps={foregroundColorMapping} />;
const fileTextIcon = <ThemedFileText size={ICON_SIZE.sm} uniProps={foregroundColorMapping} />;
const activityIcon = <ThemedActivity size={ICON_SIZE.sm} uniProps={foregroundColorMapping} />;

function useKeepRunningAfterQuitToggle(args: {
  settings: DesktopDaemonSettings;
  updateSettings: (next: Partial<DesktopDaemonSettings>) => Promise<unknown>;
}) {
  const { settings, updateSettings } = args;
  const [isUpdatingKeepRunningAfterQuit, setIsUpdatingKeepRunningAfterQuit] = useState(false);

  const handleToggleKeepRunningAfterQuit = useCallback(() => {
    setIsUpdatingKeepRunningAfterQuit(true);
    void updateSettings({ keepRunningAfterQuit: !settings.keepRunningAfterQuit })
      .catch(() => {
        // useDesktopSettings owns the user-visible IPC error.
      })
      .finally(() => {
        setIsUpdatingKeepRunningAfterQuit(false);
      });
  }, [settings.keepRunningAfterQuit, updateSettings]);

  return { isUpdatingKeepRunningAfterQuit, handleToggleKeepRunningAfterQuit };
}

function useDaemonCliStatusModal() {
  const { t } = useTranslation();
  const [cliStatusOutput, setCliStatusOutput] = useState<string | null>(null);
  const [isCliStatusModalOpen, setIsCliStatusModalOpen] = useState(false);
  const [isLoadingCliStatus, setIsLoadingCliStatus] = useState(false);

  const handleOpenCliStatus = useCallback(async () => {
    setIsLoadingCliStatus(true);
    try {
      setCliStatusOutput(await getCliDaemonStatus());
      setIsCliStatusModalOpen(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setCliStatusOutput(t("desktop.daemon.fullStatus.fetchFailed", { message }));
      setIsCliStatusModalOpen(true);
    } finally {
      setIsLoadingCliStatus(false);
    }
  }, [t]);

  const handleCopyCliStatus = useCallback(() => {
    if (!cliStatusOutput) {
      return;
    }
    void Clipboard.setStringAsync(cliStatusOutput)
      .then(() => {
        Alert.alert(t("common.states.copied"), t("desktop.daemon.fullStatus.copied"));
        return;
      })
      .catch((error) => {
        console.error("[Settings] Failed to copy daemon status", error);
      });
  }, [cliStatusOutput, t]);

  const handleCloseCliStatusModal = useCallback(() => setIsCliStatusModalOpen(false), []);

  return {
    cliStatusOutput,
    isCliStatusModalOpen,
    isLoadingCliStatus,
    handleCopyCliStatus,
    handleOpenCliStatus,
    handleCloseCliStatusModal,
  };
}

function useDaemonLogsModal(daemonLogs: { logPath?: string } | null) {
  const { t } = useTranslation();
  const [isLogsModalOpen, setIsLogsModalOpen] = useState(false);

  const handleCopyLogPath = useCallback(() => {
    const logPath = daemonLogs?.logPath;
    if (!logPath) {
      return;
    }

    void Clipboard.setStringAsync(logPath)
      .then(() => {
        Alert.alert(t("common.states.copied"), t("desktop.daemon.logs.copied"));
        return;
      })
      .catch((error) => {
        console.error("[Settings] Failed to copy log path", error);
        Alert.alert(t("common.errors.error"), t("desktop.daemon.logs.copyFailed"));
      });
  }, [daemonLogs?.logPath, t]);

  const handleOpenLogs = useCallback(() => {
    if (!daemonLogs) {
      return;
    }
    setIsLogsModalOpen(true);
  }, [daemonLogs]);

  const handleCloseLogsModal = useCallback(() => setIsLogsModalOpen(false), []);

  return { isLogsModalOpen, handleCopyLogPath, handleOpenLogs, handleCloseLogsModal };
}

interface DaemonLogsModalProps {
  visible: boolean;
  onClose: () => void;
  daemonLogs: { logPath?: string; contents?: string } | null;
}

function DaemonLogsModal({ visible, onClose, daemonLogs }: DaemonLogsModalProps) {
  const { t } = useTranslation();
  const header = useMemo<SheetHeader>(() => ({ title: t("desktop.daemon.logs.modalTitle") }), [t]);

  return (
    <AdaptiveModalSheet
      visible={visible}
      onClose={onClose}
      header={header}
      testID="managed-daemon-logs-dialog"
      snapPoints={LOGS_MODAL_SNAP_POINTS}
    >
      <View style={styles.modalBody}>
        <Text style={settingsStyles.rowHint}>
          {daemonLogs?.logPath ?? t("desktop.daemon.logs.unavailable")}
        </Text>
        <Text style={styles.logOutput} selectable dataSet={CODE_SURFACE_DATASET}>
          {daemonLogs?.contents?.length ? daemonLogs.contents : t("desktop.daemon.logs.empty")}
        </Text>
      </View>
    </AdaptiveModalSheet>
  );
}

interface DaemonCliStatusModalProps {
  visible: boolean;
  onClose: () => void;
  cliStatusOutput: string | null;
  onCopy: () => void;
}

function DaemonCliStatusModal({
  visible,
  onClose,
  cliStatusOutput,
  onCopy,
}: DaemonCliStatusModalProps) {
  const { t } = useTranslation();
  const header = useMemo<SheetHeader>(
    () => ({ title: t("desktop.daemon.fullStatus.modalTitle") }),
    [t],
  );

  return (
    <AdaptiveModalSheet
      visible={visible}
      onClose={onClose}
      header={header}
      testID="daemon-cli-status-dialog"
      snapPoints={CLI_STATUS_MODAL_SNAP_POINTS}
    >
      <View style={styles.modalBody}>
        <Text style={styles.logOutput} selectable dataSet={CODE_SURFACE_DATASET}>
          {cliStatusOutput ?? ""}
        </Text>
        <View style={styles.modalActions}>
          <Button variant="outline" size="sm" onPress={onClose}>
            {t("common.actions.close")}
          </Button>
          <Button size="sm" onPress={onCopy}>
            {t("common.actions.copy")}
          </Button>
        </View>
      </View>
    </AdaptiveModalSheet>
  );
}

interface DaemonInfoCardProps {
  daemonStatusStateText: string;
  daemonStatusDetailText: string;
  isDaemonManagementPaused: boolean;
  handleToggleDaemonManagement: () => void;
  isUpdatingDaemonManagement: boolean;
  keepRunningAfterQuit: boolean;
  handleToggleKeepRunningAfterQuit: () => void;
  isUpdatingKeepRunningAfterQuit: boolean;
  daemonLogs: { logPath?: string } | null;
  handleCopyLogPath: () => void;
  handleOpenLogs: () => void;
  handleRunCliStatus: () => void;
  isLoadingCliStatus: boolean;
}

function DaemonInfoCard(props: DaemonInfoCardProps) {
  const { t } = useTranslation();
  const {
    daemonStatusStateText,
    daemonStatusDetailText,
    isDaemonManagementPaused,
    handleToggleDaemonManagement,
    isUpdatingDaemonManagement,
    keepRunningAfterQuit,
    handleToggleKeepRunningAfterQuit,
    isUpdatingKeepRunningAfterQuit,
    daemonLogs,
    handleCopyLogPath,
    handleOpenLogs,
    handleRunCliStatus,
    isLoadingCliStatus,
  } = props;

  return (
    <View style={settingsStyles.card}>
      <View style={settingsStyles.row}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>{t("desktop.daemon.status.title")}</Text>
          <Text style={settingsStyles.rowHint}>{t("desktop.daemon.status.builtInOnly")}</Text>
        </View>
        <View style={styles.statusValueGroup}>
          <Text style={styles.valueText}>{daemonStatusStateText}</Text>
          <Text style={styles.valueSubtext}>{daemonStatusDetailText}</Text>
        </View>
      </View>
      <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>{t("desktop.daemon.management.title")}</Text>
          <Text style={settingsStyles.rowHint}>{t("desktop.daemon.management.hint")}</Text>
        </View>
        <Switch
          value={!isDaemonManagementPaused}
          onValueChange={handleToggleDaemonManagement}
          disabled={isUpdatingDaemonManagement}
          accessibilityLabel={t("desktop.daemon.management.title")}
        />
      </View>
      <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>{t("desktop.daemon.keepRunning.title")}</Text>
          <Text style={settingsStyles.rowHint}>{t("desktop.daemon.keepRunning.hint")}</Text>
        </View>
        <Switch
          value={keepRunningAfterQuit}
          onValueChange={handleToggleKeepRunningAfterQuit}
          disabled={isUpdatingKeepRunningAfterQuit}
          accessibilityLabel={t("desktop.daemon.keepRunning.title")}
        />
      </View>
      <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>{t("desktop.daemon.logs.title")}</Text>
          <Text style={settingsStyles.rowHint}>
            {daemonLogs?.logPath ?? t("desktop.daemon.logs.unavailable")}
          </Text>
        </View>
        <View style={styles.actionGroup}>
          {daemonLogs?.logPath ? (
            <Button variant="outline" size="sm" leftIcon={copyIcon} onPress={handleCopyLogPath}>
              {t("desktop.daemon.logs.copyPath")}
            </Button>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            leftIcon={fileTextIcon}
            onPress={handleOpenLogs}
            disabled={!daemonLogs}
          >
            {t("desktop.daemon.logs.open")}
          </Button>
        </View>
      </View>
      <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>{t("desktop.daemon.fullStatus.title")}</Text>
          <Text style={settingsStyles.rowHint}>{t("desktop.daemon.fullStatus.hint")}</Text>
        </View>
        <Button
          variant="outline"
          size="sm"
          leftIcon={activityIcon}
          onPress={handleRunCliStatus}
          disabled={isLoadingCliStatus}
        >
          {isLoadingCliStatus ? t("common.states.loading") : t("desktop.daemon.fullStatus.view")}
        </Button>
      </View>
    </View>
  );
}

export function LocalDaemonSection() {
  const { t } = useTranslation();
  const showSection = shouldUseDesktopDaemon();
  const appVersion = resolveAppVersion();
  const { settings, updateSettings, isLoading: isLoadingSettings } = useDesktopSettings();
  const daemonSettings = settings.daemon;
  const updateDaemonSettings = useCallback(
    (updates: Partial<DesktopDaemonSettings>) => updateSettings({ daemon: updates }),
    [updateSettings],
  );
  const { data, isLoading, error: statusError, setStatus, refetch } = useDaemonStatus();

  const daemonStatus = data?.status ?? null;
  const daemonLogs = data?.logs ?? null;
  const daemonVersion = daemonStatus?.version ?? null;
  const [isStopping, setIsStopping] = useState(false);
  const handleStop = useCallback(() => {
    setIsStopping(true);
    void confirmAndStopDesktopDaemon()
      .then((status) => {
        if (status) setStatus(status);
        return undefined;
      })
      .catch((error) => Alert.alert(t("desktop.daemon.lifecycle.stopFailed"), String(error)))
      .finally(() => setIsStopping(false));
  }, [setStatus, t]);

  const daemonVersionMismatch = isVersionMismatch(appVersion, daemonVersion);
  const daemonStatusStateText =
    statusError ??
    (daemonStatus?.status === "running"
      ? t("desktop.daemon.status.running")
      : t("desktop.daemon.status.notRunning"));
  const daemonStatusDetailText = t("desktop.daemon.status.pid", {
    pid: daemonStatus?.pid ? daemonStatus.pid : "—",
  });
  const isDaemonManagementPaused = !daemonSettings.manageBuiltInDaemon;

  const { isUpdating: isUpdatingDaemonManagement, toggle: handleToggleDaemonManagement } =
    useBuiltInDaemonManagement({
      daemonStatus,
      settings: daemonSettings,
      updateSettings: updateDaemonSettings,
      setStatus,
      refreshStatus: refetch,
    });
  const { isUpdatingKeepRunningAfterQuit, handleToggleKeepRunningAfterQuit } =
    useKeepRunningAfterQuitToggle({
      settings: daemonSettings,
      updateSettings: updateDaemonSettings,
    });

  const { isLogsModalOpen, handleCopyLogPath, handleOpenLogs, handleCloseLogsModal } =
    useDaemonLogsModal(daemonLogs);

  const {
    cliStatusOutput,
    isCliStatusModalOpen,
    isLoadingCliStatus,
    handleCopyCliStatus,
    handleOpenCliStatus,
    handleCloseCliStatusModal,
  } = useDaemonCliStatusModal();
  const handleRunCliStatus = useCallback(() => {
    void handleOpenCliStatus();
  }, [handleOpenCliStatus]);

  const handleOpenAdvancedSettings = useCallback(
    () => void openExternalUrl(ADVANCED_DAEMON_SETTINGS_URL),
    [],
  );

  const advancedSettingsButton = useMemo(
    () => (
      <Button
        variant="ghost"
        size="sm"
        leftIcon={advancedSettingsIcon}
        textStyle={settingsStyles.sectionHeaderLinkText}
        style={settingsStyles.sectionHeaderLink}
        onPress={handleOpenAdvancedSettings}
        accessibilityLabel={t("desktop.daemon.openAdvancedSettings")}
      >
        {t("desktop.daemon.advancedSettings")}
      </Button>
    ),
    [handleOpenAdvancedSettings, t],
  );

  if (!showSection) {
    return null;
  }

  return (
    <SettingsSection
      title={t("desktop.daemon.title")}
      trailing={advancedSettingsButton}
      testID="host-page-daemon-lifecycle-card"
    >
      {isLoading || isLoadingSettings ? (
        <View style={[settingsStyles.card, styles.loadingCard]}>
          <ThemedLoadingSpinner size="small" uniProps={foregroundMutedColorMapping} />
        </View>
      ) : (
        <>
          <DaemonInfoCard
            daemonStatusStateText={daemonStatusStateText}
            daemonStatusDetailText={daemonStatusDetailText}
            isDaemonManagementPaused={isDaemonManagementPaused}
            handleToggleDaemonManagement={handleToggleDaemonManagement}
            isUpdatingDaemonManagement={isUpdatingDaemonManagement}
            keepRunningAfterQuit={daemonSettings.keepRunningAfterQuit}
            handleToggleKeepRunningAfterQuit={handleToggleKeepRunningAfterQuit}
            isUpdatingKeepRunningAfterQuit={isUpdatingKeepRunningAfterQuit}
            daemonLogs={daemonLogs}
            handleCopyLogPath={handleCopyLogPath}
            handleOpenLogs={handleOpenLogs}
            handleRunCliStatus={handleRunCliStatus}
            isLoadingCliStatus={isLoadingCliStatus}
          />

          {daemonStatus?.pid ? (
            <View style={settingsStyles.card}>
              <View style={settingsStyles.row}>
                <View style={settingsStyles.rowContent}>
                  <Text style={settingsStyles.rowTitle}>
                    {daemonStatus.ownedByDesktop
                      ? t("desktop.daemon.lifecycle.owned")
                      : t("desktop.daemon.lifecycle.attached")}
                  </Text>
                  <Text style={settingsStyles.rowHint}>{daemonStatus.home}</Text>
                </View>
                <Button variant="outline" size="sm" onPress={handleStop} disabled={isStopping}>
                  {isStopping
                    ? t("desktop.daemon.lifecycle.stopping")
                    : t("desktop.daemon.lifecycle.stop")}
                </Button>
              </View>
            </View>
          ) : null}

          {daemonVersionMismatch ? (
            <View style={styles.warning}>
              <InlineAlert variant="warning" description={t("desktop.daemon.versionMismatch")} />
            </View>
          ) : null}
        </>
      )}

      <DaemonLogsModal
        visible={isLogsModalOpen}
        onClose={handleCloseLogsModal}
        daemonLogs={daemonLogs}
      />

      <DaemonCliStatusModal
        visible={isCliStatusModalOpen}
        onClose={handleCloseCliStatusModal}
        cliStatusOutput={cliStatusOutput}
        onCopy={handleCopyCliStatus}
      />
    </SettingsSection>
  );
}

const ADVANCED_DAEMON_SETTINGS_URL = "https://paseo.sh/docs/configuration";

const styles = StyleSheet.create((theme) => ({
  actionGroup: {
    flexDirection: "row",
    gap: theme.spacing[2],
    flexWrap: "wrap",
    justifyContent: "flex-end",
  },
  loadingCard: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: theme.spacing[6],
  },
  statusValueGroup: {
    alignItems: "flex-end",
    gap: 2,
  },
  valueText: {
    color: theme.colors.foregroundMuted,
    ...theme.typeScale.body,
  },
  valueSubtext: {
    color: theme.colors.foregroundMuted,
    ...theme.typeScale.caption,
  },
  warning: {
    marginTop: theme.spacing[3],
  },
  modalBody: {
    gap: theme.spacing[3],
    paddingBottom: theme.spacing[2],
  },
  logOutput: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    lineHeight: 18,
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
}));

const LOGS_MODAL_SNAP_POINTS = ["70%", "92%"];
const CLI_STATUS_MODAL_SNAP_POINTS = ["60%", "85%"];
