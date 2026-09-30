import { useMemo } from "react";
import { StyleSheet } from "react-native-unistyles";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { useIsCompactFormFactor } from "@/constants/layout";
import { ProviderIconFrame, ProviderStatusBadge } from "@/provider-detail/header";
import {
  ProviderDetail,
  ProviderDetailActions,
  useProviderDetailHeader,
} from "@/provider-detail/view";

interface ProviderDiagnosticSheetProps {
  provider: string;
  visible: boolean;
  onClose: () => void;
  // 删除确认并写入成功后调用。
  onRemoved: () => void;
  serverId: string;
}

// composer 模型选择器齿轮打开的提供方详情：弹窗外框，头部是图标、名称、徽章、「刷新」和 ⋯。
export function ProviderDiagnosticSheet({
  provider,
  visible,
  onClose,
  onRemoved,
  serverId,
}: ProviderDiagnosticSheetProps) {
  const header = useProviderDetailHeader(serverId, provider, { onRemoved });
  // 手机上文字「刷新」会把名称挤没，改成仅图标。
  const isCompact = useIsCompactFormFactor();

  const sheetHeader = useMemo<SheetHeader>(
    () => ({
      title: header.label,
      leading: <ProviderIconFrame icon={header.icon} size="sm" />,
      titleAccessory: <ProviderStatusBadge status={header.status} />,
      actions: (
        <ProviderDetailActions
          serverId={serverId}
          provider={provider}
          header={header}
          iconOnlyRefresh={isCompact}
        />
      ),
    }),
    [header, isCompact, provider, serverId],
  );

  return (
    <AdaptiveModalSheet
      header={sheetHeader}
      visible={visible}
      onClose={onClose}
      testID="provider-settings-sheet"
      snapPoints={MAIN_SNAP_POINTS}
      desktopMaxWidth={640}
      contentStyle={styles.content}
    >
      <ProviderDetail serverId={serverId} provider={provider} />
    </AdaptiveModalSheet>
  );
}

const MAIN_SNAP_POINTS = ["65%", "92%"];

const styles = StyleSheet.create({
  // 区块自带 24 的下边距，弹窗内容不再叠 gap；最后一块的下边距充当底部留白。
  content: {
    gap: 0,
    paddingBottom: 0,
  },
});
