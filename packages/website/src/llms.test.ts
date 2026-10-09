import { describe, expect, it } from "vitest";
import { buildLlmsTxt } from "./llms";

function sectionHeadings(llmsTxt: string): string[] {
  return llmsTxt.split("\n").filter((line) => line.startsWith("## "));
}

describe("llms.txt", () => {
  it("keeps the docs section with a markdown link per public doc", () => {
    const llmsTxt = buildLlmsTxt();

    expect(sectionHeadings(llmsTxt)).toContain("## Docs");
    expect(llmsTxt).toMatch(/^- \[[^\]]+\]\(https:\/\/[^/)]+\/docs\/cli\.md\)/m);
  });

  it("has no agent landing page or alternatives section", () => {
    const llmsTxt = buildLlmsTxt();

    expect(sectionHeadings(llmsTxt)).toEqual(["## Docs", "## Optional"]);
    expect(llmsTxt).not.toMatch(/\/alternatives\//);
  });

  it("links only to pages the site still serves", () => {
    expect(buildLlmsTxt()).not.toMatch(/\]\(https:\/\/[^/)]+\/(blog|sponsor|agents)(\/[^)]*)?\)/);
  });
});
