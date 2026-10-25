import React, { useCallback } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Plus } from "lucide-react-native";
import type {
  AccountRotationProvider,
  ProviderAccount,
  ProviderAccountBlock,
} from "@getpaseo/protocol/provider-account/rpc-schemas";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { Switch } from "@/components/ui/switch";
import { settingsStyles } from "@/styles/settings";
import { UsageWindowBar } from "@/usage/window-bar";
import type { SignedInAccount } from "./use-account-sign-in";
import type { ProviderAccountsLoad } from "./use-provider-accounts";

/*
 * Codex / Claude Code 提供方页的「账号」一节，从上到下：说明行（总开关关着、登录换不了）、
 * 「多号自动轮换」开关、账号列表、「添加账号」。纯 props，运行时接线在 view.tsx。
 */

const KEY = "settings.providers.accounts";
const SKELETON_ROWS = [0, 1];

export interface ProviderAccountsSectionProps {
  provider: AccountRotationProvider;
  providerLabel: string;
  load: ProviderAccountsLoad;
  canManage: boolean;
  pendingRotation: boolean | null;
  rotationError: string | null;
  onToggleRotation: (enabled: boolean) => void;
  onOpenPrivacySettings: () => void;
  // 这家能加号时给；没有就不出现「添加账号」。
  onAddAccount?: () => void;
  onSignInAgain: (account: ProviderAccount) => void;
  // 刚加上或更新的号：高亮它的行。
  highlighted: SignedInAccount | null;
}

export function ProviderAccountsSection(props: ProviderAccountsSectionProps) {
  const { provider, providerLabel, load, canManage, pendingRotation, rotationError } = props;
  const { t } = useTranslation();
  const data = load.kind === "ready" ? load.data : null;
  const blocked = data?.blocked ?? null;
  const savedValue = data?.settings.rotationEnabled === true;
  const shownValue = pendingRotation ?? savedValue;
  const locked = data === null || pendingRotation !== null || !canManage || blocked !== null;
  return (
    <SettingsSection title={t(`${KEY}.title`)} testID="provider-accounts">
      {blocked ? (
        <BlockedNotice
          blocked={blocked}
          providerLabel={providerLabel}
          onOpenPrivacySettings={props.onOpenPrivacySettings}
        />
      ) : null}
      <View style={settingsStyles.card}>
        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>{t(`${KEY}.rotate.title`)}</Text>
            <Text style={settingsStyles.rowHint} testID="provider-accounts-rotate-hint">
              {rotateHint(t, provider)}
            </Text>
            {rotationError ? (
              <Text style={settingsStyles.rowError} testID="provider-accounts-rotate-error">
                {t(`${KEY}.rotate.saveFailed`, { reason: rotationError })}
              </Text>
            ) : null}
          </View>
          <Switch
            value={shownValue}
            onValueChange={props.onToggleRotation}
            disabled={locked}
            accessibilityLabel={t(`${KEY}.rotate.title`)}
            testID="provider-accounts-rotate-switch"
          />
        </View>
      </View>
      <AccountList
        load={load}
        providerLabel={providerLabel}
        rotationOn={savedValue}
        canManage={canManage}
        onAddAccount={blocked ? undefined : props.onAddAccount}
        onSignInAgain={props.onSignInAgain}
        highlighted={props.highlighted}
      />
    </SettingsSection>
  );
}

function BlockedNotice({
  blocked,
  providerLabel,
  onOpenPrivacySettings,
}: {
  blocked: ProviderAccountBlock;
  providerLabel: string;
  onOpenPrivacySettings: () => void;
}) {
  const { t } = useTranslation();
  if (blocked.kind === "cli_sign_ins_off") {
    return (
      <View style={styles.notice}>
        <Alert
          size="sm"
          variant="info"
          description={t(`${KEY}.cliSignInsOff`)}
          testID="provider-accounts-cli-sign-ins-off"
        >
          <Button
            variant="outline"
            size="sm"
            onPress={onOpenPrivacySettings}
            testID="provider-accounts-open-privacy"
          >
            {t(`${KEY}.openPrivacySettings`)}
          </Button>
        </Alert>
      </View>
    );
  }
  return (
    <View style={styles.notice}>
      <Alert
        size="sm"
        variant="warning"
        description={t(`${KEY}.loginUnsupported`, {
          name: providerLabel,
          reason: unsupportedReason(t, blocked),
        })}
        testID="provider-accounts-login-unsupported"
      />
    </View>
  );
}

/** 开关下的说明行；Codex 多一句请求经过 Osuna。 */
function rotateHint(t: TFunction, provider: AccountRotationProvider): string {
  const hint = t(`${KEY}.rotate.hint`);
  if (provider !== "codex") return hint;
  return `${hint} ${t(`${KEY}.rotate.codexHint`)}`;
}

const UNSUPPORTED_CODES = new Set([
  "ephemeral",
  "unknown_store",
  "config_unparsable",
  "keyring_unavailable",
  "login_unparsable",
  "account_unknown",
]);

/** 已知原因用翻译，新 daemon 给的别的原因照原文。 */
function unsupportedReason(
  t: TFunction,
  blocked: Extract<ProviderAccountBlock, { kind: "login_unsupported" }>,
): string {
  if (!UNSUPPORTED_CODES.has(blocked.code)) return blocked.reason;
  return t(`${KEY}.unsupportedReasons.${blocked.code}`);
}

interface AccountListProps {
  load: ProviderAccountsLoad;
  providerLabel: string;
  rotationOn: boolean;
  canManage: boolean;
  onAddAccount: (() => void) | undefined;
  onSignInAgain: (account: ProviderAccount) => void;
  highlighted: SignedInAccount | null;
}

function AccountList(props: AccountListProps) {
  const { load, providerLabel, rotationOn, canManage, onAddAccount, highlighted } = props;
  const { t } = useTranslation();
  if (load.kind === "loading") {
    return (
      <View style={settingsStyles.card} testID="provider-accounts-loading">
        {SKELETON_ROWS.map((row) => (
          <View key={row} style={[settingsStyles.row, row > 0 && settingsStyles.rowBorder]}>
            <View style={styles.skeletonBody}>
              <View style={[styles.skeletonBar, styles.skeletonTitle]} />
              <View style={[styles.skeletonBar, styles.skeletonMeter]} />
            </View>
          </View>
        ))}
      </View>
    );
  }
  if (load.kind === "error") {
    return (
      <Text style={styles.listError} testID="provider-accounts-load-error">
        {t(`${KEY}.loadFailed`, { reason: load.message })}
      </Text>
    );
  }
  const { accounts } = load.data;
  // 轮换关着、也没有号：开关下面不再多一块空列表。
  if (accounts.length === 0 && !rotationOn) return null;
  const addButton = onAddAccount ? (
    <View style={styles.addRow}>
      <Button
        variant="outline"
        size="sm"
        leftIcon={Plus}
        onPress={onAddAccount}
        disabled={!canManage}
        testID="provider-accounts-add"
      >
        {t(`${KEY}.add`)}
      </Button>
    </View>
  ) : null;
  if (accounts.length === 0) {
    return (
      <View style={styles.list}>
        <View style={settingsStyles.card} testID="provider-accounts-empty">
          <View style={settingsStyles.row}>
            <Text style={settingsStyles.rowHint}>{t(`${KEY}.empty`, { name: providerLabel })}</Text>
          </View>
        </View>
        {addButton}
      </View>
    );
  }
  const highlightedAccount = highlighted
    ? accounts.find((account) => account.id === highlighted.accountId)
    : undefined;
  return (
    <View style={styles.list}>
      <View style={settingsStyles.card} testID="provider-accounts-list">
        {accounts.map((account, index) => (
          <AccountRow
            key={account.id}
            account={account}
            first={index === 0}
            divided={index > 0}
            highlighted={account.id === highlighted?.accountId}
            canManage={canManage}
            onSignInAgain={props.onSignInAgain}
          />
        ))}
      </View>
      {highlighted?.alreadyAdded && highlightedAccount ? (
        <Text style={styles.listHint} testID="provider-accounts-already-added">
          {t(`${KEY}.alreadyAdded`, {
            email: highlightedAccount.email ?? highlighted.email ?? t(`${KEY}.unknownEmail`),
          })}
        </Text>
      ) : null}
      {accounts.length === 1 ? (
        <Text style={styles.listHint} testID="provider-accounts-single">
          {t(`${KEY}.single`)}
        </Text>
      ) : null}
      {addButton}
    </View>
  );
}

interface AccountRowProps {
  account: ProviderAccount;
  first: boolean;
  divided: boolean;
  highlighted: boolean;
  canManage: boolean;
  onSignInAgain: (account: ProviderAccount) => void;
}

function AccountRow(props: AccountRowProps) {
  const { account, first, divided, highlighted, canManage, onSignInAgain } = props;
  const { t } = useTranslation();
  const { usage } = account;
  const signInAgain = useCallback(() => onSignInAgain(account), [account, onSignInAgain]);
  return (
    <View
      style={[
        styles.accountRow,
        divided && settingsStyles.rowBorder,
        highlighted && styles.accountRowHighlighted,
      ]}
      testID={`provider-account-${account.id}`}
    >
      <View style={styles.accountHeader}>
        <View style={styles.accountName}>
          <Text style={settingsStyles.rowTitle} numberOfLines={1}>
            {account.email ?? t(`${KEY}.unknownEmail`)}
          </Text>
          {account.plan ? <Text style={settingsStyles.rowHint}>{account.plan}</Text> : null}
        </View>
        <View style={styles.badges}>
          {account.signedIn ? (
            <StatusBadge size="xs" variant="success" label={t(`${KEY}.badges.inUse`)} />
          ) : null}
          {first ? <StatusBadge size="xs" label={t(`${KEY}.badges.first`)} /> : null}
          {account.needsSignIn ? (
            <StatusBadge size="xs" variant="error" label={t(`${KEY}.badges.needsSignIn`)} />
          ) : null}
        </View>
      </View>
      {account.needsSignIn ? (
        <View style={styles.needsSignIn} testID="provider-account-needs-sign-in">
          <Text style={[settingsStyles.rowHint, styles.needsSignInText]}>
            {t(`${KEY}.needsSignInHint`)}
          </Text>
          <Button
            variant="outline"
            size="sm"
            onPress={signInAgain}
            disabled={!canManage}
            testID="provider-account-sign-in-again"
          >
            {t(`${KEY}.signInAgain`)}
          </Button>
        </View>
      ) : null}
      {usage.status === "reading" ? (
        <Text style={settingsStyles.rowHint} testID="provider-account-usage-reading">
          {t(`${KEY}.usage.reading`)}
        </Text>
      ) : null}
      {usage.status === "failed" && !account.needsSignIn ? (
        <Text style={settingsStyles.rowHint} testID="provider-account-usage-failed">
          {t(`${KEY}.usage.failed`, { reason: usageFailure(t, usage) })}
        </Text>
      ) : null}
      {usage.status === "read" ? (
        <View testID="provider-account-usage">
          {usage.windows.map((window) => (
            <UsageWindowBar
              key={window.id}
              window={window}
              displayAs="used"
              pinnable={false}
              pinned={false}
              onTogglePin={noop}
              pinLabel=""
              pinTestID=""
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function noop(): void {}

const USAGE_FAILURE_CODES = new Set(["not_found", "not_read_yet", "rejected"]);

function usageFailure(
  t: TFunction,
  usage: Extract<ProviderAccount["usage"], { status: "failed" }>,
): string {
  if (usage.code && USAGE_FAILURE_CODES.has(usage.code)) {
    return t(`${KEY}.usage.reasons.${usage.code}`);
  }
  return usage.reason;
}

const styles = StyleSheet.create((theme) => ({
  notice: {
    marginBottom: theme.spacing[3],
  },
  list: {
    marginTop: theme.spacing[3],
    gap: theme.spacing[2],
  },
  listHint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  listError: {
    marginTop: theme.spacing[3],
    color: theme.colors.statusDanger,
    fontSize: theme.fontSize.sm,
  },
  accountRow: {
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    gap: theme.spacing[2],
  },
  accountRowHighlighted: {
    backgroundColor: theme.colors.surface2,
  },
  needsSignIn: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  needsSignInText: {
    flex: 1,
    minWidth: 160,
  },
  addRow: {
    flexDirection: "row",
  },
  accountHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  accountName: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  badges: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[1],
  },
  skeletonBody: {
    flex: 1,
    gap: theme.spacing[2],
  },
  skeletonBar: {
    height: 10,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface3,
  },
  skeletonTitle: {
    width: "40%",
  },
  skeletonMeter: {
    width: "80%",
  },
}));
