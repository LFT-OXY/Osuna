export { selectActiveApiEndpoint, selectInheritedApiEndpoint } from "./internal/notices";
export { modelFamilyOf } from "./internal/model-families";
export { isPiLikeProvider } from "./internal/pi-like";

/** 能切第三方接口、Osuna 对话里换成接口模型的内置提供方；自定义提供方不在此列。 */
const API_ENDPOINT_PROVIDERS = new Set(["claude", "codex"]);

export function supportsApiEndpoints(provider: string): boolean {
  return API_ENDPOINT_PROVIDERS.has(provider);
}

/** 主机声明了哪几家 Pi 系的第三方接口（apiEndpointPi、apiEndpointOmp）。 */
export interface ApiEndpointSettingsShown {
  provider: string;
  hostSupportsPi: boolean;
  hostSupportsOmp: boolean;
}

/**
 * 提供方页要不要有「第三方接口」区：Claude Code、Codex 一直有；Pi、OMP 要主机各自声明 apiEndpointPi、apiEndpointOmp
 * （老主机不认 provider "pi"、"omp"，不显示用不了的开关）。
 */
export function showsApiEndpointSettings(input: ApiEndpointSettingsShown): boolean {
  if (supportsApiEndpoints(input.provider)) return true;
  if (input.provider === "pi") return input.hostSupportsPi;
  return input.provider === "omp" && input.hostSupportsOmp;
}
