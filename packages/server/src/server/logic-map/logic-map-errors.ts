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
