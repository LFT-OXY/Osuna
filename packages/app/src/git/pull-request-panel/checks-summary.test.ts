import { describe, expect, it } from "vitest";
import { CHECK_TRAIT_ACTION_REQUIRED } from "@getpaseo/protocol/check-traits";
import { i18n } from "@/i18n/i18next";
import type { CheckStatus } from "./check-status";
import { PRESENTATION_ORDER, summarizeChecks } from "./checks-summary";
import type { PrPaneCheck } from "./data";

function check(name: string, status: CheckStatus, traits?: string[]): PrPaneCheck {
  return { provider: "github", name, status, url: `https://example.test/${name}`, traits };
}

describe("summarizeChecks", () => {
  it("reports no checks without claiming the run passed", () => {
    const summary = summarizeChecks([], i18n.t);

    expect(summary.outcome).toBe("none");
    expect(summary.headline).toBe("No checks");
    expect(summary.detail).toBe("");
    expect(summary.parts).toEqual([]);
    expect(summary.accessibilityLabel).toBe("No checks");
    expect(summary.total).toBe(0);
    expect(summary.groups).toEqual([]);
  });

  it("leads with failures when anything failed", () => {
    const summary = summarizeChecks(
      [check("build", "success"), check("lint", "failure"), check("e2e", "pending")],
      i18n.t,
    );

    expect(summary.outcome).toBe("failure");
    expect(summary.headline).toBe("Some checks were not successful");
    expect(summary.detail).toBe("1 failing, 1 in progress, 1 successful checks");
    expect(summary.parts).toEqual([
      { status: "failure", count: 1, lead: "", text: "1 failing" },
      { status: "pending", count: 1, lead: ", ", text: "1 in progress" },
      { status: "success", count: 1, lead: ", ", text: "1 successful" },
    ]);
    expect(summary.accessibilityLabel).toBe(
      "Some checks were not successful. 1 failing, 1 in progress, 1 successful checks",
    );
    expect(summary.groups.map((group) => group.status)).toEqual(["failure", "pending", "success"]);
  });

  it("reports an unfinished run as in progress when nothing failed", () => {
    const summary = summarizeChecks([check("build", "success"), check("e2e", "pending")], i18n.t);

    expect(summary.outcome).toBe("pending");
    expect(summary.headline).toBe("Some checks haven't completed yet");
    expect(summary.detail).toBe("1 in progress, 1 successful checks");
  });

  it("treats a run of only successes and skips as passed", () => {
    const summary = summarizeChecks(
      [check("build", "success"), check("deploy", "skipped")],
      i18n.t,
    );

    expect(summary.outcome).toBe("success");
    expect(summary.headline).toBe("All checks have passed");
    expect(summary.detail).toBe("1 successful, 1 skipped checks");
    expect(summary.parts).toEqual([
      { status: "success", count: 1, lead: "", text: "1 successful" },
      { status: "ignored", count: 1, lead: ", ", text: "1 skipped" },
    ]);
  });

  it("asks for attention when a check needs action", () => {
    const summary = summarizeChecks(
      [check("build", "success"), check("deploy", "pending", [CHECK_TRAIT_ACTION_REQUIRED])],
      i18n.t,
    );

    expect(summary.outcome).toBe("actionRequired");
    expect(summary.headline).toBe("Some checks need your attention");
  });

  it("keeps the checks of each group together under a counted label", () => {
    const summary = summarizeChecks(
      [check("build", "failure"), check("lint", "success"), check("test", "failure")],
      i18n.t,
    );

    const [failing, successful] = summary.groups;
    expect(failing?.label).toBe("2 failing checks");
    expect(failing?.checks.map((item) => item.name)).toEqual(["build", "test"]);
    expect(successful?.label).toBe("1 successful check");
    expect(successful?.checks.map((item) => item.name)).toEqual(["lint"]);
  });

  it("has a count phrase for every check presentation", () => {
    for (const status of PRESENTATION_ORDER) {
      expect(i18n.exists(`workspace.git.pr.checksOverview.count.${status}`), status).toBe(true);
    }
  });

  it("says check rather than checks for a run of one", () => {
    const summary = summarizeChecks([check("build", "failure")], i18n.t);

    expect(summary.detail).toBe("1 failing check");
  });

  it("reads in the active app language", async () => {
    await i18n.changeLanguage("fr");
    try {
      const summary = summarizeChecks(
        [
          check("build", "success"),
          check("deploy", "skipped"),
          check("lint", "failure"),
          check("test", "failure"),
        ],
        i18n.t,
      );

      expect(summary.headline).toBe("Certaines vérifications ont échoué");
      expect(summary.detail).toBe("Vérifications : 2 en échec, 1 réussie(s), 1 ignorée(s)");
      expect(summary.groups.map((group) => group.label)).toEqual([
        "2 vérifications en échec",
        "1 vérification réussie",
        "1 vérification ignorée",
      ]);
      expect(summarizeChecks([], i18n.t).headline).toBe("Aucune vérification");
    } finally {
      await i18n.changeLanguage("en");
    }
  });

  it("joins the count phrases the way the language punctuates a list", async () => {
    await i18n.changeLanguage("zh-CN");
    try {
      const summary = summarizeChecks(
        [check("build", "success"), check("lint", "failure"), check("test", "failure")],
        i18n.t,
      );

      expect(summary.parts.map((part) => `${part.lead}${part.text}`)).toEqual([
        "2 项失败",
        "，1 项成功",
      ]);
      expect(summary.detail).toBe("2 项失败，1 项成功");
      expect(summary.accessibilityLabel).toBe("部分检查未通过。2 项失败，1 项成功");
      expect(summary.groups.map((group) => group.label)).toEqual(["2 项失败", "1 项成功"]);
    } finally {
      await i18n.changeLanguage("en");
    }
  });
});
