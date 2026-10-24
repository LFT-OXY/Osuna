/** Pi 与它的分支 OMP：主机把它们对话里的接口模型写成它们认得的 `osuna/…`。 */
const PI_LIKE_PROVIDERS = new Set(["pi", "omp"]);

export function isPiLikeProvider(provider: string): boolean {
  return PI_LIKE_PROVIDERS.has(provider);
}

/** 有模型角色（modelRoles）的只有 OMP。 */
export function hasModelRoles(provider: string): boolean {
  return provider === "omp";
}

/** 有命名配置（OMP profile）的只有 OMP：设置页每套一块，键是 omp#<名字>。 */
export function hasOmpProfiles(provider: string): boolean {
  return provider === "omp";
}

/** 一套命名配置的设置所在的键（同主机的 omp-profiles.ts）。 */
export function ompProfileSettingsKey(profile: string): string {
  return `omp#${profile}`;
}
