import { useTranslation } from "react-i18next";
import type { ApiEndpointTemplate } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { useFetchQuery } from "@/data/query";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";

export type EndpointTemplatesState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; templates: ApiEndpointTemplate[] };

/**
 * 主机的模板清单（随 daemon 版本走）；打开列表时重取一次，主机升级后的新模板也能看到。`enabled` 为 false（主机没声明 apiEndpointManagement）
 * 时不发请求，给空清单：老主机上「+」直接打开「自定义」表单。
 */
export function useEndpointTemplates({
  serverId,
  enabled,
}: {
  serverId: string;
  enabled: boolean;
}): EndpointTemplatesState & { retry: () => void } {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const query = useFetchQuery({
    queryKey: ["api-endpoint-templates", serverId],
    dataShape: "value",
    staleTimeMs: 0,
    enabled: enabled && Boolean(client) && isConnected,
    retry: false,
    queryFn: async () => {
      if (!client) throw new Error(t("workspace.terminal.hostDisconnected"));
      const response = await client.apiEndpointListTemplates();
      if (response.error) throw new Error(response.error.message);
      return response.templates;
    },
  });
  const retry = () => void query.refetch();
  if (!enabled) return { status: "ready", templates: [], retry };
  if (query.data) return { status: "ready", templates: query.data, retry };
  if (query.error) return { status: "error", message: query.error.message, retry };
  return { status: "loading", retry };
}
