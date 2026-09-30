import { create } from "zustand";

interface ProviderSettingsTarget {
  serverId: string;
  provider: string;
  overlayParentLayer?: number;
}

interface ProviderSettingsStoreState {
  serverId: string | null;
  provider: string | null;
  overlayParentLayer: number;
  visible: boolean;
  open: (target: ProviderSettingsTarget) => void;
  close: () => void;
  closeIfShowing: (target: { serverId: string; provider: string }) => void;
}

export const useProviderSettingsStore = create<ProviderSettingsStoreState>()((set, get) => ({
  serverId: null,
  provider: null,
  overlayParentLayer: 0,
  visible: false,
  open: ({ serverId, provider, overlayParentLayer = 0 }) => {
    set({ serverId, provider, overlayParentLayer, visible: true });
  },
  close: () => {
    set({ visible: false });
  },
  closeIfShowing: ({ serverId, provider }) => {
    const current = get();
    if (!current.visible || current.serverId !== serverId || current.provider !== provider) return;
    set({ visible: false });
  },
}));
