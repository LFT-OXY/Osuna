/** 发给窗口渲染层的一件事：渲染层准备好之前先存着（每个窗口只留最新的一件），准备好时交出。 */
export class RendererInbox<T> {
  private readonly readyWindows = new Set<number>();
  private readonly pendingByWindow = new Map<number, T>();

  windowLoading(webContentsId: number): void {
    this.readyWindows.delete(webContentsId);
  }

  windowReady(webContentsId: number): T | null {
    this.readyWindows.add(webContentsId);
    const pending = this.pendingByWindow.get(webContentsId) ?? null;
    this.pendingByWindow.delete(webContentsId);
    return pending;
  }

  deliverOrQueue(webContentsId: number, item: T): T | null {
    if (this.readyWindows.has(webContentsId)) {
      return item;
    }
    this.pendingByWindow.set(webContentsId, item);
    return null;
  }

  removeWindow(webContentsId: number): void {
    this.readyWindows.delete(webContentsId);
    this.pendingByWindow.delete(webContentsId);
  }
}
