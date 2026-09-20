import type { AgentHookPluginFileInstallStrategy } from "../agent-hook-installer.js";

// Both generations discover the same file. Their loaders select the entrypoint:
// OpenCode 1 calls server(); OpenCode 2 calls setup(). Keep their event contracts
// separate: V1 publishes status snapshots, V2 publishes execution transitions.
export const OPENCODE_PLUGIN_SOURCE = [
  "const V1_STATUS_EVENTS = {",
  '  busy: "session.status.busy",',
  '  retry: "session.status.retry",',
  '  idle: "session.status.idle",',
  "};",
  "",
  "const V2_EVENTS = {",
  '  "session.execution.started": "session.status.busy",',
  '  "session.execution.succeeded": "session.status.idle",',
  '  "session.execution.failed": "session.status.idle",',
  '  "session.execution.interrupted": "session.status.idle",',
  '  "permission.asked": "permission.asked",',
  '  "permission.replied": "permission.replied",',
  "};",
  "",
  "function osunaEventForV1(event) {",
  "  const type = event.type;",
  '  if (type === "permission.asked") return "permission.asked";',
  '  if (type === "permission.replied") return "permission.replied";',
  '  if (type !== "session.status") return null;',
  "  return V1_STATUS_EVENTS[event.properties.status.type] ?? null;",
  "}",
  "",
  // CLI processes can finish out of order, especially for immediate failures.
  // Both entrypoints enqueue reports so an older busy report cannot overwrite idle.
  "let pendingHook = Promise.resolve();",
  "",
  // The daemon injects OSUNA_HOOK_CLI with the CLI path it already resolved; the
  // bare name works because that CLI's bin dir is prepended to the terminal PATH.
  "function runOsunaHook(event) {",
  "  if (!process.env.OSUNA_TERMINAL_ID) return;",
  "  pendingHook = pendingHook.then(async () => {",
  "    try {",
  '      const cli = process.env.OSUNA_HOOK_CLI || "osuna";',
  '      const child = Bun.spawn([cli, "hooks", "opencode", event], {',
  '        stdin: "ignore",',
  '        stdout: "ignore",',
  '        stderr: "ignore",',
  "      });",
  "      await child.exited;",
  "    } catch {}",
  "  });",
  "  return pendingHook;",
  "}",
  "",
  "export default {",
  '  id: "osuna-terminal-activity",',
  "  server() {",
  "    return {",
  "      event: async ({ event }) => {",
  "        const osunaEvent = osunaEventForV1(event);",
  "        if (osunaEvent) await runOsunaHook(osunaEvent);",
  "      },",
  "    };",
  "  },",
  "  setup(ctx) {",
  "    const controller = new AbortController();",
  "    void (async () => {",
  "      for await (const event of ctx.event.subscribe({ signal: controller.signal })) {",
  "        const osunaEvent = V2_EVENTS[event.type];",
  "        if (osunaEvent) await runOsunaHook(osunaEvent);",
  "      }",
  "    })().catch(() => {});",
  "    return () => controller.abort();",
  "  },",
  "};",
  "",
].join("\n");

export function createOpenCodePluginInstallStrategy(): AgentHookPluginFileInstallStrategy {
  return {
    kind: "plugin-file",
    configDir: "opencode",
    configDirBase: "xdg-config",
    configFile: "plugins/osuna-terminal-activity.js",
    // COMPAT(opencode-plugin-rename): added 2026-09-20, remove after 2027-03-20 — the fork
    // shipped this plugin as paseo-terminal-activity.js before the rename.
    legacyConfigFiles: ["plugins/paseo-terminal-activity.js"],
    configDirEnvOverride: "OPENCODE_CONFIG_DIR",
    hookMarker: "osuna hooks opencode",
    source: OPENCODE_PLUGIN_SOURCE,
  };
}
