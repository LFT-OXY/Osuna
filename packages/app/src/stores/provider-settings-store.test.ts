import { afterEach, describe, expect, it } from "vitest";
import { useProviderSettingsStore } from "./provider-settings-store";

describe("provider settings store", () => {
  afterEach(() => {
    useProviderSettingsStore.setState({
      serverId: null,
      provider: null,
      overlayParentLayer: 0,
      visible: false,
    });
  });

  it("carries the opener layer without leaking it into later base-level opens", () => {
    useProviderSettingsStore.getState().open({
      serverId: "server-1",
      provider: "codex",
      overlayParentLayer: 30,
    });
    expect(useProviderSettingsStore.getState().overlayParentLayer).toBe(30);

    useProviderSettingsStore.getState().open({
      serverId: "server-1",
      provider: "claude",
    });
    expect(useProviderSettingsStore.getState().overlayParentLayer).toBe(0);
  });

  // 删除成功后关弹窗：只关仍在显示的那个提供方，删除期间换开的弹窗不受影响。
  it("closes only when the removed provider is still the one showing", () => {
    const store = useProviderSettingsStore.getState();
    store.open({ serverId: "server-1", provider: "custom-a" });
    store.closeIfShowing({ serverId: "server-1", provider: "custom-a" });
    expect(useProviderSettingsStore.getState().visible).toBe(false);

    store.open({ serverId: "server-1", provider: "claude" });
    store.closeIfShowing({ serverId: "server-1", provider: "custom-a" });
    expect(useProviderSettingsStore.getState().visible).toBe(true);

    store.closeIfShowing({ serverId: "server-2", provider: "claude" });
    expect(useProviderSettingsStore.getState().visible).toBe(true);
  });
});
