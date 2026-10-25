import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ProviderAccountError,
  ProviderAccountSignIn,
} from "@getpaseo/protocol/provider-account/rpc-schemas";
import { extractFailureReason } from "@/price-table/pricing";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { toErrorMessage } from "@/utils/error-messages";
import { openExternalUrl } from "@/utils/open-external-url";

/*
 * 加号与重新登录对话框的状态：开始、等浏览器、粘贴地址、失败后重试。登录在主机上跑，
 * 状态变化经 provider.account.changed 广播，这里收到就重读这次登录。
 */

/** 粘贴地址那一栏：提交中，或上次提交被拒的原因（paste_invalid、paste_mismatch、not_waiting 或别的）。 */
export interface PasteState {
  submitting: boolean;
  error: ProviderAccountError | null;
}

export type AccountSignInView =
  | { kind: "closed" }
  | { kind: "starting"; accountId?: string; email?: string }
  | { kind: "start_failed"; accountId?: string; email?: string; message: string }
  | { kind: "active"; email?: string; signIn: ProviderAccountSignIn; paste: PasteState };

/** 刚加上或更新的号（主机回的完成结果）：列表里高亮它，已有的号多一句「已经有这个号」。 */
export type SignedInAccount = Extract<ProviderAccountSignIn, { status: "done" }>["result"];

export interface UseAccountSignInResult {
  view: AccountSignInView;
  start: (target?: { accountId: string; email?: string }) => void;
  retry: () => void;
  close: () => void;
  submitPaste: (pasted: string) => void;
  openSignInPage: () => void;
}

/**
 * 这台设备要打开的登录页。Claude Code 的号不在主机前（或 Claude Code 没打开页面）时打开它打印的那个：
 * 登录完显示一段代码，粘回来完成；别的都打开 authUrl。
 */
export function signInLink(input: { signIn: ProviderAccountSignIn; isLocalHost: boolean }): string {
  const { signIn, isLocalHost } = input;
  if (signIn.provider === "claude" && (!isLocalHost || signIn.callbackBlocked)) {
    return signIn.codeUrl ?? signIn.authUrl;
  }
  return signIn.authUrl;
}

const CHANGED_EVENT = "provider.account.changed";
const IDLE_PASTE: PasteState = { submitting: false, error: null };

function failureReason(cause: unknown): string {
  // 主机拒绝时 message 后面跟着 requestType=… code=…，只留原因。
  return extractFailureReason(cause) || toErrorMessage(cause);
}

export function useAccountSignIn(input: {
  serverId: string;
  provider: string;
  // 主机就是这台电脑：开始后直接打开浏览器。
  isLocalHost: boolean;
  onSignedIn: (account: SignedInAccount) => void;
}): UseAccountSignInResult {
  const { serverId, provider, isLocalHost, onSignedIn } = input;
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const [view, setView] = useState<AccountSignInView>({ kind: "closed" });
  const viewRef = useRef(view);
  viewRef.current = view;
  const onSignedInRef = useRef(onSignedIn);
  onSignedInRef.current = onSignedIn;

  const show = useCallback((signIn: ProviderAccountSignIn | null, email?: string) => {
    if (!signIn) return;
    const current = viewRef.current;
    // 对话框已关或换成了别的一次登录：这份回复作废。
    if (current.kind === "closed") return;
    if (current.kind === "active" && current.signIn.id !== signIn.id) return;
    if (signIn.status === "done") {
      setView({ kind: "closed" });
      onSignedInRef.current(signIn.result);
      return;
    }
    const paste = current.kind === "active" ? current.paste : IDLE_PASTE;
    setView({ kind: "active", signIn, paste, ...(email ? { email } : {}) });
  }, []);

  const start = useCallback(
    (target?: { accountId: string; email?: string }) => {
      const base = {
        ...(target?.accountId ? { accountId: target.accountId } : {}),
        ...(target?.email ? { email: target.email } : {}),
      };
      setView({ kind: "starting", ...base });
      void (async () => {
        try {
          if (!client) throw new Error("Not connected");
          const payload = await client.providerAccountSignInStart({
            provider,
            ...(target?.accountId ? { accountId: target.accountId } : {}),
          });
          if (viewRef.current.kind !== "starting") return;
          if (payload.error || !payload.signIn) {
            setView({
              kind: "start_failed",
              ...base,
              message: payload.error?.message ?? "The sign-in didn't start",
            });
            return;
          }
          const signIn = payload.signIn;
          setView({
            kind: "active",
            signIn,
            paste: IDLE_PASTE,
            ...(target?.email ? { email: target.email } : {}),
          });
          if (isLocalHost && !signIn.callbackBlocked) void openExternalUrl(signIn.authUrl);
        } catch (cause) {
          if (viewRef.current.kind !== "starting") return;
          setView({
            kind: "start_failed",
            ...base,
            message: failureReason(cause),
          });
        }
      })();
    },
    [client, isLocalHost, provider],
  );

  const retry = useCallback(() => {
    const current = viewRef.current;
    let accountId: string | undefined;
    if (current.kind === "active") accountId = current.signIn.accountId;
    else if (current.kind !== "closed") accountId = current.accountId;
    const email = current.kind === "closed" ? undefined : current.email;
    start(accountId ? { accountId, ...(email ? { email } : {}) } : undefined);
  }, [start]);

  const close = useCallback(() => {
    const current = viewRef.current;
    setView({ kind: "closed" });
    if (current.kind === "active" && current.signIn.status === "waiting" && client) {
      void client.providerAccountSignInCancel({ signInId: current.signIn.id }).catch(() => {
        /* 主机上的登录 10 分钟后自己超时。 */
      });
    }
  }, [client]);

  const submitPaste = useCallback(
    (pasted: string) => {
      const current = viewRef.current;
      if (current.kind !== "active" || !client) return;
      const signInId = current.signIn.id;
      const settlePaste = (error: ProviderAccountError | null) =>
        setView((latest) =>
          latest.kind === "active" && latest.signIn.id === signInId
            ? { ...latest, paste: { submitting: false, error } }
            : latest,
        );
      setView({ ...current, paste: { submitting: true, error: null } });
      void (async () => {
        try {
          // Claude Code 粘的是登录页显示的代码，Codex 是浏览器最后跳到的地址。
          const payload = await client.providerAccountSignInSubmit(
            current.signIn.provider === "claude"
              ? { signInId, code: pasted }
              : { signInId, callbackUrl: pasted },
          );
          show(payload.signIn, current.email);
          settlePaste(payload.error);
        } catch (cause) {
          settlePaste({ code: "failed", message: failureReason(cause) });
        }
      })();
    },
    [client, show],
  );

  const openSignInPage = useCallback(() => {
    const current = viewRef.current;
    if (current.kind === "active") {
      void openExternalUrl(signInLink({ signIn: current.signIn, isLocalHost }));
    }
  }, [isLocalHost]);

  const refresh = useCallback(
    async (signInId: string) => {
      if (!client) return;
      try {
        const payload = await client.providerAccountSignInGet({ signInId });
        const current = viewRef.current;
        show(payload.signIn, current.kind === "active" ? current.email : undefined);
      } catch {
        /* 下一次广播再读。 */
      }
    },
    [client, show],
  );

  // 浏览器回到主机、超时：主机广播一次，这里重读这次登录。
  const activeId =
    view.kind === "active" && view.signIn.status === "waiting" ? view.signIn.id : null;
  useEffect(() => {
    if (!client || !isConnected || !activeId) return;
    const observation = client.observeEvents([CHANGED_EVENT]);
    observation.subscribe({
      snapshot: () => {},
      update: (message) => {
        if (message.type !== CHANGED_EVENT) return;
        void refresh(activeId);
      },
    });
    return () => {
      void observation.release().catch(() => {
        /* The socket is gone; the daemon drops the subscription with it. */
      });
    };
  }, [activeId, client, isConnected, refresh]);

  return { view, start, retry, close, submitPaste, openSignInPage };
}
