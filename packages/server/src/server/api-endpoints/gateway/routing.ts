import {
  API_ENDPOINT_MODEL_TIERS,
  type ApiEndpointModelTier,
} from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import type { ApiEndpointProvider, ApiEndpointState, StoredApiEndpoint } from "../store.js";

/*
 * 中转站按请求里的模型名挑出用户选的那家，按顺序试：
 * 1. `slug/模型名`：该家开着且选了这个模型就直达；
 * 2. 整个名字是某家已选的模型（模型名本身可能带斜杠，如 `moonshotai/kimi-k2`）；
 * 3. 标识那家已删除 / 已关闭 / 没选这个模型：视同不可用，斜杠后的光秃秃模型名换同名的家；
 * 4. Claude 档位名（含 opus / sonnet / haiku / fable）：第一家映射了该档位的接口，换成映射到的模型。
 * 都按创建顺序（数组顺序）找，只看开着的接口。
 * 用户选的那家排第一，后面跟着其他开着、选了同名模型的接口（创建顺序），供失败时自动切换；模型名不变。
 */

export interface GatewayCandidate {
  endpoint: StoredApiEndpoint;
  upstreamModel: string;
}

export type GatewayRoute =
  | { ok: true; candidates: GatewayCandidate[] }
  | { ok: false; message: string };

/** `claude-haiku-4-5-20251001`、`haiku` 这类名字里的档位；档位词须独立成段。 */
function claudeTierOf(model: string): ApiEndpointModelTier | null {
  const lower = model.toLowerCase();
  return (
    API_ENDPOINT_MODEL_TIERS.find((tier) =>
      new RegExp(`(?:^|[^a-z])${tier}(?:[^a-z]|$)`).test(lower),
    ) ?? null
  );
}

export function resolveGatewayRoute(input: {
  state: ApiEndpointState;
  agent: ApiEndpointProvider;
  model: string;
}): GatewayRoute {
  const chosen = chooseEndpoint(input);
  if (!chosen) {
    return { ok: false, message: `No enabled API endpoint offers the model "${input.model}"` };
  }
  const others = input.state.endpoints
    .filter(
      (endpoint) =>
        endpoint.enabled &&
        endpoint.id !== chosen.endpoint.id &&
        endpoint.models.some((entry) => entry.id === chosen.upstreamModel),
    )
    .map((endpoint) => ({ endpoint, upstreamModel: chosen.upstreamModel }));
  return { ok: true, candidates: [chosen, ...others] };
}

function chooseEndpoint(input: {
  state: ApiEndpointState;
  agent: ApiEndpointProvider;
  model: string;
}): GatewayCandidate | null {
  const { model } = input;
  const enabled = input.state.endpoints.filter((endpoint) => endpoint.enabled);
  const selects = (endpoint: StoredApiEndpoint, id: string) =>
    endpoint.models.some((entry) => entry.id === id);
  const firstSelecting = (id: string) => enabled.find((endpoint) => selects(endpoint, id));

  const slash = model.indexOf("/");
  const bare = slash === -1 ? null : model.slice(slash + 1);
  if (bare !== null) {
    const slug = model.slice(0, slash);
    const direct = enabled.find((endpoint) => endpoint.slug === slug && selects(endpoint, bare));
    if (direct) return { endpoint: direct, upstreamModel: bare };
  }
  for (const name of bare === null ? [model] : [model, bare]) {
    const endpoint = firstSelecting(name);
    if (endpoint) return { endpoint, upstreamModel: name };
  }
  const tier = input.agent === "claude" ? claudeTierOf(bare ?? model) : null;
  if (tier) {
    for (const endpoint of enabled) {
      const mapped = endpoint.modelMapping?.[tier];
      if (mapped) return { endpoint, upstreamModel: mapped };
    }
  }
  return null;
}
