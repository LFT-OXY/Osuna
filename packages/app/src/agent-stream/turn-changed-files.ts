import type { ToolCallDetail } from "@getpaseo/protocol/agent-types";
import { stripCwdPrefix } from "@getpaseo/protocol/path-utils";
import { describeToolCall } from "@/tool-calls/detail-level/grouping";
import type { StreamItem, ToolCallItem } from "@/types/stream";
import { parseUnifiedDiff } from "@/utils/tool-call-parsers";

export interface LineStat {
  additions: number;
  deletions: number;
}

export interface TurnChangedFile extends LineStat {
  path: string;
  displayPath: string;
}

export interface TurnChangedFilesSummary extends LineStat {
  files: TurnChangedFile[];
}

function splitLines(text: string | undefined): string[] {
  if (!text) return [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

function countUnifiedDiff(diff: string): LineStat {
  let additions = 0;
  let deletions = 0;
  for (const line of parseUnifiedDiff(diff)) {
    if (line.type === "add") additions += 1;
    else if (line.type === "remove") deletions += 1;
  }
  return { additions, deletions };
}

// 只剥掉首尾相同的行，不跑完整 LCS：每个已完成回合挂载时都要算一次，替换片段可能很大。
// 对一处连续改动这就是精确值，多处改动时会把中间未变的行也算进来。
function countReplacement(oldText: string | undefined, newText: string | undefined): LineStat {
  const oldLines = splitLines(oldText);
  const newLines = splitLines(newText);
  let prefix = 0;
  while (
    prefix < oldLines.length &&
    prefix < newLines.length &&
    oldLines[prefix] === newLines[prefix]
  ) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  return {
    additions: newLines.length - prefix - suffix,
    deletions: oldLines.length - prefix - suffix,
  };
}

function statForChange(detail: Extract<ToolCallDetail, { type: "edit" | "write" }>): LineStat {
  if (detail.type === "write") {
    // write 只带新内容，不知道覆盖前有什么，整份内容计为新增。
    return { additions: splitLines(detail.content).length, deletions: 0 };
  }
  if (detail.unifiedDiff) return countUnifiedDiff(detail.unifiedDiff);
  return countReplacement(detail.oldString, detail.newString);
}

/**
 * 汇总一轮回复里 edit / write 工具调用改过的文件。daemon 不记录每轮 diff，这里只能从工具调用
 * 推出来；失败或取消的调用没有落盘，不计入。
 */
export function summarizeTurnChangedFiles(input: {
  items: readonly StreamItem[];
  cwd: string | undefined;
  expandGroup: (hostId: string) => readonly ToolCallItem[] | undefined;
}): TurnChangedFilesSummary | null {
  const byPath = new Map<string, TurnChangedFile>();
  for (const item of input.items) {
    if (item.kind !== "tool_call") continue;
    for (const call of input.expandGroup(item.id) ?? [item]) {
      const { detail, status } = describeToolCall(call);
      if (status === "failed" || status === "canceled") continue;
      if (detail.type !== "edit" && detail.type !== "write") continue;
      if (!detail.filePath) continue;
      const stat = statForChange(detail);
      const existing = byPath.get(detail.filePath);
      if (existing) {
        existing.additions += stat.additions;
        existing.deletions += stat.deletions;
      } else {
        byPath.set(detail.filePath, {
          path: detail.filePath,
          displayPath: stripCwdPrefix(detail.filePath, input.cwd),
          ...stat,
        });
      }
    }
  }
  if (byPath.size === 0) return null;
  const files = [...byPath.values()];
  return {
    files,
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
  };
}
