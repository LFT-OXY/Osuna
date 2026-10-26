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
import { memo, type ComponentProps, type RefObject } from "react";
import { useTranslation } from "react-i18next";
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
import { MermaidFence } from "@/components/markdown/fence/mermaid";
import { ICON_SIZE } from "@/styles/theme";
import { MarkdownCodeBlock } from "./code-block.web";
import { isGithubAlertKind, type GithubAlertKind } from "./github-alerts";
import { MarkdownImage } from "./image.web";
import { MarkdownLink } from "./link.web";
import { REHYPE_PLUGINS, REMARK_PLUGINS } from "./pipeline";
import { isDataImageUrl, type MarkdownPreviewResources } from "./resource";
import { MarkdownPreviewResourcesContext } from "./resources-context.web";

type HastNode = NonNullable<ExtraProps["node"]>;
type HastChild = HastNode["children"][number];

// react-markdown 默认会把 data: 地址清空；图片的 data:image/ 放行，其余照默认处理。
function previewUrlTransform(url: string, key: string, node: Readonly<HastNode>): string {
  const isImageSource = key === "src" && node.tagName === "img";
  if (isImageSource && isDataImageUrl(url)) return url;
  return defaultUrlTransform(url);
}

function hastText(node: HastChild): string {
  if (node.type === "text") return node.value;
  if (node.type === "element") return node.children.map(hastText).join("");
  return "";
}

// 上游删掉了 fence/language.ts；预览只需要信息串的第一个词。
function getMarkdownFenceLanguage(info: string | null | undefined): string | null {
  return info?.trim().split(/\s+/)[0]?.toLowerCase() || null;
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

function MarkdownPre({ node, children, ...props }: ComponentProps<"pre"> & ExtraProps) {
  const fence = readFence(node);
  if (fence?.language === "mermaid") {
    return <MermaidFence code={fence.code} />;
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
  /** 正文容器，直接子元素是带 data-source-line 的顶层块（滚到指定行时用）。 */
  bodyRef: RefObject<HTMLDivElement | null>;
}

export const DomMarkdown = memo(function DomMarkdown({
  source,
  resources,
  bodyRef,
}: DomMarkdownProps) {
  return (
    <MarkdownPreviewResourcesContext.Provider value={resources}>
      <div className="md-body" ref={bodyRef}>
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
