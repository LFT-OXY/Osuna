import { afterEach, describe, expect, it } from "vitest";
import { i18n } from "@/i18n/i18next";
import { diffDocumentLabels } from "./labels";

describe("diff document labels", () => {
  afterEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("writes a large file's changed line count with thousands separators", async () => {
    await i18n.changeLanguage("en");
    expect(diffDocumentLabels(i18n.t).linesChanged(1500)).toBe("1,500 lines changed");
    expect(diffDocumentLabels(i18n.t).linesChanged(1234567)).toBe("1,234,567 lines changed");
  });

  it("uses the Chinese wording in a Chinese interface", async () => {
    await i18n.changeLanguage("zh-CN");
    expect(diffDocumentLabels(i18n.t).linesChanged(1500)).toBe("改动 1,500 行");
  });
});
