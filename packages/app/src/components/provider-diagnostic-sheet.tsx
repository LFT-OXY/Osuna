import * as Clipboard from "expo-clipboard";
import { Copy, FileText, RotateCw } from "lucide-react-native";
import type { TFunction } from "i18next";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, type PressableStateCallbackType, Text, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { ScrollableCodeSurface, SurfaceCard } from "@/components/ui/scrollable-code-surface";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useToast } from "@/contexts/toast-context";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { ProviderDetail } from "@/provider-detail/view";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { resolveProviderLabel } from "@/utils/provider-definitions";

interface ProviderDiagnosticSheetProps {
  provider: string;
  visible: boolean;
  onClose: () => void;
  serverId: string;
}

// 诊断输出弹窗。设置页详情的 ⋯「诊断」与错误卡「运行诊断」也打开它。
export function DiagnosticSubSheet({
  provider,
  serverId,
  visible,
  onClose,
}: {
  provider: string;
  serverId: string;
  visible: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const toast = useToast();
  const client = useHostRuntimeClient(serverId);
  const [diagnostic, setDiagnostic] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchDiagnostic = useCallback(async () => {
    if (!client) return;
    setLoading(true);
    try {
      const result = await client.getProviderDiagnostic(provider);
      setDiagnostic(result.diagnostic);
    } catch (err) {
      setDiagnostic(
        err instanceof Error ? err.message : t("settings.providers.diagnostic.failedToFetch"),
      );
    } finally {
      setLoading(false);
    }
  }, [client, provider, t]);

  useEffect(() => {
    if (visible) {
      void fetchDiagnostic();
    } else {
      setDiagnostic(null);
    }
  }, [visible, fetchDiagnostic]);

  const refreshButtonStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      sheetStyles.iconButton,
      (Boolean(hovered) || pressed) && sheetStyles.iconButtonHovered,
      loading ? sheetStyles.disabled : null,
    ],
    [loading],
  );

  const handleRefreshPress = useCallback(() => {
    void fetchDiagnostic();
  }, [fetchDiagnostic]);

  const copyButtonStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      sheetStyles.iconButton,
      (Boolean(hovered) || pressed) && Boolean(diagnostic) && sheetStyles.iconButtonHovered,
      diagnostic ? null : sheetStyles.disabled,
    ],
    [diagnostic],
  );

  const handleCopyPress = useCallback(() => {
    if (!diagnostic) return;
    void Clipboard.setStringAsync(diagnostic)
      .then(() => toast.copied(t("settings.providers.diagnostic.copyLabel")))
      .catch(() => toast.error(t("settings.providers.diagnostic.copyFailed")));
  }, [diagnostic, t, toast]);

  const header = useMemo<SheetHeader>(
    () => ({
      title: t("settings.providers.diagnostic.title"),
      actions: (
        <View style={sheetStyles.headerActions}>
          <Pressable
            onPress={handleCopyPress}
            disabled={!diagnostic}
            hitSlop={8}
            style={copyButtonStyle}
            accessibilityRole="button"
            accessibilityLabel={t("settings.providers.diagnostic.copyAccessibility")}
          >
            <Copy size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />
          </Pressable>
          <Pressable
            onPress={handleRefreshPress}
            disabled={loading}
            hitSlop={8}
            style={refreshButtonStyle}
            accessibilityRole="button"
            accessibilityLabel={
              loading
                ? t("settings.providers.diagnostic.refreshingAccessibility")
                : t("settings.providers.diagnostic.refreshAccessibility")
            }
          >
            {loading ? (
              <LoadingSpinner size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />
            ) : (
              <RotateCw size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />
            )}
          </Pressable>
        </View>
      ),
    }),
    [
      copyButtonStyle,
      diagnostic,
      handleCopyPress,
      handleRefreshPress,
      loading,
      refreshButtonStyle,
      t,
      theme.colors.foregroundMuted,
      theme.iconSize.sm,
    ],
  );

  let body: React.ReactNode;
  if (loading && !diagnostic) {
    body = (
      <SurfaceCard key={visible ? "visible" : "hidden"}>
        <View style={sheetStyles.codeBlockLoading}>
          <LoadingSpinner size="small" color={theme.colors.foregroundMuted} />
          <Text style={sheetStyles.mutedText}>{t("settings.providers.diagnostic.running")}</Text>
        </View>
      </SurfaceCard>
    );
  } else if (diagnostic) {
    body = (
      <ScrollableCodeSurface key={visible ? "visible" : "hidden"} maxHeight={480}>
        {diagnostic}
      </ScrollableCodeSurface>
    );
  } else {
    body = (
      <SurfaceCard key={visible ? "visible" : "hidden"}>
        <View style={sheetStyles.codeBlockLoading}>
          <Text style={sheetStyles.mutedText}>{t("settings.providers.diagnostic.none")}</Text>
        </View>
      </SurfaceCard>
    );
  }

  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={onClose}
      snapPoints={DIAGNOSTIC_SNAP_POINTS}
      scrollable={false}
      testID="provider-diagnostic-sheet"
    >
      {body}
    </AdaptiveModalSheet>
  );
}

interface ProviderSheetFooterInput {
  isCompact: boolean;
  modelsRefreshing: boolean;
  t: TFunction;
  onOpenDiagSheet: () => void;
  onRefreshModels: () => void;
}

// 「已更新」和「添加 Model」在详情的 Models 节里，底栏只放诊断和刷新。
function renderProviderSheetFooter({
  isCompact,
  modelsRefreshing,
  t,
  onOpenDiagSheet,
  onRefreshModels,
}: ProviderSheetFooterInput) {
  const contentStyle = isCompact ? sheetStyles.compactFooterContent : sheetStyles.footerContent;
  const actionsStyle = isCompact ? sheetStyles.compactFooterActions : sheetStyles.footerActions;
  const buttonStyle = isCompact ? sheetStyles.compactFooterButton : null;

  return (
    <View style={contentStyle}>
      <View style={actionsStyle}>
        <Button
          variant="secondary"
          size="sm"
          leftIcon={FileText}
          onPress={onOpenDiagSheet}
          style={buttonStyle}
        >
          {t("settings.providers.diagnostic.button")}
        </Button>
        <Button
          variant="default"
          size="sm"
          leftIcon={modelsRefreshing ? undefined : RotateCw}
          onPress={onRefreshModels}
          disabled={modelsRefreshing}
          style={buttonStyle}
        >
          {modelsRefreshing
            ? t("settings.providers.diagnostic.refreshing")
            : t("settings.providers.diagnostic.refresh")}
        </Button>
      </View>
    </View>
  );
}

export function ProviderDiagnosticSheet({
  provider,
  visible,
  onClose,
  serverId,
}: ProviderDiagnosticSheetProps) {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const { entries: snapshotEntries, refresh, isRefreshing } = useProvidersSnapshot(serverId);
  const [diagSheetOpen, setDiagSheetOpen] = useState(false);

  const providerLabel = resolveProviderLabel(provider, snapshotEntries);
  const providerEntry = useMemo(
    () => snapshotEntries?.find((entry) => entry.provider === provider),
    [snapshotEntries, provider],
  );
  const modelsRefreshing = isRefreshing || providerEntry?.status === "loading";

  useEffect(() => {
    if (!visible) {
      setDiagSheetOpen(false);
    }
  }, [visible]);

  const handleRefreshModels = useCallback(() => {
    void refresh([provider]);
  }, [provider, refresh]);

  const handleOpenDiagSheet = useCallback(() => setDiagSheetOpen(true), []);
  const handleCloseDiagSheet = useCallback(() => setDiagSheetOpen(false), []);

  const sheetHeader = useMemo<SheetHeader>(() => ({ title: providerLabel }), [providerLabel]);

  return (
    <>
      <AdaptiveModalSheet
        header={sheetHeader}
        visible={visible}
        onClose={onClose}
        testID="provider-settings-sheet"
        footer={renderProviderSheetFooter({
          isCompact,
          modelsRefreshing,
          t,
          onOpenDiagSheet: handleOpenDiagSheet,
          onRefreshModels: handleRefreshModels,
        })}
        snapPoints={MAIN_SNAP_POINTS}
      >
        <ProviderDetail
          serverId={serverId}
          provider={provider}
          onRunDiagnostic={handleOpenDiagSheet}
        />
      </AdaptiveModalSheet>
      <DiagnosticSubSheet
        provider={provider}
        serverId={serverId}
        visible={diagSheetOpen}
        onClose={handleCloseDiagSheet}
      />
    </>
  );
}

const sheetStyles = StyleSheet.create((theme) => ({
  mutedText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.foregroundMuted,
  },
  iconButton: {
    width: 28,
    height: 28,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  iconButtonHovered: {
    backgroundColor: theme.colors.surface2,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  disabled: {
    opacity: 0.5,
  },
  footerContent: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
  compactFooterContent: {
    flex: 1,
    gap: theme.spacing[2],
  },
  footerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  compactFooterActions: {
    gap: theme.spacing[2],
  },
  compactFooterButton: {
    alignSelf: "stretch",
  },
  codeBlockLoading: {
    paddingVertical: theme.spacing[4],
    paddingHorizontal: theme.spacing[4],
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
}));

const MAIN_SNAP_POINTS = ["65%", "92%"];
const DIAGNOSTIC_SNAP_POINTS = ["50%", "85%"];
