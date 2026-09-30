import { describe, expect, it } from "vitest";
import { i18n } from "@/i18n/i18next";
import type { CheckStatus } from "./check-status";
import {
  formatChecksCount,
  formatChecksGroupLabel,
  formatChecksHeadline,
  PRESENTATION_ORDER,
  summarizeChecks,
} from "./checks-summary";
import type { PrPaneCheck } from "./data";

function check(name: string, status: CheckStatus): PrPaneCheck {
  return { provider: "github", name, status, url: `https://example.test/${name}` };
}

describe("summarizeChecks", () => {
  it("reports no checks without claiming the run passed", () => {
    const summary = summarizeChecks([]);

    expect(summary.outcome).toBe("none");
    expect(summary.parts).toEqual([]);
    expect(summary.total).toBe(0);
    expect(summary.groups).toEqual([]);
  });

  it("leads with failures when anything failed", () => {
    const summary = summarizeChecks([
      check("build", "success"),
      check("lint", "failure"),
      check("e2e", "pending"),
    ]);

    expect(summary.outcome).toBe("failure");
    expect(summary.parts).toEqual([
      { status: "failure", count: 1 },
      { status: "pending", count: 1 },
      { status: "success", count: 1 },
    ]);
    expect(summary.groups.map((group) => group.status)).toEqual(["failure", "pending", "success"]);
  });

  it("reports an unfinished run as in progress when nothing failed", () => {
    const summary = summarizeChecks([check("build", "success"), check("e2e", "pending")]);

    expect(summary.outcome).toBe("pending");
  });

  it("treats a run of only successes and skips as passed", () => {
    const summary = summarizeChecks([check("build", "success"), check("deploy", "skipped")]);

    expect(summary.outcome).toBe("success");
    expect(summary.parts).toEqual([
      { status: "success", count: 1 },
      { status: "ignored", count: 1 },
    ]);
  });

  it("keeps the checks of each group together with their count", () => {
    const summary = summarizeChecks([
      check("build", "failure"),
      check("lint", "success"),
      check("test", "failure"),
    ]);

    const [failing, successful] = summary.groups;
    expect(failing?.count).toBe(2);
    expect(failing?.checks.map((item) => item.name)).toEqual(["build", "test"]);
    expect(successful?.count).toBe(1);
  });
});

describe("checks summary copy", () => {
  it.each([
    ["none", "No checks"],
    ["failure", "Some checks were not successful"],
    ["pending", "Some checks haven't completed yet"],
    ["success", "All checks have passed"],
    ["actionRequired", "Some checks need your attention"],
  ] as const)("renders the %s headline in English", (outcome, english) => {
    expect(formatChecksHeadline(i18n.t, outcome)).toBe(english);
  });

  it("renders the count line with a plural noun", () => {
    const summary = summarizeChecks([
      check("build", "success"),
      check("lint", "failure"),
      check("e2e", "pending"),
    ]);

    expect(formatChecksCount(i18n.t, summary.parts, summary.total)).toBe(
      "1 failing, 1 in progress, 1 successful checks",
    );
  });

  it("says check rather than checks for a run of one", () => {
    const summary = summarizeChecks([check("build", "failure")]);

    expect(formatChecksCount(i18n.t, summary.parts, summary.total)).toBe("1 failing check");
  });

  it("renders skipped checks in the count line", () => {
    const summary = summarizeChecks([check("build", "success"), check("deploy", "skipped")]);

    expect(formatChecksCount(i18n.t, summary.parts, summary.total)).toBe(
      "1 successful, 1 skipped checks",
    );
  });

  it("labels each group with its counted noun", () => {
    const summary = summarizeChecks([
      check("build", "failure"),
      check("lint", "success"),
      check("test", "failure"),
    ]);

    const [failing, successful] = summary.groups;
    expect(failing && formatChecksGroupLabel(i18n.t, failing)).toBe("2 failing checks");
    expect(successful && formatChecksGroupLabel(i18n.t, successful)).toBe("1 successful check");
  });

  it("has a count phrase for every check presentation", () => {
    for (const status of PRESENTATION_ORDER) {
      expect(i18n.exists(`workspace.git.pr.checks.count.${status}`), status).toBe(true);
    }
  });
});
