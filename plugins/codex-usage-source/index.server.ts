import type { PluginServerContext } from "@getpaseo/plugin/server";
import { inputSchema, type CodexUsageInput } from "./shared/input.js";
import { consumeReset, discover, fetchUsage } from "./server/usage.js";

export default function contribute(server: PluginServerContext) {
  server.registerUsageSource({
    id: "codex",
    label: "Codex",
    icon: "icon.svg",
    input: inputSchema,
    discover: (scope) => discover(scope),
    fetch(input: CodexUsageInput) {
      return fetchUsage(input, fetch, {}, `Osuna/${server.appVersion}`);
    },
    consumeReset(input: CodexUsageInput) {
      return consumeReset(input, fetch, {}, `Osuna/${server.appVersion}`);
    },
  });
  return () => {};
}
