import { defaultWebSocketFactory } from "@osuna/client/internal/daemon-client-websocket-transport";
import type { WebSocketFactory } from "@osuna/client/internal/daemon-client-transport-types";

export function createAppWebSocketFactory(): WebSocketFactory {
  return defaultWebSocketFactory;
}
