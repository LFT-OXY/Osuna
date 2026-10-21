import { PendingOpenProjectStore } from "../pending-open-project-store.js";

export interface OwnedDesktopWindow<TAgentTarget> {
  webContentsId: number;
  isDestroyed(): boolean;
  isVisible(): boolean;
  isMinimized(): boolean;
  restore(): void;
  show(): void;
  focus(): void;
  sendAgent(target: TAgentTarget): void;
  sendImportLink(link: string): void;
}

interface DesktopWindowOwnerPort<TAgentTarget> {
  create(input: {
    initialRoute: string | null;
    restoreWindowState: boolean;
    onCreated(webContentsId: number): void;
    onClosed(webContentsId: number): void;
  }): Promise<OwnedDesktopWindow<TAgentTarget>>;
  windows(): OwnedDesktopWindow<TAgentTarget>[];
  focusedWindow(): OwnedDesktopWindow<TAgentTarget> | null;
  agentRoute(target: TAgentTarget): string;
  deliverAgent(webContentsId: number, target: TAgentTarget): TAgentTarget | null;
  // 导入链接（paseo://import）：渲染层准备好时交出，没准备好先存着。
  deliverImportLink(webContentsId: number, link: string): string | null;
}

export interface DesktopWindowOwner<TAgentTarget> {
  openPrimary(input?: {
    initialRoute?: string | null;
    pendingProjectPath?: string | null;
  }): Promise<void>;
  openAdditional(input?: { pendingProjectPath?: string | null }): Promise<void>;
  openOrFocusAgent(target: TAgentTarget): Promise<void>;
  /** 导入链接交给当前窗口（有焦点的，否则看得见的，否则第一个）；一个窗口都没有时开一个再交。 */
  deliverImportLink(link: string): Promise<void>;
  restoreWhenActivated(): Promise<void>;
  takePendingProject(webContentsId: number): string | null;
}

export function createDesktopWindowOwner<TAgentTarget>(
  port: DesktopWindowOwnerPort<TAgentTarget>,
): DesktopWindowOwner<TAgentTarget> {
  const pendingProjects = new PendingOpenProjectStore();
  let agentWindowCreation: Promise<void> | null = null;

  const open = async (input: {
    initialRoute: string | null;
    pendingProjectPath: string | null;
    restoreWindowState: boolean;
  }): Promise<OwnedDesktopWindow<TAgentTarget>> => {
    return port.create({
      initialRoute: input.initialRoute,
      restoreWindowState: input.restoreWindowState,
      onCreated: (webContentsId) => pendingProjects.set(webContentsId, input.pendingProjectPath),
      onClosed: (webContentsId) => pendingProjects.delete(webContentsId),
    });
  };

  const currentWindow = (): OwnedDesktopWindow<TAgentTarget> | undefined => {
    const windows = port.windows();
    return port.focusedWindow() ?? windows.find((candidate) => candidate.isVisible()) ?? windows[0];
  };

  const owner: DesktopWindowOwner<TAgentTarget> = {
    async openPrimary(input = {}) {
      await open({
        initialRoute: input.initialRoute ?? null,
        pendingProjectPath: input.pendingProjectPath ?? null,
        restoreWindowState: true,
      });
    },
    async openAdditional(input = {}) {
      await open({
        initialRoute: null,
        pendingProjectPath: input.pendingProjectPath ?? null,
        restoreWindowState: false,
      });
    },
    async deliverImportLink(link) {
      let window = currentWindow();
      if (!window || window.isDestroyed()) {
        window = await open({
          initialRoute: null,
          pendingProjectPath: null,
          restoreWindowState: true,
        });
      }
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
      const deliverable = port.deliverImportLink(window.webContentsId, link);
      if (deliverable) window.sendImportLink(deliverable);
    },
    async openOrFocusAgent(target) {
      const windows = port.windows();
      const window =
        port.focusedWindow() ?? windows.find((candidate) => candidate.isVisible()) ?? windows[0];
      if (!window || window.isDestroyed()) {
        if (!agentWindowCreation) {
          agentWindowCreation = owner
            .openPrimary({ initialRoute: port.agentRoute(target) })
            .finally(() => {
              agentWindowCreation = null;
            });
          await agentWindowCreation;
          return;
        }
        await agentWindowCreation;
        await owner.openOrFocusAgent(target);
        return;
      }
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
      const deliverable = port.deliverAgent(window.webContentsId, target);
      if (deliverable) window.sendAgent(deliverable);
    },
    async restoreWhenActivated() {
      if (port.windows().length === 0) await owner.openPrimary();
    },
    takePendingProject: (webContentsId) => pendingProjects.take(webContentsId),
  };
  return owner;
}
