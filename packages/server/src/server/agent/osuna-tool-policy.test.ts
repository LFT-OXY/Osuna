import { describe, expect, test } from "vitest";
import type { ProviderOsunaToolsPolicy } from "@osuna/protocol/provider-config";

import { isOsunaToolEnabled, resolveOsunaToolPolicy } from "./osuna-tool-policy.js";

describe("Osuna tool policy", () => {
  test("defaults to all Osuna tools and resolves only the exact provider ID", () => {
    const customPolicy = {
      enabled: true,
      disabledTools: ["list_agents"],
    } satisfies ProviderOsunaToolsPolicy;

    expect(
      resolveOsunaToolPolicy("custom-claude", {
        claude: { osunaTools: { enabled: false } },
        "custom-claude": { osunaTools: customPolicy },
      }),
    ).toBe(customPolicy);
    expect(resolveOsunaToolPolicy("other-custom", { claude: { osunaTools: customPolicy } })).toBe(
      undefined,
    );
    expect(isOsunaToolEnabled(undefined, "list_agents")).toBe(true);
  });

  test("applies the provider gate and sparse disabled tools without filtering speak", () => {
    expect(isOsunaToolEnabled({ enabled: false }, "list_agents")).toBe(false);
    expect(isOsunaToolEnabled({ enabled: false }, "speak")).toBe(true);
    expect(
      isOsunaToolEnabled({ enabled: true, disabledTools: ["list_agents"] }, "list_agents"),
    ).toBe(false);
    expect(
      isOsunaToolEnabled({ enabled: true, disabledTools: ["list_agents"] }, "create_agent"),
    ).toBe(true);
  });
});
