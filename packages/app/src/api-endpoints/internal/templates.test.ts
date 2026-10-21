import { describe, expect, it } from "vitest";
import type { ApiEndpointTemplate } from "@getpaseo/protocol/api-endpoint/rpc-schemas";
import {
  isTemplateRowAdded,
  siteChoicesOf,
  templatePick,
  templateSections,
  type TemplateSection,
} from "./templates";

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

describe("templatePick", () => {
  const sections = templateSections({ templates: TEMPLATES, query: "", noteText: noTranslation });
  const rowOf = (id: string) => {
    const found = sections.flatMap((section) => section.rows).find((row) => row.template.id === id);
    if (!found) throw new Error(`no row ${id}`);
    return found;
  };
  const endpoint = (id: string, templateId?: string) => ({
    id,
    ...(templateId ? { templateId } : {}),
  });

  it("adds a template not added yet, and opens the first endpoint made from one that is (as magpie)", () => {
    const endpoints = [
      endpoint("ep_custom"),
      endpoint("ep_1", "openai"),
      endpoint("ep_2", "openai"),
    ];

    expect(isTemplateRowAdded(rowOf("openrouter"), endpoints)).toBe(false);
    expect(templatePick(rowOf("openrouter"), endpoints)).toEqual({
      kind: "add",
      templateId: "openrouter",
    });
    expect(isTemplateRowAdded(rowOf("openai"), endpoints)).toBe(true);
    expect(templatePick(rowOf("openai"), endpoints)).toEqual({ kind: "open", endpointId: "ep_1" });
  });

  it("a global and China row adds the side not added yet, then opens the global one's endpoint", () => {
    const row = rowOf("moonshot");

    expect(templatePick(row, [])).toEqual({ kind: "add", templateId: "moonshot" });
    const globalAdded = [endpoint("ep_g", "moonshot")];
    expect(isTemplateRowAdded(row, globalAdded)).toBe(true);
    expect(templatePick(row, globalAdded)).toEqual({ kind: "add", templateId: "moonshot-cn" });
    const chinaAdded = [endpoint("ep_c", "moonshot-cn")];
    expect(templatePick(row, chinaAdded)).toEqual({ kind: "add", templateId: "moonshot" });
    const both = [endpoint("ep_c", "moonshot-cn"), endpoint("ep_g", "moonshot")];
    expect(templatePick(row, both)).toEqual({ kind: "open", endpointId: "ep_g" });
  });
});
