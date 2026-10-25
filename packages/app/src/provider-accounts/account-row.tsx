import React, { useCallback, useMemo } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ArrowRightLeft, GripVertical, Star, Trash2 } from "lucide-react-native";
import type { ProviderAccount } from "@getpaseo/protocol/provider-account/rpc-schemas";
import { OrderMenuItems, sortableRowStyles } from "@/api-endpoints/order-menu-items";
import type { SortableEndpointRowInfo } from "@/api-endpoints/sortable-endpoint-rows.types";
import type { RowMoves, RowPlace } from "@/api-endpoints/sortable-order";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { RowActionsMenuTrigger } from "@/components/ui/row-actions-menu-trigger";
import { StatusBadge } from "@/components/ui/status-badge";
import { settingsStyles } from "@/styles/settings";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { UsageWindowBar } from "@/usage/window-bar";

/*
 * 账号列表的一行：邮箱、套餐、状态标签、各窗口用量，行尾 ⋯ 菜单（立即使用、设为第一、上移、下移、移到最前、
 * 移到最后、移除）；网页与桌面端可拖动行首把手排序（与第三方接口列表同一套，sortable-endpoint-rows）。
 */

const KEY = "settings.providers.accounts";

const ThemedGripVertical = withUnistyles(GripVertical);
const ThemedArrowRightLeft = withUnistyles(ArrowRightLeft);
const ThemedStar = withUnistyles(Star);
const ThemedTrash2 = withUnistyles(Trash2);
const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const dangerColorMapping = (theme: Theme) => ({ color: theme.colors.statusDanger });

export type AccountRowActivity = "switching" | "removing" | null;

export interface AccountRowProps {
  account: ProviderAccount;
  row: SortableEndpointRowInfo<ProviderAccount>;
  divided: boolean;
  highlighted: boolean;
  // 能管理主机时才有 ⋯ 菜单；只读设备只看。
  canManage: boolean;
  // 别的操作进行中或这一节停着：菜单里的项都不能点。
  locked: boolean;
  moves: RowMoves;
  activity: AccountRowActivity;
  // 这一行上次操作失败的原因（立即使用、移除）。
  error: string | null;
  onUse: (account: ProviderAccount) => void;
  onRemove: (account: ProviderAccount) => void;
  onArrange: (account: ProviderAccount, place: RowPlace) => void;
  onSignInAgain: (account: ProviderAccount) => void;
}

export function AccountRow(props: AccountRowProps) {
  const { account, row, divided, highlighted, canManage, activity, error } = props;
  const { t } = useTranslation();
  const { onSignInAgain } = props;
  const signInAgain = useCallback(() => onSignInAgain(account), [account, onSignInAgain]);
  const first = row.index === 0;
  return (
    <View
      style={[
        styles.accountRow,
        divided && settingsStyles.rowBorder,
        highlighted && styles.accountRowHighlighted,
        row.isDragging && sortableRowStyles.dragging,
      ]}
      testID={rowTestId(row, account)}
    >
      {row.isPlaceholder ? <View style={sortableRowStyles.dropSlot} pointerEvents="none" /> : null}
      <View style={[styles.rowBody, row.isPlaceholder && styles.hidden]}>
        <View style={styles.accountHeader}>
          {row.hasHandle
            ? row.wrapHandle(
                <View style={styles.handle}>
                  <ThemedGripVertical size={ICON_SIZE.sm} uniProps={foregroundMutedColorMapping} />
                </View>,
              )
            : null}
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
          {canManage ? <AccountRowMenu {...props} first={first} /> : null}
        </View>
        {activity ? (
          <Text style={settingsStyles.rowHint} testID="provider-account-activity">
            {t(activity === "switching" ? `${KEY}.switching` : `${KEY}.removing`)}
          </Text>
        ) : null}
        {error ? (
          <Text style={settingsStyles.rowError} testID="provider-account-error">
            {error}
          </Text>
        ) : null}
        <AccountRowDetails account={account} canManage={canManage} onSignInAgain={signInAgain} />
      </View>
    </View>
  );
}

/** 行的下半：登录失效时的「重新登录」，各窗口的用量（读取中、读不到、读到了）。 */
function AccountRowDetails({
  account,
  canManage,
  onSignInAgain,
}: {
  account: ProviderAccount;
  canManage: boolean;
  onSignInAgain: () => void;
}) {
  const { t } = useTranslation();
  const { usage } = account;
  return (
    <>
      {account.needsSignIn ? (
        <View style={styles.needsSignIn} testID="provider-account-needs-sign-in">
          <Text style={[settingsStyles.rowHint, styles.needsSignInText]}>
            {t(`${KEY}.needsSignInHint`)}
          </Text>
          <Button
            variant="outline"
            size="sm"
            onPress={onSignInAgain}
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
    </>
  );
}

/** 行菜单；窄屏是底部弹层。桌面端右键行也打开它。 */
function AccountRowMenu(props: AccountRowProps & { first: boolean }) {
  const { account, row, locked, moves, first, onUse, onRemove, onArrange } = props;
  const { t } = useTranslation();
  const name = account.email ?? t(`${KEY}.unknownEmail`);
  const label = t(`${KEY}.menu.label`, { email: name });
  const useLeading = useMemo(
    () => <ThemedArrowRightLeft size={ICON_SIZE.md} uniProps={foregroundMutedColorMapping} />,
    [],
  );
  const firstLeading = useMemo(
    () => <ThemedStar size={ICON_SIZE.md} uniProps={foregroundMutedColorMapping} />,
    [],
  );
  const removeLeading = useMemo(
    () => <ThemedTrash2 size={ICON_SIZE.md} uniProps={dangerColorMapping} />,
    [],
  );
  const handleUse = useCallback(() => onUse(account), [account, onUse]);
  const handleFirst = useCallback(() => onArrange(account, "top"), [account, onArrange]);
  const handleRemove = useCallback(() => onRemove(account), [account, onRemove]);
  const handleArrange = useCallback(
    (place: RowPlace) => onArrange(account, place),
    [account, onArrange],
  );
  const orderLabels = useMemo(
    () => ({
      up: t(`${KEY}.menu.moveUp`),
      down: t(`${KEY}.menu.moveDown`),
      top: t(`${KEY}.menu.moveToTop`),
      bottom: t(`${KEY}.menu.moveToBottom`),
    }),
    [t],
  );
  // 已经在用、需要重新登录的号不能「立即使用」。
  const canUse = !locked && !account.signedIn && !account.needsSignIn;
  return (
    <DropdownMenu compactMode="sheet" open={row.isMenuOpen} onOpenChange={row.onMenuOpenChange}>
      <RowActionsMenuTrigger
        accessibilityLabel={label}
        testID={`provider-account-menu-${account.id}`}
      />
      <DropdownMenuContent align="end" width={240} sheetTitle={label}>
        <DropdownMenuItem
          leading={useLeading}
          disabled={!canUse}
          onSelect={handleUse}
          testID="provider-account-use"
        >
          {t(`${KEY}.menu.useNow`)}
        </DropdownMenuItem>
        <DropdownMenuItem
          leading={firstLeading}
          disabled={locked || first}
          onSelect={handleFirst}
          testID="provider-account-make-first"
        >
          {t(`${KEY}.menu.makeFirst`)}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <OrderMenuItems
          moves={locked ? NO_MOVES : moves}
          labels={orderLabels}
          onArrange={handleArrange}
          testIdPrefix="provider-account-order-"
        />
        <DropdownMenuSeparator />
        <DropdownMenuItem
          destructive
          leading={removeLeading}
          disabled={locked}
          onSelect={handleRemove}
          testID="provider-account-remove"
        >
          {t(`${KEY}.menu.remove`)}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const NO_MOVES: RowMoves = { top: false, up: false, down: false, bottom: false };

function rowTestId(row: SortableEndpointRowInfo<ProviderAccount>, account: ProviderAccount) {
  if (row.isDragging) return "provider-account-row-dragging";
  if (row.isPlaceholder) return "provider-account-row-drop-slot";
  return `provider-account-${account.id}`;
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
  accountRow: {
    position: "relative",
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
  },
  rowBody: {
    gap: theme.spacing[2],
  },
  hidden: {
    opacity: 0,
  },
  accountRowHighlighted: {
    backgroundColor: theme.colors.surface2,
  },
  handle: {
    width: 16,
    alignItems: "center",
    justifyContent: "center",
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
}));
