import { describe, expect, it } from "vitest";
import { createDesktopWindowOwner, type OwnedDesktopWindow } from "./desktop-window-owner.js";

interface Target {
  id: string;
}

function harness() {
  const windows: OwnedDesktopWindow<Target>[] = [];
  const launches: Array<{ initialRoute: string | null; restoreWindowState: boolean }> = [];
  const sent: Target[] = [];
  const importsSent: Array<{ webContentsId: number; link: string }> = [];
  const importsQueued: Array<{ webContentsId: number; link: string }> = [];
  const readyWindows = new Set<number>();
  let nextId = 1;
  let focused: OwnedDesktopWindow<Target> | null = null;
  let closeWindow = (_id: number) => {};
  const owner = createDesktopWindowOwner<Target>({
    async create(input) {
      launches.push({
        initialRoute: input.initialRoute,
        restoreWindowState: input.restoreWindowState,
      });
      const id = nextId++;
      closeWindow = input.onClosed;
      const window: OwnedDesktopWindow<Target> = {
        webContentsId: id,
        isDestroyed: () => false,
        isVisible: () => true,
        isMinimized: () => false,
        restore: () => {},
        show: () => {},
        focus: () => {},
        sendAgent: (target) => sent.push(target),
        sendImportLink: (link) => importsSent.push({ webContentsId: id, link }),
      };
      windows.push(window);
      input.onCreated(id);
      return window;
    },
    windows: () => windows,
    focusedWindow: () => focused,
    agentRoute: (target) => `/agent/${target.id}`,
    deliverAgent: (_id, target) => target,
    deliverImportLink: (webContentsId, link) => {
      if (readyWindows.has(webContentsId)) return link;
      importsQueued.push({ webContentsId, link });
      return null;
    },
  });
  return {
    owner,
    launches,
    sent,
    importsSent,
    importsQueued,
    windows,
    markReady: (...ids: number[]) => ids.forEach((id) => readyWindows.add(id)),
    setFocused: (window: OwnedDesktopWindow<Target>) => {
      focused = window;
    },
    close: (id: number) => closeWindow(id),
  };
}

describe("desktop window owner", () => {
  it("restores only primary launches and routes pending projects per window", async () => {
    const h = harness();
    await h.owner.openPrimary({ pendingProjectPath: " /project/a " });
    await h.owner.openAdditional({ pendingProjectPath: "/project/b" });
    expect(h.launches).toEqual([
      { initialRoute: null, restoreWindowState: true },
      { initialRoute: null, restoreWindowState: false },
    ]);
    expect(h.owner.takePendingProject(1)).toBe("/project/a");
    expect(h.owner.takePendingProject(2)).toBe("/project/b");
  });

  it("focuses an existing window and delivers agent routing through its inbox", async () => {
    const h = harness();
    await h.owner.openPrimary();
    h.setFocused(h.windows[0]);
    await h.owner.openOrFocusAgent({ id: "agent-7" });
    expect(h.launches).toHaveLength(1);
    expect(h.sent).toEqual([{ id: "agent-7" }]);
  });

  it("removes pending routing state when a window closes", async () => {
    const h = harness();
    await h.owner.openAdditional({ pendingProjectPath: "/project/a" });
    h.close(1);
    expect(h.owner.takePendingProject(1)).toBeNull();
  });
});

describe("import links", () => {
  it("hands paseo://import to the focused window, and Agent links still route as before", async () => {
    const h = harness();
    await h.owner.openPrimary();
    await h.owner.openAdditional();
    h.markReady(1, 2);
    h.setFocused(h.windows[1]);
    await h.owner.deliverImportLink("paseo://import?preset=deepseek");
    expect(h.importsSent).toEqual([{ webContentsId: 2, link: "paseo://import?preset=deepseek" }]);
    expect(h.sent).toEqual([]);

    await h.owner.openOrFocusAgent({ id: "agent-7" });
    expect(h.sent).toEqual([{ id: "agent-7" }]);
    expect(h.importsSent).toHaveLength(1);
    expect(h.launches).toHaveLength(2);
  });

  it("opens a window for a link when none is open, and queues the link for it", async () => {
    const h = harness();
    await h.owner.deliverImportLink("paseo://import?preset=openai");
    expect(h.launches).toEqual([{ initialRoute: null, restoreWindowState: true }]);
    expect(h.importsQueued).toEqual([{ webContentsId: 1, link: "paseo://import?preset=openai" }]);
  });
});
