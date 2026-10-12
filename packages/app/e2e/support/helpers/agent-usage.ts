import type { Page } from "@playwright/test";
import type { ApiEndpointRef } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import type { UsageAgentSummary } from "@getpaseo/protocol/usage/types";
import { daemonWsRoutePattern } from "./daemon-port";
import { loadSessionMessageReaders } from "./new-workspace";

interface ActiveApiEndpoint {
  provider: string;
  endpoint: ApiEndpointRef;
}

interface AgentUsageSummaryFixtureOptions {
  /** 让提供方快照里的这个提供方带上启用中的第三方接口。 */
  activeApiEndpoint?: ActiveApiEndpoint;
}

function sessionFrame(message: object): string {
  return JSON.stringify({ type: "session", message });
}

function tagActiveApiEndpoint<Entry extends { provider: string }>(
  entries: Entry[],
  active: ActiveApiEndpoint,
): Entry[] {
  return entries.map((entry) =>
    entry.provider === active.provider
      ? Object.assign({}, entry, { activeApiEndpoint: active.endpoint })
      : entry,
  );
}

/**
 * 伪造 `usage.agent.get` 的应答：扫描器不读 mock 智能体的日志，daemon 对它永远答零。
 * 其余消息照常到达 daemon。同一个页面只能装一个 WebSocket 路由，
 * 套餐用量要真数据时用 `installLoginUsage`（daemon 侧的插件），不要再装第二个路由。
 */
export async function installAgentUsageSummaryFixture(
  page: Page,
  summary: UsageAgentSummary,
  options: AgentUsageSummaryFixtureOptions = {},
): Promise<void> {
  const frames = await loadSessionMessageReaders();
  const { activeApiEndpoint } = options;

  await page.routeWebSocket(daemonWsRoutePattern(), (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((message) => {
      const request = frames.client(message);
      if (request?.type !== "usage.agent.get.request") {
        server.send(message);
        return;
      }
      ws.send(
        sessionFrame({
          type: "usage.agent.get.response",
          payload: { ...summary, requestId: request.requestId },
        }),
      );
    });

    server.onMessage((message) => {
      const response = activeApiEndpoint ? frames.server(message) : null;
      const isProvidersSnapshot =
        response?.type === "get_providers_snapshot_response" ||
        response?.type === "providers_snapshot_update";
      if (!activeApiEndpoint || !isProvidersSnapshot) {
        ws.send(message);
        return;
      }
      const { entries, compactSnapshot } = response.payload;
      ws.send(
        sessionFrame({
          ...response,
          payload: {
            ...response.payload,
            entries: tagActiveApiEndpoint(entries, activeApiEndpoint),
            compactSnapshot: compactSnapshot && {
              ...compactSnapshot,
              entries: tagActiveApiEndpoint(compactSnapshot.entries, activeApiEndpoint),
            },
          },
        }),
      );
    });
  });
}
