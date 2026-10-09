<p align="center">
  <img src="packages/app/assets/images/osuna-logo.png" width="64" height="64" alt="Osuna logo">
</p>

<h1 align="center">Osuna</h1>

<p align="center">
  <a href="README.md">English</a> ·
  <a href="README.zh-CN.md">简体中文</a> ·
  <a href="README.ja.md">日本語</a> ·
  <a href="README.ko.md">한국어</a>
</p>

<p align="center">
  <a href="https://github.com/LFT-OXY/Osuna/releases">
    <img src="https://img.shields.io/github/v/release/LFT-OXY/Osuna?style=flat&logo=github" alt="GitHub release">
  </a>
</p>

<p align="center">Claude Code、Codex、Copilot、OpenCode 和 Pi agents 的统一界面。</p>

在你自己的机器上并行运行 agents。无论在手机上还是桌前，都能推进交付。

- **自托管：** Agents 在你的机器上运行，使用完整的本地开发环境、工具、配置和技能。
- **多提供商：** 通过同一个界面使用 Claude Code、Codex、Copilot、OpenCode 和 Pi。为每个任务选择合适的模型。
- **语音控制：** 在语音模式下口述任务或讨论问题。需要免手操作时很方便。
- **跨设备：** 支持桌面端、Web、CLI 和手机。在桌前开始工作，用手机查看进度，也可以从终端脚本化操作。
- **隐私优先：** Osuna 没有遥测、追踪，也不会强制登录。

## 插件

用受信任的 TypeScript 插件添加主题、工作区面板、命令、设置页和 coding agent 提供商。通过
`osuna plugin add <source>` 从本地目录或 Git 仓库安装。

见[插件文档](docs/plugins.md)。插件可以访问 daemon 所在的机器，并在已连接的客户端中运行；只安装你信任的代码。

## 快速开始

Osuna 会运行一个名为 daemon 的本地服务，用来管理你的 coding agents。桌面 app、Web app、CLI 和手机 app 等客户端都会连接到它。

### 前置条件

你至少需要安装一个 agent CLI，并用你的凭据完成配置：

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
- [Codex](https://github.com/openai/codex)
- [GitHub Copilot](https://github.com/features/copilot/cli/)
- [OpenCode](https://github.com/anomalyco/opencode)
- [Pi](https://pi.dev)

### 桌面 app（推荐）

从 [GitHub releases 页面](https://github.com/LFT-OXY/Osuna/releases)下载。打开 app 后 daemon 会自动启动，不需要再安装其他东西。

如果要从手机连接，打开 **Settings → 你的 host → Pair Device** 并扫描二维码，链接会打开 Osuna 的 Web app。Android 也可以从 releases 页面安装 APK。上游的 Paseo 手机 app 不是受支持的客户端。

如果要在终端里使用 `osuna` 命令，打开 **Settings → Integrations → Command line**，点击 **Install**。它会把命令链接到 `~/.local/bin`。

### Docker

在 Docker 中运行 Osuna daemon 和自托管 Web UI，适合服务器和远程机器：

```bash
docker run -d --name osuna \
  -p 6767:6767 \
  -e OSUNA_PASSWORD=change-me \
  -v "$PWD/osuna-home:/home/osuna" \
  -v "$PWD:/workspace" \
  ghcr.io/lft-oxy/osuna:latest
```

启动后打开 `http://localhost:6767`。在基础镜像上安装你用的 agent CLI，再通过环境变量或持久化的 `/home/osuna` 卷提供凭据。完整配置见 [Docker 文档](docs/docker.md)。

### 从源码构建

在没有 Docker 的服务器或无头机器上，从本仓库构建 daemon 和 CLI。Node.js 版本见 `.tool-versions`。

```bash
git clone https://github.com/LFT-OXY/Osuna.git
cd Osuna
npm ci
npm run build:server
node packages/cli/bin/osuna
```

最后一条命令会启动 daemon，并询问是否打印配对二维码。其他命令见 `node packages/cli/bin/osuna --help`。

不要从 npm 安装 `@getpaseo/cli`，那是上游的 Paseo，不是 Osuna。

## CLI 用法

你能在 app 中完成的事情，也都可以在终端中完成。

```bash
osuna run --provider claude/opus-4.6 "implement user authentication"
osuna run --provider codex/gpt-5.5 --worktree feature-x "implement feature X"

osuna ls                           # 列出正在运行的 agents
osuna attach abc123                # 实时流式查看输出
osuna send abc123 "also add tests" # 发送后续任务

# 在远程 daemon 上运行；--cwd 是那台机器上的路径
osuna run --host workstation.local:6767 --cwd /workspace "run the full test suite"
```

运行 `osuna --help` 查看完整命令列表。

## Skills

Skills 会教你的 agent 使用 Osuna 来编排其他 agents。

```bash
npx skills add LFT-OXY/Osuna
```

然后在任意 agent 对话中使用：

- `/osuna-handoff` — 在 agents 之间交接工作。我会用它先和 Claude 规划，再交给 Codex 实现。
- `/osuna-advisor` — 启动单个 agent 作为 advisor，提供第二意见，但不把工作委托出去。
- `/osuna-committee` — 组建两个风格互补的 agents，让它们后退一步做根因分析并产出计划。

## 开发

Monorepo 包结构速览：

- `packages/server`：Osuna daemon（agent 进程编排、WebSocket API、MCP server）
- `packages/app`：Expo 客户端（iOS、Android、Web）
- `packages/cli`：用于 daemon 和 agent 工作流的 `osuna` CLI
- `packages/desktop`：Electron 桌面 app
- `packages/relay`：daemon 和客户端使用的 relay 传输与加密
- `packages/website`：官网和文档区（`osuna.chinhae.cc`）

常用命令：

```bash
# 运行所有本地开发服务
npm run dev

# 单独运行某个界面
npm run dev:server
npm run dev:app
npm run dev:desktop
npm run dev:website

# 构建 server stack
npm run build:server

# 全仓库检查
npm run typecheck
```

完整开发环境配置见 [docs/development.md](docs/development.md)。

## License

Apache-2.0

Osuna 最初是 [Paseo](https://github.com/getpaseo/paseo) 的 fork，现已独立开发。见 [NOTICE](NOTICE)。
