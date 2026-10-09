import type { Page } from "@playwright/test";
import type { ProviderUsage } from "@osuna/protocol/messages";
import { daemonWsRoutePattern } from "./daemon-port";

interface ProviderUsageFixturePayload {
  fetchedAt: string;
  providers: ProviderUsage[];
}

/** 以 `rpc_error` 应答，和 daemon 取数失败时一样。 */
interface ProviderUsageFixtureFailure {
  rpcError: string;
}

type ProviderUsageFixtureAnswer = ProviderUsageFixturePayload | ProviderUsageFixtureFailure;

interface ProviderUsageFixtureOptions {
  /** `false` 表示主机没有 `features.providerUsageList`；默认 `true`。 */
  supported?: boolean;
}

export interface ProviderUsageFixture {
  requestCount(): number;
  waitForRequestCount(count: number): Promise<void>;
}

type WebSocketMessage = string | Buffer;

function parseJson(message: WebSocketMessage): unknown {
  const raw = typeof message === "string" ? message : message.toString("utf8");
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function getSessionMessage(message: WebSocketMessage): Record<string, unknown> | null {
  const envelope = parseJson(message);
  if (!envelope || typeof envelope !== "object") {
    return null;
  }
  const maybeEnvelope = envelope as { type?: unknown; message?: unknown };
  if (maybeEnvelope.type !== "session" || !maybeEnvelope.message) {
    return null;
  }
  if (typeof maybeEnvelope.message !== "object") {
    return null;
  }
  return maybeEnvelope.message as Record<string, unknown>;
}

function withProviderUsageFeature(input: {
  message: WebSocketMessage;
  supported: boolean;
}): string | null {
  const { message, supported } = input;
  const envelope = parseJson(message);
  if (!envelope || typeof envelope !== "object") {
    return null;
  }
  const maybeEnvelope = envelope as {
    type?: unknown;
    message?: {
      type?: unknown;
      payload?: Record<string, unknown>;
    };
  };
  const payload = maybeEnvelope.message?.payload;
  if (
    maybeEnvelope.type !== "session" ||
    maybeEnvelope.message?.type !== "status" ||
    payload?.status !== "server_info"
  ) {
    return null;
  }
  return JSON.stringify({
    ...maybeEnvelope,
    message: {
      ...maybeEnvelope.message,
      payload: {
        ...payload,
        features: {
          ...(typeof payload.features === "object" && payload.features !== null
            ? payload.features
            : {}),
          providerUsageList: supported,
        },
      },
    },
  });
}

function answerMessage(requestId: string, answer: ProviderUsageFixtureAnswer) {
  if ("rpcError" in answer) {
    return {
      type: "rpc_error",
      payload: {
        requestId,
        requestType: "provider.usage.list.request",
        error: answer.rpcError,
        code: "handler_error",
      },
    };
  }
  return {
    type: "provider.usage.list.response",
    payload: { requestId, fetchedAt: answer.fetchedAt, providers: answer.providers },
  };
}

export async function installProviderUsageFixture(
  page: Page,
  payloads: ProviderUsageFixtureAnswer[],
  options: ProviderUsageFixtureOptions = {},
): Promise<ProviderUsageFixture> {
  const supported = options.supported ?? true;
  let requests = 0;
  const waiters: Array<{ count: number; resolve: () => void }> = [];

  function notifyWaiters() {
    for (const waiter of waiters.splice(0)) {
      if (requests >= waiter.count) {
        waiter.resolve();
      } else {
        waiters.push(waiter);
      }
    }
  }

  function payloadForRequest(): ProviderUsageFixtureAnswer {
    const index = Math.min(requests - 1, payloads.length - 1);
    const payload = payloads[index];
    if (!payload) {
      throw new Error("Provider usage fixture requires at least one payload.");
    }
    return payload;
  }

  await page.routeWebSocket(daemonWsRoutePattern(), (ws) => {
    const server = ws.connectToServer();

    ws.onMessage((message) => {
      const sessionMessage = getSessionMessage(message);
      if (sessionMessage?.type === "provider.usage.list.request") {
        requests += 1;
        const requestId = sessionMessage.requestId;
        if (typeof requestId !== "string") {
          throw new Error("provider.usage.list.request missing requestId");
        }
        const payload = payloadForRequest();
        // 先把应答发出去再通知，等到的请求数就包含了它的应答。
        ws.send(JSON.stringify({ type: "session", message: answerMessage(requestId, payload) }));
        notifyWaiters();
        return;
      }
      server.send(message);
    });

    server.onMessage((message) => {
      if (typeof message !== "string") {
        ws.send(message);
        return;
      }
      ws.send(withProviderUsageFeature({ message, supported }) ?? message);
    });
  });

  return {
    requestCount() {
      return requests;
    },
    waitForRequestCount(count: number) {
      if (requests >= count) {
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => {
        waiters.push({ count, resolve });
      });
    },
  };
}
