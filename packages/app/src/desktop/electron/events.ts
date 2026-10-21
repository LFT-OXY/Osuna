import { getDesktopHost } from "@/desktop/host";

export type DesktopEventUnlisten = () => void;

interface EventEnvelope {
  payload?: unknown;
}

/** 桌面端的桥（preload 给的 API、主进程的 IPC）一时用不了：可以过一会儿再接。 */
export class DesktopBridgeUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "DesktopBridgeUnavailableError";
  }
}

export async function listenToDesktopEvent<TPayload>(
  event: string,
  handler: (payload: TPayload) => void,
): Promise<DesktopEventUnlisten> {
  const listen = getDesktopHost()?.events?.on;
  if (typeof listen !== "function") {
    throw new DesktopBridgeUnavailableError("Desktop event API is unavailable.");
  }

  const unlisten = await listen(event, (rawEvent: unknown) => {
    const payload =
      typeof rawEvent === "object" && rawEvent !== null && "payload" in rawEvent
        ? (rawEvent as EventEnvelope).payload
        : rawEvent;
    handler(payload as TPayload);
  });

  return typeof unlisten === "function" ? unlisten : () => {};
}
