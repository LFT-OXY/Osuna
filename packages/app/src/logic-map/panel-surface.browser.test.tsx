import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { page, userEvent } from "@vitest/browser/context";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  SessionOutboundMessage,
  WorkspaceLogicMapReadResult,
  WorkspaceLogicMapSummary,
} from "@getpaseo/protocol/messages";
import { i18n } from "@/i18n/i18next";
import { buildEmptyLogicMap, buildLoginLogicMap } from "@/test/logic-map-fixtures";
import { LogicMapPanelSurface, type LogicMapClient } from "./panel-surface";

// App sources compile against the classic JSX runtime, which expects React on the global.
beforeEach(() => vi.stubGlobal("React", React));

beforeAll(async () => {
  if (!i18n.isInitialized) {
    await i18n.init();
  }
  await i18n.changeLanguage("en");
  await page.viewport(1280, 900);
});

const WORKSPACE_ID = "workspace-1";

interface FakeHost {
  client: LogicMapClient;
  maps: WorkspaceLogicMapSummary[];
  reads: Map<string, WorkspaceLogicMapReadResult | Promise<WorkspaceLogicMapReadResult>>;
  getCalls: string[];
  /** 模拟 daemon 推送一条事件给订阅了它的连接。 */
  push: (message: SessionOutboundMessage) => void;
}

function createFakeHost(): FakeHost {
  const listeners: ((message: SessionOutboundMessage) => void)[] = [];
  const host: FakeHost = {
    maps: [],
    reads: new Map(),
    getCalls: [],
    push: (message) => {
      for (const listener of listeners) listener(message);
    },
    client: {
      listWorkspaceLogicMaps: async () => host.maps,
      getWorkspaceLogicMap: async ({ mapName }) => {
        host.getCalls.push(mapName);
        const result = host.reads.get(mapName);
        if (!result) throw new Error(`unexpected read of ${mapName}`);
        return result;
      },
      observeEvents: (() => ({
        subscribe: (observer: {
          snapshot: () => void;
          update: (message: SessionOutboundMessage) => void;
        }) => {
          listeners.push(observer.update);
          observer.snapshot();
        },
        release: async () => {},
      })) as unknown as LogicMapClient["observeEvents"],
    },
  };
  return host;
}

interface Mounted {
  root: Root;
  container: HTMLElement;
}

const mounted: Mounted[] = [];

function mountSurface(
  host: FakeHost,
  overrides: Partial<{ supported: boolean | null; conversationMapName: string | null }> = {},
): void {
  const container = document.createElement("div");
  container.style.cssText =
    "position: absolute; top: 0; left: 0; width: 320px; height: 760px; display: flex; flex-direction: column;";
  document.body.appendChild(container);
  const root = createRoot(container);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  act(() =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <LogicMapPanelSurface
          serverId="server-1"
          workspaceId={WORKSPACE_ID}
          client={host.client}
          isConnected
          supported={overrides.supported === undefined ? true : overrides.supported}
          conversationMapName={overrides.conversationMapName ?? null}
        />
      </QueryClientProvider>,
    ),
  );
  mounted.push({ root, container });
}

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    act(() => entry.root.unmount());
    entry.container.remove();
  }
});

function byTestId(testID: string): HTMLElement {
  const element = document.querySelector(`[data-testid="${testID}"]`);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`${testID} did not render`);
  }
  return element;
}

async function shown(testID: string): Promise<HTMLElement> {
  await expect.poll(() => document.querySelector(`[data-testid="${testID}"]`)).not.toBeNull();
  return byTestId(testID);
}

/** 一块区域里用户看到的文字，按出现顺序。 */
function shownTexts(element: HTMLElement): string[] {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const texts: string[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent?.trim();
    if (text) texts.push(text);
  }
  return texts;
}

function nodeTitles(): string[] {
  return [...document.querySelectorAll('[data-testid^="logic-map-node-title-"]')].map(
    (element) => element.textContent ?? "",
  );
}

function loginMapHost(): FakeHost {
  const host = createFakeHost();
  host.maps = [{ name: "user-login", title: "用户登录" }];
  host.reads.set("user-login", { kind: "ok", map: buildLoginLogicMap() });
  return host;
}

describe("the logic map panel", () => {
  it("explains how to turn logic maps on when the workspace has none", async () => {
    const host = createFakeHost();
    mountSurface(host);

    expect(shownTexts(await shown("logic-map-empty"))).toEqual([
      "No logic map yet",
      "Turn on Logic map in the composer toolbar. The agent then keeps a map of the feature as you discuss it.",
    ]);
    expect(host.getCalls).toEqual([]);
  });

  it("shows skeleton cards while the map loads", async () => {
    const host = createFakeHost();
    host.maps = [{ name: "user-login", title: "用户登录" }];
    host.reads.set("user-login", new Promise(() => {}));
    mountSurface(host);

    const loading = await shown("logic-map-loading");
    expect(loading.getAttribute("aria-label")).toBe("Loading logic map…");
    expect(loading.querySelectorAll('[data-testid="logic-map-skeleton-card"]')).toHaveLength(3);
  });

  it("draws the map the current conversation keeps, with its node count and decision rows", async () => {
    const host = loginMapHost();
    host.maps = [
      { name: "checkout", title: "结账" },
      { name: "user-login", title: "用户登录" },
    ];
    mountSurface(host, { conversationMapName: "user-login" });

    await shown("logic-map-canvas");
    expect(shownTexts(byTestId("logic-map-header"))).toEqual(["用户登录", "13 nodes"]);
    expect(nodeTitles()).toEqual([
      "提交账号和密码",
      "账户状态",
      "提示账户已锁定",
      "校验密码",
      "清零失败次数",
      "二次验证",
      "签发登录会话",
      "进入首页",
      "失败次数 +1",
      "满 5 次？",
      "提示密码错误",
      "锁定账户 30 分钟",
      "留在登录页",
    ]);
    expect(shownTexts(byTestId("logic-map-node-limit"))).toEqual([
      "满 5 次？",
      "If",
      "未满",
      "Else",
      "已满",
    ]);
    expect(shownTexts(byTestId("logic-map-node-second-factor"))).toEqual([
      "二次验证",
      "Subgraph · 4 nodes",
    ]);
    expect(shownTexts(byTestId("logic-map-node-session"))).toEqual([
      "签发登录会话",
      "No formal doc yet",
    ]);
    expect(host.getCalls).toEqual(["user-login"]);
  });

  it("gives a long title a tooltip with the whole title", async () => {
    const host = loginMapHost();
    const map = buildLoginLogicMap();
    const longTitle = "锁定账户 30 分钟并通知账户所有人";
    host.reads.set("user-login", {
      kind: "ok",
      map: {
        ...map,
        nodes: map.nodes.map((node) => (node.id === "lock" ? { ...node, title: longTitle } : node)),
      },
    });
    mountSurface(host);

    await userEvent.hover(await shown("logic-map-node-lock"));

    expect(shownTexts(await shown("logic-map-node-tooltip"))).toEqual([longTitle]);
  });

  it("shows a new map the agent has not written yet as a lone start card", async () => {
    const host = createFakeHost();
    host.maps = [{ name: "untitled-1a2b", title: null }];
    host.reads.set("untitled-1a2b", { kind: "ok", map: buildEmptyLogicMap() });
    mountSurface(host);

    expect(shownTexts(await shown("logic-map-new-map"))).toEqual([
      "Start",
      "The agent hasn't added any nodes yet.",
    ]);
    expect(shownTexts(byTestId("logic-map-header"))).toEqual(["Untitled logic map", "0 nodes"]);
  });

  it("names the map, the file and the problem when a map file is broken", async () => {
    const host = createFakeHost();
    host.maps = [{ name: "user-login", title: null }];
    host.reads.set("user-login", {
      kind: "corrupt",
      file: "docs/logic-maps/user-login/map.json",
      problem: "Unexpected token } in JSON at position 120",
    });
    mountSurface(host);

    expect(shownTexts(await shown("logic-map-corrupt"))).toEqual([
      "Can't read this logic map",
      "user-login: docs/logic-maps/user-login/map.json is broken (Unexpected token } in JSON at position 120). Fix or restore the file.",
    ]);
  });

  it("asks to update the host instead of reading maps from an old one", async () => {
    const host = loginMapHost();
    mountSurface(host, { supported: false });

    expect(shownTexts(await shown("logic-map-host-outdated"))).toEqual([
      "Update Osuna on this host",
      "This host's Osuna is too old to show logic maps.",
    ]);
    expect(host.getCalls).toEqual([]);
  });

  it("redraws the map when the agent changes it", async () => {
    const host = loginMapHost();
    mountSurface(host);
    await shown("logic-map-node-home");

    const map = buildLoginLogicMap();
    host.reads.set("user-login", {
      kind: "ok",
      map: {
        ...map,
        nodes: [
          ...map.nodes,
          { id: "audit", kind: "step", title: "记录登录日志", parentId: null, doc: null },
        ],
        edges: [...map.edges, { from: "session", to: "audit", condition: null }],
      },
    });
    act(() =>
      host.push({
        type: "workspace.logic_map.changed",
        payload: { workspaceId: WORKSPACE_ID, mapName: "user-login" },
      }),
    );

    await shown("logic-map-node-audit");
    expect(shownTexts(byTestId("logic-map-header"))).toEqual(["用户登录", "14 nodes"]);
    expect(host.getCalls).toEqual(["user-login", "user-login"]);
  });
});
