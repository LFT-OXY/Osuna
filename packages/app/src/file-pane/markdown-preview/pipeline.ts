import type { ComponentProps } from "react";
import type ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema, type Options as SanitizeSchema } from "rehype-sanitize";
import rehypeSlug from "rehype-slug";
import remarkGfm from "remark-gfm";
import { remarkGithubAlerts } from "./github-alerts";

/*
 * 预览的 remark / rehype 插件，单独放一个文件：浏览器测试直接用它渲染，不经过代码块等带原生依赖的组件。
 */

/** 正文里每个顶层块在 Markdown 正文中的起始行号（从 1 起），定位到某一行时按它找块。 */
export const SOURCE_LINE_ATTRIBUTE = "data-source-line";

interface HastLikeNode {
  type: string;
  position?: { start?: { line?: number } };
  properties?: Record<string, unknown>;
  children?: HastLikeNode[];
}

/** 给根下的每个元素记上它的起始行号；没有位置的（插件生成的）跳过。 */
function rehypeSourceLines() {
  return (tree: HastLikeNode) => {
    for (const child of tree.children ?? []) {
      const line = child.position?.start?.line;
      if (child.type !== "element" || typeof line !== "number") continue;
      child.properties = { ...child.properties, dataSourceLine: line };
    }
  };
}

// 默认 schema 即 GitHub 的白名单：保留 align 等排版属性，剥掉 script、style、iframe 与事件属性。
// 链接协议在此基础上收窄到 http(s) / mailto；相对路径与页内锚点不带协议，本就放行。
// 图片另放行 data:（<img> 里的 data 地址不会执行脚本）；只有 data:image/ 能通过 previewUrlTransform。
const PREVIEW_SANITIZE_SCHEMA = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    "*": [...(defaultSchema.attributes?.["*"] ?? []), "dataSourceLine"],
    blockquote: [...(defaultSchema.attributes?.blockquote ?? []), "dataAlert"],
  },
  protocols: {
    ...defaultSchema.protocols,
    href: ["http", "https", "mailto"],
    src: ["http", "https", "data"],
  },
} satisfies SanitizeSchema;

export const REMARK_PLUGINS = [remarkGfm, remarkGithubAlerts];
// 标题的 GitHub 风格 slug id 在消毒前生成，消毒时与原始 HTML 的 id 一样加上 user-content- 前缀，
// 页内锚点点击时再去掉前缀匹配（见 link.web.tsx）。行号在 rehype-raw 之后记（它会重建节点），消毒前记。
export const REHYPE_PLUGINS = [
  rehypeRaw,
  rehypeSlug,
  rehypeSourceLines,
  [rehypeSanitize, PREVIEW_SANITIZE_SCHEMA],
] satisfies NonNullable<ComponentProps<typeof ReactMarkdown>["rehypePlugins"]>;
