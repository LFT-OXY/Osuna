import React, { useCallback, useEffect, useState } from "react";
import * as Clipboard from "expo-clipboard";
import { useTranslation } from "react-i18next";
import type {
  AccountRotationProvider,
  ProviderAccount,
} from "@getpaseo/protocol/provider-account/rpc-schemas";
import { useToast } from "@/contexts/toast-context";
import { useIsLocalDaemon } from "@/hooks/use-is-local-daemon";
import { openHostPrivacySettings } from "@/navigation/settings-navigation";
import { ProviderAccountsRiskNoticeSheet } from "./risk-notice-sheet";
import { ProviderAccountsSection } from "./section";
import { ProviderAccountSignInSheet } from "./sign-in-sheet";
import { useAccountSignIn, type SignedInAccount } from "./use-account-sign-in";
import { useProviderAccounts } from "./use-provider-accounts";

// 加号成功后新号的行高亮这么久。
const HIGHLIGHT_MS = 6000;

/** 「账号」一节的运行时接线；主机没声明 accountRotation 时什么都不画。 */
export function ProviderAccountsView(props: {
  serverId: string;
  provider: AccountRotationProvider;
  providerLabel: string;
}) {
  const { serverId, provider, providerLabel } = props;
  const { t } = useTranslation();
  const toast = useToast();
  const accounts = useProviderAccounts(serverId, provider);
  const isLocalHost = useIsLocalDaemon(serverId);
  const [highlighted, setHighlighted] = useState<SignedInAccount | null>(null);
  const signIn = useAccountSignIn({ serverId, provider, isLocalHost, onSignedIn: setHighlighted });
  const openPrivacy = useCallback(() => openHostPrivacySettings(serverId), [serverId]);
  const startSignIn = signIn.start;
  const addAccount = useCallback(() => startSignIn(), [startSignIn]);
  const signInAgain = useCallback(
    (account: ProviderAccount) =>
      startSignIn({ accountId: account.id, ...(account.email ? { email: account.email } : {}) }),
    [startSignIn],
  );
  const signInView = signIn.view;
  const copyLink = useCallback(() => {
    if (signInView.kind !== "active") return;
    void Clipboard.setStringAsync(signInView.signIn.authUrl).then(() =>
      toast.copied(t("settings.providers.accounts.signIn.linkLabel")),
    );
  }, [signInView, t, toast]);
  useEffect(() => {
    if (!highlighted) return;
    const timer = setTimeout(() => setHighlighted(null), HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [highlighted]);
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
        // 加 Claude Code 的号在后面的工单里做。
        onAddAccount={provider === "codex" ? addAccount : undefined}
        onSignInAgain={signInAgain}
        highlighted={highlighted}
      />
      {accounts.confirmingRiskNotice ? (
        <ProviderAccountsRiskNoticeSheet
          provider={provider}
          providerLabel={providerLabel}
          onConfirm={accounts.confirmRiskNotice}
          onClose={accounts.cancelRiskNotice}
        />
      ) : null}
      {signInView.kind !== "closed" ? (
        <ProviderAccountSignInSheet
          providerLabel={providerLabel}
          view={signInView}
          callbackReachable={isLocalHost}
          onOpenSignInPage={signIn.openSignInPage}
          onCopyLink={copyLink}
          onSubmitPaste={signIn.submitPaste}
          onRetry={signIn.retry}
          onClose={signIn.close}
        />
      ) : null}
    </>
  );
}
