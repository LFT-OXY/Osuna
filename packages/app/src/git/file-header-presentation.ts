const compactFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export const DIFF_FILE_HEADER_HEIGHT = 30;
export const DIFF_FILE_HEADER_CONTENT_HEIGHT = 28;
export const DIFF_FILE_HEADER_LEFT = 12;
export const DIFF_FILE_HEADER_RIGHT = 8;
/** 变更字母居中所在的格子，位于 ±统计之后。 */
export const DIFF_FILE_CHANGE_SLOT_SIZE = 14;
export const DIFF_FILE_HEADER_TEXT_GAP = 4;

export function allocateDiffHeaderTextWidths(input: {
  available: number;
  nameWidth: number;
  directoryWidth: number;
}): { name: number; directory: number } {
  const available = Math.max(0, input.available);
  const nameWidth = Math.max(0, input.nameWidth);
  const directoryWidth = Math.max(0, input.directoryWidth);
  if (nameWidth >= available || directoryWidth === 0) {
    return { name: Math.min(nameWidth, available), directory: 0 };
  }
  const directoryAvailable = Math.max(0, available - nameWidth - DIFF_FILE_HEADER_TEXT_GAP);
  return { name: nameWidth, directory: Math.min(directoryWidth, directoryAvailable) };
}

/** 超过这个改动行数（增 + 删）的文件默认收起，收起时文件头标出行数。 */
export const LARGE_DIFF_FILE_CHANGED_LINES = 1000;

export function diffFileChangedLines(file: { additions: number; deletions: number }): number {
  return file.additions + file.deletions;
}

export function isLargeDiffFile(file: { additions: number; deletions: number }): boolean {
  return diffFileChangedLines(file) > LARGE_DIFF_FILE_CHANGED_LINES;
}

export function formatDiffCount(value: number): string {
  return compactFormatter.format(value).toLowerCase();
}

export function fileNameForPath(path: string): string {
  return path.split("/").pop() ?? path;
}

export function directorySuffix(path: string): string {
  return path.includes("/") ? ` ${path.slice(0, path.lastIndexOf("/"))}` : "";
}

export type DiffFileChange = "added" | "deleted" | "modified";

export function diffFileChangeKind(file: { isNew: boolean; isDeleted: boolean }): DiffFileChange {
  if (file.isNew) return "added";
  if (file.isDeleted) return "deleted";
  return "modified";
}

const DIFF_FILE_CHANGE_PRESENTATION = {
  added: { letter: "A", tone: "statusSuccess" },
  deleted: { letter: "D", tone: "statusDanger" },
  modified: { letter: "M", tone: "statusWarning" },
} as const;

/** 变更字母及其状态色；树形行与 web / 原生画布文件头共用。 */
export function diffFileChangePresentation(change: DiffFileChange) {
  return DIFF_FILE_CHANGE_PRESENTATION[change];
}
