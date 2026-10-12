# 15 — 打包核对、文档、PR 正文与并入 main

**What to build:** 维护者拿到并入所需的全部证据并发话，合并分支经 PR 以 merge commit 并入 main。证据包括：本机打出的 macOS 包里带着内置插件，装好的应用里套餐用量有数据、Providers 列表里有 Muse Code 与 Antigravity；草稿 PR 上 CI 全绿；`prd.md` 的验收清单逐项核对过；14 的截图。`docs/release.md` 记录的同步点更新到 v0.11.2，并写明 v0.11.1、v0.11.2 也在补丁分支上、合 v0.12 时要重解哪些文件。PR 正文写清和上游不一样的地方与原因。规格见 `prd.md` 的「文档」「补丁分支」「Testing Decisions」的验收清单，以及 `docs/qa.md`、`docs/release.md`。

**Blocked by:** 14
**Status:** ready-for-agent
**Impl:** ready

- [ ] 本机按 `docs/release.md`「本地出一个 macOS 包」打出一个包（只在本机生成，不发布、不推 tag）。包里有内置插件目录；打开应用后套餐用量有数据，Providers 列表里有 Muse Code 与 Antigravity。包的路径与核对结果记在 `## Comments` 下并交给维护者。
- [ ] 内置插件没有进包时，原因已查清并修好（Osuna 的打包流程与上游不同之处），修法写进 `docs/release.md`「踩过的坑」。
- [ ] `docs/release.md`「从上游同步」：同步点那一句更新为 v0.11.2（`759532509`）；表里加一行，含八段的发布点、各自的 merge commit 与 PR 编号。
- [ ] `docs/release.md`「上游的补丁分支」按 v0.11.1、v0.11.2 重写：并入后与上游 main 的共同祖先是 v0.11.0；用上游自己的 v0.11.2 对上游 main 模拟合并得出的、合 v0.12 时要重解的文件清单。
- [ ] 本次新踩到的、下次还会遇到的坑补进「踩过的坑」，至少包括：上游的 beta 里有它后来删掉的中间设计；上游新增的内置插件要核对进包。没有别的就不加。
- [ ] Osuna 讲 Usage 的文档里，提到上游用量来源的地方用链接，不重述；仓库说明里的文档表与实际一致。
- [ ] ADR 0006（`docs/adr/0006-usage-in-code-is-upstream-plan-usage.md`）已从 `docs/glossary.md` 的套餐用量词条与 `docs/release.md`「从上游同步」链入。01 的评审提出；这两个文件都在冲突清单里，所以没有在 01 里加。
- [ ] 文档改动用项目的格式化脚本只处理改动过的文件。
- [ ] `prd.md`「验收清单」逐项核对并勾选，没满足的写明原因。
- [ ] 草稿 PR 上 CI 全绿，Nix 与 Nix Update Hash 除外；已知偶发失败重跑后通过。CI 的等待放在后台。
- [ ] PR 正文按 `docs/qa.md` 写，含：各段冲突裁决摘要；两个新提供方上经核实缺失的 Osuna 功能与后续任务；因换成上游实现而改动的 Osuna 断言；按 Osuna 决定改写或没收的上游测试；`plugin add 作者/仓库` 含义的变化；daemon 自更新保持下线；平台矩阵里原生端标注免验收，Windows 包与虚拟机验收由维护者自己做。
- [ ] 合并期间 main 有新提交时，已把 main 合进合并分支（不 rebase）并重新看过 CI。
- [ ] 收尾在并入之前做完：各工单的验收项已对照勾选、任务记录与 journal 已提交。并入会让这个 worktree 被 daemon 自动归档，已提前告诉维护者。
- [ ] 维护者看过截图、包的核对结果与 PR 正文并发话后，PR 转为可合并，以 merge commit 并入（不 squash、不 rebase）。并入由维护者操作，或得到维护者明确同意后操作。
- [ ] 并入后：`759532509` 是 main 的祖先；任务在主工作树归档。

## Comments

### 来自 09 的交接（2026-10-12，写 PR 正文与 `docs/release.md` 用）

- **按 Osuna 决定改写的上游测试（第五段）：** `composer/agent-controls/utils.test.ts` 的 `service_tier → yellow` 改成 `providerBrand`；`e2e/browser/codex-speed.spec.ts` 的图标色由上游的黄色改成 Codex 品牌色并补实心断言、补「不带搜索框」；`e2e/browser/usage-screen.spec.ts`「an account with all logins failing…」由 `/usage` 独立页面改到窄屏的套餐用量抽屉。维护者 2026-10-12 确认：速度菜单用 Osuna 的实心品牌色、中文界面下显示中文。
- **与上游不同的行为：** 速度菜单的功能名与普通 / 快速 / 超快按界面语言显示（`docs/i18n.md` 已写明这条例外）；选择型功能的菜单在选项不超过 6 个时不带搜索框。
- **「踩过的坑」候选：** 规格按「标志性文件首次出现在冲突清单里」推断功能落在哪一段会偏——速度菜单在第 1 段就自动合并进来了，到第 5 段才第一次冲突；`plugins/antigravity-provider/server/provider.test.ts`「reports startup auth…」在 macOS 本机报 `kill EPERM`（对只剩僵尸进程的进程组发信号），Linux 不会，合并前就如此，以 CI 为准；截图用 128 色量化时，画面里没有别的蓝色就会把提供方彩色图标压成灰色，这类图用 256 色。
- **并入前看一眼：** `e2e/browser/agent-timeline-scroll-smoothness.spec.ts:137`「…during slow upward scrolling」从第四段起连续四次 CI 首跑失败（三次重试通过，`ed5f82e5e` 那次首跑与重试都挂、`rerun --failed` 后通过），本机单跑通过。失败形状固定：图片行加载后高度 560 → 225，可见文字位移 -175。没有查原因——是 runner 慢，还是 Osuna 的图片行高度与上游 #5970 预留的不一致。
