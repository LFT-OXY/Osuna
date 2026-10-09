import { describe, expect, it } from "vitest";
import { buildLlmsTxt } from "./llms";

function sectionHeadings(llmsTxt: string): string[] {
  return llmsTxt.split("\n").filter((line) => line.startsWith("## "));
}

describe("llms.txt", () => {
  it("links each public doc as markdown", () => {
    expect(buildLlmsTxt()).toMatch(/^- \[[^\]]+\]\(https:\/\/[^/)]+\/docs\/cli\.md\)/m);
  });

  it("has no agent landing page or alternatives section", () => {
    const llmsTxt = buildLlmsTxt();

    expect(sectionHeadings(llmsTxt)).toEqual(["## Docs", "## Optional"]);
    expect(llmsTxt).not.toMatch(/\/alternatives\//);
  });

  it("names only the ways Osuna is actually distributed", () => {
    const llmsTxt = buildLlmsTxt();

    expect(llmsTxt).not.toMatch(/\bnpm\b|Homebrew|\biOS\b|App Store|Play Store/);
    expect(llmsTxt).toContain("https://github.com/LFT-OXY/Osuna/releases");
    expect(llmsTxt).toContain("ghcr.io/lft-oxy/osuna");
  });

  it("links only to pages the site still serves", () => {
    expect(buildLlmsTxt()).not.toMatch(/\]\(https:\/\/[^/)]+\/(blog|sponsor|agents)(\/[^)]*)?\)/);
  });
});
