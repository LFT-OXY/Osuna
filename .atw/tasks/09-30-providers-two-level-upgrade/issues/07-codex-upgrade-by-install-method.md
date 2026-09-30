# 07 — Codex 按安装方式升级

**What to build:** 点 Codex 的"升级"时，daemon 按 codex 可执行文件的真实路径（解析过符号链接的）判断它当初是怎么装的，选择对应的官方升级方式：
- **官方独立安装**：重跑官方安装脚本，并设 `CODEX_NON_INTERACTIVE=1`；Windows 用官方的 PowerShell 安装脚本
- **Homebrew**：`brew upgrade --cask codex`
- **npm 全局安装**：`npm install -g @openai/codex@latest`

判断不出来时（包括 Microsoft Store 版），返回"判断不出安装方式"。App 此时显示"无法自动升级"，并附手动升级的指引，也就是指向安装指引或官方文档。

**Blocked by:** 06
**Status:** ready-for-agent
**Impl:** ready

- [ ] 判断安装方式的函数是纯函数，单测覆盖独立安装、Homebrew（`/opt/homebrew` 和 `/usr/local`）、npm 全局目录、Microsoft Store、判断不出来这几种路径
- [ ] daemon e2e 测试：假 codex 在 npm 目录结构下时，执行的是 npm 升级命令（可以用 PATH 里的假 npm 记录收到的参数）；判断不出来时返回对应的 errorCode
- [ ] App 对"判断不出安装方式"显示专门的提示和手动升级的指引，不直接显示原始错误
- [ ] 新增的文案在 9 个语言文件里都补上了
- [ ] typecheck 和 lint 都通过
