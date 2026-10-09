import type {
  ApiEndpointCreatedRef,
  ApiEndpointModeMismatch,
} from "@osuna/protocol/api-endpoint/rpc-schemas";
import type { AgentProvider, AgentTimelineItem, ApiEndpointModeSource } from "./agent-sdk-types.js";

type ApiEndpointModeNotice = Extract<AgentTimelineItem, { type: "notification" }>;

/**
 * 恢复的会话创建时所处的模式（createdIn，null 即官方）与当前不同时，给出「可能无法继续」的提示；相同返回 null。
 * App 按 apiEndpointModeMismatch 本地化；message 是给老客户端的英文原文。
 */
export function buildApiEndpointModeNotice(input: {
  modes: ApiEndpointModeSource;
  provider: AgentProvider;
  createdIn: string | null;
}): ApiEndpointModeNotice | null {
  const { modes, provider, createdIn } = input;
  const current = modes.active(provider);
  const currentId = current?.id ?? null;
  if (currentId === createdIn) return null;
  let createdEndpoint: ApiEndpointCreatedRef | null = null;
  if (createdIn !== null) {
    const name = modes.endpointName(provider, createdIn);
    createdEndpoint = { id: createdIn, name };
  }
  const mismatch = { createdIn: createdEndpoint, current };
  const message = describeMismatchInEnglish(mismatch);
  return { type: "notification", level: "warning", message, apiEndpointModeMismatch: mismatch };
}

function describeMismatchInEnglish(mismatch: ApiEndpointModeMismatch): string {
  const { createdIn, current } = mismatch;
  let created = "on Official";
  if (createdIn?.name === null) {
    created = "with an API endpoint that has since been deleted";
  } else if (createdIn) {
    created = `with the API endpoint "${createdIn.name}"`;
  }
  let now = "Official";
  if (current) {
    now = `the API endpoint "${current.name}"`;
  }
  return `This session was created ${created}, but the current mode is ${now}. It may not be able to continue.`;
}
