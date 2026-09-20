import type { Page } from "@playwright/test";
import { daemonWsRoutePattern } from "./daemon-port";

export interface PricingRefreshReply {
  result: "updated" | "not_modified" | "failed";
  fetchedAt: string;
  error: string | null;
}

export interface PricingRefreshFixture {
  requestCount(): number;
  waitForRequestCount(count: number): Promise<void>;
}

type WebSocketMessage = string | Buffer;

function getSessionMessage(message: WebSocketMessage): Record<string, unknown> | null {
  const raw = typeof message === "string" ? message : message.toString("utf8");
  let envelope: unknown;
  try {
    envelope = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!envelope || typeof envelope !== "object") return null;
  const maybeEnvelope = envelope as { type?: unknown; message?: unknown };
  if (maybeEnvelope.type !== "session" || typeof maybeEnvelope.message !== "object") return null;
  return maybeEnvelope.message as Record<string, unknown>;
}

/**
 * Answers `usage.pricing.refresh.request` in the socket instead of letting the
 * worker daemon reach GitHub. What the daemon does with a 200 / 304 / failed
 * fetch is asserted in-process (`usage-pricing.e2e.test.ts`); the browser only
 * owns what the button does with each outcome.
 */
export async function installPricingRefreshFixture(
  page: Page,
  reply: PricingRefreshReply,
): Promise<PricingRefreshFixture> {
  let requests = 0;
  const waiters: Array<{ count: number; resolve: () => void }> = [];

  function notifyWaiters() {
    for (const waiter of waiters.splice(0)) {
      if (requests >= waiter.count) waiter.resolve();
      else waiters.push(waiter);
    }
  }

  await page.routeWebSocket(daemonWsRoutePattern(), (ws) => {
    const server = ws.connectToServer();

    ws.onMessage((message) => {
      const sessionMessage = getSessionMessage(message);
      if (sessionMessage?.type === "usage.pricing.refresh.request") {
        requests += 1;
        const requestId = sessionMessage.requestId;
        if (typeof requestId !== "string") {
          throw new Error("usage.pricing.refresh.request missing requestId");
        }
        notifyWaiters();
        ws.send(
          JSON.stringify({
            type: "session",
            message: {
              type: "usage.pricing.refresh.response",
              payload: { requestId, ...reply },
            },
          }),
        );
        return;
      }
      server.send(message);
    });

    server.onMessage((message) => ws.send(message));
  });

  return {
    requestCount() {
      return requests;
    },
    waitForRequestCount(count: number) {
      if (requests >= count) return Promise.resolve();
      return new Promise<void>((resolve) => {
        waiters.push({ count, resolve });
      });
    },
  };
}

/**
 * Answers `set_daemon_config_request` with an `rpc_error`, the way the daemon
 * does when it refuses a write. The price table has no other way to reach its
 * save-failure branch from a browser: a real daemon accepts these writes.
 */
export async function installDaemonConfigFailureFixture(page: Page, reason: string): Promise<void> {
  await page.routeWebSocket(daemonWsRoutePattern(), (ws) => {
    const server = ws.connectToServer();

    ws.onMessage((message) => {
      const sessionMessage = getSessionMessage(message);
      if (sessionMessage?.type === "set_daemon_config_request") {
        const requestId = sessionMessage.requestId;
        if (typeof requestId !== "string") {
          throw new Error("set_daemon_config_request missing requestId");
        }
        ws.send(
          JSON.stringify({
            type: "session",
            message: {
              type: "rpc_error",
              payload: {
                requestId,
                requestType: "set_daemon_config_request",
                error: reason,
                code: "handler_error",
              },
            },
          }),
        );
        return;
      }
      server.send(message);
    });

    server.onMessage((message) => ws.send(message));
  });
}
