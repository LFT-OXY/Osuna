import { describe, expect, it } from "vitest";
import type { ApiEndpointTemplate } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import { siteChoicesOf, templateSections, type TemplateSection } from "./templates";

function template(
  id: string,
  group: string,
  extra: Partial<ApiEndpointTemplate> = {},
): ApiEndpointTemplate {
  return {
    id,
    name: id.toUpperCase(),
    group,
    baseUrls: [{ format: "openai_chat", url: `https://api.${id}.example/v1` }],
    modelsDevIds: [],
    ...extra,
  };
}

const TEMPLATES = [
  template("openai", "vendor", { name: "OpenAI" }),
  template("moonshot", "vendor", { name: "Kimi" }),
  template("moonshot-cn", "vendor", {
    name: "Kimi (China)",
    baseUrls: [{ format: "openai_chat", url: "https://api.moonshot.cn/v1" }],
  }),
  template("kimi-code", "vendor", { name: "Kimi Code", note: "Membership" }),
  template("openrouter", "relay", { name: "OpenRouter" }),
  template("ollama", "local", { name: "Ollama" }),
  template("someday", "future", { name: "Someday" }),
];

const noTranslation = (note: string) => note;

function rowsOf(section: TemplateSection): [string, string | null][] {
  return section.rows.map((row) => [row.template.id, row.chinaSite?.id ?? null]);
}

function idsOf(sections: TemplateSection[]): string[] {
  return sections.flatMap((section) => section.rows.map((row) => row.template.id));
}

describe("templateSections", () => {
  it("groups vendors, relay services and local servers in that order, a China site on its global row", () => {
    const sections = templateSections({ templates: TEMPLATES, query: "", noteText: noTranslation });

    expect(sections.map((section) => ({ group: section.group, rows: rowsOf(section) }))).toEqual([
      {
        group: "vendor",
        rows: [
          ["openai", null],
          ["moonshot", "moonshot-cn"],
          ["kimi-code", null],
        ],
      },
      { group: "relay", rows: [["openrouter", null]] },
      { group: "local", rows: [["ollama", null]] },
    ]);
  });

  it("finds by name, id, host and note, in any case, and a China site's host finds its row", () => {
    const find = (query: string, noteText = noTranslation) =>
      idsOf(templateSections({ templates: TEMPLATES, query, noteText }));

    expect(find("kimi")).toEqual(["moonshot", "kimi-code"]);
    expect(find("OPENROUTER")).toEqual(["openrouter"]);
    expect(find("api.openai.example")).toEqual(["openai"]);
    expect(find("moonshot.cn")).toEqual(["moonshot"]);
    expect(find("membership")).toEqual(["kimi-code"]);
    expect(find("会员", (note) => (note === "Membership" ? "会员" : note))).toEqual(["kimi-code"]);
    expect(find("  ")).toHaveLength(5);
    expect(find("nothing like it")).toEqual([]);
  });
});

describe("siteChoicesOf", () => {
  it("offers the global and China site of a pair, from either side, and none for a template alone", () => {
    expect(siteChoicesOf(TEMPLATES, "moonshot")).toEqual([
      { templateId: "moonshot", area: "global" },
      { templateId: "moonshot-cn", area: "china" },
    ]);
    expect(siteChoicesOf(TEMPLATES, "moonshot-cn")).toEqual([
      { templateId: "moonshot", area: "global" },
      { templateId: "moonshot-cn", area: "china" },
    ]);
    expect(siteChoicesOf(TEMPLATES, "openai")).toBeNull();
  });
});
