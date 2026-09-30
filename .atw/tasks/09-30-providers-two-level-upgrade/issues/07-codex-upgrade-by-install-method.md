# 07 — Codex 按安装方式升级

**What to build:** 点 Codex 的"升级"时，daemon 按 codex 可执行文件的真实路径（解析过符号链接的）判断它当初是怎么装的，选择对应的官方升级方式：
- **官方独立安装**：重跑官方安装脚本，并设 `CODEX_NON_INTERACTIVE=1`；Windows 用官方的 PowerShell 安装脚本
- **Homebrew**：`brew upgrade --cask codex`
- **npm 全局安装**：`npm install -g @openai/codex@latest`

判断不出来时（包括 Microsoft Store 版），返回"判断不出安装方式"。App 此时显示"无法自动升级"，并附手动升级的指引，也就是指向安装指引或官方文档。

实现说明：判断规则和命令对齐上游 `codex-rs/install-context` 与 `update_action.rs`，比原文收得更紧（审查发现）：
- npm 加 `--prefix <原前缀>`，避免 PATH 上另一个 node 的 npm 把新版装到别处。
- Homebrew 只认 `Caskroom/codex`；formula 版和手放进 `/usr/local/bin` 的判为"判断不出"。
- 独立安装把路径里的 `CODEX_HOME` 传给安装脚本。入口链接都经过 `current`，所以不传 `CODEX_INSTALL_DIR`。
- bun、pnpm 的全局目录判为"判断不出"，不用 npm 升级。
- 已核实：Windows 的 install.ps1 把入口目录和 `current` 都做成联接，`fs.realpath` 能解析到 `releases`。
- 未验证：Windows 上 `powershell` 和 `npm` 经 cmd 转一层时的引号处理，本机无法测试。
- 未处理：由桌面端启动的 daemon，PATH 上可能没有 npm。这种情况下报 `command_failed`。
- e2e 只断言 npm 的参数，不断言 `version`：假 Codex 不会跑 app-server，快照状态是 `error`，不带版本。

**Blocked by:** 06
**Status:** ready-for-agent
**Impl:** done

- [x] 判断安装方式的函数是纯函数，单测覆盖独立安装、Homebrew（`/opt/homebrew` 和 `/usr/local`）、npm 全局目录、Microsoft Store、判断不出来这几种路径
- [x] daemon e2e 测试：假 codex 在 npm 目录结构下时，执行的是 npm 升级命令（可以用 PATH 里的假 npm 记录收到的参数）；判断不出来时返回对应的 errorCode
- [x] App 对"判断不出安装方式"显示专门的提示和手动升级的指引，不直接显示原始错误
- [x] 新增的文案在 9 个语言文件里都补上了
- [x] typecheck 和 lint 都通过
