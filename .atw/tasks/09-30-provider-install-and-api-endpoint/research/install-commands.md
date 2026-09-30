# 各提供方官方安装命令（2026-09-29 调研）

命令为官方文档原文照录。实现前请再核对一遍，因为命令和包名会变。

## Claude Code — https://code.claude.com/docs/en/setup

- macOS / Linux / WSL：`curl -fsSL https://claude.ai/install.sh | bash`
- Windows PowerShell：`irm https://claude.ai/install.ps1 | iex`
- Windows CMD：`curl -fsSL https://claude.ai/install.cmd -o install.cmd && install.cmd && del install.cmd`
- 其他安装方式：`brew install --cask claude-code`、`winget install Anthropic.ClaudeCode`、`npm install -g @anthropic-ai/claude-code`
- Windows 10 1809 及以上原生支持。

## Codex — https://developers.openai.com/codex/cli

- macOS / Linux：`curl -fsSL https://chatgpt.com/codex/install.sh | sh`
- Windows：`powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"`
- 其他安装方式：`npm install -g @openai/codex`、`brew install --cask codex`
- 第三方接口功能要求 Codex ≥ 0.118.0，原因是依赖 `auth.command`。

## Pi — https://pi.dev/docs/latest/quickstart

- macOS / Linux：`curl -fsSL https://pi.dev/install.sh | sh`
- 通用（包括 Windows）：`npm install -g --ignore-scripts @earendil-works/pi-coding-agent`，需要 Node 22.19+。
- 包名已从 `@mariozechner/pi-coding-agent` 迁移过来，旧包已标记 deprecated。
- 安装脚本只支持 macOS/Linux。Windows 可以原生运行（通过 Git Bash），也可以在 WSL 里运行。

## Oh My Pi — https://omp.sh/docs/quickstart

- macOS / Linux：`curl -fsSL https://omp.sh/install | sh`
- Windows：`irm https://omp.sh/install.ps1 | iex`
- 其他安装方式：`brew install can1357/tap/omp`、`bun install -g @oh-my-pi/pi-coding-agent`
- 三个平台都原生支持。

## 参考项目怎么做

- **openchamber**：按客户端的 userAgent 判断平台。命令写死在前端（`LocalSetupScreen.tsx:12-14`），另有「我已安装，检查并继续」按钮。
- **t3code**：只按 Windows 和 posix 两类平台区分，取的是服务端的系统。它在首次运行向导里打开内置终端，并预先填好命令（`providerReadiness.logic.ts:79-129`）。
- **desktop-cc-gui**：后端一键安装，同时展示「将执行」和「手动命令」两份内容（`cli_lifecycle.rs`）。
- **orca**：只给一个官网链接（`agent-catalog.tsx`）。
