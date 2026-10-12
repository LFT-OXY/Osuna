# 15 — 打包核对、文档、PR 正文与并入 main

**What to build:** 维护者拿到并入所需的全部证据并发话，合并分支经 PR 以 merge commit 并入 main。证据包括：本机打出的 macOS 包里带着内置插件，装好的应用里套餐用量有数据、Providers 列表里有 Muse Code 与 Antigravity；草稿 PR 上 CI 全绿；`prd.md` 的验收清单逐项核对过；14 的截图。`docs/release.md` 记录的同步点更新到 v0.11.2，并写明 v0.11.1、v0.11.2 也在补丁分支上、合 v0.12 时要重解哪些文件。PR 正文写清和上游不一样的地方与原因。规格见 `prd.md` 的「文档」「补丁分支」「Testing Decisions」的验收清单，以及 `docs/qa.md`、`docs/release.md`。

**Blocked by:** 14
**Status:** ready-for-agent
**Impl:** ready

- [ ] 本机按 `docs/release.md`「本地出一个 macOS 包」打出一个包（只在本机生成，不发布、不推 tag）。包里有内置插件目录；打开应用后套餐用量有数据，Providers 列表里有 Muse Code 与 Antigravity。包的路径与核对结果记在 `## Comments` 下并交给维护者。
- [ ] 内置插件没有进包时，原因已查清并修好（Osuna 的打包流程与上游不同之处），修法写进 `docs/release.md`「踩过的坑」。
- [ ] `docs/release.md`「从上游同步」：同步点那一句更新为 v0.11.2（`759532509`）；表里加一行，含八段的发布点、各自的 merge commit 与 PR 编号。
- [ ] `docs/release.md`「上游的补丁分支」按 v0.11.2 重写（v0.11.1 在上游 main 上，13 更正）：并入后与上游 main 的共同祖先是 v0.11.1（`ab10a6694`）；用上游自己的 v0.11.2 对上游 main 模拟合并得出的、合 v0.12 时要重解的文件清单。
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

### 来自 10 的交接（2026-10-12，写 PR 正文与 `docs/release.md` 用）

- **按 Osuna 决定改写的上游测试（第六段）、因换成上游实现而改动的 Osuna 断言：** 逐条在 10 的 `## Comments` 里（各 6 条与 4 条）。前面各段为上游的中间页面写的跳过与改写在这一段全部消失：`usage-screen.spec.ts`（已随上游改名 `usage-modal.spec.ts`）与 `usage-sidebar-item.spec.ts` 取上游整份，02、06、09 交接里与这两个文件有关的条目写 PR 正文时以 10 的为准。06 里 `sidebar-help.spec.ts` 的 `Math.round` 改写也被上游自己的修法取代。
- **与上游不同的行为：** PR 面板检查汇总的分隔符随语言变、标题栏无障碍名称走翻译模板（上游写死 `", "` 与 `". "`）；中文界面里检查汇总与「已工作 …」保持 Osuna 的译法。
- **用户看得见、要写进更新日志的：** 侧栏底部的「套餐用量」图标与摘要改成在当前页面上打开弹窗（之前进 Usage 页）；插件登记处安装默认开启，`PASEO_PLUGIN_REGISTRY_ENABLED` 开关取消（上游 #6224）；法文界面整份重译（上游 #6004）；PR 面板、侧栏状态分组在其余七种非英文语言里由英文占位变成译文。
- **`docs/release.md`「上游的补丁分支」要改的事实：** 那一节列的十个文件，分叉在第 1 段就全部过完——6 个在第 1 段报冲突（其中 `codex-app-server-agent.ts` 在第 4 段又冲突一次，`fr.ts` 在第 6 段因上游重译再冲突一次），4 个六段都没有报冲突、git 自己合对了（`host-runtime.test.ts`、`provider-registry.ts`、`opencode/v2/agent.test.ts`、`opencode/v2/turns.ts`）。第 1 段合完后合并基点落到上游主线上，后面各段的基点是上一段的发布点。落点表在 10 的 `## Comments`。
- **「踩过的坑」候选：** 两边原先各写了一模一样的行，上游删掉时不报冲突、Osuna 那一份跟着消失（这次是 `app/_layout.tsx` 与 `utils/host-routes.ts` 里 `/usage` 的路由接线）；上游整份重译某种语言时（`fr.ts` 57 个冲突块），冲突块先取上游、再把基点 / Osuna / 上游三份资源摊平成键值做按键的三方合并并逐键比对，合完查自动合并出来的重复键；上游的新用例拿 `session.listCommands()` 当「确保进程在」用，在 Osuna 里不启动进程，换成 `setModel(null)`；上游按顺序读订阅事件的用例会被 Osuna 在 init 之后发的 `commands_changed` 挤错位；`packages/cli/tests/e2e/plugin-lifecycle.test.ts` 在 macOS 上要 `TMPDIR="$(cd "$TMPDIR" && pwd -P)"`（`/var` 是 `/private/var` 的软链接）；`daemon-client.e2e.test.ts` 会启动本机真实的提供方，而且不在 CI 的测试脚本里，本机不要整份跑。
- **并入前看一眼（第六段新出现的两条 CI 首跑失败、重试通过）：** `usage-sidebar-item.spec.ts:173` 与本机偶发的「Usage Settings cog desktop」是同一个现象——齿轮的选项浮层打开后自己收起，`closeUsageOptions` 读不到它的位置（已记给 11）；`context-window-meter.spec.ts:245`（dark）报「The test scripts every agent usage request」，悬浮卡多取了一次数，本机跑过一次是通过的。按 Osuna 决定改写的上游测试在第六段是 7 条（第 7 条是 CI 报出来的 `packages/desktop/e2e/browser-tabs.e2e.mjs`：Composer 是 contenteditable，不能用 `inputValue()`）。

### 来自 13 的交接（2026-10-12，写 PR 正文与 `docs/release.md` 用）

- **规格里关于补丁分支的事实已更正：** v0.11.1（`ab10a6694`）的发版提交在上游 main 上，只有 v0.11.2（`759532509`，3 个提交）在从 v0.11.1 分出的补丁分支上；合完后 `git merge-base HEAD upstream/main` 是 `ab10a6694`。`prd.md` 与本工单的那条验收项已按此改写。`docs/release.md`「上游的补丁分支」开头那句「上游的补丁版本不在它的 main 上」对 v0.11.1 不成立，重写时一并改。
- **合 v0.12 时要重解的文件：** 2026-10-12 用上游自己的 v0.11.2 对上游 main（`7321d8a48`）模拟合并（`git merge-tree --write-tree --name-only --no-messages 759532509 upstream/main`），没有冲突文件。动笔时按当时的上游 main 重算一次。
- **第七、八段的冲突裁决摘要：** 两段各 15 个文件，全是版本号与发版元数据（`CHANGELOG.md`、13 个 `package.json`、`package-lock.json`），取 Osuna 一侧，解完与合并前逐字节相同；没有适配提交，没有改动任何断言，没有按 Osuna 决定改写的上游测试。规格预计的 3 个冲突的测试文件实际自动合并了。
- **「踩过的坑」候选：** `CHANGELOG.md` 的冲突块取 Osuna 一侧之后，文件仍可能比合并前多出上游在冲突块之外改的行（这次是上游给 0.11.0 条目补的两段说明），解完与合并前 `cmp`，不同就整份恢复；模拟合并的冲突数是对合并前的 main 算的，前面各段解过之后后面的段可能不再冲突（这次第七段少了 3 个）。
- **推送后的 CI** 记在 13 的 Comments 里。
