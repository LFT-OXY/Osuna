# 14 — 打包核对、文档、开 PR 与并入

**What to build:** 本机打一个 macOS 包核对内置插件进包；更新 `docs/release.md`；把合并分支推到 origin、开一个指向 main 的 PR，CI 只在此时跑一次；写好 PR 正文；维护者看过证据并发话后以 merge commit 并入。规格见 `prd.md`「文档」「Testing Decisions」验收清单。

**Blocked by:** 13
**Status:** ready-for-agent
**Impl:** done

- [x] 本机打出的 macOS 包里有内置插件目录；打开后「添加提供方」里有 Hoplite，套餐用量有数据。包的路径交给维护者。
- [x] `docs/release.md`：同步点更新为 v0.13.0（`d34d17a90`），表里加一行（七段的发布点、merge commit 与 PR 编号）；「上游的补丁分支」改写为这次的实际情况（v0.11.2 分叉处 16 个文件，v0.13.0 在上游 main 上）；「分段与并入」开 PR 的时机改成「全部段做完再开一个 PR」；本次新踩到的坑补进「踩过的坑」（没有就不加）。
- [x] 推送与开 PR 前先向维护者说明并取得同意；`gh` 命令带 `--repo LFT-OXY/Osuna`。
- [x] PR 正文按 `docs/qa.md` 写，含：删掉的 DOM 预览与三个测试文件；因换成上游实现而改动的 Osuna 断言；按 Osuna 决定改写的上游测试；加进豁免名单的文件；中继密码的行为变化；各段冲突裁决摘要；后续工单（Pressable 迁移、远端子 Agent 进派发组）。平台矩阵中原生端标注免验收。
- [x] CI 全绿，Nix 与 Nix Update Hash 除外；已知偶发失败只重跑失败的作业。
- [x] 收尾（勾工单、journal）在并入之前做完。
- [ ] 维护者看过截图与包的核对结果并发话后，PR 以 merge commit 并入（不 squash、不 rebase）。并入后手动删除 worktree。
- [ ] Windows 包与虚拟机里的安装验收由维护者自己做。
