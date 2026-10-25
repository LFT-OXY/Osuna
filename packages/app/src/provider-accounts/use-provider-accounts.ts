import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type {
  ProviderAccount,
  ProviderAccountBlock,
  ProviderAccountSettings,
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
}

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
  };
}

function dataOf(payload: ProviderAccountsData): ProviderAccountsData {
  return { settings: payload.settings, accounts: payload.accounts, blocked: payload.blocked };
}
