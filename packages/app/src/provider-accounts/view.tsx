import React, { useCallback } from "react";
import type { AccountRotationProvider } from "@getpaseo/protocol/provider-account/rpc-schemas";
import { openHostPrivacySettings } from "@/navigation/settings-navigation";
import { ProviderAccountsRiskNoticeSheet } from "./risk-notice-sheet";
import { ProviderAccountsSection } from "./section";
import { useProviderAccounts } from "./use-provider-accounts";

/** 「账号」一节的运行时接线；主机没声明 accountRotation 时什么都不画。 */
export function ProviderAccountsView(props: {
  serverId: string;
  provider: AccountRotationProvider;
  providerLabel: string;
}) {
  const { serverId, provider, providerLabel } = props;
  const accounts = useProviderAccounts(serverId, provider);
  const openPrivacy = useCallback(() => openHostPrivacySettings(serverId), [serverId]);
  if (!accounts.supported) return null;
  return (
    <>
      <ProviderAccountsSection
        provider={provider}
        providerLabel={providerLabel}
        load={accounts.load}
        canManage={accounts.canManage}
        pendingRotation={accounts.pendingRotation}
        rotationError={accounts.rotationError}
        onToggleRotation={accounts.setRotation}
        onOpenPrivacySettings={openPrivacy}
      />
      {accounts.confirmingRiskNotice ? (
        <ProviderAccountsRiskNoticeSheet
          provider={provider}
          providerLabel={providerLabel}
          onConfirm={accounts.confirmRiskNotice}
          onClose={accounts.cancelRiskNotice}
        />
      ) : null}
    </>
  );
}
