import { useCallback } from "react";
import { ProviderDiagnosticSheet } from "@/components/provider-diagnostic-sheet";
import { OverlayLayerProvider } from "@/lib/overlay-root";
import { useProviderSettingsStore } from "@/stores/provider-settings-store";

export function ProviderSettingsHost() {
  const serverId = useProviderSettingsStore((state) => state.serverId);
  const provider = useProviderSettingsStore((state) => state.provider);
  const visible = useProviderSettingsStore((state) => state.visible);
  const overlayParentLayer = useProviderSettingsStore((state) => state.overlayParentLayer);
  const close = useProviderSettingsStore((state) => state.close);
  const closeIfShowing = useProviderSettingsStore((state) => state.closeIfShowing);

  const handleClose = useCallback(() => {
    close();
  }, [close]);

  // 删除成功后提供方从快照消失，关掉弹窗回到模型选择器；删除期间已换开别的提供方时不关。
  const handleRemoved = useCallback(() => {
    if (!serverId || !provider) return;
    closeIfShowing({ serverId, provider });
  }, [closeIfShowing, provider, serverId]);

  if (!serverId || !provider) {
    return null;
  }

  return (
    <OverlayLayerProvider layer={overlayParentLayer}>
      <ProviderDiagnosticSheet
        key={`${serverId}:${provider}`}
        provider={provider}
        serverId={serverId}
        visible={visible}
        onClose={handleClose}
        onRemoved={handleRemoved}
      />
    </OverlayLayerProvider>
  );
}
