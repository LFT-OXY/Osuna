import type { HostRuntimeConnectionStatus } from "@/runtime/host-runtime";
import { assertUnreachable } from "./exhaustive";

// outdated 不在这里：它的文案走 i18n，由呈现它的界面各自给出。
export function formatConnectionStatus(
  status: Exclude<HostRuntimeConnectionStatus, "outdated">,
): string {
  switch (status) {
    case "online":
      return "Online";
    case "connecting":
      return "Connecting";
    case "offline":
      return "Offline";
    case "error":
      return "Error";
    case "idle":
      return "Idle";
    default:
      return assertUnreachable(status);
  }
}

export type ConnectionStatusTone = "success" | "warning" | "error" | "muted";

export function getConnectionStatusTone(status: HostRuntimeConnectionStatus): ConnectionStatusTone {
  switch (status) {
    case "online":
      return "success";
    case "connecting":
      return "warning";
    case "error":
      return "error";
    case "offline":
      return "warning";
    case "idle":
      return "muted";
    case "outdated":
      return "warning";
    default:
      return assertUnreachable(status);
  }
}

// 已经有了定论、等下去也不会自己连上的状态。与"连接中"相对：后者值得等。
export function isHostKnownUnreachable(status: HostRuntimeConnectionStatus | undefined): boolean {
  return status === "offline" || status === "error" || status === "outdated";
}
