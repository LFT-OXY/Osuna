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
import { confirmDialog } from "@/utils/confirm-dialog";
import { ProviderAccountLimitsSheet } from "./limits-sheet";
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
  const { removeAccount } = accounts;
  // 移除前确认：只删 Osuna 存的这一份，CLI 不被登出。
  const confirmRemove = useCallback(
    (account: ProviderAccount) => {
      // macOS 桌面端的确认框只显示 message，所以 message 里也写明是哪个号。
      const email = account.email ?? t("settings.providers.accounts.unknownEmail");
      void (async () => {
        const confirmed = await confirmDialog({
          title: t("settings.providers.accounts.remove.title", { email }),
          message: t("settings.providers.accounts.remove.message", { email }),
          confirmLabel: t("settings.providers.accounts.remove.confirm"),
          cancelLabel: t("common.actions.cancel"),
          destructive: true,
        });
        if (confirmed) removeAccount(account);
      })();
    },
    [removeAccount, t],
  );
  // 正在设上限的号（只记 id：列表刷新后用新的那份）。
  const [limitsFor, setLimitsFor] = useState<string | null>(null);
  const { setLimits } = accounts;
  const saveLimits = useCallback(
    (account: ProviderAccount, limits: Record<string, number>) => {
      void (async () => {
        if (await setLimits(account, limits)) setLimitsFor(null);
      })();
    },
    [setLimits],
  );
  const closeLimits = useCallback(() => setLimitsFor(null), []);
  const openLimits = useCallback((account: ProviderAccount) => setLimitsFor(account.id), []);
  const limitsAccount =
    limitsFor !== null && accounts.load.kind === "ready"
      ? accounts.load.data.accounts.find((account) => account.id === limitsFor)
      : undefined;
  const { pendingAction, actionError } = accounts;
  const limitsSaving = pendingAction?.kind === "limits" && pendingAction.accountId === limitsFor;
  const limitsError = actionError?.action.kind === "limits" ? actionError.message : null;
  const saveShownLimits = useCallback(
    (limits: Record<string, number>) => {
      if (limitsAccount) saveLimits(limitsAccount, limits);
    },
    [limitsAccount, saveLimits],
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
        pendingAction={accounts.pendingAction}
        actionError={accounts.actionError}
        onUseAccount={accounts.switchTo}
        onRemoveAccount={confirmRemove}
        onSetOrder={accounts.setOrder}
        onSetLimits={openLimits}
        onSetKeepSignedIn={accounts.setKeepSignedIn}
        onSetSwitchOnly={accounts.setSwitchOnly}
      />
      {limitsAccount ? (
        <ProviderAccountLimitsSheet
          account={limitsAccount}
          saving={limitsSaving}
          error={limitsError}
          onSave={saveShownLimits}
          onClose={closeLimits}
        />
      ) : null}
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
