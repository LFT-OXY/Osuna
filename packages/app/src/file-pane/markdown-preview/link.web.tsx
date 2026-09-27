/*
 * 页内锚点的 `user-content-` 前缀匹配与仓库内文件链接 chip 移植自 t3code
 * `apps/web/src/components/ChatMarkdown.tsx`（`findMarkdownFragmentTarget`、`MarkdownFileLink`），
 * 打开方式改为 Osuna 的文件标签，锚点只在预览自身的滚动容器内滚动。
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
import { useCallback, useMemo, type ComponentProps, type MouseEvent } from "react";
import type { ExtraProps } from "react-markdown";
import { getFileNameFromPath } from "@/attachments/utils";
import { MaterialFileIcon } from "@/components/material-file-icon";
import { ICON_SIZE } from "@/styles/theme";
import { openExternalUrl } from "@/utils/open-external-url";
import type { WorkspaceFileLocation } from "@/workspace/file-open";
import { resolveMarkdownResource, type MarkdownResourceTarget } from "./resource";
import { useMarkdownPreviewResources } from "./resources-context.web";

type HastNode = NonNullable<ExtraProps["node"]>;
type WorkspaceFileTarget = Extract<MarkdownResourceTarget, { kind: "workspace_file" }>;

// rehype-sanitize 给 id / name 加的防 DOM clobbering 前缀；文中的 `#foo` 不带它。
const SANITIZED_ID_PREFIX = "user-content-";

function containsImage(node: HastNode | undefined): boolean {
  return (
    node?.children.some(
      (child) => child.type === "element" && (child.tagName === "img" || containsImage(child)),
    ) ?? false
  );
}

function findAnchorTarget(root: Element, id: string): HTMLElement | null {
  const ids = new Set([id, id.toLowerCase()]);
  for (const candidate of ids) {
    for (const value of [`${SANITIZED_ID_PREFIX}${candidate}`, candidate]) {
      const escaped = CSS.escape(value);
      const target = root.querySelector<HTMLElement>(`[id="${escaped}"], [name="${escaped}"]`);
      if (target) return target;
    }
  }
  return null;
}

function scrollContainerOf(element: HTMLElement): HTMLElement | null {
  for (let current = element.parentElement; current; current = current.parentElement) {
    const { overflowY } = getComputedStyle(current);
    const scrollable = overflowY === "auto" || overflowY === "scroll";
    if (scrollable && current.scrollHeight > current.clientHeight) return current;
  }
  return null;
}

// 不用 scrollIntoView：它会连带滚动应用外层的 overflow 容器，把界面整体推走。
// 也不用 scrollTo：RN Web 的 ScrollView 在自己的 DOM 节点上换了一个签名不同的 scrollTo。
function scrollToAnchor(link: HTMLElement, id: string): void {
  const root = link.closest(".md-body");
  const target = root ? findAnchorTarget(root, id) : null;
  const container = target ? scrollContainerOf(target) : null;
  if (!target || !container) return;
  const offset = target.getBoundingClientRect().top - container.getBoundingClientRect().top;
  container.scrollTop += offset;
}

function describeLocation(file: WorkspaceFileTarget): string {
  if (!file.lineStart) return file.path;
  const range = file.lineEnd ? `${file.lineStart}-${file.lineEnd}` : `${file.lineStart}`;
  return `${file.path}:${range}`;
}

type AnchorProps = ComponentProps<"a"> & ExtraProps;

interface WorkspaceFileLinkProps extends Omit<AnchorProps, "onClick"> {
  file: WorkspaceFileTarget;
  openWorkspaceFile: (location: WorkspaceFileLocation) => void;
}

function WorkspaceFileLink({
  node,
  file,
  openWorkspaceFile,
  children,
  title,
  ...props
}: WorkspaceFileLinkProps) {
  const open = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      event.preventDefault();
      openWorkspaceFile(file);
    },
    [openWorkspaceFile, file],
  );
  const tooltip = title ?? describeLocation(file);
  // 包着图片的链接（徽章、截图）保留原样，只接管点击。
  if (containsImage(node)) {
    return (
      <a {...props} title={tooltip} onClick={open}>
        {children}
      </a>
    );
  }
  const fileName = getFileNameFromPath(file.path) ?? file.path;
  return (
    <a
      {...props}
      title={tooltip}
      className="md-file-link"
      data-testid="markdown-file-link"
      onClick={open}
    >
      <MaterialFileIcon fileName={fileName} size={ICON_SIZE.sm} />
      <span className="md-file-link-label">{children}</span>
    </a>
  );
}

/**
 * 预览里的链接不能让应用窗口自己导航走：仓库内文件在新文件标签打开，页内锚点在预览内滚动，
 * http(s) 交给系统浏览器，其余（越出工作区、mailto 等）不响应。
 */
export function MarkdownLink({ node, href, ...props }: AnchorProps) {
  const resources = useMarkdownPreviewResources();
  const target = useMemo(
    () =>
      resources && href
        ? resolveMarkdownResource({
            href,
            documentPath: resources.documentPath,
            workspaceRoot: resources.workspaceRoot,
          })
        : null,
    [href, resources],
  );
  const handleClick = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      event.preventDefault();
      if (target?.kind === "anchor") scrollToAnchor(event.currentTarget, target.id);
      // 消毒后的 href 只剩 http(s) / mailto / 无协议地址，external 即 http(s)；
      // 桌面端 opener 对非 http(s) 会抛错，mailto 因此不交出去。
      else if (target?.kind === "external") void openExternalUrl(target.url);
    },
    [target],
  );

  if (target?.kind === "workspace_file" && resources) {
    return (
      <WorkspaceFileLink
        {...props}
        node={node}
        href={href}
        file={target}
        openWorkspaceFile={resources.openWorkspaceFile}
      />
    );
  }
  return <a {...props} href={href} onClick={handleClick} />;
}
