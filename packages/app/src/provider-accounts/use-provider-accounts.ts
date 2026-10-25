import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type {
  ProviderAccount,
  ProviderAccountBlock,
  ProviderAccountError,
  ProviderAccountSettings,
  ProviderAccountSwitch,
  ProviderAccountSwitchFailure,
} from "@getpaseo/protocol/provider-account/rpc-schemas";
import { useReplicaQuery } from "@/data/query";
import { extractFailureReason } from "@/price-table/pricing";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { toErrorMessage } from "@/utils/error-messages";

/** 「账号」一节要的那份状态：主机回的列表与设置。 */
export interface ProviderAccountsData {
  settings: ProviderAccountSettings;
  accounts: ProviderAccount[];
  blocked: ProviderAccountBlock | null;
  // 最近的换号，最新的在前；老 daemon 不发时为空。
  switches: ProviderAccountSwitch[];
  switchFailure: ProviderAccountSwitchFailure | null;
}

/** 正在进行的号操作：立即使用、移除某个号，或保存顺序。 */
export type AccountAction =
  | { kind: "use"; accountId: string }
  | { kind: "remove"; accountId: string }
  | { kind: "order" };

/** 号操作失败：留在原处，直到重试或做别的操作。 */
export interface AccountActionError {
  action: AccountAction;
  message: string;
}

export type ProviderAccountsLoad =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: ProviderAccountsData };

export interface UseProviderAccountsResult {
  // 主机声明了 accountRotation；没有时整节不出现。
  supported: boolean;
  load: ProviderAccountsLoad;
  canManage: boolean;
  // 保存中显示要改成的值；null 是没在保存。
  pendingRotation: boolean | null;
  // 开关保存失败的原因；留在原处，直到重试。
  rotationError: string | null;
  // 风险提示开着。
  confirmingRiskNotice: boolean;
  setRotation: (enabled: boolean) => void;
  confirmRiskNotice: () => void;
  cancelRiskNotice: () => void;
  pendingAction: AccountAction | null;
  actionError: AccountActionError | null;
  switchTo: (account: ProviderAccount) => void;
  removeAccount: (account: ProviderAccount) => void;
  setOrder: (accountIds: string[]) => void;
}

// 主机记进 switchFailure 的换号失败：在这一节顶上醒目地说，不在原处再说一遍。
const RECORDED_SWITCH_FAILURES = new Set(["write_failed", "needs_sign_in", "login_unsupported"]);

const CHANGED_EVENT = "provider.account.changed";

export function providerAccountsQueryKey(serverId: string, provider: string) {
  return ["provider-accounts", serverId, provider] as const;
}

export function useProviderAccounts(serverId: string, provider: string): UseProviderAccountsResult {
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  // COMPAT(accountRotation): added in v0.17.0, remove gate after 2027-04-25.
  const supported = useHostFeature(serverId, "accountRotation");
  const canManage = useSessionStore(
    (state) =>
      state.sessions[serverId]?.serverInfo?.permissions?.includes("daemon.manage") === true,
  );
  const queryClient = useQueryClient();
  const queryKey = providerAccountsQueryKey(serverId, provider);
  const query = useReplicaQuery<ProviderAccountsData>({
    queryKey,
    enabled: Boolean(client && isConnected && supported),
    pushEvent: CHANGED_EVENT,
    queryFn: async () => {
      if (!client) throw new Error("Not connected");
      const payload = await client.providerAccountList({ provider });
      if (payload.error) throw new Error(payload.error.message);
      return dataOf(payload);
    },
  });
  const [pendingRotation, setPendingRotation] = useState<boolean | null>(null);
  const [rotationError, setRotationError] = useState<string | null>(null);
  const [confirmingRiskNotice, setConfirmingRiskNotice] = useState(false);

  // 额度读完、别的设备改了开关：主机广播一次，这里重读。
  useEffect(() => {
    if (!client || !isConnected || !supported) return;
    const observation = client.observeEvents([CHANGED_EVENT]);
    observation.subscribe({
      snapshot: () => {},
      update: (message) => {
        if (message.type !== CHANGED_EVENT) return;
        void queryClient.invalidateQueries({ queryKey: ["provider-accounts", serverId] });
      },
    });
    return () => {
      void observation.release().catch(() => {
        /* The socket is gone; the daemon drops the subscription with it. */
      });
    };
  }, [client, isConnected, queryClient, serverId, supported]);

  const save = useCallback(
    (input: { enabled: boolean; acknowledgeRiskNotice: boolean }) => {
      setRotationError(null);
      setPendingRotation(input.enabled);
      void (async () => {
        try {
          if (!client) throw new Error("Not connected");
          const payload = await client.providerAccountSetRotation({
            provider,
            enabled: input.enabled,
            ...(input.acknowledgeRiskNotice ? { acknowledgeRiskNotice: true } : {}),
          });
          queryClient.setQueryData(providerAccountsQueryKey(serverId, provider), dataOf(payload));
          if (payload.error?.code === "risk_notice_required") {
            setConfirmingRiskNotice(true);
          } else if (payload.error) {
            setRotationError(payload.error.message);
          }
        } catch (cause) {
          // 主机拒绝时 message 后面跟着 requestType=… code=…，只留原因。
          setRotationError(extractFailureReason(cause) || toErrorMessage(cause));
        } finally {
          setPendingRotation(null);
        }
      })();
    },
    [client, provider, queryClient, serverId],
  );

  // 第一次为这家打开先问风险提示；看过的直接存。关掉不问。
  const setRotation = useCallback(
    (enabled: boolean) => {
      const seen = query.data?.settings.riskNoticeSeen === true;
      if (enabled && !seen) {
        setRotationError(null);
        setConfirmingRiskNotice(true);
        return;
      }
      save({ enabled, acknowledgeRiskNotice: false });
    },
    [query.data?.settings.riskNoticeSeen, save],
  );
  const confirmRiskNotice = useCallback(() => {
    setConfirmingRiskNotice(false);
    save({ enabled: true, acknowledgeRiskNotice: true });
  }, [save]);
  const cancelRiskNotice = useCallback(() => setConfirmingRiskNotice(false), []);

  const [pendingAction, setPendingAction] = useState<AccountAction | null>(null);
  const [actionError, setActionError] = useState<AccountActionError | null>(null);
  const run = useCallback(
    (input: { action: AccountAction; send: () => Promise<StatePayload> }) => {
      const { action } = input;
      setActionError(null);
      setPendingAction(action);
      void (async () => {
        try {
          const payload = await input.send();
          queryClient.setQueryData(providerAccountsQueryKey(serverId, provider), dataOf(payload));
          if (payload.error && !shownInSection({ action, error: payload.error })) {
            setActionError({ action, message: payload.error.message });
          }
        } catch (cause) {
          setActionError({ action, message: extractFailureReason(cause) || toErrorMessage(cause) });
          // 没拿到主机的状态：重读一次，先画上的新顺序回到主机上的。
          void queryClient.invalidateQueries({
            queryKey: providerAccountsQueryKey(serverId, provider),
          });
        } finally {
          setPendingAction(null);
        }
      })();
    },
    [provider, queryClient, serverId],
  );
  const switchTo = useCallback(
    (account: ProviderAccount) =>
      run({
        action: { kind: "use", accountId: account.id },
        send: () => connected(client).providerAccountUse({ provider, accountId: account.id }),
      }),
    [client, provider, run],
  );
  const removeAccount = useCallback(
    (account: ProviderAccount) =>
      run({
        action: { kind: "remove", accountId: account.id },
        send: () => connected(client).providerAccountRemove({ provider, accountId: account.id }),
      }),
    [client, provider, run],
  );
  const setOrder = useCallback(
    (accountIds: string[]) => {
      // 先按新顺序画，保存失败时由回复里的状态放回主机上的顺序。
      queryClient.setQueryData<ProviderAccountsData>(
        providerAccountsQueryKey(serverId, provider),
        (current) => (current ? reorder(current, accountIds) : current),
      );
      run({
        action: { kind: "order" },
        send: () => connected(client).providerAccountSetOrder({ provider, accountIds }),
      });
    },
    [client, provider, queryClient, run, serverId],
  );

  let load: ProviderAccountsLoad = { kind: "loading" };
  if (query.data) load = { kind: "ready", data: query.data };
  else if (query.isError) load = { kind: "error", message: toErrorMessage(query.error) };

  return {
    supported,
    load,
    canManage,
    pendingRotation,
    rotationError,
    confirmingRiskNotice,
    setRotation,
    confirmRiskNotice,
    cancelRiskNotice,
    pendingAction,
    actionError,
    switchTo,
    removeAccount,
    setOrder,
  };
}

type StatePayload = Omit<ProviderAccountsData, "switches" | "switchFailure"> & {
  switches?: ProviderAccountSwitch[];
  switchFailure?: ProviderAccountSwitchFailure | null;
  error: ProviderAccountError | null;
};

function connected<T>(client: T | null): T {
  if (!client) throw new Error("Not connected");
  return client;
}

function shownInSection(input: { action: AccountAction; error: ProviderAccountError }): boolean {
  return input.action.kind === "use" && RECORDED_SWITCH_FAILURES.has(input.error.code);
}

function reorder(data: ProviderAccountsData, accountIds: string[]): ProviderAccountsData {
  const byId = new Map(data.accounts.map((account) => [account.id, account]));
  const accounts = accountIds.flatMap((id) => byId.get(id) ?? []);
  return accounts.length === data.accounts.length ? { ...data, accounts } : data;
}

function dataOf(payload: Omit<StatePayload, "error">): ProviderAccountsData {
  return {
    settings: payload.settings,
    accounts: payload.accounts,
    blocked: payload.blocked,
    switches: payload.switches ?? [],
    switchFailure: payload.switchFailure ?? null,
  };
}
