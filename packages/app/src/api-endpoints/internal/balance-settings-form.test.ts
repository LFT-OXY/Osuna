import { describe, expect, it } from "vitest";
import {
  balanceFieldsOf,
  balanceSettingsOf,
  hasBalanceSettings,
  hasLoneTeamId,
  isZhipuAddress,
} from "./balance-settings-form";

describe("GLM team IDs in the balance settings", () => {
  it("are sent with no balance URL, trimmed, and left out when empty", () => {
    const fields = {
      ...balanceFieldsOf(undefined),
      balanceTeamOrgIdText: " org-1 ",
      balanceTeamProjectIdText: "proj-1",
    };
    expect(balanceSettingsOf(fields)).toEqual({ teamOrgId: "org-1", teamProjectId: "proj-1" });
    expect(hasBalanceSettings(fields)).toBe(true);
    const withUrl = { ...fields, balanceUrlText: "https://relay.example/api/usage/token" };
    expect(balanceSettingsOf(withUrl)).toEqual({
      url: "https://relay.example/api/usage/token",
      teamOrgId: "org-1",
      teamProjectId: "proj-1",
    });
    expect(balanceSettingsOf(balanceFieldsOf(undefined))).toEqual({});
  });

  it("are given both or neither: one alone holds the save, as in magpie", () => {
    const empty = balanceFieldsOf(undefined);
    expect(hasLoneTeamId(empty)).toBe(false);
    expect(hasLoneTeamId({ ...empty, balanceTeamOrgIdText: "org-1" })).toBe(true);
    expect(hasLoneTeamId({ ...empty, balanceTeamProjectIdText: " p " })).toBe(true);
    expect(
      hasLoneTeamId({ ...empty, balanceTeamOrgIdText: "org-1", balanceTeamProjectIdText: "p" }),
    ).toBe(false);
  });

  it("are read back from the saved settings", () => {
    const fields = balanceFieldsOf({ teamOrgId: "org-1", teamProjectId: "proj-1" });
    expect(fields.balanceTeamOrgIdText).toBe("org-1");
    expect(fields.balanceTeamProjectIdText).toBe("proj-1");
  });

  it("are offered only for an endpoint at Zhipu's or Z.ai's address", () => {
    expect(isZhipuAddress(["", "https://open.bigmodel.cn/api/anthropic", ""])).toBe(true);
    expect(isZhipuAddress(["https://api.z.ai/api/coding/paas/v4", "", ""])).toBe(true);
    expect(isZhipuAddress(["https://api.deepseek.com", "", ""])).toBe(false);
    expect(isZhipuAddress(["not a url", "", ""])).toBe(false);
  });
});
