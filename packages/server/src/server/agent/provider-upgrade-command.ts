import { getAgentProviderDefinition } from "@getpaseo/protocol/provider-manifest";
import type { ProviderCliLaunch } from "./provider-cli-version.js";

/*
 * 内置提供方的升级命令：用提供方实际启动的可执行文件执行它自带的升级子命令。
 * 纯函数，新增提供方时在表里加一行。Codex 没有自带的升级命令，不在表里，
 * 按可执行文件的真实路径判断安装方式，再选对应的官方升级方式。
 * Claude Code 的 `claude update` 对 Homebrew 装的版本只打印提示、正常退出，所以 cask 版改用 brew 升级。
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
  // env 叠加在提供方的环境之上。
  | { kind: "run"; command: string; args: string[]; env?: Record<string, string> }
  | { kind: "install_method_unknown" }
  | { kind: "unsupported" };

// 各自带上安装所在的位置，升级时装回同一处。
export type CodexInstallMethod =
  | { method: "standalone"; codexHome: string }
  | { method: "homebrew"; prefix: string }
  | { method: "npm"; prefix: string }
  | { method: "unknown" };

// 照录 codex-rs/tui/src/update_action.rs 里的官方升级命令。
const CODEX_STANDALONE_UNIX_ARGS = [
  "-c",
  "curl -fsSL https://chatgpt.com/codex/install.sh | CODEX_NON_INTERACTIVE=1 sh",
];
const CODEX_STANDALONE_WINDOWS_ARGS = [
  "-ExecutionPolicy",
  "Bypass",
  "-c",
  "$env:CODEX_NON_INTERACTIVE=1; irm https://chatgpt.com/codex/install.ps1 | iex",
];
const HOMEBREW_PREFIXES = ["/opt/homebrew", "/usr/local"];
// 官方文档写的是 claude-code，另有跟随最新版的 claude-code@latest。
const CLAUDE_CASKS = ["claude-code", "claude-code@latest"];
const STANDALONE_RELEASES_DIR = "/packages/standalone/releases/";

export function hasProviderUpgradeCommand(provider: string): boolean {
  // Codex 不在子命令表里，按安装方式另选升级命令。
  if (provider === "codex") return true;
  return Object.prototype.hasOwnProperty.call(UPGRADE_SUBCOMMANDS, provider);
}

/*
 * 按 codex 可执行文件的真实路径（解析过符号链接）判断安装方式，规则对齐上游 codex-rs/install-context：
 * 独立安装在 $CODEX_HOME/packages/standalone/releases 下（Windows 的入口目录是指过去的联接）；
 * Homebrew 只在 macOS 上认，而且只认 cask 的 Caskroom/codex，手放进 /usr/local/bin 的和 formula 版
 * 都执行不了 `brew upgrade --cask codex`。上游靠 npm 包装脚本设的环境变量认 npm，daemon 拿不到，
 * 改认 npm 的全局目录。bun、pnpm 的全局目录和 Microsoft Store 版都判断不出，免得用 npm 装出第二份。
 */
export function detectCodexInstallMethod({
  realPath,
  platform,
}: {
  realPath: string;
  platform: NodeJS.Platform;
}): CodexInstallMethod {
  const isWindows = platform === "win32";
  const { forwardSlashPath, comparablePath } = toMatchablePaths({ realPath, isWindows });
  // 替换成 `node cli.js` 这类命令时，可执行文件是解释器，看它的路径判断不出 codex 的安装方式。
  const basename = comparablePath.slice(comparablePath.lastIndexOf("/") + 1);
  if (!basename.startsWith("codex")) return { method: "unknown" };
  const releasesIndex = comparablePath.indexOf(STANDALONE_RELEASES_DIR);
  if (releasesIndex !== -1) {
    const forwardSlashCodexHome = forwardSlashPath.slice(0, releasesIndex);
    const codexHome = toNativePath({ forwardSlashPath: forwardSlashCodexHome, isWindows });
    return { method: "standalone", codexHome };
  }
  const npmPrefix = findNpmGlobalPrefix({ forwardSlashPath, comparablePath, isWindows });
  if (npmPrefix !== null) {
    const prefix = toNativePath({ forwardSlashPath: npmPrefix, isWindows });
    return { method: "npm", prefix };
  }
  const cask = findHomebrewCask({ realPath, platform, caskNames: ["codex"] });
  if (cask) return { method: "homebrew", prefix: cask.prefix };
  return { method: "unknown" };
}

/*
 * Homebrew cask 只在 macOS 上认（Linux 上的 Homebrew 不在这两个前缀下），而且路径要落在
 * <前缀>/Caskroom/<cask 名>/ 下面：手放进 bin 的和 formula 版都执行不了 `brew upgrade --cask`。
 */
function findHomebrewCask(input: {
  realPath: string;
  platform: NodeJS.Platform;
  caskNames: readonly string[];
}): { prefix: string; cask: string } | null {
  if (input.platform !== "darwin") return null;
  for (const prefix of HOMEBREW_PREFIXES) {
    const cask = input.caskNames.find((name) =>
      input.realPath.startsWith(`${prefix}/Caskroom/${name}/`),
    );
    if (cask) return { prefix, cask };
  }
  return null;
}

function homebrewCaskUpgradeCommand(input: {
  prefix: string;
  cask: string;
}): ProviderUpgradeCommand {
  // brew 总在它前缀的 bin 下；用绝对路径，不依赖 daemon 的 PATH。
  return {
    kind: "run",
    command: `${input.prefix}/bin/brew`,
    args: ["upgrade", "--cask", input.cask],
  };
}

// Windows 路径统一成正斜杠；不分大小写，所以用小写的副本匹配，从原路径里截前缀。
function toMatchablePaths(input: { realPath: string; isWindows: boolean }): {
  forwardSlashPath: string;
  comparablePath: string;
} {
  if (!input.isWindows) {
    return { forwardSlashPath: input.realPath, comparablePath: input.realPath };
  }
  const forwardSlashPath = input.realPath.replaceAll("\\", "/");
  return { forwardSlashPath, comparablePath: forwardSlashPath.toLowerCase() };
}

function toNativePath(input: { forwardSlashPath: string; isWindows: boolean }): string {
  if (!input.isWindows) return input.forwardSlashPath;
  return input.forwardSlashPath.replaceAll("/", "\\");
}

// npm 的全局前缀：POSIX 上包在 <前缀>/lib/node_modules 下；Windows 上前缀是 %APPDATA%\npm，
// 包在 <前缀>/node_modules 下，命令是前缀下的 codex.cmd / codex.ps1 包装脚本。
function findNpmGlobalPrefix(input: {
  forwardSlashPath: string;
  comparablePath: string;
  isWindows: boolean;
}): string | null {
  const { forwardSlashPath, comparablePath, isWindows } = input;
  if (!isWindows) {
    const packageIndex = comparablePath.indexOf("/lib/node_modules/@openai/codex/");
    if (packageIndex === -1) return null;
    return forwardSlashPath.slice(0, packageIndex);
  }
  const packageIndex = comparablePath.indexOf("/npm/node_modules/@openai/codex/");
  if (packageIndex !== -1) return forwardSlashPath.slice(0, packageIndex + "/npm".length);
  const isNpmCommandShim = /\/npm\/codex(\.cmd|\.ps1)?$/.test(comparablePath);
  if (!isNpmCommandShim) return null;
  return forwardSlashPath.slice(0, forwardSlashPath.lastIndexOf("/"));
}

function resolveCodexUpgradeCommand(input: {
  realPath: string;
  platform: NodeJS.Platform;
}): ProviderUpgradeCommand {
  const install = detectCodexInstallMethod(input);
  switch (install.method) {
    case "standalone": {
      const isWindows = input.platform === "win32";
      const command = isWindows ? "powershell" : "sh";
      const args = isWindows ? CODEX_STANDALONE_WINDOWS_ARGS : CODEX_STANDALONE_UNIX_ARGS;
      // 安装脚本把发布目录放在 CODEX_HOME（缺省 ~/.codex）下，再把 current 指到新版；入口链接都经过
      // current，所以只要 CODEX_HOME 对上现有安装，原来的入口就会用上新版。CODEX_HOME 改过、而 daemon
      // 的环境里没有时，缺省值会装出第二份，所以从真实路径里取回来。
      return { kind: "run", command, args: [...args], env: { CODEX_HOME: install.codexHome } };
    }
    case "homebrew":
      return homebrewCaskUpgradeCommand({ prefix: install.prefix, cask: "codex" });
    case "npm": {
      // PATH 上先找到的 npm 可能属于另一个 node（nvm、Homebrew），不指定前缀就会装进别处，留下第二份。
      const npmPackage = getAgentProviderDefinition("codex").npmPackage;
      return {
        kind: "run",
        command: "npm",
        args: ["install", "-g", "--prefix", install.prefix, `${npmPackage}@latest`],
      };
    }
    case "unknown":
      return { kind: "install_method_unknown" };
  }
}

export function resolveProviderUpgradeCommand({
  provider,
  launch,
  executableRealPath,
  platform,
}: {
  provider: string;
  launch: Pick<ProviderCliLaunch, "executable" | "args" | "source">;
  // 可执行文件解析过符号链接的路径，codex 和 claude 用它判断安装方式。
  executableRealPath: string;
  platform: NodeJS.Platform;
}): ProviderUpgradeCommand {
  if (provider === "codex") {
    return resolveCodexUpgradeCommand({ realPath: executableRealPath, platform });
  }
  if (!hasProviderUpgradeCommand(provider)) return { kind: "unsupported" };
  if (provider === "claude") {
    // replace 模式换成解释器启动时，真实路径是解释器，不在 Caskroom 下，照旧走 `claude update`。
    const cask = findHomebrewCask({
      realPath: executableRealPath,
      platform,
      caskNames: CLAUDE_CASKS,
    });
    if (cask) return homebrewCaskUpgradeCommand(cask);
  }
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
