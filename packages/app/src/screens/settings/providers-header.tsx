import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { RotateCw } from "lucide-react-native";
import { BackHeader } from "@/components/headers/back-header";
import { ScreenTitle } from "@/components/headers/screen-title";
import { Button } from "@/components/ui/button";
import {
  iconButtonChromeGlyphSize,
  iconButtonChromeStyle,
  mutedIconColorMapping,
} from "@/components/ui/icon-button-chrome";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { Text } from "@/components/ui/text";
import { ProviderDetailMenu } from "@/provider-detail/header";
import { useProviderDetailHeader, useProviderDiagnosticActions } from "@/provider-detail/view";
import { useProvidersView } from "./providers-page";

/*
 * 提供方详情的页头。桌面是「Providers / {名称}」面包屑；手机是 BackHeader，
 * 标题为提供方名称，右侧放仅图标的「刷新」和 ⋯ 菜单。正文还没显示详情（列表未到、主机未连接、
 * 地址里的提供方不存在）时，页头退回分区标题，和正文保持一致。
 */

const ThemedRotateCw = withUnistyles(RotateCw);
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);

interface ProviderHeaderProps {
  serverId: string;
  provider: string;
  // 正文不是详情时显示的分区标题，也是面包屑的上一级。
  sectionTitle: string;
}

export function ProvidersBreadcrumb({
  serverId,
  provider,
  sectionTitle,
  onPressProviders,
}: ProviderHeaderProps & { onPressProviders: () => void }) {
  const providersView = useProvidersView(serverId, provider);
  const { label } = useProviderDetailHeader(serverId, provider);

  if (providersView.kind !== "detail") {
    return <ScreenTitle testID="settings-detail-header-title">{sectionTitle}</ScreenTitle>;
  }

  return (
    <View style={styles.breadcrumb}>
      <Button
        variant="ghost"
        size="sm"
        style={styles.parent}
        onPress={onPressProviders}
        testID="settings-providers-breadcrumb"
      >
        {sectionTitle}
      </Button>
      <Text color="foregroundExtraMuted">/</Text>
      <ScreenTitle testID="settings-detail-header-title">{label}</ScreenTitle>
    </View>
  );
}

export function ProviderDetailBackHeader({
  serverId,
  provider,
  sectionTitle,
  onBack,
}: ProviderHeaderProps & { onBack: () => void }) {
  const { t } = useTranslation();
  const providersView = useProvidersView(serverId, provider);
  const {
    label,
    isRefreshing,
    onRefresh,
    providerSource,
    hostSupportsRemoval,
    isRemoving,
    onRemove,
  } = useProviderDetailHeader(serverId, provider);
  // ⋯ 在顶栏、诊断节在正文，经 provider-detail/diagnostic.ts 的 store 让正文滚到诊断节并运行。
  const { diagnose } = useProviderDiagnosticActions(serverId, provider);
  const refreshStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) =>
      iconButtonChromeStyle({
        size: "large",
        state: { hovered: Boolean(hovered), pressed },
        disabled: isRefreshing,
      }),
    [isRefreshing],
  );
  const refreshAccessibilityState = useMemo(
    () => ({ busy: isRefreshing, disabled: isRefreshing }),
    [isRefreshing],
  );
  const rightContent = useMemo(
    () => (
      <View style={styles.screenActions}>
        <Pressable
          style={refreshStyle}
          onPress={onRefresh}
          disabled={isRefreshing}
          accessibilityRole="button"
          accessibilityLabel={t("settings.providers.diagnostic.refresh")}
          accessibilityState={refreshAccessibilityState}
          testID="provider-detail-refresh"
        >
          {isRefreshing ? (
            <ThemedLoadingSpinner uniProps={mutedIconColorMapping} />
          ) : (
            <ThemedRotateCw
              size={iconButtonChromeGlyphSize("large")}
              uniProps={mutedIconColorMapping}
            />
          )}
        </Pressable>
        <ProviderDetailMenu
          provider={provider}
          providerLabel={label}
          providerSource={providerSource}
          hostSupportsRemoval={hostSupportsRemoval}
          isRemoving={isRemoving}
          onDiagnose={diagnose}
          onRemove={onRemove}
          placement="screenHeader"
        />
      </View>
    ),
    [
      diagnose,
      hostSupportsRemoval,
      isRefreshing,
      isRemoving,
      label,
      onRefresh,
      onRemove,
      provider,
      providerSource,
      refreshAccessibilityState,
      refreshStyle,
      t,
    ],
  );

  if (providersView.kind !== "detail") {
    return <BackHeader title={sectionTitle} onBack={onBack} borderless />;
  }

  return <BackHeader title={label} rightContent={rightContent} onBack={onBack} borderless />;
}

const styles = StyleSheet.create((theme) => ({
  breadcrumb: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flexShrink: 1,
    minWidth: 0,
  },
  screenActions: {
    flexDirection: "row",
    alignItems: "center",
  },
  // 文字与左侧图标对齐，悬停底色向外扩。
  parent: {
    paddingHorizontal: theme.spacing[1],
    marginHorizontal: -theme.spacing[1],
  },
}));
