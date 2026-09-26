import { describe, expect, it } from "vitest";
import type { ToolCallDetail } from "@getpaseo/protocol/agent-types";
import type { StreamItem, ToolCallItem } from "@/types/stream";
import { summarizeTurnChangedFiles } from "./turn-changed-files";

const CWD = "/repo";

function agentToolCall(
  id: string,
  detail: ToolCallDetail,
  status: "completed" | "failed" | "canceled" = "completed",
): ToolCallItem {
  return {
    kind: "tool_call",
    id,
    timestamp: new Date("2026-01-01T00:00:00.000Z"),
    payload: {
      source: "agent",
      data: {
        provider: "claude",
        callId: id,
        name: detail.type,
        status,
        error: null,
        detail,
      },
    },
  };
}

function assistantMessage(id: string): StreamItem {
  return {
    kind: "assistant_message",
    id,
    text: "done",
    timestamp: new Date("2026-01-01T00:00:00.000Z"),
  };
}

const noGroups = () => undefined;

describe("summarizeTurnChangedFiles", () => {
  it("returns null when the turn changed no files", () => {
    const items: StreamItem[] = [
      agentToolCall("read", { type: "read", filePath: "/repo/a.ts", content: "x" }),
      assistantMessage("a1"),
    ];

    expect(summarizeTurnChangedFiles({ items, cwd: CWD, expandGroup: noGroups })).toBeNull();
  });

  it("merges edits to the same file and keeps first-touch order", () => {
    const items: StreamItem[] = [
      agentToolCall("e1", {
        type: "edit",
        filePath: "/repo/src/b.ts",
        unifiedDiff: "--- a/src/b.ts\n+++ b/src/b.ts\n@@ -1,2 +1,3 @@\n keep\n-old\n+new\n+added",
      }),
      agentToolCall("w1", { type: "write", filePath: "/repo/README.md", content: "one\ntwo\n" }),
      agentToolCall("e2", {
        type: "edit",
        filePath: "/repo/src/b.ts",
        oldString: "a\nb\nc",
        newString: "a\nB\nc",
      }),
      assistantMessage("a1"),
    ];

    expect(summarizeTurnChangedFiles({ items, cwd: CWD, expandGroup: noGroups })).toEqual({
      files: [
        { path: "/repo/src/b.ts", displayPath: "src/b.ts", additions: 3, deletions: 2 },
        { path: "/repo/README.md", displayPath: "README.md", additions: 2, deletions: 0 },
      ],
      additions: 5,
      deletions: 2,
    });
  });

  it("counts only the lines between the unchanged prefix and suffix of an edit", () => {
    const items: StreamItem[] = [
      agentToolCall("e1", {
        type: "edit",
        filePath: "/repo/a.ts",
        oldString: "top\nmiddle\nbottom",
        newString: "top\nfirst\nsecond\nbottom",
      }),
    ];

    expect(summarizeTurnChangedFiles({ items, cwd: CWD, expandGroup: noGroups })).toEqual({
      files: [{ path: "/repo/a.ts", displayPath: "a.ts", additions: 2, deletions: 1 }],
      additions: 2,
      deletions: 1,
    });
  });

  it("skips edits that failed or were canceled", () => {
    const items: StreamItem[] = [
      agentToolCall(
        "e1",
        { type: "edit", filePath: "/repo/a.ts", oldString: "a", newString: "b" },
        "failed",
      ),
      agentToolCall("e2", { type: "write", filePath: "/repo/b.ts", content: "x" }, "canceled"),
    ];

    expect(summarizeTurnChangedFiles({ items, cwd: CWD, expandGroup: noGroups })).toBeNull();
  });

  it("reads every call behind a grouped tool-call host", () => {
    const first = agentToolCall("e1", {
      type: "edit",
      filePath: "/repo/a.ts",
      oldString: "a",
      newString: "b",
    });
    const second = agentToolCall("e2", {
      type: "write",
      filePath: "/repo/b.ts",
      content: "x",
    });
    // 分组后的宿主行沿用组内最后一个调用的内容，id 取第一个调用的 id。
    const host: ToolCallItem = { ...second, id: first.id };
    const groups = new Map([[host.id, [first, second]]]);

    expect(
      summarizeTurnChangedFiles({
        items: [host],
        cwd: CWD,
        expandGroup: (hostId) => groups.get(hostId),
      }),
    ).toEqual({
      files: [
        { path: "/repo/a.ts", displayPath: "a.ts", additions: 1, deletions: 1 },
        { path: "/repo/b.ts", displayPath: "b.ts", additions: 1, deletions: 0 },
      ],
      additions: 2,
      deletions: 1,
    });
  });
});
