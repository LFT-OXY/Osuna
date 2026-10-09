import { describe, expect, test } from "vitest";

import { MutableDaemonConfigPatchSchema, MutableDaemonConfigSchema } from "./messages.js";
import { ProviderOverrideSchema, ProviderOsunaToolsPolicySchema } from "./provider-config.js";

describe("provider Osuna-tool policy", () => {
  test("accepts arbitrary tool IDs and leaves an empty policy enabled by default", () => {
    expect(
      ProviderOsunaToolsPolicySchema.parse({
        disabledTools: ["future_tool", "browser_future_tool"],
      }),
    ).toEqual({
      disabledTools: ["future_tool", "browser_future_tool"],
    });
    expect(ProviderOsunaToolsPolicySchema.parse({})).toEqual({});
    expect(ProviderOverrideSchema.parse({}).osunaTools).toBeUndefined();
  });

  test("accepts osunaTools on persisted provider overrides", () => {
    expect(
      ProviderOverrideSchema.parse({
        extends: "claude",
        osunaTools: {
          enabled: false,
          disabledTools: ["create_workspace"],
        },
      }).osunaTools,
    ).toEqual({
      enabled: false,
      disabledTools: ["create_workspace"],
    });
  });

  test("accepts osunaTools when reading and patching mutable daemon providers", () => {
    expect(
      MutableDaemonConfigSchema.parse({
        mcp: { injectIntoAgents: true },
        providers: {
          codex: {
            osunaTools: { enabled: false, disabledTools: ["future_tool"] },
          },
        },
      }).providers.codex?.osunaTools,
    ).toEqual({
      enabled: false,
      disabledTools: ["future_tool"],
    });

    expect(
      MutableDaemonConfigPatchSchema.parse({
        providers: {
          codex: {
            osunaTools: { disabledTools: ["browser_future_tool"] },
          },
        },
      }).providers?.codex?.osunaTools,
    ).toEqual({ disabledTools: ["browser_future_tool"] });
  });
});
