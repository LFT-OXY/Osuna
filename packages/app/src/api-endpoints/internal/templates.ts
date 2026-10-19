// 模板列表的分组、搜索与国际站 / 中国站配对照 magpie（https://github.com/yetone/magpie，internal/gui/assets/app.js 的
// renderAddSheet、chinaOf、pairTile，7597c132）。Copyright (c) 2026 yetone. MIT License — 完整声明见本仓库 THIRD_PARTY_NOTICES。
import type { ApiEndpointTemplate } from "@getpaseo/protocol/api-endpoint/rpc-schemas";

/*
 * 「+」先出的模板列表：厂商、中转服务、本机三组，按 daemon 给的顺序；认不出的分组不显示（照 magpie）。
 * 中国站是一个 id 为「国际站 id + -cn」的模板，并在国际站那一行，进表单后再切「国际 / 中国」。
 */

export const TEMPLATE_GROUPS = ["vendor", "relay", "local"] as const;
export type TemplateGroup = (typeof TEMPLATE_GROUPS)[number];

export interface TemplateRow {
  template: ApiEndpointTemplate;
  // 同一厂商的中国站；没有为 null。
  chinaSite: ApiEndpointTemplate | null;
}

export interface TemplateSection {
  group: TemplateGroup;
  rows: TemplateRow[];
}

export type TemplateArea = "global" | "china";

export interface TemplateSiteChoice {
  templateId: string;
  area: TemplateArea;
}

const CHINA_SUFFIX = "-cn";

function chinaSiteOf(
  templates: readonly ApiEndpointTemplate[],
  global: ApiEndpointTemplate,
): ApiEndpointTemplate | null {
  return templates.find((candidate) => candidate.id === global.id + CHINA_SUFFIX) ?? null;
}

function globalSiteOf(
  templates: readonly ApiEndpointTemplate[],
  template: ApiEndpointTemplate,
): ApiEndpointTemplate | null {
  if (!template.id.endsWith(CHINA_SUFFIX)) return null;
  const globalId = template.id.slice(0, -CHINA_SUFFIX.length);
  return templates.find((candidate) => candidate.id === globalId) ?? null;
}

// 搜索看的那个地址：照 magpie 先取 Chat，再 Responses，最后 Anthropic。
const HOST_FORMATS = ["openai_chat", "openai_responses", "anthropic_messages"];

function hostOf(template: ApiEndpointTemplate): string {
  for (const format of HOST_FORMATS) {
    const url = template.baseUrls.find((entry) => entry.format === format)?.url;
    if (url) return url.replace(/^[a-z]+:\/\//i, "").split("/")[0] ?? "";
  }
  return "";
}

/**
 * 按搜索词分好组的行；搜索不分大小写，看名称、id、地址的主机名与说明（说明也按界面语言找，noteText 把英文换成显示的文字）。
 * 国际站或中国站有一边对得上，整行就留下。
 */
export function templateSections(input: {
  templates: readonly ApiEndpointTemplate[];
  query: string;
  noteText: (note: string) => string;
}): TemplateSection[] {
  const { templates, noteText } = input;
  const query = input.query.trim().toLowerCase();
  function hits(template: ApiEndpointTemplate): boolean {
    if (query === "") return true;
    const note = template.note ?? "";
    return [template.name, template.id, hostOf(template), note, note ? noteText(note) : ""].some(
      (text) => text.toLowerCase().includes(query),
    );
  }
  return TEMPLATE_GROUPS.flatMap((group) => {
    const rows = templates
      .filter((template) => template.group === group && !globalSiteOf(templates, template))
      .map((template) => ({ template, chinaSite: chinaSiteOf(templates, template) }))
      .filter((row) => hits(row.template) || (row.chinaSite !== null && hits(row.chinaSite)));
    return rows.length > 0 ? [{ group, rows }] : [];
  });
}

/** 表单里的「国际 / 中国」：模板有另一边时给两项（国际在前），没有为 null。 */
export function siteChoicesOf(
  templates: readonly ApiEndpointTemplate[],
  templateId: string,
): TemplateSiteChoice[] | null {
  const template = templates.find((candidate) => candidate.id === templateId);
  if (!template) return null;
  const global = globalSiteOf(templates, template) ?? template;
  const china = chinaSiteOf(templates, global);
  if (!china) return null;
  return [
    { templateId: global.id, area: "global" },
    { templateId: china.id, area: "china" },
  ];
}
