// 范围用例取自 magpie（https://github.com/yetone/magpie，internal/provider/concurrency.go 的 SetQuotaRest、SetRestCap）
// Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。

import { describe, expect, it } from "vitest";
import { cooldownSettingsProblem } from "./cooldown-settings.js";

describe("cooldown settings in range (magpie SetQuotaRest, SetRestCap)", () => {
  it("takes whole minutes from 0 to eight days", () => {
    expect(cooldownSettingsProblem({})).toBeNull();
    expect(cooldownSettingsProblem({ quotaRestMinutes: 0, restCapMinutes: 11_520 })).toBeNull();
  });

  it("names the first field out of range: negative, past eight days, or not whole", () => {
    expect(cooldownSettingsProblem({ quotaRestMinutes: -1 })).toEqual({
      field: "quotaRestMinutes",
    });
    expect(cooldownSettingsProblem({ restCapMinutes: 11_521 })).toEqual({
      field: "restCapMinutes",
    });
    expect(cooldownSettingsProblem({ quotaRestMinutes: 1.5, restCapMinutes: -1 })).toEqual({
      field: "quotaRestMinutes",
    });
  });
});
