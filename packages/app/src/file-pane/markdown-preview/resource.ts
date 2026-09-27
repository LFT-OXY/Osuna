import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";

/** 文件面板交给预览、用于解析相对资源的上下文（仅 Web 版使用）。 */
export interface MarkdownPreviewResources {
  client: DaemonClient | null;
  workspaceRoot: string;
  /** 当前 Markdown 文件的路径：工作区相对路径或绝对路径。 */
  documentPath: string;
  /** 面板可见时才读取资源，与文件面板自身的读取闸门一致。 */
  enabled: boolean;
  /** daemon 支持文件订阅时，资源在磁盘上变更后自动刷新。 */
  liveUpdates: boolean;
}

export type MarkdownResourceTarget =
  | { kind: "external"; url: string }
  /** `path` 为规范化后的工作区相对路径（`/` 分隔）。 */
  | { kind: "workspace_file"; path: string }
  | { kind: "outside_workspace" }
  | { kind: "unsupported" };

const WEB_URL_PATTERN = /^https?:/i;
const DATA_IMAGE_URL_PATTERN = /^data:image\//i;
const URI_SCHEME_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const WINDOWS_DRIVE_PATTERN = /^[A-Za-z]:(?:\/|$)/;

const UNSUPPORTED: MarkdownResourceTarget = { kind: "unsupported" };
const OUTSIDE_WORKSPACE: MarkdownResourceTarget = { kind: "outside_workspace" };

function toSlashes(value: string): string {
  return value.replace(/\\/g, "/");
}

export function isDataImageUrl(url: string): boolean {
  return DATA_IMAGE_URL_PATTERN.test(url);
}

// 不成对的 `%`（如文件名本身含 `%`）按字面处理。
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch (error) {
    if (error instanceof URIError) return value;
    throw error;
  }
}

function upperCaseDrive(path: string): string {
  return WINDOWS_DRIVE_PATTERN.test(path) ? `${path[0].toUpperCase()}${path.slice(1)}` : path;
}

function isAbsolute(path: string): boolean {
  return path.startsWith("/") || WINDOWS_DRIVE_PATTERN.test(path);
}

function normalizeRoot(workspaceRoot: string): string | null {
  const root = toSlashes(workspaceRoot.trim()).replace(/\/+$/, "");
  if (root === "") return workspaceRoot.trim().startsWith("/") ? "" : null;
  if (!isAbsolute(root)) return null;
  return upperCaseDrive(root);
}

/** 绝对路径落在工作区内时返回相对部分，否则返回 null。盘符大小写不敏感。 */
function relativeToRoot(absolutePath: string, root: string): string | null {
  const path = upperCaseDrive(absolutePath);
  if (path === root) return "";
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : null;
}

/** 依次应用 `.` 与 `..`；越过工作区根返回 null。 */
function resolveSegments(base: string[], relativePath: string): string[] | null {
  const segments = [...base];
  for (const segment of relativePath.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) return null;
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments;
}

/** 当前文件所在目录（工作区相对的路径段）；文件不在工作区内时返回 null。 */
function documentDirectory(documentPath: string, root: string): string[] | null {
  const path = toSlashes(documentPath.trim());
  if (path.startsWith("~")) return null;
  const relative = isAbsolute(path) ? relativeToRoot(path, root) : path;
  if (relative === null) return null;
  const segments = resolveSegments([], relative);
  return segments ? segments.slice(0, -1) : null;
}

function readPath(href: string): string {
  return toSlashes(safeDecode(href.split(/[?#]/, 1)[0] ?? ""));
}

function workspaceFile(segments: string[] | null): MarkdownResourceTarget {
  if (!segments) return OUTSIDE_WORKSPACE;
  return segments.length > 0 ? { kind: "workspace_file", path: segments.join("/") } : UNSUPPORTED;
}

export interface MarkdownResourceInput {
  href: string;
  documentPath: string;
  workspaceRoot: string;
}

/**
 * 预览里资源地址的分类。相对路径相对当前文件所在目录；以 `/` 开头的路径若落在工作区内按磁盘
 * 绝对路径处理，否则按 GitHub 约定视为仓库根相对。
 */
export function resolveMarkdownResource(input: MarkdownResourceInput): MarkdownResourceTarget {
  const href = input.href.trim();
  if (WEB_URL_PATTERN.test(href) || isDataImageUrl(href)) return { kind: "external", url: href };
  const hasNoPath = href === "" || /^[#?]/.test(href);
  const isProtocolRelative = href.startsWith("//");
  if (hasNoPath || isProtocolRelative) return UNSUPPORTED;

  const path = readPath(href);
  if (path.startsWith("~")) return OUTSIDE_WORKSPACE;
  const hasOtherScheme = URI_SCHEME_PATTERN.test(path) && !WINDOWS_DRIVE_PATTERN.test(path);
  if (hasOtherScheme) return UNSUPPORTED;

  const root = normalizeRoot(input.workspaceRoot);
  if (root === null) return UNSUPPORTED;

  if (isAbsolute(path)) {
    const insideRoot = relativeToRoot(path, root);
    if (insideRoot !== null) return workspaceFile(resolveSegments([], insideRoot));
    if (WINDOWS_DRIVE_PATTERN.test(path)) return OUTSIDE_WORKSPACE;
    return workspaceFile(resolveSegments([], path));
  }

  const directory = documentDirectory(input.documentPath, root);
  if (!directory) return OUTSIDE_WORKSPACE;
  return workspaceFile(resolveSegments(directory, path));
}
