# 02 — 用 Homebrew 装的 Claude Code 也能一键升级（macOS）

**What to build:** 在 macOS 上用 Homebrew cask 装的 Claude Code（`claude-code` 或 `claude-code@latest`），点"升级"时 daemon 执行 `<Homebrew 目录>/bin/brew upgrade --cask <对应的 cask 名>`，不再执行对这种装法不起作用的 `claude update`。Codex 和 Claude Code 共用一套 Homebrew cask 识别规则。规格见 `prd.md` 的"daemon：Claude Code 的 Homebrew 升级"一节。

**Blocked by:** None — can start immediately
**Status:** ready-for-agent
**Impl:** ready

- [ ] Homebrew cask 的识别规则改成通用的：只在 macOS 上识别，目录前缀只认 `/opt/homebrew` 和 `/usr/local`，路径必须落在 `<前缀>/Caskroom/<cask 名>/` 下面。Codex 改用这套规则，原有行为不变。
- [ ] Claude Code 的真实路径在 `claude-code` 或 `claude-code@latest` 的 Caskroom 目录下时，升级命令是 `<前缀>/bin/brew upgrade --cask <从路径里取出的 cask 名>`，brew 用绝对路径。
- [ ] 路径不在 Caskroom 下、主机不是 macOS、或者改成用解释器启动（replace 模式，比如 `node cli.js`）时，仍然执行 `claude update`，replace 模式的前缀参数保持现在的处理方式。
- [ ] 升级命令的单元测试（加在现有的测试文件里）覆盖：`/opt/homebrew` 加 `claude-code@latest`、`/usr/local` 加 `claude-code`、非 macOS、路径不在 Caskroom 下、用解释器启动这几种情况。Codex 现有的 Homebrew 用例全部通过。
- [ ] `docs/providers.md` 里"Upgrade command"那一段补上：CLI 自带的升级子命令，可能只打印提示、不升级用包管理器装的版本。Claude Code 的 Homebrew 识别就是为这种情况加的，"版本没变"失败也能兜住它。
- [ ] 真实验收：开发机上的 Claude Code 是 `claude-code@latest` cask。等 npm 和这个 cask 都有比已装版本更新的版本时，在 dev 桌面端点一次"升级"，确认 daemon 执行的是 `brew upgrade --cask claude-code@latest`，并且版本变了。**执行前要再问一次用户。** 暂时没有新版本时，记录下来，留到合适的时候再做。
- [ ] typecheck 和 lint 通过。
