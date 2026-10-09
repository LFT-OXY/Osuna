import { QueryClientProvider } from "@tanstack/react-query";
import { OsunaApiProvider, PluginRpcProvider } from "@osuna/plugin/client/host";
import type { ReactNode } from "react";
import type { InstalledPlugin } from "./types";
import { usePluginSurfaceRuntime } from "./surface-runtime";
import type { DaemonClient } from "@osuna/client/internal/daemon-client";

export function PluginRuntimeBoundary({
  plugin,
  client,
  children,
}: {
  plugin: InstalledPlugin;
  client: DaemonClient;
  children: ReactNode;
}) {
  const runtime = usePluginSurfaceRuntime(client, plugin);
  if (!runtime) return null;
  return (
    <QueryClientProvider client={plugin.queryClient}>
      <OsunaApiProvider osuna={runtime.osuna}>
        <PluginRpcProvider invoke={runtime.invoke}>{children}</PluginRpcProvider>
      </OsunaApiProvider>
    </QueryClientProvider>
  );
}
