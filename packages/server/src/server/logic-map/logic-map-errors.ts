/** 逻辑图要建在的 workspace 目录不存在。 */
export class LogicMapDirectoryMissingError extends Error {
  constructor(readonly cwd: string) {
    super(`Workspace directory does not exist: ${cwd}`);
    this.name = "LogicMapDirectoryMissingError";
  }
}

/** 连续几次随机出的临时图名都已被占用。 */
export class LogicMapNameUnavailableError extends Error {
  constructor(readonly mapsDir: string) {
    super(`Could not pick a free logic map name under ${mapsDir}`);
    this.name = "LogicMapNameUnavailableError";
  }
}

/** 开关指向的 Agent 既没加载也不在存储里。 */
export class LogicMapAgentNotFoundError extends Error {
  constructor(readonly agentId: string) {
    super(`Agent not found: ${agentId}`);
    this.name = "LogicMapAgentNotFoundError";
  }
}

/** 草稿所在的 workspace 不存在或已归档。 */
export class LogicMapWorkspaceNotFoundError extends Error {
  constructor(readonly workspaceId: string) {
    super(`Workspace not found: ${workspaceId}`);
    this.name = "LogicMapWorkspaceNotFoundError";
  }
}

/** 调用方 Agent 没开逻辑图（或不是 Agent 发起的调用），不知道该读写哪张图。 */
export class LogicMapOffError extends Error {
  constructor(readonly agentId: string | null) {
    super(
      agentId
        ? "The logic map is off for this conversation. The user turns it on with the Logic map switch in the composer."
        : "The logic map tools are only available to an agent.",
    );
    this.name = "LogicMapOffError";
  }
}

/** workspace 里没有这张图。 */
export class LogicMapNotFoundError extends Error {
  constructor(readonly mapName: string) {
    super(`Logic map not found: ${mapName}`);
    this.name = "LogicMapNotFoundError";
  }
}

/** 开关要接着的那张图不在这个 workspace 里（被删了，或名字不对）。 */
export class LogicMapToContinueMissingError extends Error {
  constructor(readonly mapName: string) {
    super(`Logic map "${mapName}" is not in this workspace any more`);
    this.name = "LogicMapToContinueMissingError";
  }
}

/** 骨架文件被手动改坏：哪张图、哪个文件（相对 workspace）、什么问题。 */
export class LogicMapCorruptError extends Error {
  constructor(
    readonly mapName: string,
    readonly file: string,
    readonly problem: string,
  ) {
    super(`Logic map "${mapName}" is broken: ${file}: ${problem}`);
    this.name = "LogicMapCorruptError";
  }
}

/** 一组更新操作里有不合格的地方，整组都没写入。 */
export class LogicMapUpdateRejectedError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(
      [
        "The logic map update was rejected and nothing was written. Fix these and send the whole batch again:",
        ...problems.map((problem) => `- ${problem}`),
      ].join("\n"),
    );
    this.name = "LogicMapUpdateRejectedError";
  }
}
