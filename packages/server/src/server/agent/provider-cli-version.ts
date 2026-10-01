import { execCommand } from "../../utils/spawn.js";
import {
  checkProviderLaunchAvailable,
  createProviderEnvSpec,
  resolveProviderLaunch,
  type ProviderEnvSpec,
  type ProviderLaunchDefault,
  type ProviderLaunchSource,
  type ProviderRuntimeSettings,
} from "./provider-launch-config.js";

const CLI_VERSION_PATTERN = /\b(\d+\.\d+\.\d+)\b/;
const CLI_VERSION_TIMEOUT_MS = 5_000;

// 各家 `--version` 的前后缀都不同（`codex-cli 0.1.0`、`omp/1.0.0`、`… 1.0.0.`），只取第一个纯 x.y.z。
export function parseCliVersion(output: string): string | null {
  return output.match(CLI_VERSION_PATTERN)?.[1] ?? null;
}

/** 提供方实际启动的 CLI：解析到的可执行文件、config 里配的前置参数和环境变量。 */
export interface ProviderCliLaunch {
  executable: string;
  args: string[];
  source: ProviderLaunchSource;
  env: ProviderEnvSpec;
}

export interface ResolveProviderCliOptions {
  runtimeSettings?: ProviderRuntimeSettings;
  defaultBinary: string | ProviderLaunchDefault;
}

// 找不到可执行文件时返回 null。
export async function resolveProviderCliLaunch({
  runtimeSettings,
  defaultBinary,
}: ResolveProviderCliOptions): Promise<ProviderCliLaunch | null> {
  const launch = await resolveProviderLaunch({
    commandConfig: runtimeSettings?.command,
    defaultBinary,
  });
  const availability = await checkProviderLaunchAvailable(
    launch,
    typeof defaultBinary === "string" ? undefined : defaultBinary,
  );
  if (!availability.available) return null;
  return {
    executable: availability.resolvedPath ?? launch.command,
    args: launch.args,
    source: launch.source,
    env: createProviderEnvSpec({ runtimeSettings }),
  };
}

export interface ResolveProviderCliVersionOptions extends ResolveProviderCliOptions {
  signal?: AbortSignal;
}

// 用提供方实际启动的命令（含 config 里改过的 command 与 env）跑一次 `--version`。
export async function resolveProviderCliVersion({
  signal,
  ...options
}: ResolveProviderCliVersionOptions): Promise<string | null> {
  const launch = await resolveProviderCliLaunch(options);
  if (!launch) return null;
  const { stdout, stderr } = await execCommand(launch.executable, [...launch.args, "--version"], {
    ...launch.env,
    timeout: CLI_VERSION_TIMEOUT_MS,
    signal,
  });
  return parseCliVersion(`${stdout}\n${stderr}`);
}
