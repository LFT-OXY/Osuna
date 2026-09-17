# Orca 终端实现调研报告（完整版）

**仓库根目录**（下文以 `ROOT` 代指）：
`/Users/oxy/Documents/Configuration/dev-environment/demo/源码/orca`

---

## 1. 技术栈概览与代码分布

| 层          | 技术                                                                                                                           |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 桌面外壳    | Electron 43.7.0 + electron-vite 5 + electron-builder                                                                           |
| 渲染层      | React 19.2 + Zustand 5 + Tailwind 4 + Radix/shadcn                                                                             |
| 构建        | rolldown-vite 7.3、TypeScript 7、oxlint/oxfmt（非 ESLint/Prettier）、Vitest 4                                                  |
| 终端内核    | `node-pty ^1.1.0`（主进程）、`@xterm/xterm 6.1.0-beta.303`（渲染层）、`@xterm/headless 6.1.0-beta.302`（主进程服务端屏幕缓冲） |
| xterm addon | fit / webgl / search / unicode11 / web-links / ligatures / serialize，**无 canvas addon**                                      |
| 手机端      | Expo 55 + React Native 0.83 + expo-router + react-native-webview，**内嵌 xterm.js**                                            |
| 远程        | `ssh2` + 自建 relay + `ws` + `tweetnacl` 端到端加密                                                                            |
| 云端        | relay / relay-fence-broker / push workers，Postgres schema                                                                     |

代码规模（.ts/.tsx 文件数）：

| 目录                                             | 文件数 | 职责                                            |
| ------------------------------------------------ | ------ | ----------------------------------------------- |
| `ROOT/src/main/pty`                              | 50     | 环境变量构造、进程组、Windows PATH              |
| `ROOT/src/main/ipc/pty`                          | 96     | IPC 编排、投递批处理、背压、pane 归属           |
| `ROOT/src/main/daemon`                           | 388    | 独立终端守护进程、headless 模拟器、历史快照     |
| `ROOT/src/renderer/src/lib/pane-manager`         | 184    | **真正的 xterm 渲染核心**（不在 components 下） |
| `ROOT/src/renderer/src/components/terminal-pane` | 927    | React 生命周期、PTY 连接、标题、粘贴、链接      |
| `ROOT/src/renderer/src/store/terminals`          | 46     | Zustand tab/layout 状态                         |
| `ROOT/src/main/agent-hooks`                      | 171    | agent 状态回报的 HTTP server + spool            |
| `ROOT/src/relay`                                 | 363    | SSH 远程 host 侧 PTY                            |
| `ROOT/mobile`                                    | —      | Expo App                                        |
| `ROOT/cloud`                                     | —      | relay / push 网关                               |

容易走错的地方：`ROOT/src/main/orca-profiles/` 是**云账号**不是 shell profile；`ROOT/src/main/cli` 是 CLI 安装器，命令实现在 `ROOT/src/cli/`；`ROOT/src/main/agent-awake-service.ts` 是防系统休眠不是 agent 活跃检测。

---

## 2. 终端进程如何启动

### 2.1 三条 spawn 路径

| 路径             | 调用点                                                       | 用途                                   |
| ---------------- | ------------------------------------------------------------ | -------------------------------------- |
| 守护进程（默认） | `ROOT/src/main/daemon/pty-subprocess/native-pty-spawn.ts:36` | PTY 活在可跨 Electron 重启的 daemon 里 |
| 本地降级         | `ROOT/src/main/providers/local-pty-utils.ts:237`             | daemon 不可用时的 in-process PTY       |
| SSH/远程         | `ROOT/src/relay/pty-handler.ts`                              | relay 侧                               |

编排顺序在 `ROOT/src/main/daemon/pty-subprocess.ts:70-102`：`createDaemonPtyEnvironment` → `createPtyShellLaunchPlan` → `preflightPtySpawn` → `spawnNativeDaemonPty` → `createDaemonPtySubprocessHandle`。

真正的 spawn 调用在 `ROOT/src/main/daemon/pty-subprocess/native-pty-spawn.ts:30-48`：

```ts
const wrapped = wrapShellSpawnForMacosTccAttribution(shellPath, shellArgs, args.env);
// Why: children inherit job membership, so the host job must exist before the first Windows PTY.
if (process.platform === "win32") {
  assignHostProcessToKillOnCloseJob();
}
const proc = pty.spawn(wrapped.file, wrapped.args, {
  name: args.env.TERM ?? "xterm-256color",
  cols: args.cols,
  rows: args.rows,
  cwd,
  env: args.env,
  // Why: bundled ConPTY has the wrap-marker behavior xterm expects.
  ...(process.platform === "win32" ? { useConptyDll: true } : {}),
});
```

三个值得注意的选择。用 `useConptyDll`（捆绑 DLL）而非 `useConpty`。**没有启用 node-pty 的 `handleFlowControl`**，背压走自建的 `pause()`/`resume()`。macOS 上 spawn 会被包一层 `/usr/bin/login -flpq` trampoline（`ROOT/src/main/providers/macos-tcc-login-shell.ts:12-16`），让 TCC 权限归属到用户会话，代价是退出码可信度需要额外判定（`hostReportsChildExitStatus`）。

Windows 下 primary 失败会沿 `windowsFallbackAttempts` 链重试（`native-pty-spawn.ts:58-81`）。

### 2.2 默认 shell 判定

daemon 路径 `ROOT/src/main/daemon/shell-ready.ts:97-102`：

```ts
export function resolvePtyShellPath(env: Record<string, string>): string {
  if (process.platform === "win32") {
    return env.ORCA_TERMINAL_WINDOWS_SHELL || "powershell.exe";
  }
  return env.SHELL || process.env.SHELL || "/bin/zsh";
}
```

优先级由 `ROOT/src/main/daemon/pty-subprocess/shell-launch-plan.ts:58` 决定：WSL 上下文 → `'wsl.exe'` > `opts.shellOverride` > `resolvePtyShellPath(env)`。

本地路径带用户设置，`ROOT/src/main/providers/local-pty-launch-plan.ts:240-251`：

```ts
const shellPath =
  args.shellOverride ||
  getOptions().getDefaultShell?.()?.trim() ||   // settings.terminalDefaultShell
  args.env?.SHELL || process.env.SHELL || '/bin/zsh'
return finalizeLocalPtyLaunchPlan(seed, { shellPath, shellArgs: ['-l'], ... })
```

**本机侧不解析 `/etc/passwd`**（无 getent/dscl）。兜底是固定候选链 `ROOT/src/main/providers/local-pty-utils.ts:20`：

```ts
const UNIX_SHELL_FALLBACKS = ["/bin/zsh", "/bin/bash", "/bin/sh"] as const;
```

`resolveUnixShellPath`（`:65-78`）对绝对路径逐个做 `getShellValidationError` 校验，非绝对路径直接交给 execvp 走 PATH。spawn 失败后还有二次降级链（`:261-305`），每次重算 shell-ready 配置并清掉上一个 shell 的 `ZDOTDIR` 与 feature key。唯一真正枚举系统 shell 的代码在 relay 侧（见第 3 节）。

Windows 分支在 `ROOT/src/main/daemon/pty-subprocess/shell-launch-plan.ts:70-135`：

```ts
const resolvedGitBashPath = resolveWindowsGitBashShellPath(shellPath);
if (resolvedGitBashPath) {
  shellPath = resolvedGitBashPath;
} else if (shellPath === WINDOWS_GIT_BASH_SHELL) {
  shellPath = "powershell.exe"; // 找不到 git-bash 时退回 powershell
} else {
  shellPath = shouldResolvePowerShellFamily
    ? (resolveEffectiveWindowsPowerShell({ shellFamily, implementation, pwshAvailable }) ??
      shellPath)
    : shellPath;
}
```

Git Bash 命中后注入 `CHERE_INVOKING=1`（行 133-135）让它不强制 `cd ~`。`wsl.exe` 分支（行 136-181）负责 `CODEX_HOME` 的 Windows↔WSL 路径互转、`WSLENV` 键注册和 interop 环境。降级链构造在 `ROOT/src/main/providers/windows-shell-fallback-chain.ts`（PowerShell → Windows PowerShell → cmd.exe，每一跳带自己的 args/cwd）。

### 2.3 启动参数与 shell wrapper

**用 `-l`（login），不用 `-i`。** 各 shell 差异在 `ROOT/src/main/daemon/shell-ready.ts:127-194`：

| Shell      | args                                           | 机制                                    |
| ---------- | ---------------------------------------------- | --------------------------------------- |
| zsh        | `['-l']`                                       | `ZDOTDIR` 指向 Orca 生成的 wrapper 目录 |
| bash       | `['--rcfile', <wrapper>/bash/rcfile]`          | 不用 `-l`，以便控制加载顺序             |
| fish       | `['-l', '-C', <init>]`                         | `-C` 注入 ready marker + preflight      |
| PowerShell | `['-NoLogo','-NoExit','-EncodedCommand', ...]` | 装 OSC 133 bootstrap                    |

zsh 分支还有一条重要的降级注释：

```ts
if (!ensureShellReadyWrappers()) {
  // Why plain login zsh: ZDOTDIR pointed at an incomplete wrapper dir makes
  // zsh skip the user's whole config.
  return { args: ["-l"], env: {}, supportsReadyMarker: false };
}
```

wrapper 注入六类东西：

**1. OSC 133 提示符标记**。zsh 版在 `ROOT/src/main/zsh-startup-wrapper-builder.ts:83-96`：

```sh
__orca_osc133_precmd() {
  local exit_code=$?
  if [[ -n "${__orca_in_command:-}" ]]; then
    builtin printf "\033]133;D;%s\007" "$exit_code"
    builtin unset __orca_in_command
  fi
  builtin printf "\033]133;A\007"
}
__orca_osc133_preexec() {
  builtin printf "\033]133;C\007"
  builtin typeset -g __orca_in_command=1
}
```

bash 版走 DEBUG trap + PROMPT_COMMAND（`ROOT/src/main/bash-prompt-command-composition.ts:54-136`），PowerShell 版在 `ROOT/src/main/powershell-osc133-bootstrap.ts:79-95`（并强制 UTF-8 控制台编码）。

**2. ready marker**，`ROOT/src/main/daemon/daemon-shell-ready-marker.ts:3`：

```ts
export const SHELL_READY_MARKER = '\033]777;orca-shell-ready\007'
```

zsh 通过接管 `zle-line-init` 发射（`ROOT/src/main/shell-templates.ts:150-190`），刻意不用 `add-zle-hook-widget`（原因写在 142-149 的注释）。fish 通过 `--on-event fish_prompt`。

**3. identity marker**，上报 shell 自己的 pid（`ROOT/src/main/shell-templates.ts:42`）：

```sh
__orca_has_feature identity && printf "\033]777;orca-shell-start:%s\007" "$$"
```

**4. history 隔离**。`ORCA_HISTFILE` 以非导出变量捕获后立刻销毁，避免泄漏给子进程（`ROOT/src/main/shell-templates.ts:24-33`）。

**5. ZDOTDIR 交还**。wrapper 第一件事就是把 `ZDOTDIR` 还给用户，用户的启动文件按原样完整加载，Orca 的工作推迟到第一个 `precmd`，`__orca_deferred_init` 跑完自删除（`ROOT/src/main/shell-templates.ts:66-86` 与 `zsh-startup-wrapper-builder.ts:162-189`）。

**6. overlay 复原**（PATH、CODEX_HOME、OPENCODE_CONFIG_DIR、omp 包装器等），`ROOT/src/main/zsh-startup-wrapper-builder.ts:119-130`。其中 `getPosixOmpShellWrapper()` 来自 `ROOT/src/main/pty/omp-shell-wrapper.ts:42-70`，只包装交互式 `omp launch`，白名单子命令直通。

**7. startup command 注入**（见 6.1）。`ROOT/src/main/pty/posix-shell-startup-command.ts:3-8` 定义 `ORCA_POSIX_SHELL_STARTUP_COMMAND`，仅 bash/zsh/fish 支持。

启用哪些 feature 由 `ROOT/src/main/shell-startup-features.ts:14-23` 定义的六个 feature（`overlay | history | markers | ready | identity | startup`）和 `:59-96` 的纯函数选择，经 env 变量 `ORCA_SHELL_FEATURES` 传给 wrapper。一个都不需要时返回 `UNWRAPPED`，调用方用 `shellArgs = shellLaunch.args ?? ['-l']` 兜底。

wrapper 文件按**内容寻址**落盘并缓存（`ROOT/src/main/daemon/shell-ready.ts:45-95`），`getShellReadyWrapperRoot` 记忆化并做 `statSync().size > 0` 的完整性校验，写坏了就退回 `['-l']`。

### 2.4 cwd 的确定

三层回落。`ROOT/src/shared/terminal-startup-cwd.ts:13-41`：

```ts
const resolvedCwd = resolveRuntimePath(worktreePath, trimmedCwd);
if (
  missingDirFallback &&
  resolvedCwd !== worktreePath &&
  !missingDirFallback.directoryExists(resolvedCwd) &&
  missingDirFallback.directoryExists(worktreePath)
) {
  // 持久化的启动目录被删会让该 tab 永久无法开终端 (#7239)，在 workspace 根恢复。
  // 若根也不在（卷未挂载 / WSL 未启动），保留原请求让 provider 报它自己的错。
  missingDirFallback.onFallbackToWorkspaceRoot?.(resolvedCwd);
  return worktreePath;
}
```

IPC 入口包装在 `ROOT/src/main/ipc/pty/host-env/spawn-cwd.ts:30-43`，存在性探测在 `:45-55`（`\\wsl.localhost` UNC 路径直接返回 true，因为 Win32 `statSync` 会误报 ENOENT）。

无请求 cwd 时的安全默认在 `ROOT/src/main/providers/pty-default-cwd.ts:16-34`：

```ts
const candidates =
  process.platform === "win32"
    ? [env.USERPROFILE, homeDrivePath(env), homedir()]
    : [env.HOME, homedir()];
const selected = candidates.find(isSafeImplicitPtyCwd);
if (!selected) {
  throw new Error("No safe default working directory is available for terminal launch.");
}
```

**拒绝 root-like 路径**（`/`、盘符根），因为在根目录起 agent 会引发 runaway CPU。自动 agent 启动另有硬断言 `assertSafeAgentStartupCwd`（`:36-42`）。spawn 前校验在 `ROOT/src/main/providers/working-directory-validation.ts:109-129`（同步版）与 `:139+`（异步、可 abort、按路径共享探测，防 NFS 挂死）。

daemon 自身 cwd 被删时会按 `ORCA_USER_DATA_PATH → 安全 home → '/' | 'C:\'` 顺序 `chdir`（`ROOT/src/main/daemon/pty-subprocess/spawn-preflight.ts:44-60`）。

### 2.5 环境变量构造

基底在 `ROOT/src/main/daemon/pty-subprocess/spawn-environment.ts:134-165`：

```ts
const env: Record<string, string> = {
  ...mergeGitConfigEnvProtocol(stripInheritedBuildModeEnv(process.env), opts.env),
  TERM: "xterm-256color",
  COLORTERM: "truecolor",
  TERM_PROGRAM: "Orca",
  TERM_PROGRAM_VERSION: process.env.ORCA_APP_VERSION ?? "0.0.0-dev",
  FORCE_HYPERLINK: "1",
};
if (opts.env?.TERM) {
  env.TERM = opts.env.TERM;
} // 客户端可覆盖
delete env.ELECTRON_RUN_AS_NODE;
removeAppImageRuntimeEnv(env);
removeInheritedNoColor(env);
env.LANG ??= "en_US.UTF-8";
```

`TERM` 最终作为 `pty.spawn` 的 `name` 使用。`NO_COLOR` / `FORCE_COLOR=0` / `CLICOLOR=0` 一律剥离（`ROOT/src/main/pty/terminal-color-env.ts:1-11`），理由是父 agent shell 的关色选择不该被终端继承。`LANG` 只在缺失时补。

**PATH**。POSIX 侧 `promoteAgentTeamsShimPath` 把 agent-teams shim 目录提到最前（`spawn-environment.ts:103-122`），Orca CLI 目录由 `prependOrcaCliDirToChildPath` 注入（`ROOT/src/main/ipc/pty/host-env/assembly.ts:12`）。Windows 侧 `resolvePathEnvKey` 处理 `PATH`/`Path` 大小写、`collapseWindowsPathEnvKeys` 合并重复键，并把注册表 `HKLM\...\Session Manager\Environment` 与 `HKCU\Environment` 的 Path 合并进来（`ROOT/src/main/pty/windows-environment-path.ts:29-30`，30s TTL 缓存 + 5s 超时，失败回退 `windows-path-registry-fallback.ts`）。

**ORCA\_\* 变量**在 `ROOT/src/main/ipc/pty/host-env/assembly.ts:37+` 注入，典型模式是「真变量 + `ORCA_` 影子」：

```ts
baseEnv.ORCA_OPENCODE_CONFIG_DIR = baseEnv.OPENCODE_CONFIG_DIR; // :81
baseEnv.ORCA_MIMOCODE_HOME = baseEnv.MIMOCODE_HOME; // :93
```

让 wrapper 在用户 rc 文件跑完后恢复被覆盖的值。pane 身份四件套 `ORCA_PANE_KEY / ORCA_TAB_ID / ORCA_WORKTREE_ID / ORCA_AGENT_LAUNCH_TOKEN`（`spawn-environment.ts:22-27`）未显式指定时会被主动删除，防止嵌套继承。

**conda 修复**（`ROOT/src/main/pty/conda-activation-env.ts:31-70`）：`CONDA_SHLVL>0` 但 `CONDA_PREFIX` 缺失时，整组删除 `CONDA_SHLVL/PREFIX/DEFAULT_ENV/PROMPT_MODIFIER` 及编号变量，否则 `conda activate` 在 `_get_deactivate_scripts(None)` 崩溃（#14195）。只删不造，POSIX 上有快速短路。

**是否探测 login shell 环境并缓存**：有，但是**静态解析而非真跑 shell**。`ROOT/src/main/pty/shell-startup-env.ts`：

- 按 `$SHELL` 家族选文件集，不混用：zsh 读 `.zshenv` →（ZDOTDIR）`.zprofile/.zshrc/.zlogin`（`:142-150`）；bash 只读 login 文件 `.bash_profile/.bash_login/.profile`（`:13` 的注释解释为何不读 `.bashrc`）；fish 读 `conf.d/*.fish` + `config.fish`（`:123-129`）。
- 只承认会传给子进程的赋值：`export NAME=` 或 fish 的 `set -x/--export`（`:69-78`），最后一次赋值胜出。
- 缓存在 `:196` 的 Map，键为 `name\0home\0shell\0configHome`（`:238`），进程生命周期内不失效（`:219-221` 说明 PTY spawn 是热路径）。
- 两个入口：`readShellStartupEnvVar`（`:223`）、`readSessionShellStartupEnvVar`（`:277`，用会话 env 而非 `process.env`，避免 fish 的 `XDG_CONFIG_HOME` 漂移）。Windows 不支持。

另有一个真跑进程的探针：macOS TCC login 预检（`ROOT/src/main/providers/macos-tcc-login-shell.ts:64-90`），`login -flpq <user> /usr/bin/printf ORCA_LOGIN_PREFLIGHT_OK`，500ms 超时，结论缓存在模块级变量，被拒结果 30 分钟后重验。

### 2.6 进程组与 kill

**前台进程组检测**（`ROOT/src/main/pty/posix-pty-foreground-group.ts:28-51`）：

```ts
function runPs(pid: number): string {
  return execFileSync("ps", ["-p", String(pid), "-o", "pid=,tpgid=,tty="], {
    encoding: "utf8",
    timeout: PROCESS_TABLE_QUERY_TIMEOUT_MS,
    maxBuffer: PROCESS_TABLE_MAX_BYTES,
  });
}
let ownRowCache: { pid: number; row: string } | null = null;
/** ... Re-forking `ps` for it on every SIGWINCH doubled a ~3ms synchronous stall
 *  that the renderer fires twice per revealed pane. */
```

`normalizeTty` 处理 `ps` 的 `ttys003` 与 node-pty 的 `/dev/ttys003` 差异。追踪器在 `ROOT/src/main/daemon/pty-subprocess/foreground-process-tracker.ts`。

**进程组强杀**（`ROOT/src/main/pty/posix-pty-process-groups.ts:90-138`）：

```ts
for (const pgid of groups) {
  try {
    signalProcessGroup(pgid);
  } catch (error) {
    // PTY exit callback 可能在 ps 与 killpg 之间收割掉进程组；ESRCH 是"已消失"的证据而非失败
    if (!isProcessAlreadyGone(error) && firstError === undefined) {
      firstError = error;
    }
    continue;
  }
  recordSelfInitiatedTreeKill({
    pid: pgid,
    site: "posix-pty-process-group-sweep",
    scope: "posix-process-group",
  });
}
```

选组逻辑 `:55-83`：按控制 tty 聚合 pgid，**root 的 pgid 排最后**（先杀子组再杀 shell）。两条安全阀：root 无 tty 返回 null；**若 Orca 自身与该 PTY 共享 tty（开发态 daemon 继承启动终端）也返回 null**，退回只杀 root。进程表读取用 tty 过滤而非 `ps -ax`（全表在大机器上接近 1 秒）。

**后代树终止**（`ROOT/src/main/pty-descendant-termination.ts`）：`ps -axo pid=,ppid=,pgid=,lstart=`，`LANG=C LC_ALL=C` 强制 locale 一致，`maxBuffer` 32MB（默认 1MB 会静默截断丢后代）。快照带 `capturedAtMs` 在 `ps` 开始前取，配合 `lstart` + pgid 防 PID 回卷误杀。宽限 2 秒。Windows 侧用 `terminateWindowsProcessTree` + Job 对象。

**kill 竞态**：退出回调里同步把 `proc.kill` 置空，防止 node-pty 在 socket `'close'` 时对已回收/复用的 pid 补发 SIGHUP（`ROOT/src/main/daemon/pty-subprocess/subprocess-handle.ts:52-55`）。主 fd 泄漏修复见 `ROOT/src/main/pty/node-pty-master-fd-retirement.ts`。

---

## 3. terminal profile 数据模型

**结论：Orca 没有 VS Code / Windows Terminal 那种命名 profile 对象。** 模型是「扁平全局设置 + 每 tab 一个 `shellOverride` 字符串」。

### 3.1 实际存在的三个东西

**(a) 每 tab 的 `shellOverride: string`**，`ROOT/src/shared/terminal-tab-types.ts:56-110`：

```ts
export type TerminalTab = {
  id: string; ptyId: string | null; worktreeId: string
  title: string; customTitle: string | null
  color: string | null          // 颜色属于 tab，不属于 profile
  isPinned?: boolean
  viewMode?: 'terminal' | 'chat'
  /** Why: records the shell this tab was opened with (e.g. 'wsl.exe') so the
   *  PTY and tab icon stay stable even if the default shell setting changes
   *  later. Older persisted tabs may omit this field. */
  shellOverride?: string
  forceHostRuntime?: boolean
  startupCwd?: string
  launchAgent?: TuiAgent
```

没有 args、env、icon 字段。

**(b) RPC 边界的 zod schema**（全仓唯一对 shell 做校验的地方），`ROOT/src/shared/rpc-contract/terminal-unary-params.ts:147-199`：

```ts
// Why refused at the boundary rather than at spawn: only the host knows the allowlist
shell: z.string()
  .refine(isSupportedWindowsShellOverride, {
    message: `shell must be one of: ${listSupportedWindowsShellOverrides().join(", ")}`,
  })
  .transform((shell) => canonicalizeWindowsShellOverride(shell) ?? shell)
  .optional();
```

注意这是 **Windows-only 白名单**，不能传任意路径。白名单在 `ROOT/src/shared/windows-terminal-shell.ts:72-99`：powershell.exe / pwsh.exe / cmd.exe / wsl.exe / bash.exe / git-bash，各带简写别名。

**(c) 运行时创建终端的 payload**（`ROOT/src/shared/runtime-terminal-contracts.ts:247-266`）带 `command / cwd / env / envToDelete / launchAgent / title / shellOverride`，但是 per-call 不是可保存的 profile。

**(d) Quick Command**，最接近「可保存的命名启动项」，但只往已有 shell 里打字。`ROOT/src/shared/terminal-quick-command-types.ts:14-32`：

```ts
export type TerminalQuickCommandBase = {
  id: string;
  label: string;
  scope?: TerminalQuickCommandScope;
};
export type TerminalCommandQuickCommand = TerminalQuickCommandBase & {
  action?: "terminal-command";
  command: string;
  appendEnter: boolean;
};
export type TerminalAgentQuickCommand = TerminalQuickCommandBase & {
  action: "agent-prompt";
  agent: TuiAgent;
  prompt: string;
};
```

### 3.2 是否自动探测系统 shell

三条独立路径，覆盖度不一致。

| 路径               | 位置                                                              | 行为                                                                         |
| ------------------ | ----------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 本地候选（写死）   | `ROOT/src/main/providers/local-pty-session-operations.ts:130-155` | POSIX 只列 zsh/bash/sh，**无 fish/nu/pwsh**                                  |
| Windows 探测       | 同上 + `ROOT/src/main/git-bash.ts:41-70`                          | 扫 ProgramFiles/ProgramW6432/LOCALAPPDATA/PATH 找 git-bash，探测 pwsh 与 WSL |
| relay（远程 host） | `ROOT/src/relay/pty-shell-utils.ts:313-344`                       | **唯一真正枚举**：读 `/etc/shells`                                           |

本地候选代码：

```ts
export async function getLocalPtyProfiles(): Promise<{ name: string; path: string }[]> {
  if (process.platform === "win32") {
    const profiles = [
      { name: "PowerShell", path: "powershell.exe" },
      { name: "Command Prompt", path: "cmd.exe" },
    ];
    const gitBashPath = resolveGitBashPath();
    if (gitBashPath) profiles.push({ name: "Git Bash", path: gitBashPath });
    if (await isWslAvailableAsync()) profiles.push({ name: "WSL", path: "wsl.exe" });
    return profiles;
  }
  const shells = ["/bin/zsh", "/bin/bash", "/bin/sh"]; // 只有这 3 个
  return shells.filter((s) => existsSync(s)).map((s) => ({ name: basename(s), path: s }));
}
```

relay 侧读 `/etc/shells`，跳过注释与不存在的路径，失败回落三件套。暴露为 RPC `pty.getProfiles`（`ROOT/src/relay/pty-handler.ts:1091`），链路打通到 provider contract 与 daemon router，但 **renderer 侧没有任何调用者**。这是一条建好未接 UI 的能力。

### 3.3 用户怎么选

没有「新增 profile」的 UI，只有两级选择。

**设置 → Terminal，POSIX 是一个自由输入框**（`ROOT/src/renderer/src/components/settings/TerminalPane.tsx:83-130`）：

```tsx
<SettingsSegmentedControl
  value={shellMode}
  onChange={(value) => updateSettings({ terminalDefaultShell: value === 'system' ? '' : configuredShell })}
  options={[
    { value: 'system', label: `System shell (${systemShell})` },
    { value: 'custom', label: 'Custom shell' }
  ]}
/>
{shellMode === 'custom' ? (
  <Input value={settings.terminalDefaultShell ?? ''}
    placeholder="fish, nu, or /bin/zsh"
    onChange={(e) => updateSettings({ terminalDefaultShell: e.target.value.trimStart() })}
    onBlur={() => void validateShell()} ... />
```

不枚举不补全，校验只是 `window.api.shell.pathExists`，且非绝对路径直接跳过校验（`:72-75`）。

**Windows 是四选一分段控件**（`ROOT/src/renderer/src/components/settings/TerminalWindowsShellSection.tsx:32-80`）：PowerShell / CMD / Git Bash / WSL，带 shell 图标（`ROOT/src/renderer/src/components/tab-bar/shell-icons.tsx:1-14`）。

**tab bar 的 `+` 下拉可以 per-terminal 选 shell，但仅限 Windows**（`ROOT/src/renderer/src/components/tab-bar/tab-bar-windows-shell-options.ts:11-62`），落到 `newTerminalWithShell(shellOverride)`。macOS/Linux 上 `--shell` 会被明确拒绝，只能改全局设置。

其余终端设置面板组件约 13 个，都在 `ROOT/src/renderer/src/components/settings/`：`TerminalRenderingSection`、`TerminalAppearanceSection`、`TerminalCursorAppearanceSection`、`TerminalAdvancedSection`（滚动行数）、`TerminalFontSizeSetting`、`TerminalAdvancedTypographyControls`、`TerminalThemePicker` / `TerminalThemeSections`、`TerminalInteractionSection`、`TerminalScrollSpeedSlider`、`TerminalMacKeyboardSection`、`TerminalSetupScriptSection`、`TerminalContrastSetting`，聚合入口 `TerminalPane.tsx:139-180`。

### 3.4 设置 schema

**纯 TypeScript type，无 zod**：`ROOT/src/shared/global-settings-types.ts:109-310`：

```ts
terminalFontSize: number
terminalFontFamily: string
terminalFontWeight: number
terminalLineHeight: number
terminalGpuAcceleration: 'auto' | 'on' | 'off'
terminalLigatures: 'auto' | 'on' | 'off'
terminalCursorStyle: 'bar' | 'block' | 'underline'
terminalCursorBlink: boolean
terminalThemeDark: string
terminalCustomThemes?: TerminalCustomTheme[]
/** Windows-only: COMSPEC always points to cmd.exe, so this explicit shell overrides it. */
terminalWindowsShell: string
/** Optional shell executable for new terminals on macOS and Linux. */
terminalDefaultShell?: string
terminalWindowsWslDistro?: string | null
terminalWindowsPowerShellImplementation: 'auto' | 'powershell.exe' | 'pwsh.exe'
terminalScrollbackRows: number
terminalQuickCommands?: TerminalQuickCommand[]
terminalScopeHistoryByWorktree: boolean
```

默认值在 `ROOT/src/shared/default-global-settings.ts:62-174`（`terminalWindowsShell: 'powershell.exe'`、`terminalDefaultShell: ''`、`terminalCursorStyle: 'block'`、`terminalThemeDark: 'Ghostty Default Style Dark'`、`terminalScopeHistoryByWorktree: true`）。迁移在 `ROOT/src/main/persistence/applying-settings/terminal-settings-migrations.ts:43-60`（`terminalScrollbackBytes` → `terminalScrollbackRows` 等）。

---

## 4. 持久化与恢复

### 4.1 会话跨重启靠独立 daemon

架构见 `ROOT/docs/reference/orcad-operations.md:7-22`：

```
|            | orcad                            | terminal daemon                       |
| Started by | the supervisor                   | orcad, detached                       |
| Owns       | RPC, git, worktrees, persistence | every local PTY                       |
| Lifetime   | one supervised run               | detached from orcad, not its service  |
| Endpoint   | `ws://<bind>:<port>`             | `<data-root>/daemon/daemon-v<N>.sock` |
```

daemon 初始化后整个 PTY provider 被替换（`ROOT/src/main/ipc/pty/provider/registry.ts:124-136`），调用处在 `ROOT/src/main/daemon/daemon-provider-state.ts:121`。

持久绑定（tab/leaf ↔ ptyId）写盘在 `ROOT/src/main/persistence/loading-store/pty-binding-persistence.ts:34-56`，相关文件还有 `pty-binding-fast-lane.ts`、`pty-binding-refusals.ts`、`terminal-binding-recovery.ts`、`terminal-tab-pty-ownership.ts`、`workspace-session-terminal-binding-replay.ts`。

### 4.2 scrollback 持久化：两套并行机制

**(1) 渲染进程的 SerializeAddon 快照**（本地 + SSH 都用）。Addon 挂载在 `ROOT/src/renderer/src/lib/pane-manager/pane-dom-creation.ts:132`。关机时抓取（`ROOT/src/renderer/src/components/terminal-pane/terminal-shutdown-layout-capture.ts:104-130`）：

```ts
for (const pane of panes) {
  // Why: non-focused panes may have renderer-throttled PTY bytes queued;
  // push them into xterm before taking the shutdown scrollback snapshot.
  flushTerminalOutput(pane.terminal);
  let scrollback = pane.terminal.options.scrollback ?? 10_000;
  // Why serializeWithAbsoluteCursor: these buffers replay into fresh xterms on
  // session restore, and SerializeAddon's relative cursor restore lands one
  // column short after a wrap-pending final row.
  let serialized = serializeWithAbsoluteCursor(pane.serializeAddon, pane.terminal, { scrollback });
  if (!fitsSessionScrollbackByteLimit(serialized) && scrollback > 1) {
    serialized = serializeWithinSessionScrollbackByteLimit(pane, serialized, scrollback);
  }
}
```

绝对光标修正在 `ROOT/src/shared/terminal-serialize-absolute-cursor.ts:1`，模式位清理在 `ROOT/src/shared/terminal-mode-reset-profiles.ts:6`。

**不进 session JSON**，落到 `<profile dir>/terminal-scrollback/v1-<sha256(tabId\0leafId).slice(32)>.bin`（`ROOT/src/main/terminal-scrollback-snapshots.ts:21-51`）：

```ts
const SNAPSHOT_DIR_NAME = "terminal-scrollback";
const REF_PREFIX = "v1";
export function makeTerminalScrollbackSnapshotRef(tabId: string, leafId: string): string {
  const hash = createHash("sha256").update(`${tabId}\0${leafId}`).digest("hex").slice(0, 32);
  return `${REF_PREFIX}-${hash}`;
}
function snapshotPath(ref: string, snapshotRoot: string): string | null {
  if (!/^v1-[0-9a-f]{32}$/.test(ref)) return null;
  return join(snapshotRoot, `${ref}.bin`);
}
```

tmp+rename 原子写，`mode 0o600`，目录 `0o700`，只保留尾部字节。

字节上限（`ROOT/src/shared/terminal-scrollback-limits.ts:1-3`）：

| 场景              | 上限   |
| ----------------- | ------ |
| session JSON 内联 | 512 KB |
| 回放              | 512 KB |
| .bin 文件         | 5 MB   |

GC 是引用计数式（`ROOT/src/main/persistence/loading-store/terminal-session-cleanup.ts:30-34`）：

```ts
const nextRefs = collectTerminalScrollbackSnapshotRefs(next);
for (const ref of collectTerminalScrollbackSnapshotRefs(prior)) {
  if (!nextRefs.has(ref)) deleteTerminalScrollbackSnapshotSync(ref, storage);
}
```

哪些 worktree 需要 renderer 抓 buffer（SSH/远程必须，本地由 daemon 负责）判定在 `ROOT/src/shared/workspace-session-terminal-buffers.ts:13-38`。

**(2) daemon 侧的 headless 模拟器 + checkpoint/增量日志**（本地 PTY）。`ROOT/src/main/daemon/daemon-checkpoint-file.ts:5-28`：

```ts
/** On-disk shape of checkpoint.json. Written by history-manager, read by
 *  history-reader — one type so the generation pairing with output.log's
 *  header cannot silently diverge */
export type TerminalCheckpointFile = {
  snapshotAnsi: string;
  scrollbackAnsi: string;
  oscLinks?: TerminalOscLinkRange[];
  rehydrateSequences: string;
  pendingEscapeTailAnsi?: string;
  cwd: string | null;
  cols: number;
  rows: number;
  modes: TerminalModes;
  scrollbackLines: number;
  lastTitle?: string;
  terminalOwner?: TerminalOwner;
  generation?: number; // ties to output.log header
  pendingOutputSeq?: number;
  checkpointedAt: string;
};
```

目录名用 `encodeURIComponent(sessionId)`（sessionId 含 `:` `/`）。冷恢复 payload 有 16MB LRU 内存缓存（`ROOT/src/main/daemon/cold-restore-payload-cache.ts:3-27`），可恢复 session 上限 10000（`ROOT/src/main/daemon/terminal-history-restorable-retention.ts:1`）。

一致性由 `ROOT/src/shared/terminal-restore-parity-fixture.ts:26-39` 保障：用 `@xterm/headless` 搭一个与渲染层配置完全一致的终端做校验。

### 4.3 reattach

pane 身份是 `(tabId, leafId)`，解析到 ptyId 在 `ROOT/src/main/ipc/pty/pane/stable-owner.ts:36-63`：

```ts
export function resolvePersistedStablePaneOwner(store, paneKey, worktreeId, connectionId) {
  const parsed = parsePaneKey(paneKey);
  const session = store.getWorkspaceSession(
    connectionId ? toSshExecutionHostId(connectionId) : undefined,
  );
  const tab = session.tabsByWorktree?.[worktreeId]?.find(
    (c) => c.id === parsed.tabId && c.worktreeId === worktreeId,
  );
  const ptyId = session.terminalLayoutsByTabId?.[parsed.tabId]?.ptyIdsByLeafId?.[parsed.leafId];
  if (!tab || typeof ptyId !== "string" || ptyId.length === 0) return null;
  const incarnationId = session.terminalPtyIncarnationsByPaneKey?.[paneKey];
  return {
    tabId: parsed.tabId,
    leafId: parsed.leafId,
    ptyId,
    ...(incarnationId ? { incarnationId } : {}),
  };
}
```

冲突会抛四种具名错误，是排障关键字：`terminal_pane_owner_conflict`、`terminal_pane_owner_host_mismatch`（`:67-117`）、`terminal_pane_owner_changed`（`adopt-stable.ts:43`）。

`createTerminal` 先 adopt 再 spawn（`ROOT/src/main/ipc/pty/pane/adopt-stable.ts:13-52`），同 owner key 的并发 adopt 共享同一个 promise。

SSH 远程 PTY 用 lease，最关键的规则写在 `ROOT/src/main/persistence/leasing-ssh-ptys/ssh-pty-lease-operations.ts:18-31`：

```ts
/**
 * Only `terminated` unbinds a pane. It is the operator-close state ... `expired` records that the
 * CLIENT lost its route and says nothing about the remote shell. Wiping the binding on `expired`
 * made `resolvePersistedStablePaneOwner` return null, so `adoptStablePane` gave up and
 * `createTerminal` spawned a replacement over a process that was still running.
 */
function leaseStateWithdrawsBinding(state: SshRemotePtyLease["state"]): boolean {
  return state === "terminated";
}
```

同目录配套：`ssh-pty-pane-supersession.ts`、`ssh-pty-lease-tombstone-retention.ts`、`ssh-pty-binding-cleanup.ts`、`ssh-pty-consumer-recovery.ts`、`ssh-target-reassignment.ts`。渲染侧重连在 `ROOT/src/renderer/src/components/terminal-pane/pty-connection/`（`cold-restore-resume-startup.ts`、`direct-ssh-retry-status.ts`、`pty-input-recovery.ts`），tab 级恢复账本 `TerminalTabRecoveryLedger` 在 `ROOT/src/shared/terminal-tab-types.ts:6-53`。

### 4.4 命令历史隔离

开关 `settings.terminalScopeHistoryByWorktree`（默认开）。根目录（`ROOT/src/main/terminal-history-paths.ts:5-18`）：

```ts
const HISTORY_DIR_NAME = "terminal-history";
const HISTORY_DIR_NAME_WSL = "terminal-history-wsl";
// Why: rename live history out of the way first so a quit mid-rm still leaves a durable tombstone GC can finish.
export const PENDING_DELETE_DIR_NAME = ".pending-delete";
```

目录名 = `hashWorktreeId(worktreeId)`（16 位小写 hex）。shell 识别与文件名在 `ROOT/src/main/terminal-history.ts:15-63`（zsh→`zsh_history`，bash→`bash_history`，其余返回 null 走别的机制）。

注入逻辑在 `ROOT/src/main/terminal-history.ts:202-288`，三道防护：

```ts
export function injectHistoryEnv(spawnEnv, worktreeId, shellPath, cwd, options = {}) {
  delete spawnEnv.ORCA_HISTFILE          // 防嵌套 Orca 继承上层 worktree
  dropInheritedOrcaFishHistory(spawnEnv)
  dropInheritedOrcaHistFile(spawnEnv)
  // Check-before-set: if the caller already provided the shell's history knob, preserve it.
  if (shell === 'fish' ? spawnEnv.fish_history : spawnEnv.HISTFILE) return result
  spawnEnv.HISTFILE = wslDistro ? toLinuxPath(histFilePath) : histFilePath
  // Why a second variable: macOS `/etc/zshrc` assigns HISTFILE unconditionally
  // and runs before Orca's wrapper .zshrc ... The wrapper restores it from here (#11044).
  spawnEnv.ORCA_HISTFILE = spawnEnv.HISTFILE
```

wrapper 侧消费在 `ROOT/src/main/shell-templates.ts:27-32, 130-139`。继承检测（防嵌套泄漏）在 `ROOT/src/main/worktree-history-file-path.ts:30-60`，用正则识别 Orca 铸造的 HISTFILE 路径。

**fish 是特例**（`ROOT/src/main/fish-history-session.ts:5-62`）：

```ts
/** fish ignores HISTFILE entirely — history lives at `<data dir>/<name>_history`
 *  where `<name>` comes only from the `fish_history` variable ... So the session NAME
 *  is the only isolation lever ... `XDG_DATA_HOME` is deliberately not redirected */
const SESSION_PREFIX = "orca_";
const SAFE_SESSION_NAME = /^orca_(?:relay_)?[0-9a-f]{1,64}$/;
```

GC 有 5 分钟最小年龄保护防 TOCTOU（`ROOT/src/main/terminal-history-gc.ts:19-33`）：

```ts
// Why 5 minutes: GC runs ~10s after startup ... A worktree created between the snapshot and GC
// execution won't appear in liveWorktreeIds, so without an age guard GC would delete its
// freshly-created history directory (TOCTOU race).
const GC_MIN_AGE_MS = 5 * 60 * 1000;
const HISTORY_GC_SCAN_CONCURRENCY = 16;
```

删除走 rename 到 `.pending-delete` 再 rm 的墓碑模式。

---

## 5. 前端渲染

> 关键定位：渲染层真正的核心**不在** `components/terminal*`，而在 `ROOT/src/renderer/src/lib/pane-manager/`（184 文件）。`components/terminal-pane` 是 React 侧的生命周期 / PTY 绑定 / 标题 / 可见性编排层。

### 5.1 Terminal 实例与构造 options

唯一生产创建点：`ROOT/src/renderer/src/lib/pane-manager/pane-dom-creation.ts:41-53`：

```ts
const userOpts = options.terminalOptions?.(id) ?? {};
const terminalOpts: ITerminalOptions = { ...buildDefaultTerminalOptions(), ...userOpts };
const terminal = new Terminal(terminalOpts);
// Why: a synchronous throw inside any link provider's provideLinks ... escapes
// to window.onerror and gets the renderer killed. Guard every provider registered
// after this point — addon-internal and Orca's own.
installGuardedLinkProviderRegistration(terminal);
installWindowsCtrlAltChordRepair(terminal);
```

默认 options（`ROOT/src/renderer/src/lib/pane-manager/pane-terminal-options.ts:31-75`）：

```ts
{
  allowProposedApi: true,
  cursorBlink: true,
  cursorStyle: 'block',
  cursorInactiveStyle: resolveTerminalCursorInactiveStyle(cursorStyle),
  fontSize: 14,
  fontFamily: '"SF Mono", "Menlo", ... "Hack Nerd Font", monospace',
  fontWeight: '300', fontWeightBold: '500',
  scrollback: DESKTOP_TERMINAL_SCROLLBACK_ROWS_DEFAULT,     // 5000
  scrollSensitivity: 1.15,
  fastScrollSensitivity: 5,
  allowTransparency: false,
  minimumContrastRatio: LIGHT_BG_MIN_CONTRAST,
  macOptionIsMeta: false,                 // 非美式布局用 Option 组合打 @ €
  macOptionClickForcesSelection: true,
  drawBoldTextInBrightColors: true,
  scrollbar: { width: 7 },                // FitAddon 会吃掉约 1 列做 gutter
  vtExtensions: { kittyKeyboard: true }   // 对齐 VS Code xtermTerminal.ts
}
```

**没有 `letterSpacing`**（全仓未设置）。`theme` 不在构造 options 里，构造后由 `applyTerminalAppearance` 注入。

每 pane 的用户 options 在 `ROOT/src/renderer/src/components/terminal-pane/terminal-pane-manager-options.ts:112-158`，含 `windowsPty` 兼容层（`ROOT/src/renderer/src/lib/pane-manager/windows-pty-compatibility.ts:34-43`，按 Windows build 号决定是否传 `buildNumber`，`<21376` 只传 `{backend:'conpty'}`）。

另外两处非主路径的 `new Terminal(...)`：设置页预览 `TerminalSettingsPreview.tsx:128`、Dashboard 弹出预览 `AgentTerminalPreview.tsx:264`。

### 5.2 Addon

加载点 `ROOT/src/renderer/src/lib/pane-manager/pane-lifecycle.ts:45-56, 103-120`，顺序有讲究：

```ts
terminal.open(xtermContainer);
container.appendChild(linkTooltip);
// Load addons (order matters: WebGL must be after open())
terminal.loadAddon(fitAddon);
terminal.loadAddon(searchAddon);
terminal.loadAddon(serializeAddon);
terminal.loadAddon(unicode11Addon);
terminal.loadAddon(webLinksAddon);
activateOrcaTerminalUnicodeProvider(terminal); // 必须在任何 write 之前
if (ligaturesEnabled) {
  attachLigatures(pane);
}
if (pane.gpuRenderingEnabled) {
  attachWebgl(pane);
}
attachPaneFitResizeObserver(pane);
pane.pendingInitialFitRafId = requestAnimationFrame(() => {
  safeFit(pane);
});
```

**没有 canvas addon**，只有 WebGL 和 xterm 内置 DOM renderer 两档。Unicode11 之外还有自研宽度 shim `ROOT/src/shared/terminal-unicode-provider.ts`（修 ZWJ 宽度导致的表格破损 #4877）。Ligatures 是懒加载包装（绕过上游 packaging bug），attach 后会 `rebuildAttachedWebgl(pane)` 重建 glyph atlas。

WebGL 是动态 import 且有 3 次尝试上限（`ROOT/src/renderer/src/lib/pane-manager/terminal-webgl-addon-loader.ts:36-59`）：

```ts
webglAddonLoadAttempts += 1;
webglAddonLoad = import("@xterm/addon-webgl").then(
  (module) => {
    webglAddonConstructor = module.WebglAddon;
    handlers?.onLoaded();
  },
  (error) => {
    webglAddonLoad = null; // .then(ok,err) 会 fulfilled，缓存会永久困在 DOM renderer
    handlers?.onFailed();
    console.warn("[terminal] WebGL addon failed to load — using DOM renderer:", error);
  },
);
```

理由是 243 KB 的 addon 不能进首屏 chunk，由 `main.tsx` 在 React root 渲染后 prime。

context loss 处理在 `ROOT/src/renderer/src/lib/pane-manager/pane-webgl-renderer.ts:286-333`，回落 DOM renderer 并记录诊断，每 pane 独立 latch 不拖累全局。dispose 时主动调 `WEBGL_lose_context.loseContext()` 并把 canvas 宽高清零（`:162-176`，防 Windows/ANGLE 超出 Chromium 活跃 context 预算，#6874）。晚到的 attach 必须配一次 refit（`:201-230`），否则 grid 仍按 DOM cell metrics 测量，右侧会留空。

还有一条内容级否决：从 OSC 标题识别出 Gemini pane 时强制回 DOM renderer（`ROOT/src/renderer/src/components/terminal-pane/terminal-renderer-policy.ts:13-39`），但已知非 Gemini 的 owner 可反否决。

### 5.3 主题与字体

`ROOT/src/renderer/src/lib/terminal-themes/index.ts:8-17` 把四类主题合并成一个目录：

```ts
const THEME_CATEGORIES: readonly TerminalThemeMap[] = [
  DEFAULT_TERMINAL_THEMES, // Ghostty Default Style Dark / Builtin Tango Light
  POPULAR_DARK_TERMINAL_THEMES,
  POPULAR_LIGHT_TERMINAL_THEMES,
  CLASSIC_TERMINAL_THEMES, // Tango Dark / Homebrew ...
];
```

重名**直接抛错**（`shared.ts:9-13`：`throw new Error(\`Duplicate terminal theme name: ${name}\`)`）。默认值在 `ROOT/src/renderer/src/lib/terminal-theme.ts:14-17`。

**Warp 主题支持导入而非内置**。`ROOT/src/main/warp-themes/discovery.ts:7-18` 扫描 6 个 Warp 渠道（`.warp` / `.warp-preview` / `.warp-oss` / `.warp-dev` / `.warp-local` / `.warp-integration`，分 mac/linux/windows 名）的 themes 目录。`index.ts:33-58` 三种来源：`auto`（自动发现）/ `chooseFile` / `chooseFolder`，单文件上限 1 MB。YAML 解析放 worker 里并带超时。导入后成为 custom theme（`ROOT/src/shared/terminal-custom-themes.ts:7-16`），选择串形如 `custom:<id>`。

主题注入 xterm 在 `ROOT/src/renderer/src/components/terminal-pane/terminal-appearance.ts:53-70`：

```ts
export function composeActiveTerminalTheme(baseTheme, settings): ITheme | null {
  let theme: ITheme = {
    overviewRulerBorder: 'transparent',   // scrollbar.width 打开了 overview ruler，其 border 会画亮线
    scrollbarSliderBackground: 'rgba(180, 180, 185, 0.4)',
    scrollbarSliderHoverBackground: 'rgba(180, 180, 185, 0.6)',
    scrollbarSliderActiveBackground: 'rgba(180, 180, 185, 0.8)',
    ...baseTheme
```

同处还按背景亮度重算 `minimumContrastRatio`（#7934）。

字体：系统字体枚举在主进程（`ROOT/src/main/system-fonts.ts:35-78`，macOS 用 `system_profiler SPFontsDataType -json`，45 秒超时 32MB buffer；Linux 用 `fc-list : family`；Windows 用 PowerShell），结果 memo。渲染侧 fallback 链在 `ROOT/src/renderer/src/components/terminal-pane/layout-serialization.ts:36-65`：

```ts
const FALLBACK_FONTS = [
  "SF Mono",
  "Menlo",
  "Monaco",
  "Cascadia Mono",
  "Consolas",
  "DejaVu Sans Mono",
  "Liberation Mono",
  "Orca Nerd Font Symbols", // 内置 PUA fallback，供 OMP/Powerline 字形
  "Symbols Nerd Font Mono",
  "MesloLGS Nerd Font",
  "JetBrainsMono Nerd Font",
  "Hack Nerd Font",
  "monospace",
] as const;
```

字重归一化在 `ROOT/src/shared/terminal-fonts.ts:1-40`（默认 500 / bold 700，范围 100–900，bold 独立可配）。

### 5.4 resize 与 5.5 输入延迟

详见第 9 节 B 组与 A 组，那里有完整的常量表和多客户端仲裁机制。

### 5.6 隐藏终端与 GPU 探测

GPU 自动策略只在 Linux 上做严格判定（`ROOT/src/renderer/src/lib/pane-manager/terminal-webgl-auto-policy.ts:74-141`），依次否决 Wayland（#5319 输入卡死）、无 webgl2、无 `WEBGL_debug_renderer_info`、软件渲染器正则 `swiftshader|llvmpipe|softpipe`。结果全局缓存。

隐藏 pane 有三档处理：

```ts
// pane-rendering-control.ts:61-120
for (const pane of suspended) {
  pane.webglAttachmentDeferred = true;
  pane.terminal.blur();
  // ... 在 opacity:0 且未 inert 的 hide 模式下，活着的 WebglRenderer 会一直闪光标重绘
  suspendTerminalCursorBlink(pane.terminal);
}
if (retention && tryRetainHiddenPanesWebgl(retention.owner, retention.livePanes)) return;
for (const pane of suspended) {
  disposeWebgl(pane);
}
```

LRU 保留（`ROOT/src/renderer/src/lib/pane-manager/terminal-webgl-hidden-retention.ts:4-18`）：

```ts
// Orca raises Blink's active-context ceiling to 128, but retained contexts still consume
// GPU memory. Six keeps recent switch-backs on WebGL without letting hidden worktrees
// grow that cost with the mounted-pane population.
const MAX_RETAINED_HIDDEN_WEBGL_CONTEXTS = 6;
```

浮动终端例外（重开面板必须重建静默损坏的 atlas）。最彻底的一档是 **cold parking**：隐藏久了 slot 直接返回 null 不渲染（`ROOT/src/renderer/src/components/terminal-pane/use-terminal-tab-cold-parking.ts`），由字节 watcher 接管。

其它性能细节：RTL 连接器懒注册（任何 character joiner 会让每次重绘扫描整个 grid）、渲染错位探测 `terminal-render-desync-sentinel.ts`、DPR 变化修复 `terminal-canvas-dpr-repair.ts`。

---

## 6. 与 AI agent 的集成

### 6.1 spawn agent：先起 shell，再注入命令

PTY 里跑的永远是用户自己的交互式 shell。理由在 `ROOT/src/main/providers/local-pty-shell-ready-startup-command.ts:48`：

```ts
// Why: run in the same interactive shell (not `shell -c`) so the session survives after the agent exits.
// Why CR on Windows: PSReadLine/cmd.exe submit on `\r`, not LF; POSIX treats either as Enter under ICRNL.
const submit = process.platform === "win32" ? "\r" : "\n";
```

命令拼装三层：

**(a) 基础命令 + session options + 用户 args**（`ROOT/src/shared/tui-agent-launch-command.ts:34`）：

```ts
const override = args.cmdOverrides[args.agent];
const command =
  override ||
  getTuiAgentLaunchCommand(TUI_AGENT_CONFIG[args.agent], args.platform, {
    isRemote: args.isRemote,
  });
const suffix = planAgentCliArgsSuffix(args.agentArgs, args.shell);
```

`insertBeforeTerminator`（`:103`）把 model/effort flag 插到 `--` 之前。

**(b) prompt 注入模式表**（`ROOT/src/shared/tui-agent-startup.ts:97`）：`argv` / `flag-prompt`（`--prompt`）/ `hermes-query` / `flag-prompt-interactive` / `flag-interactive`（`-i`），都不支持时回落 `followupPrompt`（启动后再粘贴）。

**(c) headless one-shot 识别**（`ROOT/src/shared/agent-headless-command.ts:9`），这些不算交互 agent。flag 匹配工具支持 `-mopus` 这类聚簇短 flag（`ROOT/src/shared/agent-cli-flag-detection.ts:4`）。

**投递两条路**（`StartupCommandDelivery = 'fast' | 'shell-ready'`）。

路径 A 把命令写进 env `ORCA_POSIX_SHELL_STARTUP_COMMAND`，由 shell 的 prompt hook 自己 `eval`（`ROOT/src/main/pty/posix-shell-startup-command.ts:27`）：

```sh
__orca_run_startup_command() {
  local __orca_command="$ORCA_POSIX_SHELL_STARTUP_COMMAND" __orca_status
  unset ORCA_POSIX_SHELL_STARTUP_COMMAND
  __orca_remove_startup_command_prompt_hook
  builtin history -s "$__orca_command" 2>/dev/null || true
  builtin printf '%s\n' "$__orca_command"
  eval "$__orca_command"
}
```

路径 B 是等 ready 后单次写入（`local-pty-shell-ready-startup-command.ts:51`）：

```ts
// Why: single write after the ready barrier avoids incremental-paste char drops;
// multiline is bracketed-paste wrapped so newlines don't submit early.
proc.write(buildStartupCommandSubmission(startupCommand, { submit, bracketedPasteSafe: ... }))
```

上层编排在 `ROOT/src/main/agent-launch/agent-launch-executor.ts:101`，若偏好 structured session 则先建无 startup agent 的 worktree，被拒则降级成终端 agent。注意 `:282` 的注释：prompt 投递是调用方的责任不是 executor 的。

### 6.2 向终端注入文本

RPC `terminal.send` 在 `ROOT/src/main/runtime/rpc/methods/terminal/terminal-send-method.ts:24`，字段有 `text` / `enter` / `interrupt` / `agentPrompt` / `requireAgentStatus` / `waitSubmitMs` / `inputKind`。两阶段守卫（`:121`）：

```ts
if (params.requireAgentStatus === "sendable" && hasText && hasSuffix) {
  // Why: guarded sends are two-phase; reject combined payload + submit so a guard flip can't cause partial delivery.
  return { send: { handle: params.terminal, accepted: false, bytesWritten: 0 } };
}
```

agent prompt 与普通写入分叉在 `:192`，`isTerminalRunningSettledPromptAgent` 只对 claude/codex 返回 true（内部用 `recognizeAgentProcess(foregroundProcess)` 做前台进程识别）。

prompt 字节用 bracketed paste 包裹并做 ESC 消毒（`ROOT/src/shared/agent-prompt-injection.ts:83`）：

```ts
export function buildAgentPromptPasteBytes(prompt: string): string {
  return `${AGENT_PROMPT_BRACKETED_PASTE_START}${sanitizeAgentPromptText(prompt)}${AGENT_PROMPT_BRACKETED_PASTE_END}`;
}
```

Enter 之前的等待量按平台 + 字节数算（ConPTY 64 B/ms vs POSIX 4096 B/ms，`:60`）。

**slash command 走逐键输入**（`ROOT/src/shared/agent-tui-command-typing.ts:23`）：

```ts
/** Sends one PTY write per key so slash-command TUIs do not classify it as pasted prose. */
export async function typeAgentTuiCommand(args: {...}) {
  const keys = [AGENT_TUI_CLEAR_INPUT_LINE, ...args.command, '\r']
```

间隔 16ms。CLI 端是 `orca terminal send`（`ROOT/src/cli/handlers/terminal-send.ts:13`），host 不支持 prompt-delivery capability 时拒发而不是乐观发送。

### 6.3 等 shell ready：三重判据

就绪判定汇总在 `ROOT/src/main/providers/local-pty-shell-readiness-session.ts`。

**判据 1（首选）OSC 777 ready marker**（`ROOT/src/main/shell-ready-marker-scanner.ts:1`）：

```ts
export const SHELL_READY_MARKER_PREFIX = "\x1b]777;orca-shell-ready";
```

流式扫描器 `scanForShellReadyBoundary`（`:29`）逐字符匹配，匹配中的字节被 hold（`state.heldBytes`），防止 marker 碎片泄漏到终端显示，遇 BEL 判定 matched 并报告 `postMarkerBytesObserved`。

**判据 2（wrapper 被用户配置顶掉时的兜底）line-editor 特征 + 进程探测**（`ROOT/src/main/line-editor-ready-output-scanner.ts:1`）：

```ts
const LINE_EDITOR_READY_SEQUENCES = ["\x1b[?2004h", "\x1b[?1034h", "\x1b]133;A\x07"] as const;
```

即开启 bracketed paste、meta 模式、或 OSC 133;A 三者任一。看到后 50ms settle 再探针，最多 4 次（`ROOT/src/main/shell-prompt-readiness-probe.ts:13`）。探针检查三件事（`:43`）：PTY slave 处于 line-editor 状态、shell pid 是前台进程且 executable basename 与启动的 shell 同名、executable 路径等于解析路径或在本 pane PATH 下的同名安装列表里（`:71-88` 的注释解释了 Homebrew bash `exec` 覆盖的情形）。

**判据 3 超时兜底**（`ROOT/src/main/providers/local-pty-shell-ready-startup-command.ts:7`）：

```ts
export const STARTUP_COMMAND_READY_MAX_WAIT_MS = 1500;
const POST_SHELL_READY_STARTUP_COMMAND_DELAY_MS = 30;
const POST_SHELL_READY_STARTUP_COMMAND_FALLBACK_MS = 200;
```

ready 之后还要再等一拍（`:68`）：

```ts
// Why: marker fires from precmd before the line editor takes the PTY out of ECHO;
// writing now double-echoes the command, so settle first.
```

### 6.4 读取与等待输出

主进程用 `@xterm/headless`（`ROOT/src/main/daemon/headless-emulator.ts:1`）：

```ts
import "./xterm-env-polyfill";
import { Terminal } from "@xterm/headless";
import { SerializeAddon } from "@xterm/addon-serialize";
import { Unicode11Addon } from "@xterm/addon-unicode11";
```

构造在 `:82`，`vtExtensions: { kittyKeyboard: true }`，加载 Unicode11 以与 renderer 的字宽测量一致（`:95` 注释：否则 emoji 行会错位，镜像累积 cell-shifted tears）。每 PTY 一份。

`terminal.read` 两种语义（`ROOT/src/main/runtime/orca-runtime-resolve-terminal-pane.ts:180`）：`--cursor` 翻累积流，`--screen` 读当前渲染帧。CLI 侧明确禁止两者同用并对老 host 做能力校验。

`terminal.wait` 只支持两个条件（`ROOT/src/shared/rpc-contract/terminal-unary-params.ts:140`）：`exit` 和 `tui-idle`。CLI 把 RPC 超时放宽到 5 分钟，且 `satisfied === false` 时 `process.exitCode = 1`，为支持 `terminal wait && terminal send` 链式用法。轮询 loop 在 `ROOT/src/main/runtime/runtime-terminal-idle-polls.ts:103`。

### 6.5 activity 状态检测：七路信号，三级证据

状态词汇表（`ROOT/src/shared/agent-status-types.ts:26`）：

```ts
export const AGENT_STATUS_STATES = ["working", "blocked", "waiting", "done"] as const;
```

七路信号：

| 信号                     | 位置                                                     | 说明                                                                         |
| ------------------------ | -------------------------------------------------------- | ---------------------------------------------------------------------------- |
| A. OSC 9999 自报状态     | `ROOT/src/shared/agent-status-osc.ts:5`                  | 带跨 chunk carry；挂在 ptyId 而非 paneKey（CLI 创建的 PTY 可能没有 paneKey） |
| B. 终端标题 OSC 0/2      | `ROOT/src/main/runtime/terminal-wait-detection.ts:14`    | 必须显式 idle 词或已知前缀字符                                               |
| C. 屏幕正文扫描          | 同上 `:109`                                              | cursor-agent 无 idle OSC 标题，靠盲文 spinner 的有无判定                     |
| D. PTY 输出静默计时      | `ROOT/src/main/runtime/orca-runtime-postlude.ts:61`      | 超时 5 分钟，轮询 2 秒，quiescence 3 秒                                      |
| E. 前台进程识别          | `ROOT/src/shared/agent-process-recognition.ts:1-45`      | 处理 node/python 包装与 `.exe/.cmd/.ps1` 后缀                                |
| F. agent hooks HTTP 回调 | 见 6.6                                                   | 归一化为 explicit status                                                     |
| G. OSC 133;D 命令结束    | `ROOT/src/shared/terminal-osc133-command-finished.ts:16` | 主要服务 shell 命令而非 agent turn                                           |

信号 B 的显式判据（`terminal-wait-detection.ts:14`）：

```ts
const EXPLICIT_IDLE_TITLE_RE = /(^|\s)(ready|idle|done)(\s|$|[.!?])/i;
const CLAUDE_IDLE_PREFIX = "\u2733";
const GEMINI_IDLE_PREFIX = "\u25c7";
const PI_IDLE_PREFIX = "\u03c0 - ";
```

必须显式，因为 launch 标题如 "Codex YOLO" 含 agent 名但不是就绪信号。

**合并规则是这套设计最精华的部分**（`ROOT/src/main/runtime/tui-idle-evidence.ts:128`）：

```ts
export function isTuiIdleSatisfied(input: TuiIdleSatisfactionInput): boolean {
  // Why the title before the body: both are tier 1, so either settles, but the title is a
  // memoized lookup and the body is a fresh multi-KB scan. Same verdict, cheaper order.
  if (hasExplicitIdleTitle(input.record, input.rendererTitle) || input.readPositiveBodyEvidence()) {
    return true;
  }
  if (hasFreshWorkingFirstPartyStatus(input.firstPartyStatus)) {
    return false;
  }
  return hasSustainedTitleIdle(input.record, input.agent, input.quiescenceMs);
}
```

三级（`:18-26`）：POSITIVE（agent 自称 ready）> VETO（新鲜的 first-party working/blocked/waiting，agent 自己的说法压倒一切推断）> ABSENCE（仅有名字的标题或安静的非 shell 前台进程，且必须持续满足 quiescence）。

`nameOnlyIdleNeedsCorroboration`（`:70`）按 agent 分类：Codex/Devin 会显式报 ready，必须等佐证；Grok/Copilot/Aider/Mimo/agy/OpenCode 静止时只会打自己的名字，不能等，否则永不 settle（注释提到 idle 的 Grok 面板每秒重绘 banner 约 4 次）。

permission 类信号用**时间戳新旧仲裁**（`ROOT/src/main/runtime/runtime-terminal-agent-status-query.ts:65`）：

```ts
const newestPermissionAt = Math.max(
  explicitStatus?.status === "permission" ? explicitStatus.updatedAt : -1,
  lifecycle?.status === "permission" ? lifecycle.updatedAt : -1,
  terminal.waitBlockedAt ?? -1,
);
```

`liveTitleClearsBlockedText`（`:69`）允许一个活的非 permission 标题把正文里残留的旧权限提示清掉。`explicitStatus` 存在时还会再查前台是否已回到 shell，避免 hook 说 working 但 agent 早退了。

prompt 送达的效果验证在 `ROOT/src/main/runtime/agent-prompt-submission-verification.ts:13`，`isTerminalSendSettlementAgent` 只认 claude/codex（`:54`：只有这两家暴露可结算的 turn-start 信号）。

**合成的 spinner 走独立入口不污染数据流**（`ROOT/src/main/runtime/orca-runtime-schedule-wait-blocked-check.ts:144`）：

```ts
/** Feed a main-fabricated OSC title/BEL frame (agent hook spinners) through
 *  the per-PTY tracker — NOT onPtyData, so emulator state, tails,
 *  transcripts, and stats never see synthetic bytes. */
ingestSyntheticTitleFrame(ptyId: string, data: string): void
```

推进逻辑在 `ROOT/src/main/startup/synthetic-title-runtime.ts:87`，窗口不可见就不推帧（`ROOT/src/main/synthetic-title-visibility.ts:1-6`）。`ROOT/src/main/synthetic-title-spinner.ts:8` 的注释解释为何 connection-scoped 的 clear 不带 paneKey：丢 SSH 传输不等于远端 PTY 停了。

### 6.6 agent hooks

通道是**本地 HTTP + spool 文件补偿**。HTTP server（`ROOT/src/main/agent-hooks/server/server-lifecycle.ts:159`）监听 `127.0.0.1` 随机端口，鉴权在 `:61`：

```ts
// Why: authenticate before spending work reading an untrusted body.
if (req.headers["x-orca-agent-hook-token"] !== this.token) {
  res.writeHead(403);
  res.end();
  return;
}
let destroyedBySlowlorisCap = false;
req.setTimeout(HOOK_REQUEST_SLOWLORIS_MS, () => {
  destroyedBySlowlorisCap = true;
  req.destroy();
});
```

token 每次 start 重新 `randomUUID()`。**始终返回 204 永不阻塞 agent**（`:128`）：

```ts
// Why: fail open — return success on malformed payloads so a broken hook never blocks the agent.
```

spool 文件（`ROOT/src/shared/agent-hook-spool.ts:15`）：

```ts
export const AGENT_HOOK_SPOOL_MAX_BYTES = 5 * 1024 * 1024;
export const AGENT_HOOK_SPOOL_MAX_FILES = 1024;
export const AGENT_HOOK_SPOOL_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
```

读取时保留未写完的尾行（`:55`：A torn trailing line is left unconsumed so a writer still finishing it is not truncated away）。启动时**先 drain 再 bind**（`server-lifecycle.ts:47`）：

```ts
// Drain before binding the listener so replay cannot race a live hook during startup.
```

agent 侧通过 endpoint 文件找到端口和 token（`ROOT/src/shared/agent-hook-endpoint-file.ts:1`，`endpoint.env` / `endpoint.cmd`，字段 `ORCA_AGENT_HOOK_PORT / TOKEN / ENV / VERSION`）。

注入方式是往 agent 配置里写 curl 片段（`ROOT/src/main/agent-hooks/hook-post-command.ts:14`）：

```sh
printf '%s' "$payload" | curl -sS -X POST "http://127.0.0.1:${ORCA_AGENT_HOOK_PORT}/hook/<source>" \
  --connect-timeout "${connect_timeout:-0.5}" --max-time "${max_time:-1.5}" \
  --noproxy "127.0.0.1" \
  -H "Content-Type: application/json" \
  -H "X-Orca-Agent-Hook-Token: ${ORCA_AGENT_HOOK_TOKEN}" \
  -H "X-Orca-Agent-Hook-Meta-Encoding: base64"
```

脚本调用用守卫包裹（`ROOT/src/main/agent-hooks/posix-hook-command.ts:8`）：

```ts
const guards = [
  ...(options.requiredEnvVar ? [`[ -n "\${${options.requiredEnvVar}-}" ]`] : []),
  `[ -f ${quoted} ]`,
  `[ -r ${quoted} ]`,
  `[ -x ${quoted} ]`,
].join(" && ");
return `if ${guards}; then ${invocation}; else ${fallback}; fi`;
```

动机（`:7`）是脚本缺失时静默 no-op 而不是每次工具调用都 exit-127。

Claude 的 settings.json 注入注册 10 个事件（`ROOT/src/main/claude/hook-settings.ts:40-95`）：`SessionStart`、`UserPromptSubmit`、`Stop`、`StopFailure`（OpenClaude 在 API/model 错误后跳过 Stop）、`SubagentStop`、`PreToolUse`/`PostToolUse`/`PostToolUseFailure`/`PermissionRequest`、`PostCompact`（手动 `/compact` 不发 Stop）。写入路径对 symlink 特殊处理（`ROOT/src/main/agent-hooks/hook-config-write-path.ts:13`）：

```ts
if (isSymlink) {
  // Why: atomic rename on the link path disconnects dotfiles-managed hook configs.
  return realpathSync.native(configPath);
}
```

14 家 agent 的安装器在 `ROOT/src/main/agent-hooks/managed-agent-hook-registry.ts:38`。事件到状态的归一化入口在 `ROOT/src/shared/agent-hook-listener.ts:23`，每家 provider 一个文件共 32 个（`ROOT/src/shared/agent-hook-listener/providers/`）。Claude 的映射在 `claude-events.ts:103`。

### 6.7 交互式提示

从 hook payload 派生 `interactivePrompt`（`ROOT/src/shared/agent-hook-listener/interactive-tool.ts:39`）：

```ts
export function deriveInteractivePrompt(toolName, toolInput, eventName): string | undefined {
  const isPostToolEvent =
    normalizedEventName === "post_tool_use" || normalizedEventName === "post_tool_use_failure";
  if (isAskUserQuestionTool(toolName) && !isPostToolEvent && toolInput != null) {
    try {
      return JSON.stringify(toolInput);
    } catch {
      return undefined;
    }
  }
  if (eventName === "PermissionRequest" && typeof toolName === "string" && toolName.length > 0) {
    try {
      return JSON.stringify({
        approval: { tool: toolName, summary: summarizeApprovalInput(toolInput) },
      });
    } catch {
      return undefined;
    }
  }
  return undefined;
}
```

`summarizeApprovalInput` 优先取 `command / file_path / path / url / pattern`，超 200 字符截断。工具结束时显式清空（`:8`），否则失败的工具会永远看起来在飞。

下游消费四处：dashboard 归入 attention 桶、native chat 渲染交互卡片、`terminal.wait --for tui-idle` 碰到阻塞**立刻返回** `satisfied:false + blockedReason`（`ROOT/src/main/runtime/runtime-terminal-idle-polls.ts:118`）、`requireAgentStatus: 'sendable'` 的写入被挡下。

还有一个巧妙的闭环（`ROOT/src/renderer/src/components/terminal-pane/agent-question-answered-inference.ts:79`）：用户在终端里手动按键回答后，解析 `{questions}` 里的单选项数（`ROOT/src/shared/agent-question-answered-intent.ts:37`）推断这次按键是否构成一次回答，从而清掉 attention 状态，不必等 agent 下一次 hook。

---

## 7. 多终端管理

**Pane 树是「DOM 即模型」**。`PaneManager`（`ROOT/src/renderer/src/lib/pane-manager/pane-manager.ts:71-80`）持有 `root: HTMLElement` + `panes: Map<number, ManagedPaneInternal>`，split 表现为 `.pane-split` DOM 节点，序列化时遍历 DOM（`layout-serialization.ts:75+` 的 `serializePaneTree`）。

持久化模型（`ROOT/src/shared/terminal-tab-types.ts:115-141`）：

```ts
export type TerminalPaneLayoutNode =
  | { type: "leaf"; leafId: string }
  | {
      type: "split";
      direction: "vertical" | "horizontal";
      first: TerminalPaneLayoutNode;
      second: TerminalPaneLayoutNode;
      ratio?: number;
    }; // 第一个子节点的 flex 比例 0–1，缺省 0.5

export type TerminalLayoutSnapshot = {
  root: TerminalPaneLayoutNode | null;
  activeLeafId: string | null;
  expandedLeafId: string | null;
  ptyIdsByLeafId?: Record<string, string>; // 会话内 remount 用，重启不用
  buffersByLeafId?: Record<string, string>; // 序列化 scrollback
};
```

Store 形状（`ROOT/src/renderer/src/store/terminals/terminal-state.ts:26-152`）：

```ts
tabsByWorktree: Record<string, TerminalTab[]>;
activeTabId: string | null;
activeTabIdByWorktree: Record<string, string | null>; // 每 worktree 独立焦点
ptyIdsByTabId: Record<string, string[]>;
runtimePaneTitlesByTabId: Record<string, Record<number, string>>;
terminalLayoutsByTabId: Record<string, TerminalLayoutSnapshot>;
expandedPaneByTabId / canExpandPaneByTabId;
tabBarOrderByWorktree: Record<string, string[]>;
```

`setTabLayout` 有结构相等短路（`terminal-layout-state.ts:80-84`）：pane 标题变动会反复重新持久化结构相同的快照，短路能让所有 pane selector 保持休眠。

**分组键就是 `worktreeId`**。解析与路由在 `ROOT/src/renderer/src/store/terminals/terminal-workspace-routing.ts:54-60+`（`parseWorkspaceKey` 区分 folder workspace 与 repo worktree）。创建 tab 时按 worktree 决定 shell（`terminal-tab-creation.ts:101-115`）。浮动终端用保留伪 worktree id `'global-floating-terminal'`（`ROOT/src/shared/constants.ts:106`）。worktree 内还有 group 层。

**标题有四个来源**：

1. 序号默认标题（`ROOT/src/renderer/src/store/terminals/terminal-tab-creation.ts:26-40`）：

```ts
export function getNextTerminalOrdinal(tabs: TerminalTab[]): number {
  // 复用最小空闲序号：老 tab 关掉后新终端仍叫 "Terminal 1"，不是单调计数器
  const match = /^Terminal (\d+)$/.exec(tab.defaultTitle ?? tab.title)
```

2. OSC 0/2 标题（`ROOT/src/renderer/src/components/terminal-pane/pty-output-title-observer.ts:71-122`），只在 `data.includes('\x1b]')` 时才扫，"working" 类标题 3 秒无更新就清转轮。主进程也有一套（`terminalMainSideEffectAuthority` 打开时走 `pty:sideEffect`，避免双份扫描）。标题还兼做渲染器策略输入（`terminal-title-evidence.ts:50-63` 一次解析出 `displayTitle` + `rendererPolicy`）。

3. AI 生成标题（`terminal-tab-presentation.ts:85-112`），仅当 `settings.tabAutoGenerateTitle` 且无 `customTitle` / `quickCommandLabel`。另有 `aiVaultTitle`。

4. 手动重命名 `customTitle`。

**`synthetic-title-*.ts` 在 `src/main/`**，是给没有原生 OSC 标题的 pane 合成带转轮的标题帧，见 6.5。

**关闭确认只对交互式用户关闭生效**（`ROOT/src/renderer/src/components/terminal/running-terminal-close-guard.ts:22-63`）：

```ts
/** ... A remote inspect RPC can hang for its full 15s timeout, and an X button that looks
 *  dead for 15s is the same class of bug as one that never asks — but an unanswered probe
 *  is not evidence of an idle shell, so the timeout raises the prompt rather than killing
 *  a possibly-running remote command (#10142). */
export const RUNNING_CLOSE_PROBE_TIMEOUT_MS = 4_000;

export function shouldConfirmRunningTerminalClose(options?): boolean {
  if (options?.force === true || options?.rejectPinned === true) return false;
  if (options?.skipRunningProcessConfirm === true || options?.lifecyclePtyId !== undefined)
    return false;
  return isUserReason(options?.reason) && isUserReason(options?.hostCloseReason);
}
```

`collectTabPtyIds`（`:46-63`）同时并 `ptyIdsByTabId` 和 layout 的 `ptyIdsByLeafId`，避免挂载窗口期漏提示。

关闭后 tab 被移除（`ROOT/src/renderer/src/store/terminals/terminal-tab-close.ts:27-46`），两个软保留：远程 worktree 的 user 关闭记 tombstone（防 direct-SSH pull 时复活）、Cmd+Shift+T 重开栈（快照 `startupCwd / shellOverride / customTitle / color / position`，`:88-105`）。PTY 退出导致的关闭走另一路径，带 `suppressedPtyExitIds` / `pendingPtyShutdownIds` 引用计数防拆卸竞态。

**floating-terminal 是全局悬浮工作区面板**。面板里可以放终端、浏览器、Markdown 编辑器、模拟器（`ROOT/src/renderer/src/components/floating-terminal/FloatingTerminalPanelSurface.tsx:40-79`）。可拖动、可缩放、可最大化、几何持久化。唤起入口是可拖动悬浮按钮（位置持久化 + 视口变化时 reconcile，拖动阈值 4px）。快捷键体系独立（`floating-terminal-panel-types.ts:21-28`）：

```ts
// 'deferred' leaves propagation intact for the terminal pane's split-close handler.
export type FloatingShortcutOutcome = "handled" | "deferred" | "unmatched";
```

**terminal-quick-commands** 是用户自定义的一键命令 / agent prompt，派发到 pane 在 `ROOT/src/renderer/src/components/terminal-pane/terminal-quick-command-dispatch.ts:31-45`。

---

## 8. 跨设备：手机端与远程访问

### 8.1 两个长生命周期进程 + 五种远程形态

核心设计是把「Orca runtime（RPC 服务端）」从 Electron 窗口里剥离，所有远程客户端都是这个 runtime 的 WebSocket 客户端。

| 形态                                      | 入口                                                                             | 传输                                            |
| ----------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------- |
| A. `orca serve` 自托管                    | `ROOT/src/cli/specs/serve.ts:4-33`                                               | 直连 `ws(s)://host:6768` + E2EE 握手            |
| B. 手机直连（LAN / Tailscale / SSH 转发） | `ROOT/mobile/src/transport/direct-rpc-client.ts`                                 | 同上                                            |
| C. 手机经 cloud relay                     | `ROOT/cloud/apps/relay/` + `ROOT/src/main/runtime/relay/relay-control-client.ts` | 双方出站连 relay，relay 做**不透明字节 splice** |
| D. SSH 远程 worktree                      | `ROOT/src/relay/relay.ts`、`ROOT/src/main/ssh/`                                  | 自定义二进制帧跑在 SSH 通道 / Unix socket 上    |
| E. 浏览器 web 客户端                      | `ROOT/vite.web.config.ts` + `ROOT/src/renderer/web-index.html`                   | 同端口 HTTP 托管                                |

绑定策略（`ROOT/docs/reference/orcad-operations.md:39-53`）：`--bind` 默认 `127.0.0.1`，只接受字面 IP 拒绝主机名（DNS 会决定绑哪个网卡），设计上远程走 SSH 本地端口转发，所以 loopback 是正确默认值。

`serve` 的能力声明（`ROOT/src/cli/specs/serve.ts:19-25`）：

```ts
notes: [
  "Runs in the foreground and prints the bound endpoint, advertised endpoint, and pairing status.",
  "--pairing-address changes only the client-advertised address; use a reachable LAN, Tailscale, SSH-forward, or reverse-proxy endpoint.",
  "Use --mobile-pairing to print a mobile-scoped pairing QR/link instead of the default runtime-environment pairing link.",
  "When the web client bundle is available, the server also prints a browser URL with the pairing data embedded.",
];
```

数据流：

```
node-pty → terminal daemon (detached, 拥有全部 PTY)
         ↕ unix socket / NDJSON RPC
       orcad / Electron main = Orca runtime
         ↕ WebSocket (ws/wss)
   ┌────────────┬──────────────────┬────────────────┐
[直连 E2EE]  [relay splice]   [static HTTP]
   │             │                  │
桌面远程     手机 Expo App        浏览器 web 客户端
           (xterm in WebView)    (完整 Orca UI)

旁路: cloud/apps/push (APNs/FCM) ← src/main/runtime/push/push-dispatcher.ts
```

SSH 形态的执行边界（`ROOT/docs/reference/ssh-execution-boundary.md:7-13`）：执行主机拥有一切与执行相关的东西，失联只能报 `unverifiable` 不能报 `exited`。

### 8.2 传输协议：一条 WebSocket 上两类帧

文本帧是加密后 base64 的 JSON-RPC，二进制帧是加密后的终端流帧。`ROOT/mobile/src/transport/e2ee.ts:1-4`：

```ts
// Why: E2EE primitives for the mobile side. Uses tweetnacl for Curve25519 ECDH
// key exchange and XSalsa20-Poly1305 authenticated encryption. JSON RPC uses
// base64([24-byte nonce][ciphertext]) over WebSocket text frames; terminal
// stream frames use the raw byte bundle.
```

**终端流帧是 16 字节头 + payload 的纯二进制**（`ROOT/src/shared/terminal-stream-protocol.ts:12-34`）：

```ts
export enum TerminalStreamOpcode {
  Output = 1,
  SnapshotStart = 2,
  SnapshotChunk = 3,
  SnapshotEnd = 4,
  Resized = 5,
  Error = 6,
  Input = 7,
  Resize = 8,
  Subscribe = 9,
  Unsubscribe = 10,
  SnapshotRequest = 11,
  Metadata = 12,
  // Why 13: Metadata=12 shipped to mobile clients in v1.4.120; Ack (branch-only
  // remote-multiplex flow control) renumbers to stay wire-compatible.
  Ack = 13,
  ClaimViewport = 14,
  OutputSpan = 15,
  SetOutputPaused = 16,
  WriteUnavailable = 17,
}
```

帧头（`:43-56`）：`kind=0x74`、`version=1`、`opcode`、保留字节、`streamId`(u32 LE)、`seq`(u64 LE 拆两个 u32)。

**PTY 输出不是 base64**：`Output` 帧 payload 就是 UTF-8 原始字节（`encodeTerminalStreamText` → `TextEncoder().encode`）。只有输出被 host 变换过（`transformed`/`rawLength` 不等）才退化成 `OutputSpan` 的 JSON 形式。

分片与流控（`ROOT/src/shared/terminal-multiplex-flow-control.ts:1-13`）：

| 常量                | 值              |
| ------------------- | --------------- |
| 单帧分片            | 48 KiB          |
| 输出批上限          | 64 KiB          |
| 单流初始 / 最大窗口 | 512 KiB / 2 MiB |
| 总初始 / 最大窗口   | 2 MiB / 8 MiB   |
| ACK 批量 / 刷新间隔 | 192 KiB / 4 ms  |
| pending 上限        | 256 KiB         |
| 单连接最大活跃流    | 128             |

分片保证**不在 surrogate pair 中间切**（`ROOT/src/main/runtime/rpc/terminal-output-frame-chunks.ts:36-42`）。客户端用 `Ack` opcode 做字节滑动窗口回授（`ROOT/src/renderer/src/runtime/remote-runtime-terminal-flow-controller.ts:76-117`），攒够 192 KiB 或 4 ms 刷一次，发送失败会把字节数重新计回防止窗口永久缩小。无应用层压缩，只有 WebSocket 层可选 permessage-deflate。

**E2EE 握手**：明文 `e2ee_hello{publicKeyB64}` → `e2ee_ready` → 加密的 `e2ee_auth{deviceToken}` → `e2ee_authenticated`（`ROOT/mobile/src/transport/rpc-client-socket-session.ts:108-118, 200-205`；服务端 `ROOT/src/main/runtime/rpc/e2ee-channel.ts:174, 198, 236-239`）。

v2 密钥调度做双向独立密钥 + transcript 绑定（`ROOT/mobile/src/transport/mobile-e2ee-v2-key-schedule.ts:4-31`）：

```ts
const SALT_LABEL = new TextEncoder().encode("orca-mobile-e2ee/v2/salt\0");
const INFO_LABEL = new TextEncoder().encode("orca-mobile-e2ee/v2/session\0");
const transcriptHash = sha256(args.transcript);
const salt = sha256(concatBytes([SALT_LABEL, args.clientNonce, args.desktopNonce]));
const info = concatBytes([INFO_LABEL, transcriptHash]);
const expanded = hkdf(sha256, args.sharedSecret, salt, info, 96);
return {
  mobileToDesktopKey: expanded.slice(0, 32),
  desktopToMobileKey: expanded.slice(32, 64),
  sessionId: expanded.slice(64, 96),
  transcriptHash,
};
```

Web 端同源实现在 `ROOT/src/renderer/src/web/web-e2ee.ts:1-34`。

**relay 是零知识的**（`ROOT/cloud/packages/relay-contract/src/protocol-limits.ts:1-11`）：

```ts
export const RELAY_PROTOCOL_LIMITS = {
  firstFrameDeadlineMs: 2_000,
  maxHttpBodyBytes: 4 * 1024,
  // Why: the splice is an opaque E2EE stream; the desktop's worktree catalog
  // response already exceeds 1MiB on large workspaces (~775KiB at 415
  // worktrees, growing), and an oversized frame kills the session on every
  // reconnect. 8MiB buys years of headroom;
  maxFrameBytes: 8 * 1024 * 1024,
  maxConnectionsPerHost: 8,
  idleTimeoutMs: 10 * 60 * 1000,
```

数据面就是把两条 WS 原样对拼（`ROOT/cloud/apps/relay/src/splice-forwarder.ts:48-56`），带背压与字节预算，不解析任何 payload。控制面契约是 strict zod（`ROOT/cloud/packages/relay-contract/src/control-messages.ts:21-41`），relay 用 challenge/proof 验证 host 身份。

协议版本（`ROOT/src/shared/protocol-version.ts:33-35`）：

```ts
export const RUNTIME_PROTOCOL_VERSION = 3;
export const MIN_COMPATIBLE_RUNTIME_CLIENT_VERSION = 2;
export const MIN_COMPATIBLE_RUNTIME_SERVER_VERSION = 2;
```

新 opcode 必须在 Subscribe 的 `capabilities` 里协商，否则老 peer 会静默丢帧（`ROOT/docs/reference/remote-wire-compatibility.md:33-57` 的 Rule 2）。

### 8.3 输出同步与重连

**首次连接走 SnapshotStart / Chunk / End 三段式**（`ROOT/src/main/runtime/rpc/methods/terminal/terminal-snapshot-publication.ts:48-70`），内容是 `scrollbackAnsi + 当前屏 data`，按行数候选逐级降级直到满足字节预算（桌面 `REQUESTED_SNAPSHOT_BYTE_BUDGET = 2 MiB`）。

**手机端预算更小**（`ROOT/src/main/runtime/scrollback-limits.ts:1-8`）：

```ts
// Why: mobile subscribers hydrate the runtime headless emulator from the
// desktop renderer's xterm buffer. The renderer holds a 50k-row scrollback;
// shipping all of it across IPC + replaying through HeadlessEmulator is
// expensive and unnecessary for a phone screen. Cap at 1000 rows and 512 KiB
export const MOBILE_SUBSCRIBE_SCROLLBACK_ROWS = 1000;
export const MOBILE_SNAPSHOT_BYTE_BUDGET = 512 * 1024;
```

**快照与实时流的接缝按 seq 精确裁切**，不是整块丢弃（`ROOT/src/main/runtime/rpc/methods/terminal/terminal-stream-replay.ts:34-68`）：

```ts
export function getOutputAfterSnapshotSeq(chunk, snapshotSeq) {
  if (chunk.meta.seq <= snapshotSeq) return null; // 整块已含在快照里
  const chunkStartSeq = chunk.meta.seq - chunk.meta.rawLength;
  if (chunkStartSeq >= snapshotSeq) return chunk; // 整块都是新的
  if (chunk.meta.transformed) return null;
  const offset = snapshotSeq - chunkStartSeq;
  return {
    data: chunk.data.slice(offset),
    bytes: chunk.bytes,
    meta: { ...chunk.meta, rawLength: chunk.meta.rawLength - offset },
  };
}
```

订阅确认事件回传 `seq` / `capabilities` / `truncated`（`terminal-multiplex-initial-snapshot.ts:52-72`）。积压溢出时丢弃积压并重新序列化快照，把 `truncated: true` 告诉客户端 —— 丢的是历史，不是权威当前屏。

**重连不是 seq 续传，而是重新订阅 + 拿新快照。** iOS 前台恢复的注释解释了必要性（`ROOT/mobile/src/terminal/terminal-foreground-recovery.ts:5-10`）：

```ts
export const TERMINAL_FOREGROUND_RECOVERY_DELAY_MS = 120;
// 'deferred' = the socket wasn't connected at the foreground edge (it usually
// dies after ~60-80s of background); the caller must re-run recovery once the
// connection is back or a blanked WKWebView stays stale until a tab switch.
export type TerminalForegroundRecoveryOutcome = "recovered" | "deferred" | "skipped";
```

实现是 `unsubscribeTerminal(handle)` 后再 `subscribeToTerminal(handle)`。

SSH 形态是有限重放缓冲（`ROOT/src/relay/pty-handler.ts:340`）：

```ts
export const REPLAY_BUFFER_MAX = 100 * 1024;
```

语义写在 `ROOT/docs/reference/ssh-execution-boundary.md:52`：

> Reconnect re-attaches to the same live PTYs and replays a bounded buffer (a 102,400-code-unit tail). Output beyond that while you were away is lost to the client even though the process was never interrupted: **the transcript is truncated; the work stays `live`.**

relay 层另有 resume 凭据做会话续期而非内容续传（`ROOT/src/shared/mobile-relay-phone-protocol.ts:16-31`，`credentialKind: 'resume'`、`acceptedAs: 'current' | 'grace'`，TTL 30 天）。

### 8.4 手机端：Expo + 真 xterm.js 跑在 WebView

技术栈（`ROOT/mobile/package.json:20-70`）：Expo 55 + RN 0.83 + expo-router + zustand + zod + **tweetnacl** + `@noble/hashes` + `react-native-webview 13.16.2`，并且**直接依赖 `@xterm/xterm 6.1.0-beta` + `@xterm/addon-webgl` + `@xterm/addon-unicode11`**。

路由是 Expo Router 文件式：`ROOT/mobile/app/h/[hostId]/session/[worktreeId].tsx`。

postinstall 就把 xterm 打成自包含 bundle（`ROOT/mobile/package.json:10`）：

```json
"postinstall": "node scripts/build-terminal-webview-engine.mjs && node scripts/build-mermaid-webview-engine.mjs",
```

构建脚本（`ROOT/mobile/scripts/build-terminal-webview-engine.mjs:12-13, 28-33`）输出到 `src/terminal/terminal-webview-engine.generated.ts`，target `chrome74`，内容是：

```js
import { Terminal } from "@xterm/xterm";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebglAddon } from "@xterm/addon-webgl";
```

并为老 Android WebView 打了 `WeakRef` / `structuredClone` polyfill（`:38-50`）。

HTML 文档由 14 个字符串模块拼成（`ROOT/mobile/src/terminal/terminal-webview-html.ts:20-38`）：

```ts
export const XTERM_HTML = [
  TERMINAL_HTML_DOCUMENT_SHELL,
  TERMINAL_HTML_RUNTIME_STATE_AND_TEXT_SCALING,
  TERMINAL_HTML_FIT_SCALE,
  TERMINAL_HTML_MOUSE_MODE_DECSET_SCAN,
  TERMINAL_HTML_WRITE_QUEUE,
  TERMINAL_HTML_INIT_AND_WRITE,
  TERMINAL_HTML_HOST_MESSAGE_ROUTER,
  TERMINAL_HTML_SELECTION_STATE_AND_EVICTION,
  TERMINAL_HTML_OBSERVERS_AND_MODE_MIRRORING,
  TERMINAL_HTML_MOUSE_REPORT_AND_SCROLL_ROUTING,
  TERMINAL_HTML_SMOOTH_SCROLL_AND_CELL_GEOMETRY,
  TERMINAL_HTML_SELECTION_OVERLAY,
  TERMINAL_HTML_SURFACE_TOUCH_GESTURES,
  TERMINAL_HTML_MESSAGE_BRIDGE_AND_DOCUMENT_CLOSE,
].join("");
```

**所以手机上不是「看日志快照」，是完整 xterm.js，含 WebGL 渲染、DECSET 鼠标上报、OSC 133 命令边界、kitty keyboard flags 透传。**

组件在 `ROOT/mobile/src/terminal/TerminalWebView.tsx`（RN WebView + postMessage 桥，`:45-60` 用 `pendingMessages` 队列解决 WebView 未 ready 时消息被丢的问题），渲染容器 `ROOT/mobile/src/session/TerminalPaneView.tsx:72`。二进制帧在 RN 侧解码后写入 WebView（`ROOT/mobile/src/transport/rpc-client-terminal-binary-frame.ts:33-58`），写入还做合并节流（`terminal-write-coalescer.ts`）。

### 8.5 手机端输入

**特殊键条**（`ROOT/mobile/src/terminal/terminal-key-definitions.ts:3-30`）：

```ts
export const SPECIAL_KEY_LABELS: Record<string, string> = {
  escape: 'Esc', tab: 'Tab', enter: 'Enter', backspace: '⌫', delete: 'Del', insert: 'Ins',
  arrowUp: '↑', arrowDown: '↓', arrowLeft: '←', arrowRight: '→',
  home: 'Home', end: 'End', pageUp: 'PgUp', pageDown: 'PgDn', space: 'Space',
  f1: 'F1', ... f12: 'F12'
}
```

组合键可自定义（`ROOT/mobile/src/terminal/terminal-accessory-keys.ts:13-41`，修饰键 ctrl / alt / shift），长按连发（`terminal-accessory-repeat.ts`），设置页在 `ROOT/mobile/src/components/TerminalShortcutSettings.tsx`。

**两种输入模式**：live 直接输入（按键直接进 PTY，含 IME 预编辑镜像 `terminal-live-preedit-mirror.ts`、`terminal-live-control-send-order.ts`）和 buffered 草稿模式（`use-buffered-terminal-drafts.ts`）。默认行为的决策记录在 `ROOT/mobile/mobile-terminal-direct-input-default.md`。

虚拟键盘避让在 `ROOT/mobile/src/terminal/terminal-keyboard-avoidance-lift.ts`，消费点是 `TerminalPaneView.tsx:68` 的 `transform: [{ translateY: -keyboardLift }]`。手势/点击/滚轮分别在 `terminal-gesture-input.ts`、`terminal-webview-tap-dispatch-injected.ts`、`terminal-webview-wheel-scroll-injected.ts`、`terminal-webview-mouse-click-drag-injected.ts`。粘贴用 expo-clipboard，图片粘贴走 `ROOT/mobile/src/session/mobile-clipboard-image.ts`，快捷命令条在 `ROOT/mobile/src/session/QuickCommandRow.tsx`。

**语音输入是分布式的**：音频在手机采集（`ROOT/mobile/packages/expo-two-way-audio/`，含 ios/android 原生模块），**STT 在桌面跑 sherpa-onnx**。chunk 通过 RPC 上传（`ROOT/mobile/src/dictation/mobile-dictation-operations.ts:50-98`）：

```ts
export const dictationSessionStart = defineRpcOperation({
  name: "speech.dictation-start",
  method: "speech.dictation.start",
});
export const dictationAudioChunkSend = defineRpcOperation({
  name: "speech.dictation-chunk",
  method: "speech.dictation.chunk",
});
export const dictationSessionFinish = defineRpcOperation({
  name: "speech.dictation-finish",
  method: "speech.dictation.finish",
});
export const dictationSessionCancel = defineRpcOperation({
  name: "speech.dictation-cancel-or-skip",
  method: "speech.dictation.cancel",
});
```

模型管理也是远端的（`speech.models.list / download / delete`），桌面实现在 `ROOT/src/main/speech/`。转写结果路由（`ROOT/mobile/src/terminal/terminal-live-dictation-routing.ts:1-16`）：

```ts
// Routes a finished dictation transcript to the right surface: live mode inserts
// it straight into the originating PTY (matching live keystroke semantics, no
// auto-Return); buffered mode appends to the command field as before.
export function routeDictationTranscript(
  transcript: string,
  liveInputActive: boolean,
): LiveDictationRoute {
  return liveInputActive
    ? { kind: "live-insert", text: transcript }
    : { kind: "buffered-append", text: transcript };
}
```

### 8.6 web 客户端

`ROOT/vite.web.config.ts:6-27`：

```ts
root: resolve('src/renderer'),
// Why: pairing URLs may live under a reverse-proxy path prefix like
// /orca/web-index.html, so built assets must resolve relative to the page.
base: './',
build: { outDir: resolve('out/web'), emptyOutDir: true,
  rollupOptions: { input: resolve('src/renderer/web-index.html') } },
```

入口挂载的是**同一个 Electron 渲染层 App**（`ROOT/src/renderer/src/web/main.tsx:19-23`），只是把 `window.api`（preload）换成 WebSocket 实现（`ROOT/src/renderer/src/web/web-preload-api.ts` 把 git/fs/ssh/github/settings/keybindings/clipboard 全面 shim 成远程 RPC）。因为复用 App，终端就是 renderer 原生的 xterm + WebGL pane。

配对凭据放在 URL **fragment**（`ROOT/src/main/runtime/runtime-rpc/runtime-rpc-pairing-types.ts:129-142`）：

```ts
export function createWebClientUrl(endpoint: string, pairingUrl: string): string {
  const url = new URL(endpoint);
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  url.pathname = webClientPathForEndpoint(url.pathname);
  url.search = "";
  // Why: pairing URLs carry full credentials; the fragment keeps them out of proxy logs and Referer headers.
  url.hash = `pairing=${encodeURIComponent(pairingUrl)}`;
  return url.toString();
}
```

静态资源由 runtime 用极小白名单托管而非通用静态服务器（`ROOT/src/main/runtime/rpc/static-web-client-handler.ts:6-7`）：

```ts
const STATIC_WEB_ALLOWED_PATHS = new Set(["/web-index.html"]);
const STATIC_WEB_ALLOWED_PREFIXES = ["/assets/"];
```

`build:desktop` 会调用 `build:web-from-renderer`，所以桌面包里自带 web 客户端。

### 8.7 推送通知

派发器是 socket 扇出的**旁路**（`ROOT/src/main/runtime/push/push-dispatcher.ts:2-19`）：

```ts
// Why: the out-of-band leg of the mobile notification fan-out. Every event that
// already went to connected sockets is offered to the push gateway so a phone
// with Orca closed still hears about it. Fire-and-forget by construction: the
// socket fan-out must never wait on, or fail because of, a push.
const PUSH_RETRY_DELAY_MS = 2_000;
// The gateway rejects a whole request above this, so a host with more paired
// phones fans out across several sends rather than starving the extras.
const MAX_REGISTRATIONS_PER_SEND = 20;
const PUSH_TITLE_MAX_LENGTH = 80;
const PUSH_BODY_MAX_LENGTH = 180;
```

三个事件源中两个直接来自终端（`ROOT/src/shared/mobile-push-contract.ts:1-10`）：

```ts
// Why: the desktop host, the push gateway, and the phone must agree on these exact strings.
export const MOBILE_PUSH_SOURCES = ["agent-task-complete", "terminal-bell", "plugin"] as const;
// The only two states a phone can be told about; the host maps its richer
// agent status onto them before it ever reaches the gateway.
export const MOBILE_PUSH_AGENT_STATES = ["needs-input", "finished"] as const;
```

映射逻辑在 `push-dispatcher.ts:41-50`。`terminal-bell` 来自 BEL 检测（`ROOT/src/shared/terminal-bell-detector.ts`），`agent-task-complete` 来自 agent 状态机。可配置「仅当桌面不在前台时推送」。云端网关在 `ROOT/cloud/apps/push/src/`（apns-client / fcm-client / durable-push-worker / device-registry-store），桌面用 challenge-proof 证明身份，**与 relay 完全解耦** —— push 只带一行标题正文，不带终端内容。

---

## 9. 交互体验细节

### A. 输入到回显

**完整链路**：

| 阶段           | 位置                                                                                                                                                                          |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| xterm 事件订阅 | `ROOT/src/renderer/src/components/terminal-pane/terminal-user-input-signal.ts:48-60`（同时挂 `coreService.onUserInput` 与 `terminal.onData`，给每个 chunk 打 `wasUserInput`） |
| 绑定到 pane    | `ROOT/src/renderer/src/components/terminal-pane/pty-connection/pty-input-forward.ts:178-188`（预绑定闭包，注释明写 per-keystroke hot path，不每次 onData 分配闭包）           |
| forward        | 同上 `:151-183`（`claimViewportForUserActivity()` → `transport.sendInput(data)`，失败走 `requestRecoveryForUndeliverableInput()`）                                            |
| transport 入队 | `ROOT/src/renderer/src/components/terminal-pane/pty-transport.ts:117-122, 213-240`（query reply 与 Ctrl+C/Esc 走单独队列）                                                    |
| 写队列         | `ROOT/src/renderer/src/components/terminal-pane/pty-input-write-queue.ts:28-100`（双队列按 sequence 归并，head-index O(1) FIFO，head≥1024 且死前缀过半时压缩）                |
| preload IPC    | `ROOT/src/preload/api/pty-bridge-session-control.ts:73-76`                                                                                                                    |
| main 接收      | `ROOT/src/main/ipc/pty/ipc/write.ts:23,34`                                                                                                                                    |
| main 写 PTY    | `ROOT/src/main/ipc/pty/ipc/write-input.ts:193-217`                                                                                                                            |

输入路径的关键副作用点（`write-input.ts:205-214`）：

```ts
const now = performance.now();
lastInputAtByPty.set(args.id, now);
interactiveOutputCharsByPty.set(args.id, 0);
if (visibleRendererPtys.has(args.id)) {
  clearHiddenRendererResizeOutput(args.id);
}
return writePtyProviderInput(provider, args.id, args.data, admitted);
```

**没有 typeahead / local echo / 预测回显。** `ROOT/src/renderer/src/lib/typing-latency/` 是**测量**工具，`echo-instrumentation.ts:1-8` 定义了四段时间戳：输入信号 t0 → onData 派发 → 首次输出解析 → 绘制。

**没有输入去抖**，但有写队列合并阈值（`ROOT/src/renderer/src/components/terminal-pane/pty-input-write-queue-contract.ts:1-4`）：

```ts
export const TERMINAL_INPUT_COALESCE_MAX_CODE_UNITS = 4096;
export const PTY_INPUT_WRITE_QUEUE_MAX_PENDING_REPLIES = 64;
```

**输入时输出让路，是「提优先级」而非「暂停」。** 输出队列按 `highPriority` 抢占（`ROOT/src/renderer/src/lib/pane-manager/pane-terminal-output-drain.ts:36-63`），常量（`pane-terminal-output-queue-registry.ts:88-99`）：

| 参数                    | 值     |
| ----------------------- | ------ |
| 后台 flush 延迟         | 50 ms  |
| 后台 drain 间隔         | 16 ms  |
| 高优先 drain 间隔       | 4 ms   |
| chunk 大小              | 16 KB  |
| 后台每次 drain 写入数   | 2      |
| 高优先每次 drain 写入数 | 8      |
| drain 时间预算          | 8 ms   |
| 大积压阈值              | 512 KB |

高优先设为 8 的理由写在注释里：8×16KB=128KB 约 1.3ms 解析，在 8ms 预算内把持续吞吐上限定在约 30MB/s；设为 2 时只有 8MB/s，而 xterm 解析器能跑到约 100MB/s。

协作式 drain（`pane-terminal-output-drain.ts:104-107`）：

```ts
// Why: xterm parsing and DOM work share the renderer thread with input;
// keep draining cooperative so WSL/agent output can't pin the UI.
if (writes > 0 && getDrainNow() - startedAt >= DRAIN_TIME_BUDGET_MS) break;
```

**不是 rAF，是 MessageChannel**（`pane-terminal-output-queue-registry.ts:124-128`）：

```ts
// Why a MessageChannel for zero-delay drains: Chromium clamps nested setTimeout(0) to ~4ms;
// a posted macrotask isn't clamped yet still yields to input/paint. Cancellation is by generation.
if (delayMs === 0 && useMessageChannelDrain) {
  drainImmediatePending = true;
  getDrainChannel().port2.postMessage(drainImmediateGeneration);
  return;
}
```

rAF 只用于渲染侧（webgl refresh、fit、viewport present），不用于 write 调度。另有解析时钟 pacer（`pane-terminal-output-pipeline.ts:58-69`）：xterm 确认上一批解析完成后立刻 re-arm 一次零延迟 drain。

**`PTY_RENDERER_INTERACTIVE_RESERVE_CHARS` 的语义**。定义在 `ROOT/src/main/ipc/pty/delivery/constants.ts:8`，唯一使用点在 `ROOT/src/main/ipc/pty/delivery/accounting.ts:67-83`：

```ts
export function canSendPtyDataToRenderer(session, id, options = {}): boolean {
  const totalLimit =
    PTY_RENDERER_TOTAL_IN_FLIGHT_HIGH_WATER_CHARS +
    (options.interactive === true ? PTY_RENDERER_INTERACTIVE_RESERVE_CHARS : 0);
  // Why per-PTY (not global) reserve: keep one active pane responsive without letting every background pane burst past the cap.
  const ptyLimit =
    PTY_RENDERER_IN_FLIGHT_HIGH_WATER_CHARS +
    (options.interactive === true ? PTY_RENDERER_ACTIVE_PTY_IN_FLIGHT_RESERVE_CHARS : 0);
  return (
    getRendererInFlightCharsForPty(session, id) < ptyLimit &&
    session.rendererInFlightTotalChars < totalLimit
  );
}
```

| 常量                  | 值     |
| --------------------- | ------ |
| 交互态总额外配额      | 256 KB |
| 交互态单 PTY 额外配额 | 512 KB |
| 单 PTY 在途高水位     | 512 KB |
| 全局在途高水位        | 8 MB   |

这不是「给输入让路」，而是**给交互态 PTY 额外的在途字节配额**：全局 8 MB 水位被背景 PTY 打满时，正在打字的 pane 仍有额外额度可推送，回显不被饿死。

**「刚打过字则绕过批处理立刻投递」**（`ROOT/src/main/ipc/pty/delivery/interactive.ts:9-33`）：

```ts
export function shouldSendInteractiveOutputNow(id, data, now): boolean {
  const lastInputAt = lastInputAtByPty.get(id);
  if (lastInputAt === undefined || now - lastInputAt > INTERACTIVE_OUTPUT_WINDOW_MS) {
    return false;
  }
  if (!isLikelyInteractiveRedraw(data)) {
    return false;
  }
  const usedChars = interactiveOutputCharsByPty.get(id) ?? 0;
  if (usedChars + data.length > INTERACTIVE_OUTPUT_BUDGET_CHARS) {
    return false;
  }
  interactiveOutputCharsByPty.set(id, usedChars + data.length);
  return true;
}
```

| 常量               | 值        |
| ------------------ | --------- |
| 按键后交互窗口     | 100 ms    |
| 单次交互输出上限   | 1024 字符 |
| 判定为重绘的最大块 | 16 KB     |
| 交互输出总预算     | 32 KB     |
| 批处理间隔         | 2 ms      |

`:13` 的注释解释 ANSI 检测的动机：Codex 类 TUI 每次按键重绘超过 1 KB（延迟敏感），而普通命令输出应留在吞吐批处理路径上。

**背压的渲染侧是 parse-deferred 累积 ACK**（`ROOT/src/renderer/src/components/terminal-pane/terminal-pty-ack-gate.ts:25-37, 88-92`）：

```ts
// Why: monotonic per-PTY totals of processed chars, mirrored to main as TCP-style
// cumulative ACKs so a lost ACK message never becomes permanent in-flight debt.
// Why: ACKing at dispatcher enqueue made main's 512KB in-flight window mean
// "bytes RECEIVED", not "bytes PARSED" — under flood the renderer's write queue
// grew unbounded behind instant ACKs, main saw no backpressure
```

所有丢弃路径**必须**先 `fireQueuedAckCredits`，否则主进程窗口永久缩水导致 PTY 卡死。主进程侧是真 kernel 背压（`ROOT/src/main/ipc/pty-producer-flow-control.ts:1-13`）：

```ts
// Main tracks per-PTY renderer-pending chars; past HIGH it asks the provider to
// pause the actual PTY read (node-pty pause() → kernel backpressure → the flooding
// shell blocks on write), and below LOW it resumes. The wide HIGH/LOW gap is
// deliberate hysteresis so a draining queue cannot flap pause/resume per flush slice.
export const PRODUCER_FLOW_HIGH_WATERMARK_CHARS = 256 * 1024;
export const PRODUCER_FLOW_LOW_WATERMARK_CHARS = 32 * 1024;
export const PRODUCER_PAUSE_REASSERT_INTERVAL_MS = 5_000;
```

其它细节：打字时隐藏鼠标（`ROOT/src/renderer/src/components/terminal-pane/mouse-hide-while-typing.ts:9-16`）；写管线健康度 `armTerminalWriteStallWatch` 在 write 之前武装（处理 xterm WriteBuffer 卡死 #2836）；write 回调一律经 `runGuardedWriteCompletionStep` 包裹（回调里 throw 会永久卡死 terminal）。

### B. resize

**多客户端尺寸权威是「可见性 + 最后操作者」的组合，不是单点。**

渲染端的让位机制是 fit override（`ROOT/src/renderer/src/lib/pane-manager/mobile-fit-overrides.ts:1-10`）：

```ts
// Why: a phone or another desktop may own the shared PTY grid. Non-owners park
// xterm at that authoritative size so passive fitting cannot start a resize war.
export type FitHoldMode = "mobile-fit" | "remote-desktop-fit" | "desktop-fit";
```

生效点 `pane-fit.ts:111-120`：有 override 时直接 `terminal.resize(override.cols, override.rows)` 不跑 `fitAddon.fit()`。抑制 SIGWINCH（`ROOT/src/renderer/src/components/terminal-pane/pty-connection/pty-input-forward.ts:196-232`）：

```ts
session.shouldSuppressDesktopPtyResize = () => {
  const currentPtyId = session.transport.getPtyId();
  return Boolean(currentPtyId && (getFitOverrideForPty(currentPtyId) || isPtyLocked(currentPtyId)));
};
session.isRendererPtyResizeAuthoritative = () => {
  if (session.deps.isVisibleRef.current) return true;
  // hidden-tab layout churn is not authoritative; hidden SIGWINCH can reset full-screen TUIs
  return false;
};
```

main 侧仲裁：`ROOT/src/main/runtime/orca-runtime-fit-override-listeners.ts:19-32` 持有 `fitOverrideListeners: Map<ptyId, Set<...>>`；`resizeForClient` 用 `enqueueLayout` 串行化（`PtyLayoutTarget` 分 `'phone' | 'desktop'`），**restore 只有 override 的 owner 能做**（`ROOT/src/main/runtime/orca-runtime-has-recent-terminal-output-path.ts:91-93` 抛 `not_override_owner`），避免一个手机撤销另一个手机的 fit。`mobileTookFloor(ptyId, clientId)` 记录谁最后动手。恢复目标三级回退：每 subscriber 基线 → renderer 上报的几何 → 当前尺寸。

**只测量不 resize 的旁路** `pty:reportGeometry`（`ROOT/src/main/ipc/pty/ipc/resize-visibility.ts:81-83`，注释：measurement-only sibling of pty:resize，刷新 restore-target 缓存，从不 resize）。main 端 `recordRendererGeometry` 带**回声过滤**（`ROOT/src/main/runtime/orca-runtime-apply-mobile-display-mode.ts:118-122`）：上报值与 override 完全相同则丢弃，否则会把 restore 基线污染成手机尺寸。

远程多客户端另有 viewport claim（opcode 14，`ROOT/src/renderer/src/runtime/remote-runtime-terminal-multiplexer-implementation.ts:94-100`），失败时置 `pendingViewportClaim` 等重连补发。

尺寸下发还有 post-spawn 对账（`ROOT/src/renderer/src/components/terminal-pane/pty-size-reconcile.ts:1-6`）：

```
POST_SPAWN_RECONCILE_SETTLE_FRAMES = 8
POST_SPAWN_RECONCILE_MAX_FRAMES = 180   // ~3s @60fps
POST_SPAWN_RECONCILE_FALLBACK_COLS/ROWS = 80 / 24
```

**reflow 卡顿措施**（`ROOT/src/renderer/src/components/terminal-pane/use-terminal-container-fit-sync.ts:49-70`）：

```ts
// ResizeObserver fires on every incremental size change during continuous window resizes …
// Each fitPanes() → fitAddon.fit() → terminal.resize() which, when the column count changes,
// reflows the entire scrollback buffer and recalculates the viewport scroll position.
// On Windows, a single reflow of 10 000 scrollback lines can block the renderer for 500 ms-2 s.
const RESIZE_DEBOUNCE_MS = 150;
```

侧边栏开合走 `SYNC_FIT_PANES_EVENT` 在 `useLayoutEffect` 同帧 fit，绕过这 150ms，消除约 16ms 的「旧 cols + 新容器宽度」闪烁。

cell 级早退（`pane-fit.ts:126-131`）：

```ts
const dims = getProposedPaneDimensions(pane);
if (dims && dims.cols === pane.terminal.cols && dims.rows === pane.terminal.rows) {
  // Why: divider drags often stay within one cell; avoid needless clear/refresh churn.
  resumePendingFitScrollRestoreAfterFit(pane.terminal);
  return true;
}
```

每 pane 的 ResizeObserver 还要求网格连续两帧稳定才 fit（最多等 8 帧，`ROOT/src/renderer/src/lib/pane-manager/pane-fit-resize-observer.ts:84-138`），因为 Windows 上右侧栏打开时会报一次瞬时 1 列 anchor/scrollbar 抖动，直接 fit 会让 Codex 收到 SIGWINCH 循环。

reflow 逻辑行锚点在 `ROOT/src/renderer/src/lib/pane-manager/terminal-reflow-scroll-anchor.ts:27-49`（`captureLogicalLineAnchor` 向上回溯 `isWrapped` 找逻辑行首 + cell 偏移），`:51-59` 针对 Windows ConPTY < 21376 关闭 reflow 锚点。

**resize 时保持 scroll**（`pane-fit.ts:99-109`）：

```ts
const captureScrollForFit = (): void => {
  scrollIntent = captureTerminalStructuralScrollIntent(pane.terminal);
  // Why: fit can reflow and renumber every buffer row; a marker tracks the
  // pinned content itself, while a numeric line would point elsewhere after.
  pinnedScrollState =
    scrollIntent?.kind === "pinnedViewport" ? captureScrollState(pane.terminal) : null;
  shouldRestoreScroll = true;
};
```

`captureScrollState`（`ROOT/src/renderer/src/lib/pane-manager/pane-scroll.ts:60-89`）注册**两个** marker（物理首可见行 + 逻辑行首）加 `firstVisibleLogicalCellOffset`，因为 continuation-row marker 在 reflow 时可能被删或漂移。alt 屏与已在底部时都不注册 marker。恢复重试上限 2 帧。

### C. 滚动

**scrollback 配额**（`ROOT/src/shared/terminal-scrollback-policy.ts:1-25`）：

```ts
export const DESKTOP_TERMINAL_SCROLLBACK_ROWS_DEFAULT = 5_000;
export const DESKTOP_TERMINAL_SCROLLBACK_ROWS_MIN = 1_000;
export const DESKTOP_TERMINAL_SCROLLBACK_ROWS_MAX = 50_000;
export const DESKTOP_TERMINAL_SCROLLBACK_ROW_PRESETS = [5_000, 10_000, 25_000, 50_000] as const;
```

backlog 上限随 scrollback 缩放（`:27-42`）：`TERMINAL_OUTPUT_BACKLOG_MIN_CAP_CHARS = 2 MB`，`OUTPUT_BACKLOG_CHARS_PER_SCROLLBACK_ROW = 120`，`cap = max(2MB, rows*120)`。`:51-67` 有旧版按字节配置的迁移分桶（1 MB→1k 行，17.5 MB→5k，37.5 MB→10k，75 MB→25k，以上→50k）。

设置 UI 在 `ROOT/src/renderer/src/components/settings/TerminalAdvancedSection.tsx:124`（预设按钮）与 `:153-154`（自定义数字输入）。

**跟随底部完全交给 xterm 自己**。两处相同注释（`ROOT/src/renderer/src/lib/pane-manager/pane-terminal-output-pipeline.ts:30` 与 `pane-terminal-output-drain.ts:34`）：

```
// Why no per-write scroll enforcement: xterm's BufferService.isUserScrolling owns live
// follow/pin; app-side enforcement is limited to structural ops xterm can't identify, like replay.
```

判定「在底部」极简（`ROOT/src/renderer/src/lib/pane-manager/terminal-scroll-buffer-snapshot.ts:35-37`）：

```ts
export function isTerminalViewportAtBottom(viewportY: number, baseY: number): boolean {
  return viewportY >= baseY;
}
```

无像素容差，纯 buffer 行号比较。

App 层维护的是结构性操作用的意图状态机（`ROOT/src/renderer/src/lib/pane-manager/terminal-scroll-intent.ts:149-198`）：

```ts
export function syncTerminalScrollIntentFromViewport(terminal, options = {}): void {
  if (
    !options.allowBufferShrink &&
    existing?.kind === "pinnedViewport" &&
    snapshot.baseY < existing.baseY
  ) {
    // 重挂载/replay 期间 scrollback 会短暂变短，不得抹掉持久 pin
    terminalScrollIntentByTerminal.set(terminal, existing);
    return;
  }
  const kind = isTerminalViewportAtBottom(snapshot.viewportY, snapshot.baseY)
    ? "followOutput"
    : "pinnedViewport";
}
```

**幻影 pin 清理**（`:232-243`）：若标记 pinned 但实时 viewport 仍在底部且 scrollback 不短于 pin 时的长度，降级为 followOutput，否则结构操作后会把终端冻结在过期行。

键盘直接改意图（`ROOT/src/renderer/src/components/terminal-pane/terminal-pane-pane-input.ts:117-130`）：PageUp/Home 标记 pinned，PageDown/End 同步回 follow。跨 tab 切换的滚动记忆在 `use-terminal-scroll-visibility-memory.ts`。

**alternate screen**：滚动状态不跨 alt 屏恢复（`pane-scroll.ts:255`），alt 屏无 scrollback 所以分屏路径只做 WebGL 重挂不恢复滚动。**滚轮不转方向键**（无 alternate-scroll-mode 实现），`terminal-pointer-input-sequences.ts:14` 只是识别方向键序列不是生成。TUI 下滚轮走 xterm 鼠标上报，Orca 做「倍率重放」（`ROOT/src/renderer/src/lib/pane-manager/pane-terminal-mouse-wheel.ts:20, 106-120`）：

```ts
const XTERM_MOUSE_REPORTING_CLASS = "enable-mouse-events";
export function shouldMultiplyTerminalMouseWheel(event, terminalElement): boolean {
  if (
    isReplayedWheelEvent(event) ||
    !terminalElement?.classList.contains(XTERM_MOUSE_REPORTING_CLASS) ||
    event.deltaY === 0 ||
    event.shiftKey
  )
    return false;
  return true;
}
```

`cloneWheelReportEvent`（`:67-92`）克隆成 `deltaY = ±1, deltaMode = DOM_DELTA_LINE` 并打 `__orcaReplayedTerminalWheelEvent` 防重入，按算出的行数重放 N 次。

**手感参数**（`pane-terminal-options.ts:8-21, 57-66`）：

```ts
export const DEFAULT_TERMINAL_SCROLL_SENSITIVITY = 1.15; // clamp [0.1, 10]
export const DEFAULT_TERMINAL_FAST_SCROLL_SENSITIVITY = 5; // clamp [1, 20]
scrollbar: {
  width: 7;
} // VS Code 用 14；FitAddon 把它当 gutter，代价约 1 列，换"滚动条永不遮挡内容"
```

**无平滑滚动**（`smoothScrollDuration` 未设置）。TUI 滚轮另有加速/惯性模型（`ROOT/src/renderer/src/lib/pane-manager/pane-terminal-tui-wheel-reports.ts:1-19`）：

```
TUI_WHEEL_ACCELERATED_DISTANCE_GAIN = 1.6
TUI_WHEEL_BURST_FULL_INTERVAL_MS = 16    TUI_WHEEL_BURST_MAX_INTERVAL_MS = 45
TUI_WHEEL_BURST_MAX_BONUS_ROWS = 3       TUI_WHEEL_BURST_RAMP_EVENTS = 4
TUI_WHEEL_MOMENTUM_TAIL_DECAY_RATIO = 0.85
TUI_WHEEL_COMPRESSED_MAX_DISTANCE_ROWS_PER_EVENT = 6
TUI_WHEEL_BURST_MAX_DISTANCE_ROWS_PER_EVENT = 9
TERMINAL_TUI_MOUSE_WHEEL_MULTIPLIER = 1 (MIN 1, MAX 10)   // 用户可配
```

### D. 复制粘贴

**选中即复制有，且是两条独立开关**（`ROOT/src/renderer/src/components/terminal-pane/terminal-pane-pane-links.ts:123-169`）：

```ts
pane.terminal.onSelectionChange(() => {
  const shouldWritePrimarySelection = isPrimarySelectionEnabled(); // X11 PRIMARY
  const shouldWriteClipboard = settingsRef.current?.terminalClipboardOnSelect === true;
  if (!shouldWritePrimarySelection && !shouldWriteClipboard) return;
  if (!pane.terminal.hasSelection()) return;
  const timer = window.setTimeout(() => {
    setPrimarySelectionText(selection);
  }, 100); // PRIMARY 100ms 防抖
  void copyTerminalSelection({
    terminal: pane.terminal,
    writeClipboardText: window.api.ui.writeTerminalClipboardText,
  });
});
```

**「有选区复制 / 无选区 SIGINT」分支**（`ROOT/src/renderer/src/components/terminal-pane/xterm-bypass-policy.ts:72, 256-269`）：

```ts
export const TERMINAL_INTERRUPT_INPUT = "\x03";

export function shouldHandleTerminalInterruptKeyboardEvent(event, options): boolean {
  if (!isXtermHandledKeyEvent(event.type) || !isPlainCtrlC(event)) return false;
  if (options.isMac) return true; // mac: Ctrl+C 永远是 SIGINT（复制走 Cmd+C）
  return !options.hasSelection; // win/linux: 有选区就让位给剪贴板
}
```

文件头 `:9-19` 解释了为什么必须在 `attachCustomKeyEventHandler` 拦截：kitty 渐进增强（`CSI > N u`）激活后，xterm 的 KittyKeyboard 编码器会把 **Cmd+C 也编成 CSI-u 并 preventDefault**，导致 Chromium 原生 copy 事件不触发、选区永远进不了剪贴板。

调用现场（`terminal-pane-pane-input.ts:133-148`）：

```ts
if (
  shouldHandleTerminalInterruptKeyboardEvent(event, {
    isMac,
    hasSelection: pane.terminal.hasSelection(),
  })
) {
  if (event.type === "keydown") {
    pendingTerminalInterruptKeyup = true;
    pane.terminal.input(TERMINAL_INTERRUPT_INPUT);
    resetTerminalKeyboardProtocolAfterInterrupt(pane.terminal);
  } else {
    pendingTerminalInterruptKeyup = false;
  }
  return false;
}
```

Ctrl+C 还有非拉丁布局兜底（`xterm-bypass-policy.ts:213-232`）：先看 `event.key` 是否拉丁字母，否则查 `getLayoutBaseCharacterForCode(event.code)`（韩文 2-Set / 俄文层叠在拉丁布局上时能答出 `c`，Dvorak 答 `j` 正确拒绝），最后物理位置兜底 `event.code === 'KeyC' || keyCode === 67`。

默认键位（`ROOT/src/shared/keybindings/definitions-core-3.ts:201-246`）：

| 动作                                       | macOS         | Linux / Windows                    |
| ------------------------------------------ | ------------- | ---------------------------------- |
| terminal.copySelection                     | Mod+C         | Ctrl+Shift+C, Ctrl+C               |
| terminal.selectAll                         | Mod+A         | Ctrl+Shift+A                       |
| terminal.paste                             | Mod+V         | Ctrl+V, Ctrl+Shift+V, Shift+Insert |
| terminal.search                            | Mod+F         | Mod+F                              |
| terminal.clear                             | Mod+K         | Mod+K                              |
| terminal.focusNextPane / focusPreviousPane | Mod+] / Mod+[ | 同                                 |

**OSC 52**（TUI 通过 PTY 写主机剪贴板）默认开启，但**查询（`Pd = "?"`）恒被拒绝**防泄露，payload 有大小上限（`ROOT/src/renderer/src/components/terminal-pane/osc52-clipboard.ts:1-31`）。

**粘贴用 bracketed paste，有三层强化**（`ROOT/src/renderer/src/components/terminal-pane/terminal-bracketed-paste.ts`）：

```ts
// :24-25
export const BRACKETED_PASTE_START = `${ESCAPE}[200~`;
export const BRACKETED_PASTE_END = `${ESCAPE}[201~`;

// :48-51 防"paste 内嵌 ESC 提前闭合帧后被当按键执行"
// Replacing ESC with its printable substitute (\u241b, U+241B) neutralizes every framing escape.

// :71-75
export function normalizeTerminalPasteLineEndings(text: string): string {
  // xterm's native paste converts every clipboard newline to CR; direct frames must match
  // or ConPTY TUIs can treat raw LF as submit.
  return text.replace(/\r?\n/g, "\r");
}
```

`pasteTerminalText`（`:132-173`）的分支：Windows input-record 编码 → 强制 bracketed → 正常 `terminal.paste()` → Ctrl+C 后 `bracketedPasteMode` 位可能陈旧时，单行粘贴临时置 `ignoreBracketedPasteMode = true` 避免漏出 `[200~` 字面量。

**agent 场景强制 bracketed 多行粘贴**（`ROOT/src/renderer/src/components/terminal-pane/terminal-agent-paste-bracketing.ts:7-26`）：因为 `DECSET 2004` 可能被远程 replay/ConPTY 吃掉，未保护的 CR 会直接提交 agent 草稿；而「从没见过 2004」不是可用证据（macOS /bin/bash 3.2、/bin/sh 根本不发），所以改用 **pane 的 agent 身份**消歧。

**多行粘贴没有确认弹窗。** 安全性完全押在 bracketed paste + ESC 中和上（`osc52-clipboard.ts:26-31` 明确写了这个取舍）。

分片与限流（`ROOT/src/renderer/src/components/terminal-pane/terminal-paste-limits.ts:1-5`）：

```ts
export const TERMINAL_PASTE_DIRECT_MAX_BYTES = 64 * 1024; // 超过则分片
export const TERMINAL_PASTE_CHUNK_MAX_BYTES = 16 * 1024;
export const TERMINAL_PASTE_MAX_BYTES = 16 * 1024 * 1024; // 超过则 reject
export const TERMINAL_PASTE_OPERATION_TIMEOUT_MS = 30_000;
export const TERMINAL_REMOTE_PASTE_OPERATION_TIMEOUT_MS = 120_000;
```

计划构建在 `terminal-paste-coordinator.ts:151-218`（`mode ∈ {direct, chunked, bracketed-terminal, windows-input-record, reject}`，`newlinePolicy ∈ {preserve, terminal-cr, windows-input-record}`）；分片器按 UTF-8 字节切不切码点，帧首尾作为独立 chunk yield；执行器在事务内逐片 `await yieldToEventLoop()`。

**右键**（`ROOT/src/renderer/src/components/terminal-pane/use-terminal-context-menu-trigger.ts:67-86`）：

```ts
// Why: when users opt into terminal-style right-click, a selection copies
// and no selection pastes. Ctrl+right-click keeps the app menu reachable.
if (rightClickToPaste && !event.ctrlKey) {
  event.stopPropagation();
  if (clickedPane.terminal.getSelection()) {
    void copyTerminalSelection({ clearSelectionOnSuccess: true });
  } else {
    void pasteResolvedPane("right-click");
  }
  return;
}
```

默认弹 Radix 菜单（`TerminalContextMenu.tsx:46-78`）：Copy / Select All / Paste / Split Right / Split Down / Equalize / Close / Clear Screen / Fork agent session / Quick Commands / Set title / Copy Terminal ID / Copy Pane ID / Copy Agent Session ID。

**中键粘贴（PRIMARY selection）**在 Linux 和 macOS 默认开启（`ROOT/src/renderer/src/hooks/usePrimarySelectionPaste.ts:18-29`），TTL 750ms，并把「终端触发的原生 paste 抑制」限定在 `.xterm-helper-textarea` / `.xterm` 内避免吞掉其它控件的粘贴。

**拖拽文件进终端**（`ROOT/src/renderer/src/components/terminal-pane/terminal-drop-handler.ts:39-100`）区分 Orca 文件浏览器内拖与 OS 原生拖，按目标 shell（本地/WSL/SSH）决定路径引用形式，结果类型含 `rejected: 'paths-too-large' | 'too-many-paths'`。

原生 paste 事件监听用 `suppressNextNativePaste` 去重（键盘快捷键与 Chromium 原生 paste 事件二选一）。

### E. 链接、搜索、快捷键

**主终端没有用 WebLinksAddon**（只有 dashboard 预览用）。注册的是自定义 LinkProvider（`ROOT/src/renderer/src/components/terminal-pane/terminal-pane-pane-links.ts:80-116`）：

1. `createFilePathLinkProvider` 文件路径识别
2. `createTerminalHandleLinkProvider` Orca 终端句柄链接
3. `installTerminalLinkifierClickPriming` 修 xterm 首次点击前无 hover 状态的问题
4. `installFilePathLinkClickFallback` / `installHttpLinkClickFallback` 点击兜底
5. `installTerminalLinkPointerGesture` 区分「点击打开」和「拖选文本」

文件路径识别（`ROOT/src/renderer/src/components/terminal-pane/terminal-link-handlers.ts:99-141`）处理**软换行与硬换行**两种被折断的路径（专门文件 `hard-wrapped-terminal-path-fragments.ts`、`wrapped-terminal-link-ranges.ts`、`edge-wrapped-terminal-http-links.ts`），解析 `path:line:col`，`createTerminalPathExistenceBatch` 批量校验存在性后才亮链接，打开动作在 `terminal-file-link-actions.ts`。

**OSC 8 超链接**走 `terminal.options.linkHandler`（`terminal-pane-pane-links.ts:178-212`）：

```ts
pane.terminal.options.linkHandler = {
  allowNonHttpProtocols: true,
  activate: (event, text) => { const handled = handleOscLink(text, event, {...}); if (handled) pane.terminal.clearSelection() },
  hover: (_event, text) => {
    const hint = getUrlOpenLinkHint(pane.id)
    pane.linkTooltip.textContent = `${text} (${hint})`
    pane.linkTooltip.style.display = ''
    void formatTerminalUrlTooltip(text, hint, ...).then(...)  // 异步美化，token 防竞态
  },
  leave: () => { pane.linkTooltip.style.display = 'none' }
}
```

路由决策（`ROOT/src/renderer/src/components/terminal-pane/terminal-osc-link-routing.ts:32-42`）：

```ts
function isDesktopOscLinkActivation(event): boolean {
  if ("button" in event && event.button !== undefined && event.button !== 0) return false;
  // Why: desktop xterm links must not open while the user is just placing the
  // cursor or selecting text. Mobile URL taps use a separate WebView path.
  return isTerminalLinkDirectActivation(event) || isTerminalLinkActionActivation(event);
}
```

`file://` URI 与裸路径共用解析器。HTTP 链接可选在 Orca 内置浏览器或外部浏览器打开。注意 SerializeAddon 不会重新发出 OSC 8（`ROOT/src/shared/agent-tui-ansi-fuzz-stream.ts:36-37`），所以 replay 时链接范围由 Orca 自己恢复。

**搜索** UI 在 `ROOT/src/renderer/src/components/TerminalSearch.tsx`，每 pane 一个 SearchAddon（`pane-dom-creation.ts:55`）。快捷键 Mod+F 开关、Cmd/Ctrl+G 上下一个（含 `isFindQueryTooLarge` 保护）、面板内 Enter/Shift+Enter/Escape。选项有 `caseSensitive`、`regex`、`incremental: true`。

高亮配色被显式覆盖（`TerminalSearch.tsx:37-55`）：

```ts
// Why: the default xterm SearchAddon highlights blend into common terminal backgrounds (orca#612)
decorations: {
  matchBackground: '#5c4a00', matchBorder: '#5c4a00', matchOverviewRuler: '#ffcc00',
  activeMatchBackground: '#c4580e', activeMatchBorder: '#ffcf6b', activeMatchColorOverviewRuler: '#ff9900'
}
```

清理时 `clearDecorations()` 之后还要 `findNext('')`（`:21-23`：xterm keeps the active match selected after decorations are cleared）。`safeFind` 包一层 try/catch 处理 pane 折叠到 0 列或 reflow 前宽度错配导致的 addon 抛错。

**快捷键拦截是三层结构**：

| 层                | 位置                                                                                                                                           | 作用                                                            |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| L1 用户配置       | `ROOT/src/main/keybindings/keybinding-file.ts:27-29`（`~/.orca/keybindings.json`），`keybinding-service.ts:29-57` 负责迁移、冲突检测、平台归一 | 覆盖默认键位                                                    |
| L2 window capture | `ROOT/src/renderer/src/components/terminal-pane/terminal-keyboard-hook.ts:134-140`                                                             | `window.addEventListener(..., { capture: true })`，捕获阶段先吃 |
| L3 xterm 内       | `ROOT/src/renderer/src/components/terminal-pane/terminal-pane-pane-input.ts:95-202`                                                            | `attachCustomKeyEventHandler`                                   |

L3 的处理顺序：IME 抑制 → Ctrl+C 中断 → 非拉丁控制和弦 → 修饰键 → JIS ¥ → 滚动意图 → mac IME 原生文本 → `shouldBypassXtermKeyboardEvent`。最终返回（`:194-202`）：

```ts
const shouldBypass = shouldBypassXtermKeyboardEvent(event, {
  isMac,
  isIosWeb,
  hasSelection: pane.terminal.hasSelection(),
  kittyKeyboardFlags: paneKittyKeyboardModesRef.current.get(pane.id)?.flags ?? 0,
});
return !shouldBypass; // false = xterm 不处理，事件交还浏览器/宿主
```

bypass 规则（`xterm-bypass-policy.ts:290-355`）中最关键的一条（`:306-311`）：已被 preventDefault 且按住平台修饰键则 bypass，因为 window 层的 Orca 快捷键可能已处理该和弦但未停止传播，不能让 xterm 再把它发给 shell。其余：Shift + 非 ASCII 可打印字符 bypass（kitty 编码器会从物理 code 推出拉丁字母，破坏非拉丁布局）；mac 只有 `Mod+C` / `Mod+V` bypass；win/linux `Ctrl+Shift+C` / `Ctrl+C`(有选区) / `Ctrl+V` / `Ctrl+Shift+V` / `Shift+Insert` bypass。

典型键归属：

| 键                    | 行为                                                                     | 位置                                  |
| --------------------- | ------------------------------------------------------------------------ | ------------------------------------- |
| Cmd+K                 | **App 吃掉**，`clearActivePane` 清 scrollback，不是发 `\x0b`             | `definitions-core-3.ts:256-261`       |
| Ctrl+C                | mac 始终 App 拦截发 `\x03`；win/linux 无选区同上，有选区 bypass 给剪贴板 | `xterm-bypass-policy.ts:256-269`      |
| Ctrl+D                | **完全透传给 shell**（既不在 keybinding definitions 也不在 bypass 列表） | —                                     |
| Tab                   | 透传（不在 `TERMINAL_IME_OWNED_KEYS`）                                   | `xterm-bypass-policy.ts:74-87`        |
| Cmd+W                 | `tab.close` / `terminal.closePane`，L2 层消费                            | `terminal-shortcut-policy.ts:35-46`   |
| Cmd+F / Cmd+G         | App 吃掉（搜索）                                                         | 见上                                  |
| Cmd+A                 | mac selectAll；裸 Ctrl+A 透传给 readline                                 | `definitions-core-3.ts:213-223`       |
| PageUp/Down, Home/End | 不拦截，只顺带更新滚动意图                                               | `terminal-pane-pane-input.ts:117-130` |
| 修饰键本身            | 恒 `return false`                                                        | `xterm-bypass-policy.ts:281-283`      |

全局策略开关 `terminalShortcutPolicy: 'orca-first' | 'terminal-first'`（`ROOT/src/shared/keybindings/types.ts:17-21`），作用域说明在 `terminal-shortcut-policy.ts:91`：gates the tab.close pane-close alias —— terminal-first 下被 remap 的 tab.close 让位给 shell，但 scope 为 terminal 的 `terminal.closePane` 仍会关闭。键位定义带 `scope: 'terminal'` 字段参与仲裁。

`resolveTerminalShortcutAction`（`terminal-shortcut-policy.ts:48-95`）返回的动作集里有一个 `sendInput` 兜底分支：

```ts
| { type: 'sendInput'; data: string; optionKittyRelease?; consumeOptionKeyUp? }
```

这是「App 决定该发什么字节」的通道（Shift+Enter 的 CSI-u、mac Option-as-Alt、Ctrl+Arrow 的 ConPTY 差异、Windows input-record）。kitty 协议支持通过 `vtExtensions: { kittyKeyboard: true }` 声明（对齐 VS Code 的 xtermTerminal.ts）。

---

## 10. 值得借鉴的设计要点

**1. PTY 活在独立 daemon 里，且 runtime 与 UI 解耦。** `ROOT/docs/reference/orcad-operations.md:7-22`。这一个决定同时买到三件事：终端会话真正跨 app 重启存活、手机和浏览器能作为对等客户端接入、`orca serve` 可以无头运行。代价是一整套 pane 归属与 lease 协议。

**2. 不用 `shell -c` 跑 agent，而是起交互 shell 再注入命令。** `ROOT/src/main/providers/local-pty-shell-ready-startup-command.ts:48`。agent 退出后会话还在，用户可以接着敲命令。这一条决定了后面所有 ready-marker 机制的必要性。

**3. 三重 shell-ready 判据 + 优雅降级。** OSC 777 marker（`ROOT/src/main/shell-ready-marker-scanner.ts:1`）→ line-editor 序列加进程探测（`ROOT/src/main/line-editor-ready-output-scanner.ts:1`）→ 1500ms 超时。marker 扫描时 hold 住匹配中的字节，用户永远看不到碎片。ready 后再等 30ms 躲开 ECHO 竞态。

**4. shell wrapper 立刻交还 ZDOTDIR，把自己的工作推迟到第一个 precmd。** `ROOT/src/main/shell-templates.ts:66-86`。用户配置按原样完整加载，`__orca_deferred_init` 跑完自删除。wrapper 按内容寻址缓存，写坏了退回裸 login shell 而不是让终端起不来。

**5. 背压是端到端的，ACK 语义是「已解析」不是「已接收」。** `ROOT/src/renderer/src/components/terminal-pane/terminal-pty-ack-gate.ts:25-37`。仿 TCP 累积确认，丢一个 ACK 不留永久欠账。远程链路上同样的思路又实现了一遍（opcode 13，字节滑动窗口，发送失败把字节计回）。

**6. 交互态 PTY 有独立带宽配额而非「暂停输出」。** `ROOT/src/main/ipc/pty/delivery/accounting.ts:67-83`。全局水位被背景洪流打满时，正在打字的 pane 仍有 +256 KB / +512 KB 额度。配合 100ms 按键窗口内的「疑似重绘直接投递」快路径，替代了 typeahead 的作用而没有预测错误回滚的闪烁。

**7. 用 MessageChannel 而非 setTimeout(0) 或 rAF 调度 write。** `ROOT/src/renderer/src/lib/pane-manager/pane-terminal-output-queue-registry.ts:124-128`。Chromium 把嵌套 `setTimeout(0)` 钳到 4ms，posted macrotask 不被钳且仍让位给输入和绘制。配合 8ms 协作式 drain 预算和解析时钟 pacer，吞吐从 8MB/s 提到约 30MB/s 且不钉住 UI。

**8. resize 权威是「可见性 + 最后操作者」而非单点。** `ROOT/src/renderer/src/lib/pane-manager/mobile-fit-overrides.ts:1-10` + `pty-input-forward.ts:196-232`。非 owner 把 xterm 停在权威尺寸不参与 fit，隐藏 pane 的布局抖动不转发 SIGWINCH，另设只读的 reportGeometry 通道保持 restore 基线新鲜且带回声过滤。这是多端共享一个 PTY 时唯一不打架的做法。

**9. 滚动跟随交给 xterm，App 只管结构性操作。** `ROOT/src/renderer/src/lib/pane-manager/pane-terminal-output-pipeline.ts:30`。App 层的 `followOutput | pinnedViewport` 意图机只在 replay、reflow、分屏、重挂载时介入，并专门处理「幻影 pin」和「buffer 暂时变短」两个边界。

**10. agent 状态合并是分级证据而非优先级列表。** `ROOT/src/main/runtime/tui-idle-evidence.ts:128`。POSITIVE / VETO / ABSENCE 三级，agent 自报压倒推断，且按 agent 分类决定「只看到名字」是否需要佐证。permission 类信号用时间戳仲裁。

**11. 合成的 spinner 字节走独立入口，不污染数据流。** `ROOT/src/main/runtime/orca-runtime-schedule-wait-blocked-check.ts:144`。状态显示永远不会反过来污染 `terminal.read` 的结果。

**12. 手机端是真终端不是日志视图。** `ROOT/mobile/scripts/build-terminal-webview-engine.mjs`。完整 xterm.js 打进 WebView，DECSET 鼠标模式、OSC 133、kitty flags 全部透传，付出的代价只是一个 postinstall 构建步骤。快照预算按设备分档（手机 1000 行 / 512 KB，桌面 2 MB）。

**13. relay 零知识，凭据放 URL fragment。** `ROOT/cloud/apps/relay/src/splice-forwarder.ts` 只做字节对拼，`ROOT/src/main/runtime/runtime-rpc/runtime-rpc-pairing-types.ts:129-142` 把配对凭据放 fragment 避开代理日志和 Referer。

**14. 快照与实时流的接缝按 seq 字符级切片。** `ROOT/src/main/runtime/rpc/methods/terminal/terminal-stream-replay.ts:34-68`。不是「丢掉可能重复的整块」也不是「允许重复」，而是精确算出偏移切一刀。积压溢出时明确告诉客户端 `truncated: true`。

**15. 关闭确认的超时语义。** `ROOT/src/renderer/src/components/terminal/running-terminal-close-guard.ts:22-63`。探测超时不等于 shell 空闲，所以超时的结果是弹确认框而不是 kill。很多项目在这里会选「探测失败就当没进程」，那是会丢数据的。

**16. 跨版本线协议有 e2e 守门。** `ROOT/tests/e2e/cross-version-wire/cross-version-terminal-wire.unit.test.ts` 会把当前工作树与最新 release tag 双向对跑一次完整终端旅程（subscribe → input → hide/reveal → drop → reconnect）。opcode 号永久占用的历史也留在代码注释里（`Ack = 13` 为了不撞上已发布到手机的 `Metadata = 12` 而重编号）。

---

## 11. 已知缺口

`pty.getProfiles` RPC 全链路已打通（relay 读 `/etc/shells` → provider contract → router），但 renderer 零调用者，是死代码路径。POSIX 侧的自定义 shell 只有一个自由文本框，不枚举不补全，非绝对路径连存在性校验都跳过。per-tab shell 选择仅 Windows 支持。POSIX 的 `shellArgs` 硬编码为 `['-l']`，用户无法自定义启动参数。

没有 typeahead / 预测回显，高延迟链路（relay 中继、跨洲 SSH）下手感仍受 RTT 限制。多行粘贴无确认弹窗，安全性完全押在 bracketed paste 上。

重连是「重订阅 + 新快照」而非 seq 续传，SSH 形态的重放缓冲只有 100 KB，离线期间超出部分对客户端永久丢失。

SSH lease 在 relay 重启后的 `pty-1` id 回收缺陷在代码里标注为未修（`ROOT/src/main/persistence/leasing-ssh-ptys/ssh-pty-lease-operations.ts:61-66`，STA-3077）。文档自陈还缺一个原子的停服栅栏（`ROOT/docs/reference/orcad-operations.md:96`）：停服前无法原子地确认没有活跃终端。

几处直接摸 xterm 内部的地方，升级时要注意：`terminal-linkifier-hover-reset.ts:32` 摸 `Linkifier` 内部（注明版本 6.1.0-beta.287），`pane-webgl-renderer.ts:43-48` 摸 `WebglAddon._renderer._gl / ._canvas`，`terminal-freeze-breadcrumbs.ts:69` 依赖已打补丁的 addon-webgl atlas font probe 字段。
