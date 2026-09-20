// Single namespace for temporary GitHub repos created by Osuna tests.
// Bulk cleanup relies on this prefix being unmistakable — never reuse `osuna-`
// (collides with real repos like `osuna`, `osuna-website`).
export const TEMP_GITHUB_REPO_PREFIX = "osunatmp-";

export function createTempGithubRepoName(category: string): string {
  const rand = Math.random().toString(16).slice(2, 8);
  return `${TEMP_GITHUB_REPO_PREFIX}${category}-${Date.now()}-${rand}`;
}
