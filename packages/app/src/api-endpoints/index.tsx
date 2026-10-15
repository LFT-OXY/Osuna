export { selectActiveApiEndpoint, selectInheritedApiEndpoint } from "./internal/notices";
export { modelFamilyOf } from "./internal/model-families";

/** 能切第三方接口的内置提供方；自定义提供方不在此列。 */
const API_ENDPOINT_PROVIDERS = new Set(["claude", "codex"]);

export function supportsApiEndpoints(provider: string): boolean {
  return API_ENDPOINT_PROVIDERS.has(provider);
}
