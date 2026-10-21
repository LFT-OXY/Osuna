import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cdp, page, userEvent } from "@vitest/browser/context";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  LogicMapSkeleton,
  SessionOutboundMessage,
  WorkspaceLogicMapReadResult,
  WorkspaceLogicMapSummary,
} from "@getpaseo/protocol/messages";
import { i18n } from "@/i18n/i18next";
import {
  buildEmptyLogicMap,
  buildLoginLogicMap,
  buildNestedLogicMap,
} from "@/test/logic-map-fixtures";
import { DaemonConnectionError, FileReadError } from "@getpaseo/client/internal/daemon-client";
import type { ToastApi } from "@/components/toast-host";
import { ToastApiProvider } from "@/contexts/toast-api-context";
import type { WorkspaceFileLocation } from "@/workspace/file-open";
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
const WORKSPACE_ROOT = "/repo";

interface FakeHost {
  client: LogicMapClient;
  maps: WorkspaceLogicMapSummary[];
  reads: Map<string, WorkspaceLogicMapReadResult | Promise<WorkspaceLogicMapReadResult>>;
  getCalls: string[];
  /** 工作区里的文件（相对路径 → 内容），供点外部文档节点时读取。 */
  files: Map<string, string>;
  /** 读这些路径时连接断开（不是 FileReadError）。 */
  disconnectedPaths: Set<string>;
  /** 面板弹出的错误提示。 */
  toastErrors: string[];
  /** 面板弹出的普通提示。 */
  toastMessages: unknown[];
  /** 模拟 daemon 推送一条事件给订阅了它的连接。 */
  push: (message: SessionOutboundMessage) => void;
}

function createFakeHost(): FakeHost {
  const listeners: ((message: SessionOutboundMessage) => void)[] = [];
  const host: FakeHost = {
    maps: [],
    reads: new Map(),
    getCalls: [],
    files: new Map(),
    disconnectedPaths: new Set(),
    toastErrors: [],
    toastMessages: [],
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
      readFile: (async (cwd: string, path: string) => {
        if (host.disconnectedPaths.has(path)) {
          throw new DaemonConnectionError("Connection lost");
        }
        const content = host.files.get(path);
        if (cwd !== WORKSPACE_ROOT || content === undefined) {
          throw new FileReadError("File not found", cwd, path);
        }
        const bytes = new TextEncoder().encode(content);
        return {
          bytes,
          mime: "text/markdown",
          size: bytes.length,
          path,
          kind: "text",
          modifiedAt: "2026-10-19T00:00:00.000Z",
        };
      }) as LogicMapClient["readFile"],
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

interface SurfaceOverrides {
  supported: boolean | null;
  conversationMapName: string | null;
  focusedFilePath: string | null;
  onOpenNodeDoc: (location: WorkspaceFileLocation) => void;
}

const noopOpenNodeDoc = () => {};

/** 记下弹出的提示。 */
function fakeToast(host: FakeHost): ToastApi {
  return {
    show: (content) => host.toastMessages.push(content),
    copied: () => {},
    error: (message) => host.toastErrors.push(message),
  };
}

/** 挂上面板；返回的函数用新的参数重新渲染同一个面板（比如主区域换了聚焦的标签）。 */
function mountSurface(
  host: FakeHost,
  overrides: Partial<SurfaceOverrides> = {},
): (next: Partial<SurfaceOverrides>) => void {
  const container = document.createElement("div");
  container.style.cssText =
    "position: absolute; top: 0; left: 0; width: 320px; height: 760px; display: flex; flex-direction: column;";
  document.body.appendChild(container);
  const root = createRoot(container);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const toast = fakeToast(host);
  const render = (props: Partial<SurfaceOverrides>) =>
    act(() =>
      root.render(
        <ToastApiProvider api={toast}>
          <QueryClientProvider client={queryClient}>
            <LogicMapPanelSurface
              serverId="server-1"
              workspaceId={WORKSPACE_ID}
              workspaceRoot={WORKSPACE_ROOT}
              client={host.client}
              isConnected
              supported={props.supported === undefined ? true : props.supported}
              conversationMapName={props.conversationMapName ?? null}
              focusedFilePath={props.focusedFilePath ?? null}
              onOpenNodeDoc={props.onOpenNodeDoc ?? noopOpenNodeDoc}
            />
          </QueryClientProvider>
        </ToastApiProvider>,
      ),
    );
  render(overrides);
  mounted.push({ root, container });
  return (next) => render({ ...overrides, ...next });
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

/** 卡片有没有蓝色选中外圈（等 150ms 的过渡走完再看）。 */
async function outlined(testID: string): Promise<boolean> {
  const card = await shown(testID);
  await Promise.all(card.getAnimations().map((animation) => animation.finished));
  return getComputedStyle(card).boxShadow.includes("rgb(41, 112, 255) 0px 0px 0px 2px");
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
      "No doc linked",
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
    // "开始"是占位，不算节点。
    expect(byTestId("logic-map-start-placeholder")).toBeTruthy();
    expect(document.querySelectorAll('[data-testid^="logic-map-node-"]')).toHaveLength(0);
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

    const corrupt = await shown("logic-map-corrupt");
    expect(shownTexts(corrupt)).toEqual([
      "Can't read this logic map",
      "Untitled logic map: docs/logic-maps/user-login/map.json is not in a format Osuna can read. Fix or restore the file.",
      "Details",
    ]);
    // 头部和正文用同一个名字指这张图。
    expect(shownTexts(byTestId("logic-map-header"))).toEqual(["Untitled logic map"]);

    await userEvent.click(byTestId("logic-map-state-details-toggle"));
    expect(shownTexts(corrupt)).toEqual([
      "Can't read this logic map",
      "Untitled logic map: docs/logic-maps/user-login/map.json is not in a format Osuna can read. Fix or restore the file.",
      "Hide details",
      "Unexpected token } in JSON at position 120",
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

  it("outlines the node whose doc is the focused file tab in blue and leaves the others alone", async () => {
    mountSurface(loginMapHost(), { focusedFilePath: "docs/logic-maps/user-login/lock.md" });

    expect(await outlined("logic-map-node-lock")).toBe(true);
    expect(await outlined("logic-map-node-stay")).toBe(false);
  });

  it("moves the outline with the focused file tab and drops it on a tab that is no node doc", async () => {
    const update = mountSurface(loginMapHost(), {
      focusedFilePath: "docs/logic-maps/user-login/lock.md",
    });
    await shown("logic-map-node-lock");

    update({ focusedFilePath: "docs/logic-maps/user-login/stay.md" });
    await expect.poll(() => outlined("logic-map-node-stay")).toBe(true);
    expect(await outlined("logic-map-node-lock")).toBe(false);

    update({ focusedFilePath: "README.md" });
    await expect.poll(() => outlined("logic-map-node-stay")).toBe(false);

    update({ focusedFilePath: "docs/logic-maps/user-login/lock.md" });
    await expect.poll(() => outlined("logic-map-node-lock")).toBe(true);
    update({ focusedFilePath: null });
    await expect.poll(() => outlined("logic-map-node-lock")).toBe(false);
  });

  it("opens a node's own doc from the map folder when the node is clicked", async () => {
    const onOpenNodeDoc = vi.fn();
    mountSurface(loginMapHost(), { onOpenNodeDoc });

    await userEvent.click(await shown("logic-map-node-title-reset-count"));

    expect(onOpenNodeDoc).toHaveBeenCalledTimes(1);
    expect(onOpenNodeDoc).toHaveBeenCalledWith({
      path: "docs/logic-maps/user-login/reset-count.md",
    });
  });

  it("marks a node without a doc and says so when it is clicked, without opening a tab", async () => {
    const host = loginMapHost();
    const map = buildLoginLogicMap();
    host.reads.set("user-login", {
      kind: "ok",
      map: {
        ...map,
        nodes: map.nodes.map((node) => (node.id === "home" ? { ...node, doc: null } : node)),
      },
    });
    const onOpenNodeDoc = vi.fn();
    mountSurface(host, { onOpenNodeDoc });

    expect(shownTexts(await shown("logic-map-node-home"))).toEqual(["进入首页", "No doc"]);
    expect(shownTexts(byTestId("logic-map-node-reset-count"))).toEqual(["清零失败次数"]);

    await userEvent.click(byTestId("logic-map-node-title-home"));

    expect(host.toastMessages).toEqual(["This node has no doc yet"]);
    expect(onOpenNodeDoc).not.toHaveBeenCalled();
    expect(
      byTestId("logic-map-node-home").querySelector('[role="button"]')?.getAttribute("aria-label"),
    ).toBe("进入首页 has no doc yet");
  });

  it("drops the outline from the node being read when a node without a doc is clicked", async () => {
    const host = loginMapHost();
    const map = buildLoginLogicMap();
    host.reads.set("user-login", {
      kind: "ok",
      map: {
        ...map,
        nodes: map.nodes.map((node) => (node.id === "reset-count" ? { ...node, doc: null } : node)),
      },
    });
    const update = mountSurface(host, {
      focusedFilePath: "docs/logic-maps/user-login/password.md",
    });
    await expect.poll(() => outlined("logic-map-node-password")).toBe(true);

    await userEvent.click(byTestId("logic-map-node-title-reset-count"));

    await expect.poll(() => outlined("logic-map-node-password")).toBe(false);
    expect(await outlined("logic-map-node-reset-count")).toBe(false);

    update({ focusedFilePath: "docs/logic-maps/user-login/submit.md" });
    await expect.poll(() => outlined("logic-map-node-submit")).toBe(true);
  });

  it("opens a node that points at a framework doc at the line of its heading", async () => {
    const host = loginMapHost();
    const map = buildLoginLogicMap();
    host.reads.set("user-login", {
      kind: "ok",
      map: {
        ...map,
        nodes: map.nodes.map((node) =>
          node.id === "reset-count"
            ? { ...node, doc: { kind: "external", path: "spec/login.md", heading: "清零失败次数" } }
            : node,
        ),
      },
    });
    host.files.set("spec/login.md", "# 登录\n\n## 校验密码\n\n正文\n\n## 清零失败次数\n");
    const onOpenNodeDoc = vi.fn();
    mountSurface(host, { onOpenNodeDoc });

    await userEvent.click(await shown("logic-map-node-title-reset-count"));

    await expect
      .poll(() => onOpenNodeDoc.mock.calls)
      .toEqual([[{ path: "spec/login.md", lineStart: 7, lineView: "preview" }]]);
  });

  it("still opens a framework doc the host cannot read, at the top, so its tab shows the error", async () => {
    const host = loginMapHost();
    const map = buildLoginLogicMap();
    host.reads.set("user-login", {
      kind: "ok",
      map: {
        ...map,
        nodes: map.nodes.map((node) =>
          node.id === "reset-count"
            ? { ...node, doc: { kind: "external", path: "spec/gone.md", heading: "清零失败次数" } }
            : node,
        ),
      },
    });
    const onOpenNodeDoc = vi.fn();
    mountSurface(host, { onOpenNodeDoc });

    await userEvent.click(await shown("logic-map-node-title-reset-count"));

    await expect.poll(() => onOpenNodeDoc.mock.calls).toEqual([[{ path: "spec/gone.md" }]]);
  });

  it("says the node doc could not be opened when the host drops while reading it", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const host = loginMapHost();
    const map = buildLoginLogicMap();
    host.reads.set("user-login", {
      kind: "ok",
      map: {
        ...map,
        nodes: map.nodes.map((node) =>
          node.id === "reset-count"
            ? { ...node, doc: { kind: "external", path: "spec/login.md", heading: "清零失败次数" } }
            : node,
        ),
      },
    });
    host.disconnectedPaths.add("spec/login.md");
    const onOpenNodeDoc = vi.fn();
    mountSurface(host, { onOpenNodeDoc });

    await userEvent.click(await shown("logic-map-node-title-reset-count"));

    await expect.poll(() => host.toastErrors).toEqual(["Couldn't open the node doc"]);
    expect(onOpenNodeDoc).not.toHaveBeenCalled();
    expect(errorLog).toHaveBeenCalledWith(
      "[LogicMap] Failed to open node doc",
      expect.objectContaining({ nodeId: "reset-count", path: "spec/login.md" }),
    );
    errorLog.mockRestore();
  });

  it("keeps showing the map and layer a node doc was opened from once the doc's tab takes focus", async () => {
    const host = loginMapHost();
    host.maps = [
      { name: "checkout", title: "结账" },
      { name: "user-login", title: "用户登录" },
    ];
    host.reads.set("checkout", { kind: "ok", map: buildNestedLogicMap() });
    const update = mountSurface(host, { conversationMapName: "user-login" });

    await userEvent.click(await shown("logic-map-node-title-second-factor"));
    await userEvent.click(await shown("logic-map-node-title-sms-check"));
    // 打开文档后主区域聚焦的是文件标签，不再是维护这张图的对话。
    update({
      conversationMapName: null,
      focusedFilePath: "docs/logic-maps/user-login/sms-check.md",
    });

    expect(shownTexts(byTestId("logic-map-header"))).toEqual(["用户登录", "4 nodes"]);
    expect(byTestId("logic-map-breadcrumb-current").textContent).toBe("二次验证");
    await expect.poll(() => outlined("logic-map-node-sms-check")).toBe(true);
  });

  it("pans the canvas to the outlined node when it is out of view, and leaves a visible one alone", async () => {
    const update = mountSurface(loginMapHost());
    const viewport = (await shown("logic-map-viewport")).getBoundingClientRect();
    await shown("logic-map-node-stay");
    const insideViewport = (testID: string) => {
      const box = byTestId(testID).getBoundingClientRect();
      return (
        box.left >= viewport.left &&
        box.right <= viewport.right &&
        box.top >= viewport.top &&
        box.bottom <= viewport.bottom
      );
    };
    expect(insideViewport("logic-map-node-stay")).toBe(false);

    update({ focusedFilePath: "docs/logic-maps/user-login/stay.md" });
    await expect.poll(() => insideViewport("logic-map-node-stay")).toBe(true);

    const before = byTestId("logic-map-node-stay").getBoundingClientRect();
    update({ focusedFilePath: "docs/logic-maps/user-login/lock.md" });
    await expect.poll(() => outlined("logic-map-node-lock")).toBe(true);
    expect(insideViewport("logic-map-node-lock")).toBe(true);
    expect(byTestId("logic-map-node-stay").getBoundingClientRect().top).toBe(before.top);
  });

  it("opens the top of a framework doc whose heading is gone", async () => {
    const host = loginMapHost();
    const map = buildLoginLogicMap();
    host.reads.set("user-login", {
      kind: "ok",
      map: {
        ...map,
        nodes: map.nodes.map((node) =>
          node.id === "reset-count"
            ? { ...node, doc: { kind: "external", path: "spec/login.md", heading: "清零失败次数" } }
            : node,
        ),
      },
    });
    host.files.set("spec/login.md", "# 登录\n\n## 校验密码\n");
    const onOpenNodeDoc = vi.fn();
    mountSurface(host, { onOpenNodeDoc });

    await userEvent.click(await shown("logic-map-node-title-reset-count"));

    await expect.poll(() => onOpenNodeDoc.mock.calls).toEqual([[{ path: "spec/login.md" }]]);
  });

  it("opens at a readable size, from the top-left, with the zoom bar at the bottom-right", async () => {
    mountSurface(loginMapHost());
    await shown("logic-map-node-home");

    // 320 宽的边栏装不下整张图：停在 70%，左边的主路径在视口里，右边的靠拖动。
    expect(byTestId("zoomable-viewport-zoom-percent").textContent).toBe("70%");
    const viewport = byTestId("logic-map-viewport").getBoundingClientRect();
    const start = byTestId("logic-map-node-submit").getBoundingClientRect();
    expect(start.left).toBeGreaterThanOrEqual(viewport.left);
    expect(start.top - viewport.top).toBeLessThan(40);
    const bar = byTestId("zoomable-viewport-zoom-bar").getBoundingClientRect();
    expect(viewport.right - bar.right).toBeLessThan(16);
    expect(viewport.bottom - bar.bottom).toBeLessThan(16);
  });

  describe("when the agent changes the map", () => {
    afterEach(async () => {
      await cdp().send("Emulation.setEmulatedMedia", { features: [] });
    });

    async function changeMap(host: FakeHost) {
      const map = buildLoginLogicMap();
      host.reads.set("user-login", {
        kind: "ok",
        map: {
          ...map,
          nodes: [
            ...map.nodes,
            { id: "audit", kind: "step", title: "记录登录日志", parentId: null, doc: null },
          ],
          edges: [...map.edges, { from: "home", to: "audit", condition: null }],
        },
      });
      act(() =>
        host.push({
          type: "workspace.logic_map.changed",
          payload: { workspaceId: WORKSPACE_ID, mapName: "user-login" },
        }),
      );
      return shown("logic-map-node-audit");
    }

    it("fades the new node in and glides the existing ones", async () => {
      const host = loginMapHost();
      mountSurface(host);
      await shown("logic-map-node-home");

      const added = await changeMap(host);
      const addedStyle = getComputedStyle(added);
      expect(addedStyle.animationName).toBe("paseo-logic-map-node-enter");
      expect(addedStyle.animationDuration).toBe("0.15s");
      const existing = getComputedStyle(byTestId("logic-map-node-home"));
      expect(existing.animationName).toBe("none");
      expect(existing.transitionProperty).toBe("left, top, box-shadow");
      // 平移 200ms，选中外圈与悬停投影 150ms。
      expect(existing.transitionDuration).toBe("0.2s, 0.2s, 0.15s");
      expect(existing.transitionTimingFunction).toBe("ease-out");
    });

    it("puts everything in place at once when the system asks for reduced motion", async () => {
      await cdp().send("Emulation.setEmulatedMedia", {
        features: [{ name: "prefers-reduced-motion", value: "reduce" }],
      });
      const host = loginMapHost();
      mountSurface(host);
      await shown("logic-map-node-home");

      const added = await changeMap(host);
      expect(getComputedStyle(added).animationName).toBe("none");
      expect(getComputedStyle(byTestId("logic-map-node-home")).transitionDuration).toBe("0s");
    });
  });
});

function nestedMapHost(): FakeHost {
  const host = createFakeHost();
  host.maps = [{ name: "user-login", title: "用户登录" }];
  host.reads.set("user-login", { kind: "ok", map: buildNestedLogicMap() });
  return host;
}

/** Agent 把"密码登录"改成普通步骤，删掉它里面的两层。 */
function turnPasswordLoginIntoStep(): LogicMapSkeleton {
  const map = buildNestedLogicMap();
  const nodes = map.nodes.filter((node) => node.parentId === null);
  const index = nodes.findIndex((node) => node.id === "password-login");
  nodes[index] = { ...nodes[index], kind: "step" };
  const ids = new Set(nodes.map((node) => node.id));
  return {
    ...map,
    nodes,
    edges: map.edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to)),
  };
}

function changedPush(): SessionOutboundMessage {
  return {
    type: "workspace.logic_map.changed",
    payload: { workspaceId: WORKSPACE_ID, mapName: "user-login" },
  };
}

function breadcrumb(): string[] {
  return shownTexts(byTestId("logic-map-breadcrumb"));
}

describe("the logic map panel's subgraph layers", () => {
  it("opens a subgraph node's layer and shows the path to it, the current layer last", async () => {
    mountSurface(nestedMapHost());
    await shown("logic-map-node-password-login");
    expect(document.querySelector('[data-testid="logic-map-breadcrumb"]')).toBeNull();
    expect(shownTexts(byTestId("logic-map-node-password-login"))).toEqual([
      "密码登录",
      "Subgraph · 4 nodes",
    ]);

    await userEvent.click(byTestId("logic-map-node-password-login"));

    await shown("logic-map-node-check-password");
    expect(nodeTitles()).toEqual(["输入密码", "密码是否正确", "找回密码", "密码正确"]);
    expect(breadcrumb()).toEqual(["用户登录", "密码登录"]);
    expect(byTestId("logic-map-breadcrumb-current").textContent).toBe("密码登录");
    expect(shownTexts(byTestId("logic-map-header"))).toEqual(["用户登录", "4 nodes"]);

    await userEvent.click(byTestId("logic-map-node-reset"));

    await shown("logic-map-node-mail-sent");
    expect(breadcrumb()).toEqual(["用户登录", "密码登录", "找回密码"]);
    expect(byTestId("logic-map-breadcrumb-current").textContent).toBe("找回密码");
  });

  it("drags the canvas without opening the subgraph node the drag started on", async () => {
    mountSurface(nestedMapHost());
    const card = await shown("logic-map-node-password-login");
    const start = card.getBoundingClientRect();
    const x = Math.round(start.left + start.width / 2);
    const y = Math.round(start.top + start.height / 2);

    await cdp().send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await cdp().send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x,
      y,
      button: "left",
      clickCount: 1,
    });
    for (const step of [10, 20, 40]) {
      await cdp().send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: x + step,
        y: y + step,
        button: "left",
        buttons: 1,
      });
    }
    await cdp().send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: x + 40,
      y: y + 40,
      button: "left",
      clickCount: 1,
    });

    await expect
      .poll(() => byTestId("logic-map-node-password-login").getBoundingClientRect().top)
      .toBeGreaterThan(start.top + 20);
    expect(document.querySelector('[data-testid="logic-map-breadcrumb"]')).toBeNull();
    expect(nodeTitles()).toEqual(["打开登录页", "密码登录", "登录成功"]);
  });

  it("goes back to an earlier layer from the breadcrumb", async () => {
    mountSurface(nestedMapHost());
    await userEvent.click(await shown("logic-map-node-password-login"));
    await userEvent.click(await shown("logic-map-node-reset"));
    await shown("logic-map-node-mail-sent");

    await userEvent.click(byTestId("logic-map-breadcrumb-password-login"));
    await shown("logic-map-node-check-password");
    expect(breadcrumb()).toEqual(["用户登录", "密码登录"]);

    await userEvent.click(byTestId("logic-map-breadcrumb-top"));
    await shown("logic-map-node-signed-in");
    expect(nodeTitles()).toEqual(["打开登录页", "密码登录", "登录成功"]);
    expect(document.querySelector('[data-testid="logic-map-breadcrumb"]')).toBeNull();
  });

  it("starts another map at its top layer, even when it has a subgraph with the same id", async () => {
    const host = nestedMapHost();
    host.maps = [
      { name: "user-login", title: "用户登录" },
      { name: "admin-login", title: "管理员登录" },
    ];
    host.reads.set("admin-login", {
      kind: "ok",
      map: { ...buildNestedLogicMap(), title: "管理员登录" },
    });
    mountSurface(host, { conversationMapName: "user-login" });
    await userEvent.click(await shown("logic-map-node-password-login"));
    await shown("logic-map-breadcrumb");

    await userEvent.click(byTestId("logic-map-picker"));
    await userEvent.click(page.getByRole("menuitem", { name: "管理员登录" }));

    await expect.poll(() => host.getCalls).toEqual(["user-login", "admin-login"]);
    await expect.poll(() => nodeTitles()).toEqual(["打开登录页", "密码登录", "登录成功"]);
    expect(shownTexts(byTestId("logic-map-header"))).toEqual(["管理员登录", "3 nodes"]);
    expect(document.querySelector('[data-testid="logic-map-breadcrumb"]')).toBeNull();
  });

  it("comes back to a map it left at that map's top layer", async () => {
    const host = nestedMapHost();
    host.maps = [
      { name: "user-login", title: "用户登录" },
      { name: "admin-login", title: "管理员登录" },
    ];
    host.reads.set("admin-login", { kind: "ok", map: buildEmptyLogicMap() });
    mountSurface(host, { conversationMapName: "user-login" });
    await userEvent.click(await shown("logic-map-node-password-login"));
    await shown("logic-map-breadcrumb");

    await userEvent.click(byTestId("logic-map-picker"));
    await userEvent.click(page.getByRole("menuitem", { name: "管理员登录" }));
    await shown("logic-map-new-map");
    await userEvent.click(byTestId("logic-map-picker"));
    await userEvent.click(page.getByRole("menuitem", { name: "用户登录" }));

    await expect.poll(() => nodeTitles()).toEqual(["打开登录页", "密码登录", "登录成功"]);
    expect(document.querySelector('[data-testid="logic-map-breadcrumb"]')).toBeNull();
  });

  it("goes back to the top layer when the agent removes the layer being shown", async () => {
    const host = nestedMapHost();
    mountSurface(host);
    await userEvent.click(await shown("logic-map-node-password-login"));
    await shown("logic-map-node-check-password");

    host.reads.set("user-login", { kind: "ok", map: turnPasswordLoginIntoStep() });
    act(() =>
      host.push({
        type: "workspace.logic_map.changed",
        payload: { workspaceId: WORKSPACE_ID, mapName: "user-login" },
      }),
    );

    await expect.poll(() => nodeTitles()).toEqual(["打开登录页", "密码登录", "登录成功"]);
    expect(document.querySelector('[data-testid="logic-map-breadcrumb"]')).toBeNull();
    expect(shownTexts(byTestId("logic-map-header"))).toEqual(["用户登录", "3 nodes"]);
  });

  it("stays on the top layer when the agent later adds a layer with the removed one's id", async () => {
    const host = nestedMapHost();
    mountSurface(host);
    await userEvent.click(await shown("logic-map-node-password-login"));
    await shown("logic-map-node-check-password");
    host.reads.set("user-login", { kind: "ok", map: turnPasswordLoginIntoStep() });
    act(() => host.push(changedPush()));
    await expect.poll(() => nodeTitles()).toEqual(["打开登录页", "密码登录", "登录成功"]);

    host.reads.set("user-login", { kind: "ok", map: buildNestedLogicMap() });
    act(() => host.push(changedPush()));

    await expect
      .poll(() => shownTexts(byTestId("logic-map-node-password-login")))
      .toEqual(["密码登录", "Subgraph · 4 nodes"]);
    expect(nodeTitles()).toEqual(["打开登录页", "密码登录", "登录成功"]);
    expect(document.querySelector('[data-testid="logic-map-breadcrumb"]')).toBeNull();
  });
});
