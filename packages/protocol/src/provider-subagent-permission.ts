import type { AgentPermissionRequest } from "./agent-types.js";

// provider 子智能体的权限请求挂在父 agent 上；adapter 在 `metadata` 的这个键里写明它来自哪个
// 子智能体（等于描述符 id），app 按它把权限归到 track 行、派发组行与只读面板。
export const PROVIDER_SUBAGENT_ID_METADATA_KEY = "providerSubagentId";

export function providerSubagentPermissionMetadata(subagentId: string): Record<string, string> {
  return { [PROVIDER_SUBAGENT_ID_METADATA_KEY]: subagentId };
}

export function getProviderSubagentIdFromPermission(
  request: Pick<AgentPermissionRequest, "metadata">,
): string | null {
  const subagentId = request.metadata?.[PROVIDER_SUBAGENT_ID_METADATA_KEY];
  return typeof subagentId === "string" && subagentId.length > 0 ? subagentId : null;
}
