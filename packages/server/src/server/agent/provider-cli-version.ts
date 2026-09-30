import { execCommand } from "../../utils/spawn.js";
import {
  checkProviderLaunchAvailable,
  createProviderEnvSpec,
  resolveProviderLaunch,
  type ProviderLaunchDefault,
  type ProviderRuntimeSettings,
} from "./provider-launch-config.js";

const CLI_VERSION_PATTERN = /\b(\d+\.\d+\.\d+)\b/;
const CLI_VERSION_TIMEOUT_MS = 5_000;

// 各家 `--version` 的前后缀都不同（`codex-cli 0.1.0`、`omp/1.0.0`、`… 1.0.0.`），只取第一个纯 x.y.z。
export function parseCliVersion(output: string): string | null {
  return output.match(CLI_VERSION_PATTERN)?.[1] ?? null;
}

export interface ResolveProviderCliVersionOptions {
  runtimeSettings?: ProviderRuntimeSettings;
  defaultBinary: string | ProviderLaunchDefault;
  signal?: AbortSignal;
}

// 用提供方实际启动的命令（含 config 里改过的 command 与 env）跑一次 `--version`。
export async function resolveProviderCliVersion({
  runtimeSettings,
  defaultBinary,
  signal,
}: ResolveProviderCliVersionOptions): Promise<string | null> {
  const launch = await resolveProviderLaunch({
    commandConfig: runtimeSettings?.command,
    defaultBinary,
  });
  const availability = await checkProviderLaunchAvailable(
    launch,
    typeof defaultBinary === "string" ? undefined : defaultBinary,
  );
  if (!availability.available) return null;
  const executable = availability.resolvedPath ?? launch.command;
  const { stdout, stderr } = await execCommand(executable, [...launch.args, "--version"], {
    ...createProviderEnvSpec({ runtimeSettings }),
    timeout: CLI_VERSION_TIMEOUT_MS,
    signal,
  });
  return parseCliVersion(`${stdout}\n${stderr}`);
}
