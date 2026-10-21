import { describe, expect, test } from "vitest";
import { resolveLogicMapToolsUnavailableReason } from "./osuna-tools-availability";

describe("resolveLogicMapToolsUnavailableReason", () => {
  test.each(["tools_not_injected", "mcp_disabled", "tools_not_delivered"])(
    "%s means the logic map tools are missing",
    (reason) => {
      expect(
        resolveLogicMapToolsUnavailableReason({
          canCreateAgents: false,
          unavailableReason: reason,
        }),
      ).toBe(reason);
    },
  );

  test("a policy that only blocks create_agent leaves the logic map tools alone", () => {
    expect(
      resolveLogicMapToolsUnavailableReason({
        canCreateAgents: false,
        unavailableReason: "create_agent_not_allowed",
      }),
    ).toBeNull();
  });

  test("an agent that can create agents has the tools", () => {
    expect(
      resolveLogicMapToolsUnavailableReason({
        canCreateAgents: true,
        unavailableReason: undefined,
      }),
    ).toBeNull();
  });

  test("no verdict yet and unknown reason codes count as available", () => {
    expect(
      resolveLogicMapToolsUnavailableReason({
        canCreateAgents: undefined,
        unavailableReason: undefined,
      }),
    ).toBeNull();
    expect(
      resolveLogicMapToolsUnavailableReason({
        canCreateAgents: false,
        unavailableReason: "some_new_reason",
      }),
    ).toBeNull();
  });
});
