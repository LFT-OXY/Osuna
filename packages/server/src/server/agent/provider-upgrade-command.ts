import type { ProviderCliLaunch } from "./provider-cli-version.js";

/*
 * 内置提供方的升级命令：用提供方实际启动的可执行文件执行它自带的升级子命令。
 * 纯函数，新增提供方时在表里加一行。
 */

const UPGRADE_SUBCOMMANDS: Readonly<Record<string, readonly string[]>> = {
  claude: ["update"],
  copilot: ["update"],
  opencode: ["upgrade"],
  pi: ["update"],
  omp: ["update"],
};

// 升级输出只留结尾：失败原因通常在最后几行，App 也只需要展示这一段。
export const UPGRADE_OUTPUT_LIMIT = 32_000;
const TRUNCATED_MARKER = "…\n";

export type ProviderUpgradeCommand =
  | { kind: "run"; command: string; args: string[] }
  | { kind: "unsupported" };

export function hasProviderUpgradeCommand(provider: string): boolean {
  return Object.prototype.hasOwnProperty.call(UPGRADE_SUBCOMMANDS, provider);
}

export function resolveProviderUpgradeCommand({
  provider,
  launch,
}: {
  provider: string;
  launch: Pick<ProviderCliLaunch, "executable" | "args" | "source">;
}): ProviderUpgradeCommand {
  if (!hasProviderUpgradeCommand(provider)) return { kind: "unsupported" };
  const subcommand = UPGRADE_SUBCOMMANDS[provider];
  // replace 模式的 argv 是可执行文件本身（如 `node cli.js`），要带上；append 模式追加的是会话启动参数，
  // 放在子命令前面会让 CLI 把子命令当成会话的提示词。
  const prefix = launch.source === "override" ? launch.args : [];
  return { kind: "run", command: launch.executable, args: [...prefix, ...subcommand] };
}

export function clipUpgradeOutput(output: string, limit: number = UPGRADE_OUTPUT_LIMIT): string {
  if (output.length <= limit) return output;
  return `${TRUNCATED_MARKER}${output.slice(output.length - limit)}`;
}
