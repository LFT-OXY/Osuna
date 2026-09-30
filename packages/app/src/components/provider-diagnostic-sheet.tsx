import { useMemo } from "react";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { ProviderDetail } from "@/provider-detail/view";
import { resolveProviderLabel } from "@/utils/provider-definitions";

interface ProviderDiagnosticSheetProps {
  provider: string;
  visible: boolean;
  onClose: () => void;
  serverId: string;
}

// composer 模型选择器齿轮打开的提供方详情；添加 Model 和诊断都在详情里就地展开。
export function ProviderDiagnosticSheet({
  provider,
  visible,
  onClose,
  serverId,
}: ProviderDiagnosticSheetProps) {
  const { entries: snapshotEntries } = useProvidersSnapshot(serverId);
  const providerLabel = resolveProviderLabel(provider, snapshotEntries);
  const sheetHeader = useMemo<SheetHeader>(() => ({ title: providerLabel }), [providerLabel]);

  return (
    <AdaptiveModalSheet
      header={sheetHeader}
      visible={visible}
      onClose={onClose}
      testID="provider-settings-sheet"
      snapPoints={MAIN_SNAP_POINTS}
    >
      <ProviderDetail serverId={serverId} provider={provider} />
    </AdaptiveModalSheet>
  );
}

const MAIN_SNAP_POINTS = ["65%", "92%"];
