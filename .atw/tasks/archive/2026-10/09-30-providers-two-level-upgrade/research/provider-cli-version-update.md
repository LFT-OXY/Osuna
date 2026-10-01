# 内置提供方 CLI 的版本与升级（2026-09-30 调研）

"已核实"表示读过官方文档、官方源码，或者实际请求过接口；标"推测"的表示没有找到一手来源。

| 提供方 | 升级命令 | 最新版本来源 | 判断安装方式 | 备注 |
|---|---|---|---|---|
| Claude Code | `claude update`，适用于各种安装方式（npm 装的也可以用 `npm i -g @anthropic-ai/claude-code@latest`） | `downloads.claude.ai/claude-code-releases/latest`（stable 通道换成 `/stable`），返回纯文本版本号；也可以查 npm registry | 原生安装：`~/.local/bin/claude` → `~/.local/share/claude/versions/<ver>` | 原生安装会自动更新；`--version` 输出 `2.1.211 (Claude Code)`；[setup](https://code.claude.com/docs/en/setup) |
| Codex | **没有自带的升级命令**，按安装方式选：npm/bun/pnpm 用 `npm install -g @openai/codex`；brew 用 `brew upgrade --cask codex`；独立脚本就重跑 `curl -fsSL https://chatgpt.com/codex/install.sh \| CODEX_NON_INTERACTIVE=1 sh` | `api.github.com/repos/openai/codex/releases/latest`；brew 查 `formulae.brew.sh/api/cask/codex.json` | npm 包装脚本会设置环境变量 `CODEX_MANAGED_BY_NPM`；brew 路径以 `/opt/homebrew` 或 `/usr/local` 开头；独立脚本装在 `~/.codex/packages/standalone/releases/<ver>-<triple>` | `--version` 输出 `codex-cli 0.130.0`（来自测试夹具）；[update_action.rs](https://github.com/openai/codex/blob/main/codex-rs/tui/src/update_action.rs) |
| Copilot CLI | `copilot update`，适用于各种安装方式 | `copilot version` 显示版本时会顺带检查更新；也可以查 GitHub releases 或 npm `@github/copilot` | 脚本装到 `$HOME/.local/bin`，以 root 运行时装到 `/usr/local/bin` | 默认开启自动更新；`--version` 的输出格式未核实；[安装文档](https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli) |
| OpenCode | `opencode upgrade [target] --method <m>`，适用于各种安装方式 | 源码按安装方式分别取：npm 查 registry `opencode-ai`，brew 查 formulae，其余查 GitHub releases | 路径含 `~/.opencode/bin` 判为 curl 安装；其余靠 `npm list -g` 等命令判断 | 有自动更新（`OPENCODE_DISABLE_AUTOUPDATE` 可关闭）；[CLI 文档](https://opencode.ai/docs/cli/) |
| Pi | `pi update` | npm registry `@earendil-works/pi-coding-agent` | 安装脚本装到 `~/.pi/agent/install/releases/<ver>`，并写入 `managed-install.json` | 旧包 `@mariozechner/pi-coding-agent` 已被标记为 deprecated（停在 0.73.1）；[cli.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/cli.md) |
| Oh My Pi | `omp update` | `omp update --check`（**只检查不安装**，6 家里唯一有这种命令的）；也可以查 npm `@oh-my-pi/pi-coding-agent` 或 GitHub releases | omp 自己能通过 bun/npm 全局目录、`brew --prefix`、mise 判断安装方式 | [README](https://github.com/can1357/oh-my-pi) |

## 仓库事实

- **取版本号**：通用函数 `resolveBinaryVersion` 在 `packages/server/src/server/agent/providers/diagnostic-utils.ts:138`，路径解析在 `provider-launch-config.ts:87,112`。
- **诊断以外已经在取版本的只有两家**：
  - Claude：`claude/agent.ts:1566,1701`，用来决定模型清单
  - Codex：`codex-app-server-agent.ts:7027,7069`，以及 `api-endpoints/service.ts:115`
- **快照里没有版本字段**：`ProviderSnapshotEntrySchema` 在 `packages/protocol/src/messages.ts:448-468`。
- **已停用的提供方不做探测**，快照里写 `status: "unavailable"`：`provider-snapshot-manager.ts:880`。
- **启用的提供方怎么探测**：先用 `isAvailable` 看 CLI 在不在，再拉模型列表（`fetchCatalog`）；找不到 CLI 就写 `unavailable`（`provider-snapshot-manager.ts:1045-1064`）。
- **默认启用**：由 `enabledByDefault` 控制（`protocol/src/provider-manifest.ts:28`；OMP 在 `:254` 设为 `false`），在 `server/.../provider-registry.ts:738` 生效。
- **联网约束**：`docs/usage.md:117-138` 规定，daemon 主动发起的请求只有价格表一个，其余都要是用户要求的，或者是用户开启的连接。
- **权限**：
  - `docs/permissions.md:22-23`：`daemon.read` 覆盖提供方信息，`daemon.manage` 覆盖 update 和 providers
  - `create_terminal` 和 workspace script 的启动属于 `workspace.write`（`operation-permissions.ts:69,184,222`）
  - `daemon.update.request` 在 Osuna 里一律被拒绝（`daemon-session.ts:296-310`）
- **现状**：没有"升级提供方"的 RPC。

## 现有 App 代码

- 布局：`packages/app/src/screens/settings/providers-page.tsx`、`providers-layout.ts`、`providers-header.tsx`
- 列表：`providers-section.tsx`；「+」弹窗：`provider-catalog-dialog.tsx`，ACP 目录在 `components/provider-catalog-list.tsx`、`data/acp-provider-catalog.ts`
- 详情：`packages/app/src/provider-detail/index.tsx` 的顶部注释写了版块顺序；运行时接线在 `view.tsx`
- 安装指引：`packages/app/src/provider-install-guide/`，命令表在 `internal/commands.ts`
