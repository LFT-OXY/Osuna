import React, { useCallback, useMemo } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Plus } from "lucide-react-native";
import type {
  AccountRotationProvider,
  ProviderAccount,
  ProviderAccountBlock,
  ProviderAccountSwitchFailure,
} from "@getpaseo/protocol/provider-account/rpc-schemas";
import { SortableEndpointRows } from "@/api-endpoints/sortable-endpoint-rows";
import type { SortableEndpointRowInfo } from "@/api-endpoints/sortable-endpoint-rows.types";
import { arrangeIds, rowMoves, type RowPlace } from "@/api-endpoints/sortable-order";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  SelectField,
  type SelectFieldDisplay,
  type SelectFieldOption,
} from "@/components/ui/select-field";
import { Switch } from "@/components/ui/switch";
import { useIsCompactFormFactor } from "@/constants/layout";
import { settingsStyles } from "@/styles/settings";
import { AccountRow, type AccountRowActivity } from "./account-row";
import { SwitchLog } from "./switch-log";
import type { SignedInAccount } from "./use-account-sign-in";
import type {
  AccountAction,
  AccountActionError,
  ProviderAccountsData,
  ProviderAccountsLoad,
} from "./use-provider-accounts";

/*
 * Codex / Claude Code 提供方页的「账号」一节，从上到下：说明行（总开关关着、登录换不了、Claude Code 走第三方接口、换号失败）、
 * 「多号自动轮换」开关、「固定登录到」、账号列表（行菜单与拖动排序）、「添加账号」、「最近换号」。纯 props，运行时接线在 view.tsx。
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
  pendingAction: AccountAction | null;
  actionError: AccountActionError | null;
  onUseAccount: (account: ProviderAccount) => void;
  onRemoveAccount: (account: ProviderAccount) => void;
  onSetOrder: (accountIds: string[]) => void;
  onSetLimits: (account: ProviderAccount) => void;
  onSetKeepSignedIn: (accountId: string | null) => void;
  onSetSwitchOnly: (enabled: boolean) => void;
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
      {data?.throughEndpoints ? (
        <View style={styles.notice}>
          <Alert
            size="sm"
            variant="info"
            description={t(`${KEY}.throughEndpoints`)}
            testID="provider-accounts-through-endpoints"
          />
        </View>
      ) : null}
      {data?.switchFailure ? (
        <SwitchFailureNotice failure={data.switchFailure} providerLabel={providerLabel} />
      ) : null}
      <View style={settingsStyles.card}>
        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>{t(`${KEY}.rotate.title`)}</Text>
            <Text style={settingsStyles.rowHint} testID="provider-accounts-rotate-hint">
              {rotateHint({ t, provider, switchOnly: data?.settings.switchOnly === true })}
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
        {provider === "codex" ? (
          <SwitchOnlyRow
            data={data}
            canManage={canManage}
            pendingAction={props.pendingAction}
            actionError={props.actionError}
            onChange={props.onSetSwitchOnly}
          />
        ) : null}
        <KeepSignedInRow
          data={data}
          canManage={canManage}
          pendingAction={props.pendingAction}
          actionError={props.actionError}
          onChange={props.onSetKeepSignedIn}
        />
      </View>
      <AccountList
        load={load}
        providerLabel={providerLabel}
        rotationOn={savedValue}
        canManage={canManage}
        onAddAccount={blocked ? undefined : props.onAddAccount}
        onSignInAgain={props.onSignInAgain}
        highlighted={props.highlighted}
        locked={blocked !== null || props.pendingAction !== null}
        pendingAction={props.pendingAction}
        actionError={props.actionError}
        onUseAccount={props.onUseAccount}
        onRemoveAccount={props.onRemoveAccount}
        onSetOrder={props.onSetOrder}
        onSetLimits={props.onSetLimits}
      />
      {data ? <SwitchLog switches={data.switches} /> : null}
    </SettingsSection>
  );
}

/**
 * Codex 的「只换登录」：关着时 Codex 的请求经过 Osuna，当前号接不了的交给下一个号；打开后直连 OpenAI，
 * 只换登录。保存中显示要改成的值，失败的原因留在原处。
 */
function SwitchOnlyRow(props: {
  data: ProviderAccountsData | null;
  canManage: boolean;
  pendingAction: AccountAction | null;
  actionError: AccountActionError | null;
  onChange: (enabled: boolean) => void;
}) {
  const { data, canManage, pendingAction, actionError, onChange } = props;
  const { t } = useTranslation();
  const pending = pendingAction?.kind === "switchOnly" ? pendingAction.enabled : null;
  const value = pending ?? data?.settings.switchOnly === true;
  const disabled = data === null || !canManage || data.blocked !== null || pendingAction !== null;
  const error = actionError?.action.kind === "switchOnly" ? actionError.message : null;
  return (
    <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{t(`${KEY}.switchOnly.title`)}</Text>
        <Text style={settingsStyles.rowHint} testID="provider-accounts-switch-only-hint">
          {t(`${KEY}.switchOnly.hint`)}
        </Text>
        {error ? (
          <Text style={settingsStyles.rowError} testID="provider-accounts-switch-only-error">
            {t(`${KEY}.switchOnly.saveFailed`, { reason: error })}
          </Text>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        accessibilityLabel={t(`${KEY}.switchOnly.title`)}
        testID="provider-accounts-switch-only-switch"
      />
    </View>
  );
}

// 「不固定」在下拉里的 id：号的 id 不会是空串。
const NOT_KEPT = "";

/** 「固定登录到」：不固定，或某个号；固定后完全不自动换。还没有号时不出现。 */
function KeepSignedInRow(props: {
  data: ProviderAccountsData | null;
  canManage: boolean;
  pendingAction: AccountAction | null;
  actionError: AccountActionError | null;
  onChange: (accountId: string | null) => void;
}) {
  const { data, canManage, pendingAction, actionError, onChange } = props;
  const accounts = data?.accounts ?? NO_ACCOUNTS;
  const keptId = data?.settings.keepSignedInTo ?? null;
  const disabled = !canManage || data?.blocked != null || pendingAction !== null;
  const saving = pendingAction?.kind === "keep";
  const error = actionError?.action.kind === "keep" ? actionError.message : null;
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const notKept = t(`${KEY}.keep.none`);
  const emailOf = useCallback(
    (account: ProviderAccount) => account.email ?? t(`${KEY}.unknownEmail`),
    [t],
  );
  const options = useMemo<SelectFieldOption<string>[]>(
    () => [
      { id: NOT_KEPT, value: NOT_KEPT, label: notKept, testID: "provider-accounts-keep-none" },
      ...accounts.map((account) => ({
        id: account.id,
        value: account.id,
        label: emailOf(account),
        testID: `provider-accounts-keep-${account.id}`,
      })),
    ],
    [accounts, emailOf, notKept],
  );
  const kept = accounts.find((account) => account.id === keptId);
  const selectedDisplay = useMemo<SelectFieldDisplay>(
    () => ({ label: kept ? emailOf(kept) : notKept }),
    [emailOf, kept, notKept],
  );
  const change = useCallback(
    (value: string) => {
      const next = value === NOT_KEPT ? null : value;
      if (next !== keptId) onChange(next);
    },
    [keptId, onChange],
  );
  const title = t(`${KEY}.keep.title`);
  if (accounts.length === 0) return null;
  return (
    <View style={[settingsStyles.row, settingsStyles.rowBorder, isCompact && styles.rowStacked]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{title}</Text>
        <Text style={settingsStyles.rowHint}>{t(`${KEY}.keep.hint`)}</Text>
        {error ? (
          <Text style={settingsStyles.rowError} testID="provider-accounts-keep-error">
            {t(`${KEY}.keep.saveFailed`, { reason: error })}
          </Text>
        ) : null}
      </View>
      <View style={isCompact ? styles.selectStacked : styles.select}>
        <SelectField
          field={false}
          label={title}
          value={keptId ?? NOT_KEPT}
          selectedDisplay={selectedDisplay}
          options={options}
          onChange={change}
          placeholder={notKept}
          emptyText={notKept}
          title={title}
          size={isCompact ? "md" : "sm"}
          loading={saving}
          disabled={disabled}
          testID="provider-accounts-keep"
          triggerTestID="provider-accounts-keep-trigger"
        />
      </View>
    </View>
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

const SWITCH_FAILURE_CODES = new Set([
  "write_failed",
  "login_unsupported",
  "needs_sign_in",
  "no_account",
]);

/** 换号没换成：醒目地写原因和处理办法，下一次换成后主机清掉它。 */
function SwitchFailureNotice({
  failure,
  providerLabel,
}: {
  failure: ProviderAccountSwitchFailure;
  providerLabel: string;
}) {
  const { t } = useTranslation();
  const known = SWITCH_FAILURE_CODES.has(failure.code);
  const email = failure.to?.email ?? t(`${KEY}.unknownEmail`);
  return (
    <View style={styles.notice}>
      <Alert
        size="sm"
        variant="error"
        title={t(`${KEY}.switchFailure.title`)}
        description={t(`${KEY}.switchFailure.${known ? failure.code : "other"}`, {
          email,
          name: providerLabel,
          reason: failure.message,
        })}
        testID="provider-accounts-switch-failure"
      />
    </View>
  );
}

/** 开关下的说明行；Claude Code 换成说明开着的会话可能跟着换号的那句，Codex 没开「只换登录」时多一句请求经过 Osuna。 */
function rotateHint(input: {
  t: TFunction;
  provider: AccountRotationProvider;
  switchOnly: boolean;
}): string {
  const { t } = input;
  if (input.provider === "claude") return t(`${KEY}.rotate.claudeHint`);
  const hint = t(`${KEY}.rotate.hint`);
  if (input.provider !== "codex" || input.switchOnly) return hint;
  return t(`${KEY}.rotate.hintWithCodex`, { hint, codexHint: t(`${KEY}.rotate.codexHint`) });
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
  locked: boolean;
  pendingAction: AccountAction | null;
  actionError: AccountActionError | null;
  onUseAccount: (account: ProviderAccount) => void;
  onRemoveAccount: (account: ProviderAccount) => void;
  onSetOrder: (accountIds: string[]) => void;
  onSetLimits: (account: ProviderAccount) => void;
}

function AccountList(props: AccountListProps) {
  const { load, providerLabel, rotationOn, canManage, onAddAccount, highlighted } = props;
  const { locked, pendingAction, actionError, onSetOrder } = props;
  const { t } = useTranslation();
  const accounts = load.kind === "ready" ? load.data.accounts : NO_ACCOUNTS;
  const ids = useMemo(() => accounts.map((account) => account.id), [accounts]);
  const arrange = useCallback(
    (account: ProviderAccount, place: RowPlace) => {
      if (locked) return;
      const next = arrangeIds({ group: ids, id: account.id, place, shown: null });
      if (next) onSetOrder(next);
    },
    [ids, locked, onSetOrder],
  );
  const renderRow = useCallback(
    (row: SortableEndpointRowInfo<ProviderAccount>) => (
      <AccountRow
        account={row.endpoint}
        row={row}
        divided={row.index > 0}
        highlighted={row.endpoint.id === highlighted?.accountId}
        canManage={canManage}
        locked={locked}
        moves={rowMoves({ group: ids, id: row.endpoint.id, shown: null })}
        activity={activityOf(pendingAction, row.endpoint.id)}
        error={rowError(actionError, row.endpoint.id)}
        onUse={props.onUseAccount}
        onRemove={props.onRemoveAccount}
        onSetLimits={props.onSetLimits}
        onArrange={arrange}
        onSignInAgain={props.onSignInAgain}
      />
    ),
    [
      actionError,
      arrange,
      canManage,
      highlighted?.accountId,
      ids,
      locked,
      pendingAction,
      props.onRemoveAccount,
      props.onSetLimits,
      props.onSignInAgain,
      props.onUseAccount,
    ],
  );
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
        <SortableEndpointRows
          endpoints={accounts}
          isSortable={canManage && !locked && accounts.length > 1}
          renderRow={renderRow}
          onMove={arrange}
          rowTestIdPrefix="provider-account-"
          hint={t(`${KEY}.orderHint`)}
        />
      </View>
      {actionError?.action.kind === "order" ? (
        <Text style={styles.listError} testID="provider-accounts-order-error">
          {t(`${KEY}.orderFailed`, { reason: actionError.message })}
        </Text>
      ) : null}
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

const NO_ACCOUNTS: ProviderAccount[] = [];

function activityOf(action: AccountAction | null, accountId: string): AccountRowActivity {
  if (action?.kind === "use" && action.accountId === accountId) return "switching";
  if (action?.kind === "remove" && action.accountId === accountId) return "removing";
  return null;
}

/** 立即使用、移除失败写在那一行；设上限的失败留在对话框里。 */
function rowError(error: AccountActionError | null, accountId: string): string | null {
  if (!error) return null;
  const { action } = error;
  if (action.kind !== "use" && action.kind !== "remove") return null;
  return action.accountId === accountId ? error.message : null;
}

const styles = StyleSheet.create((theme) => ({
  notice: {
    marginBottom: theme.spacing[3],
  },
  select: {
    width: 260,
    flexShrink: 1,
  },
  // 窄窗口：下拉放到说明下面、占满整行，标题和说明不被挤断。
  rowStacked: {
    flexDirection: "column",
    alignItems: "stretch",
    gap: theme.spacing[2],
  },
  selectStacked: {
    width: "100%",
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
  addRow: {
    flexDirection: "row",
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
