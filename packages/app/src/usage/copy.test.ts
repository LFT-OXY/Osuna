import { expect, test } from "vitest";
import { i18n } from "@/i18n/i18next";
import { usageCopy } from "./copy";

test.each([
  [
    { kind: "expired", expiresAt: "2026-10-01T09:00:00Z", refreshedBy: "claude" },
    "Login expired 3h ago. Run claude to refresh it.",
  ],
  [{ kind: "expired", expiresAt: "2026-10-01T09:00:00Z" }, "Login expired 3h ago. Sign in again."],
  [
    { kind: "rejected", status: 403, refreshedBy: "codex" },
    "Login rejected (HTTP 403). Run codex to refresh it.",
  ],
  [{ kind: "rejected", status: 401 }, "Login rejected (HTTP 401). Sign in again."],
  [{ kind: "no_quota", detail: "No active coding plan" }, "No active coding plan"],
] as const)("problem %j", (problem, sentence) => {
  expect(usageCopy.problem(problem, new Date("2026-10-01T12:00:00Z"))).toBe(sentence);
});

test("a problem reads in the app's language, elapsed time included", async () => {
  await i18n.changeLanguage("zh-CN");
  try {
    expect(
      usageCopy.problem(
        { kind: "expired", expiresAt: "2026-10-01T09:00:00Z", refreshedBy: "claude" },
        new Date("2026-10-01T12:00:00Z"),
      ),
    ).toBe("登录已过期（3 小时前）。运行 claude 以刷新登录。");
  } finally {
    await i18n.changeLanguage("en");
  }
});

test("the sidebar summary's name joins its windows the way the language punctuates a list", async () => {
  const windows = ["Claude Session 31% used", "Codex Weekly 12% used"];
  expect(usageCopy.summary("Plan usage", windows)).toBe(
    "Plan usage: Claude Session 31% used, Codex Weekly 12% used",
  );
  await i18n.changeLanguage("zh-CN");
  try {
    expect(
      usageCopy.summary("套餐用量", ["Claude Session 已用 31%", "Codex Weekly 已用 12%"]),
    ).toBe("套餐用量：Claude Session 已用 31%，Codex Weekly 已用 12%");
  } finally {
    await i18n.changeLanguage("en");
  }
});
