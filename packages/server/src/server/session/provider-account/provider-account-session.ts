import type pino from "pino";
import type { SessionInboundMessage, SessionOutboundMessage } from "../../messages.js";
import { SignInPasteError } from "../../provider-accounts/codex-sign-in.js";
import {
  ProviderAccountRequestError,
  type ProviderAccountService,
  type ProviderAccountState,
} from "../../provider-accounts/service.js";
import {
  isAccountRotationProvider,
  type AccountRotationProvider,
  type ProviderAccountError,
  type ProviderAccountSignIn,
} from "@getpaseo/protocol/provider-account/rpc-schemas";

export interface ProviderAccountSessionHost {
  emit(msg: SessionOutboundMessage): void;
}

type StateRequest = Extract<
  SessionInboundMessage,
  {
    type:
      | "provider.account.list.request"
      | "provider.account.set_rotation.request"
      | "provider.account.use.request"
      | "provider.account.remove.request"
      | "provider.account.set_order.request"
      | "provider.account.set_limits.request"
      | "provider.account.set_keep_signed_in.request";
  }
>;
type SignInRequest = Extract<
  SessionInboundMessage,
  {
    type:
      | "provider.account.sign_in.start.request"
      | "provider.account.sign_in.get.request"
      | "provider.account.sign_in.cancel.request"
      | "provider.account.sign_in.submit.request";
  }
>;
export type ProviderAccountRequest = StateRequest | SignInRequest;

const PROVIDER_ACCOUNT_REQUESTS = new Set<string>([
  "provider.account.list.request",
  "provider.account.set_rotation.request",
  "provider.account.use.request",
  "provider.account.remove.request",
  "provider.account.set_order.request",
  "provider.account.set_limits.request",
  "provider.account.set_keep_signed_in.request",
  "provider.account.sign_in.start.request",
  "provider.account.sign_in.get.request",
  "provider.account.sign_in.cancel.request",
  "provider.account.sign_in.submit.request",
] satisfies ProviderAccountRequest["type"][]);

function isStateRequest(request: ProviderAccountRequest): request is StateRequest {
  return !request.type.startsWith("provider.account.sign_in.");
}

export function isProviderAccountRequest(
  msg: SessionInboundMessage,
): msg is ProviderAccountRequest {
  return PROVIDER_ACCOUNT_REQUESTS.has(msg.type);
}

const EMPTY_STATE: ProviderAccountState = {
  settings: { rotationEnabled: false, riskNoticeSeen: false },
  accounts: [],
  blocked: null,
};

/** 没有账号服务的 daemon 不声明 accountRotation，也就没有这一节的 RPC。 */
export function createProviderAccountSession(options: {
  host: ProviderAccountSessionHost;
  service: ProviderAccountService | undefined;
  logger: pino.Logger;
}): ProviderAccountSession | null {
  const { service } = options;
  if (!service) return null;
  return new ProviderAccountSession({ ...options, service });
}

/** 「账号」一节的 RPC；与 accountRotation 能力位同在。 */
export class ProviderAccountSession {
  constructor(
    private readonly options: {
      host: ProviderAccountSessionHost;
      service: ProviderAccountService;
      logger: pino.Logger;
    },
  ) {}

  async handle(request: ProviderAccountRequest): Promise<void> {
    if (!isStateRequest(request)) return this.handleSignIn(request);
    const { requestId, provider } = request;
    let state = EMPTY_STATE;
    let error: ProviderAccountError | null = null;
    try {
      if (!isAccountRotationProvider(provider)) {
        error = {
          code: "unsupported_provider",
          message: `${provider} has no account rotation`,
        };
      } else {
        state = await this.changeState({ request, provider });
      }
    } catch (cause) {
      error = this.failure({ cause, request });
      // 失败时也回现在的状态，客户端的开关回到主机上的值。
      if (isAccountRotationProvider(provider)) state = await this.currentState(provider);
    }
    const payload = { requestId, provider, ...state, error };
    switch (request.type) {
      case "provider.account.list.request":
        this.options.host.emit({ type: "provider.account.list.response", payload });
        return;
      case "provider.account.set_rotation.request":
        this.options.host.emit({ type: "provider.account.set_rotation.response", payload });
        return;
      case "provider.account.use.request":
        this.options.host.emit({ type: "provider.account.use.response", payload });
        return;
      case "provider.account.remove.request":
        this.options.host.emit({ type: "provider.account.remove.response", payload });
        return;
      case "provider.account.set_order.request":
        this.options.host.emit({ type: "provider.account.set_order.response", payload });
        return;
      case "provider.account.set_limits.request":
        this.options.host.emit({ type: "provider.account.set_limits.response", payload });
        return;
      case "provider.account.set_keep_signed_in.request":
        this.options.host.emit({ type: "provider.account.set_keep_signed_in.response", payload });
        return;
    }
  }

  private changeState(input: {
    request: StateRequest;
    provider: AccountRotationProvider;
  }): Promise<ProviderAccountState> {
    const { request, provider } = input;
    const { service } = this.options;
    switch (request.type) {
      case "provider.account.list.request":
        return service.list(provider);
      case "provider.account.set_rotation.request":
        return service.setRotation({
          provider,
          enabled: request.enabled,
          acknowledgeRiskNotice: request.acknowledgeRiskNotice === true,
        });
      case "provider.account.use.request":
        return service.useAccount({ provider, accountId: request.accountId });
      case "provider.account.remove.request":
        return service.removeAccount({ provider, accountId: request.accountId });
      case "provider.account.set_order.request":
        return service.setOrder({ provider, accountIds: request.accountIds });
      case "provider.account.set_limits.request":
        return service.setLimits({
          provider,
          accountId: request.accountId,
          limits: request.limits,
        });
      case "provider.account.set_keep_signed_in.request":
        return service.setKeepSignedIn({ provider, accountId: request.accountId });
    }
  }

  private async handleSignIn(request: SignInRequest): Promise<void> {
    const { service } = this.options;
    let signIn: ProviderAccountSignIn | null = null;
    let error: ProviderAccountError | null = null;
    try {
      switch (request.type) {
        case "provider.account.sign_in.start.request":
          if (!isAccountRotationProvider(request.provider)) {
            error = {
              code: "unsupported_provider",
              message: `${request.provider} has no account rotation`,
            };
          } else {
            signIn = await service.startSignIn({
              provider: request.provider,
              ...(request.accountId !== undefined ? { accountId: request.accountId } : {}),
            });
          }
          break;
        case "provider.account.sign_in.get.request":
          signIn = service.signIn(request.signInId);
          break;
        case "provider.account.sign_in.cancel.request":
          signIn = service.cancelSignIn(request.signInId);
          break;
        case "provider.account.sign_in.submit.request":
          signIn = await service.submitSignIn({
            signInId: request.signInId,
            callbackUrl: request.callbackUrl,
          });
          break;
      }
    } catch (cause) {
      if (cause instanceof SignInPasteError) {
        error = { code: cause.code, message: cause.message };
        // 粘贴的地址不能用，这次登录照旧等着：一起回它现在的样子。
        if (request.type === "provider.account.sign_in.submit.request") {
          signIn = service.signIn(request.signInId);
        }
      } else {
        error = this.failure({ cause, request });
      }
    }
    const payload = { requestId: request.requestId, signIn, error };
    switch (request.type) {
      case "provider.account.sign_in.start.request":
        this.options.host.emit({ type: "provider.account.sign_in.start.response", payload });
        return;
      case "provider.account.sign_in.get.request":
        this.options.host.emit({ type: "provider.account.sign_in.get.response", payload });
        return;
      case "provider.account.sign_in.cancel.request":
        this.options.host.emit({ type: "provider.account.sign_in.cancel.response", payload });
        return;
      case "provider.account.sign_in.submit.request":
        this.options.host.emit({ type: "provider.account.sign_in.submit.response", payload });
        return;
    }
  }

  private failure(input: {
    cause: unknown;
    request: ProviderAccountRequest;
  }): ProviderAccountError {
    const { cause, request } = input;
    if (cause instanceof ProviderAccountRequestError) {
      return { code: cause.code, message: cause.message };
    }
    this.options.logger.warn({ err: cause, type: request.type }, "Provider account request failed");
    const message = cause instanceof Error ? cause.message : String(cause);
    return { code: "failed", message };
  }

  private async currentState(provider: AccountRotationProvider): Promise<ProviderAccountState> {
    try {
      return await this.options.service.list(provider);
    } catch (error) {
      // 回复里已带着这次的失败原因；状态也读不到时开关照空状态显示（关着）。
      this.options.logger.warn({ err: error, provider }, "Provider account state can't be read");
      return EMPTY_STATE;
    }
  }
}
