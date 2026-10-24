/** Pi 与它的分支 OMP：主机把它们对话里的接口模型写成它们认得的 `osuna/…`。 */
const PI_LIKE_PROVIDERS = new Set(["pi", "omp"]);

export function isPiLikeProvider(provider: string): boolean {
  return PI_LIKE_PROVIDERS.has(provider);
}

/** 有模型角色（modelRoles）的只有 OMP。 */
export function hasModelRoles(provider: string): boolean {
  return provider === "omp";
}
