import type pino from "pino";
import type { SessionInboundMessage, SessionOutboundMessage } from "../../messages.js";
import {
  ProviderAccountRequestError,
  type ProviderAccountService,
  type ProviderAccountState,
} from "../../provider-accounts/service.js";
import {
  isAccountRotationProvider,
  type AccountRotationProvider,
  type ProviderAccountError,
} from "@getpaseo/protocol/provider-account/rpc-schemas";

export interface ProviderAccountSessionHost {
  emit(msg: SessionOutboundMessage): void;
}

type ListRequest = Extract<SessionInboundMessage, { type: "provider.account.list.request" }>;
type SetRotationRequest = Extract<
  SessionInboundMessage,
  { type: "provider.account.set_rotation.request" }
>;
export type ProviderAccountRequest = ListRequest | SetRotationRequest;

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
    const { requestId, provider } = request;
    let state = EMPTY_STATE;
    let error: ProviderAccountError | null = null;
    try {
      if (!isAccountRotationProvider(provider)) {
        error = {
          code: "unsupported_provider",
          message: `${provider} has no account rotation`,
        };
      } else if (request.type === "provider.account.list.request") {
        state = await this.options.service.list(provider);
      } else {
        state = await this.options.service.setRotation({
          provider,
          enabled: request.enabled,
          acknowledgeRiskNotice: request.acknowledgeRiskNotice === true,
        });
      }
    } catch (cause) {
      error = this.failure({ cause, request });
      // 失败时也回现在的状态，客户端的开关回到主机上的值。
      if (isAccountRotationProvider(provider)) state = await this.currentState(provider);
    }
    const payload = { requestId, provider, ...state, error };
    if (request.type === "provider.account.list.request") {
      this.options.host.emit({ type: "provider.account.list.response", payload });
    } else {
      this.options.host.emit({ type: "provider.account.set_rotation.response", payload });
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
    this.options.logger.warn(
      { err: cause, provider: request.provider, type: request.type },
      "Provider account request failed",
    );
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
