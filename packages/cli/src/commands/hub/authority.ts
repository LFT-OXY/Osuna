import type { HubCredentialStore } from "./credentials.js";
import { HubCommandError } from "./error.js";
import { normalizeHubOrigin } from "./origin.js";

export interface HubAuthorityOptions {
  origin?: string;
  apiKey?: string;
}

interface ResolveHubInput {
  options: HubAuthorityOptions;
  env: Readonly<Record<string, string | undefined>>;
  credentials: HubCredentialStore;
}

export function resolveHubOrigin(input: ResolveHubInput): string {
  // 本 fork 不托管 Hub：没有可回退的 origin，未配置时直接说清怎么配，
  // 而不是默认连向上游的 hub.paseo.sh。
  const selectedOrigin =
    input.options.origin ?? input.env.OSUNA_HUB_URL ?? input.credentials.active()?.origin;
  if (selectedOrigin === undefined) {
    throw new HubCommandError(
      "HUB_ORIGIN_REQUIRED",
      "No Hub URL configured. Pass --hub <url>, set OSUNA_HUB_URL, or run `osuna hub login <url>`.",
    );
  }
  return normalizeHubOrigin(selectedOrigin);
}

export function resolveHubCredential(input: ResolveHubInput & { origin: string }): string {
  const explicitCredential = input.options.apiKey ?? input.env.OSUNA_HUB_API_KEY;
  if (explicitCredential !== undefined) return explicitCredential;
  const stored = input.credentials.get(input.origin);
  if (stored !== null) return stored.credential;
  throw new HubCommandError(
    "HUB_API_KEY_REQUIRED",
    `No stored Hub login matches ${input.origin}. Run \`osuna hub login ${input.origin}\`, pass --api-key <secret>, or set OSUNA_HUB_API_KEY.`,
  );
}
