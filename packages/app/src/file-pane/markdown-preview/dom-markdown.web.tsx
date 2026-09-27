/*
 * 渲染管线移植自 t3code `apps/web/src/components/ChatMarkdown.tsx`：remark-gfm + GitHub 提示块 +
 * rehype-raw + rehype-sanitize，去掉了 t3code 特有的协议、codex directives 与流式渲染。
 *
 * MIT License
 *
 * Copyright (c) 2026 T3 Tools Inc.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import { memo, useCallback, type ComponentProps, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import type { TextStyle } from "react-native";
import {
  Info,
  Lightbulb,
  MessageSquareWarning,
  OctagonAlert,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react-native";
import ReactMarkdown, {
  defaultUrlTransform,
  type Components,
  type ExtraProps,
} from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema, type Options as SanitizeSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { withUnistyles } from "react-native-unistyles";
import { getMarkdownFenceLanguage } from "@/components/markdown/fence/language";
import { MermaidFence } from "@/components/markdown/fence/mermaid";
import { createMarkdownStyles } from "@/styles/markdown-styles";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { openExternalUrl } from "@/utils/open-external-url";
import { MarkdownCodeBlock } from "./code-block.web";
import { isGithubAlertKind, remarkGithubAlerts, type GithubAlertKind } from "./github-alerts";
import { MarkdownImage } from "./image.web";
import { isDataImageUrl, type MarkdownPreviewResources } from "./resource";
import { MarkdownPreviewResourcesContext } from "./resources-context.web";

type HastNode = NonNullable<ExtraProps["node"]>;
type HastChild = HastNode["children"][number];

// 默认 schema 即 GitHub 的白名单：保留 align 等排版属性，剥掉 script、style、iframe 与事件属性。
// 链接协议在此基础上收窄到 http(s) / mailto；相对路径与页内锚点不带协议，本就放行。
// 图片另放行 data:（<img> 里的 data 地址不会执行脚本）；只有 data:image/ 能通过 previewUrlTransform。
const PREVIEW_SANITIZE_SCHEMA = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    blockquote: [...(defaultSchema.attributes?.blockquote ?? []), "dataAlert"],
  },
  protocols: {
    ...defaultSchema.protocols,
    href: ["http", "https", "mailto"],
    src: ["http", "https", "data"],
  },
} satisfies SanitizeSchema;

const REMARK_PLUGINS = [remarkGfm, remarkGithubAlerts];
const REHYPE_PLUGINS = [rehypeRaw, [rehypeSanitize, PREVIEW_SANITIZE_SCHEMA]] satisfies NonNullable<
  ComponentProps<typeof ReactMarkdown>["rehypePlugins"]
>;

// react-markdown 默认会把 data: 地址清空；图片的 data:image/ 放行，其余照默认处理。
function previewUrlTransform(url: string, key: string, node: Readonly<HastNode>): string {
  const isImageSource = key === "src" && node.tagName === "img";
  if (isImageSource && isDataImageUrl(url)) return url;
  return defaultUrlTransform(url);
}

const EMPTY_TEXT_STYLE: TextStyle = {};

function hastText(node: HastChild): string {
  if (node.type === "text") return node.value;
  if (node.type === "element") return node.children.map(hastText).join("");
  return "";
}

interface MarkdownFence {
  language: string | null;
  code: string;
}

function readFence(node: HastNode | undefined): MarkdownFence | null {
  const code = node?.children.find(
    (child): child is HastNode => child.type === "element" && child.tagName === "code",
  );
  if (!code) return null;
  const className = code.properties.className;
  const languageClass = Array.isArray(className)
    ? className.find((name) => typeof name === "string" && name.startsWith("language-"))
    : undefined;
  return {
    language: getMarkdownFenceLanguage(
      typeof languageClass === "string" ? languageClass.slice("language-".length) : null,
    ),
    code: hastText(code),
  };
}

interface PreviewMermaidFenceProps {
  code: string;
  textStyle: TextStyle;
}

function PreviewMermaidFence({ code, textStyle }: PreviewMermaidFenceProps) {
  return (
    <MermaidFence
      code={code}
      phase="complete"
      inheritedStyles={EMPTY_TEXT_STYLE}
      textStyle={textStyle}
    />
  );
}

const ThemedPreviewMermaidFence = withUnistyles(PreviewMermaidFence);
function mapFenceStyle(theme: Theme) {
  return { textStyle: createMarkdownStyles(theme).fence };
}

function MarkdownPre({ node, children, ...props }: ComponentProps<"pre"> & ExtraProps) {
  const fence = readFence(node);
  if (fence?.language === "mermaid") {
    return <ThemedPreviewMermaidFence code={fence.code} uniProps={mapFenceStyle} />;
  }
  if (fence) {
    return <MarkdownCodeBlock language={fence.language} code={fence.code} />;
  }
  // 手写的 <pre>（内部没有 <code>）不带头部，原样等宽显示。
  // data-pmono 让全局界面字体规则跳过代码（见 styles/code-surface.ts）。
  return (
    <pre {...props} data-pmono="">
      {children}
    </pre>
  );
}

function MarkdownCode({ node: _node, ...props }: ComponentProps<"code"> & ExtraProps) {
  return <code {...props} data-pmono="" />;
}

function isWebHref(href: string | undefined): href is string {
  return href !== undefined && /^https?:\/\//i.test(href);
}

function MarkdownLink({ node: _node, href, ...props }: ComponentProps<"a"> & ExtraProps) {
  // 预览里的链接不能让应用窗口自己导航走：http(s) 交给系统浏览器，其余先不响应。
  // 桌面端 opener 对非 http(s) 会抛错，所以只把 http(s) 交出去。
  const openInBrowser = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      event.preventDefault();
      if (isWebHref(href)) void openExternalUrl(href);
    },
    [href],
  );
  return <a {...props} href={href} onClick={openInBrowser} />;
}

const GITHUB_ALERT_ICONS: Record<GithubAlertKind, LucideIcon> = {
  note: Info,
  tip: Lightbulb,
  important: MessageSquareWarning,
  warning: TriangleAlert,
  caution: OctagonAlert,
};

function MarkdownBlockquote({
  node,
  children,
  ...props
}: ComponentProps<"blockquote"> & ExtraProps) {
  const { t } = useTranslation();
  const kind = node?.properties.dataAlert;
  if (!isGithubAlertKind(kind)) {
    return <blockquote {...props}>{children}</blockquote>;
  }
  const Icon = GITHUB_ALERT_ICONS[kind];
  // 不用 <blockquote>：样式表把引用正文调暗，而提示块正文是普通文字，只有标题着色。
  return (
    <div role="note" className="md-alert" data-alert={kind}>
      <p className="md-alert-title">
        <Icon aria-hidden size={ICON_SIZE.sm} color="currentColor" />
        {t(`panels.file.markdownAlerts.${kind}`)}
      </p>
      {children}
    </div>
  );
}

function MarkdownTable({ node: _node, ...props }: ComponentProps<"table"> & ExtraProps) {
  return (
    <div className="md-table-scroll">
      <table {...props} />
    </div>
  );
}

const COMPONENTS = {
  pre: MarkdownPre,
  code: MarkdownCode,
  a: MarkdownLink,
  blockquote: MarkdownBlockquote,
  table: MarkdownTable,
  img: MarkdownImage,
} satisfies Components;

interface DomMarkdownProps {
  source: string;
  resources: MarkdownPreviewResources;
}

export const DomMarkdown = memo(function DomMarkdown({ source, resources }: DomMarkdownProps) {
  return (
    <MarkdownPreviewResourcesContext.Provider value={resources}>
      <div className="md-body">
        <ReactMarkdown
          remarkPlugins={REMARK_PLUGINS}
          rehypePlugins={REHYPE_PLUGINS}
          components={COMPONENTS}
          urlTransform={previewUrlTransform}
        >
          {source}
        </ReactMarkdown>
      </div>
    </MarkdownPreviewResourcesContext.Provider>
  );
});
