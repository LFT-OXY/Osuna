import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import type { ProviderVersionCheckResult } from "@getpaseo/protocol/messages";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { openExternalUrl } from "@/utils/open-external-url";
import {
  dismissProviderUpgradeError,
  upgradeProvider,
  useProviderUpgradeState,
  type ProviderUpgradeState,
} from "./upgrade";
import { applyUpgradedVersion, providerVersionCheckQueryKey } from "./version-check";

export interface ProviderUpgradeControls {
  state: ProviderUpgradeState;
  upgrade: () => void;
  dismiss: () => void;
  // 判断不出安装方式时，失败块里的手动升级指引用它打开官方文档。
  openDocs: (url: string) => void;
}

function openDocs(url: string): void {
  void openExternalUrl(url);
}

// 列表行和详情页的版本一节共用：同一个提供方的升级状态只有一份。
export function useProviderUpgrade(serverId: string, provider: string): ProviderUpgradeControls {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const queryClient = useQueryClient();
  const state = useProviderUpgradeState(serverId, provider);

  const upgrade = useCallback(() => {
    void upgradeProvider(serverId, provider, {
      run: async () => {
        if (!client) throw new Error(t("settings.providers.upgrade.errors.hostDisconnected"));
        return await client.upgradeProvider({ provider });
      },
      // 快照随后会推来新的 version；检查结果这边就地改掉，不再联网。
      onUpgraded: (version) => {
        queryClient.setQueryData<ProviderVersionCheckResult[] | undefined>(
          providerVersionCheckQueryKey(serverId),
          (results) => applyUpgradedVersion({ results, provider, version }),
        );
      },
    });
  }, [client, provider, queryClient, serverId, t]);

  const dismiss = useCallback(
    () => dismissProviderUpgradeError(serverId, provider),
    [provider, serverId],
  );

  return { state, upgrade, dismiss, openDocs };
}
