import type { ProviderSnapshotEntry } from "@osuna/protocol/agent-types";
import type {
  ApiEndpointModeMismatch,
  ApiEndpointRef,
} from "@osuna/protocol/api-endpoint/rpc-schemas";

/*
 * 第三方接口在别处的提示：套餐用量、继承 claude 的自定义提供方、恢复会话。
 * 当前模式取自提供方快照的 activeApiEndpoint；老主机不发这个字段，按「官方」处理。
 */

export function selectActiveApiEndpoint(
  entries: readonly ProviderSnapshotEntry[] | undefined,
  provider: string | null | undefined,
): ApiEndpointRef | null {
  if (!provider) return null;
  const entry = entries?.find((candidate) => candidate.provider === provider);
  return entry?.activeApiEndpoint ?? null;
}

/**
 * Claude 启用第三方接口时，继承 claude 的自定义提供方也走这个接口：settings.json 的 env 优先于进程环境。
 * 只提示 claude：带 OPENAI_BASE_URL 的 Codex 自定义提供方按请求注入自己的 model_provider，盖过顶层键。
 */
export function selectInheritedApiEndpoint(input: {
  provider: string;
  // daemon 配置里该提供方的 extends 原值（配置 schema 为 passthrough，类型未收窄）。
  extendsProvider?: unknown;
  entries: readonly ProviderSnapshotEntry[] | undefined;
}): ApiEndpointRef | null {
  // Claude 自己的详情里已经显示当前接口。
  if (input.provider === "claude") return null;
  if (input.extendsProvider !== "claude") return null;
  return selectActiveApiEndpoint(input.entries, "claude");
}

export interface ApiEndpointModeNoticeText {
  key: string;
  params: Record<string, string>;
}

const SESSION_MODE_KEY = "agentStream.apiEndpointMode";

/**
 * 恢复的会话创建时的模式与当前不同。不是这类提示（undefined），或两边都是官方（daemon 不会发），
 * 返回 null，调用方显示原文。
 */
export function describeApiEndpointModeMismatch(
  mismatch: ApiEndpointModeMismatch | undefined,
): ApiEndpointModeNoticeText | null {
  if (!mismatch) return null;
  const { createdIn, current } = mismatch;
  if (current === null) {
    if (createdIn === null) return null;
    if (createdIn.name === null) {
      return { key: `${SESSION_MODE_KEY}.deletedToOfficial`, params: {} };
    }
    return { key: `${SESSION_MODE_KEY}.endpointToOfficial`, params: { created: createdIn.name } };
  }
  if (createdIn === null) {
    return { key: `${SESSION_MODE_KEY}.officialToEndpoint`, params: { current: current.name } };
  }
  if (createdIn.name === null) {
    return { key: `${SESSION_MODE_KEY}.deletedToEndpoint`, params: { current: current.name } };
  }
  return {
    key: `${SESSION_MODE_KEY}.endpointToEndpoint`,
    params: { created: createdIn.name, current: current.name },
  };
}
