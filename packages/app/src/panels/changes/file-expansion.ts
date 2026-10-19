import { isLargeDiffFile } from "@/git/file-header-presentation";

/** Changes tab 里已决定过展开或收起的文件；两个列表互不相交。 */
export interface FileExpansionRecord {
  collapsedFilePaths: readonly string[];
  expandedFilePaths?: readonly string[];
}

export interface ResolvedFileExpansion {
  collapsedFilePaths: string[];
  expandedFilePaths: string[];
}

export interface ExpansionCandidateFile {
  path: string;
  additions: number;
  deletions: number;
  generated?: boolean;
}

const EXPAND_ALL_FILE_LIMIT = 10;
const EXPANDED_LEADING_FILE_COUNT = 3;

/**
 * 给本 tab 还没决定过的文件按默认规则补上展开或收起，已决定过的（含用户手动选过的）不动。
 * 没有新文件时原样返回同一个 record，调用方据此跳过写回。
 */
export function recordDefaultFileExpansion<Record extends FileExpansionRecord>(
  record: Record,
  files: readonly ExpansionCandidateFile[],
): Record & ResolvedFileExpansion {
  const collapsed = new Set(record.collapsedFilePaths);
  const expanded = new Set(record.expandedFilePaths ?? []);
  const nextCollapsed = [...record.collapsedFilePaths];
  const nextExpanded = [...(record.expandedFilePaths ?? [])];
  let changed = record.expandedFilePaths === undefined;
  for (const [index, file] of files.entries()) {
    if (collapsed.has(file.path) || expanded.has(file.path)) continue;
    changed = true;
    if (defaultFileExpanded(file, index, files.length)) {
      expanded.add(file.path);
      nextExpanded.push(file.path);
    } else {
      collapsed.add(file.path);
      nextCollapsed.push(file.path);
    }
  }
  if (!changed) return record as Record & ResolvedFileExpansion;
  return { ...record, collapsedFilePaths: nextCollapsed, expandedFilePaths: nextExpanded };
}

function defaultFileExpanded(
  file: ExpansionCandidateFile,
  displayIndex: number,
  fileCount: number,
): boolean {
  if (file.generated === true) return false;
  if (isLargeDiffFile(file)) return false;
  if (fileCount <= EXPAND_ALL_FILE_LIMIT) return true;
  return displayIndex < EXPANDED_LEADING_FILE_COUNT;
}

/** 用户改了收起列表（点文件头、全部收起）：离开收起列表的文件记为用户展开过。 */
export function applyCollapsedFilePaths<Record extends FileExpansionRecord>(
  record: Record,
  collapsedFilePaths: readonly string[],
): Record & ResolvedFileExpansion {
  const nextCollapsed = new Set(collapsedFilePaths);
  const expanded = new Set(
    (record.expandedFilePaths ?? []).filter((path) => !nextCollapsed.has(path)),
  );
  for (const path of record.collapsedFilePaths) {
    if (!nextCollapsed.has(path)) expanded.add(path);
  }
  return {
    ...record,
    collapsedFilePaths: [...collapsedFilePaths],
    expandedFilePaths: [...expanded],
  };
}

/** 「全部展开」：清空所有收起，Generated file 和大文件一起展开。 */
export function expandAllFiles<Record extends FileExpansionRecord>(
  record: Record,
  files: readonly ExpansionCandidateFile[],
): Record & ResolvedFileExpansion {
  const expanded = new Set([...(record.expandedFilePaths ?? []), ...record.collapsedFilePaths]);
  for (const file of files) expanded.add(file.path);
  return { ...record, collapsedFilePaths: [], expandedFilePaths: [...expanded] };
}

export function collapseAllFiles<Record extends FileExpansionRecord>(
  record: Record,
  files: readonly ExpansionCandidateFile[],
): Record & ResolvedFileExpansion {
  const paths = new Set(files.map((file) => file.path));
  const collapsed = new Set([...record.collapsedFilePaths, ...paths]);
  return {
    ...record,
    collapsedFilePaths: [...collapsed],
    expandedFilePaths: (record.expandedFilePaths ?? []).filter((path) => !paths.has(path)),
  };
}
