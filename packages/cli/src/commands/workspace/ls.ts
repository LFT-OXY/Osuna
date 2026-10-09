import type { Command } from "commander";
import { connectToDaemon, getDaemonHost } from "../../utils/client.js";
import type { CommandError, ListResult } from "../../output/index.js";
import { toWorkspaceRow, workspaceSchema, type WorkspaceRow } from "./shared.js";

export async function runLsCommand(
  options: { host?: string; daemonTarget: import("../../utils/daemon-target.js").DaemonTarget },
  _command: Command,
): Promise<ListResult<WorkspaceRow>> {
  const host = getDaemonHost({ target: options.daemonTarget });
  const client = await connectToDaemon({ target: options.daemonTarget }).catch((error: unknown) => {
    // connectToDaemon 已经给出结构化的原因（未运行、密码不对、主机版本过旧），原样交给上层。
    if (error && typeof error === "object" && "code" in error) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw {
      code: "DAEMON_NOT_RUNNING",
      message: `Cannot connect to daemon at ${host}: ${message}`,
    } satisfies CommandError;
  });
  try {
    const workspaces: WorkspaceRow[] = [];
    let cursor: string | undefined;
    do {
      const payload = await client.fetchWorkspaces({
        page: { limit: 200, ...(cursor ? { cursor } : {}) },
      });
      workspaces.push(...payload.entries.map(toWorkspaceRow));
      cursor = payload.pageInfo.nextCursor ?? undefined;
    } while (cursor);
    return { type: "list", data: workspaces, schema: workspaceSchema };
  } finally {
    await client.close().catch(() => undefined);
  }
}
