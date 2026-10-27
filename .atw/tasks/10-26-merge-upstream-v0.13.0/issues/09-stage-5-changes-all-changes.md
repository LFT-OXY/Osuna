# 09 — 第五段适配：Changes 的 All changes 接上大改动集优化

**What to build:** Changes 默认显示上游的 All changes（已提交与未提交合成一份）。Osuna 的按文件复用、1 秒节流、只看文件树时不读全文、生成文件与大文件默认收起、文件展开状态在 All changes 模式下照常工作。规格见 `prd.md`「Changes」，裁决见 `research/feature-overlap.md` 3.2 第 25、26 条。

**Blocked by:** 06
**Status:** ready-for-agent
**Impl:** done

- [ ] 客户端默认 All changes。
- [ ] All changes 模式下按文件复用生效，有测试。
- [ ] 上游私有 index 下未跟踪文件的判定正确，有测试。
- [ ] 只看文件树时不读全文、生成文件默认收起在 All changes 下生效，有测试。
- [ ] Osuna 已单独摘过的 #6745 与上游的等价提交取上游一侧。
- [ ] typecheck 和 lint 通过；改到的测试文件逐个单独跑过并通过（不跑整套）。
- [ ] 没有 Osuna 的断言被删除或放宽；必须跟着改的断言逐条记在 `## Comments` 下，供 14 写 PR 正文用。
- [ ] UI：dev 桌面端 1280 宽 / 一个有生成文件的大改动集的 Changes 面板 — 截图上默认是 All changes，生成文件收起。

## Comments

- 生产代码只加了一处注释（`checkout-diff-file-reuse.ts` 的 `readBlobIdsByPath`，见下一条）。第五段合并（工单 06）已经把需要的接上了：客户端默认 `"all"`（`git/working-diff-comparison/state.ts`，上游用例「defaults to All changes」在）；`checkout-diff-manager.ts` 对 all 模式照样建 `fileReuse`、接工作区监听与 1 秒节流；`filesOnly` 与生成文件标记不看模式。本工单补测试证明它们在 All changes 下成立。
- 私有 index 与按文件复用：复用的文件身份用真实 index 跑 `git diff --raw <base>`，没带私有 `GIT_INDEX_FILE`。实测这样也对：分支上删掉、磁盘上又放回的文件，真实 index 里报为 `D`，旧侧 blob 与私有 index 里的相同，新侧用工作区 stat 签名，所以身份一致、能复用。另用一次性用例试过改名后放回原名、base 前移（合并 main）、取消跟踪等情形，带复用与完整重算的结果逐字相同（用例没留）。所以没给 `readBlobIdsByPath` 加私有 index，只在它旁边写了两行注释说明原因；正确性由新加的复用用例守住，不另写进 `.atw/spec`。
- 1 秒节流与文件展开状态没有在 All changes 下另补测试：节流在 manager 里按订阅计时，展开规则（`panels/changes/file-expansion.ts`）只看路径、`generated` 和行数，两者都不读比较模式。
- #6745：Osuna `3c8f957da` 与上游 `be0acb293` 的补丁逐字相同，上游提交已在历史里，第五段没有冲突需要取舍；`data/push-router.ts` 的「retained hidden panel must not cancel demand」与 `e2e/browser/changes-first-edit.spec.ts` 与上游一致。
- 断言变更（PR 正文要列）：
  - `packages/server/src/utils/checkout-diff-file-reuse.test.ts`「only diffs the file that changed since the previous run」（Osuna 用例）：期望的 patch 命令从 `["diff", "HEAD", "--", ":(literal)alpha.ts"]` 改为在 `diff` 后加上游 #6562 的 `--no-ext-diff --no-color --src-prefix=a/ --dst-prefix=b/`（`checkout-git.ts` 的 `GIT_PATCH_FORMAT_ARGS`）。仍是逐字相等，「只 diff 改了的那一个文件」的意思不变。这条用例合并后本机一直挂着，本工单才跑到。
- 新增测试：`checkout-diff-file-reuse.test.ts` 三条 All changes 用例（删后放回、未跟踪、提交、取消、删除各步带复用与完整重算一致，最终状态的新增/删除判定；只重算改了的那个文件，含放回文件与未跟踪文件；清单订阅不读全文、完整订阅会读、生成文件标记一致）；`git/use-diff-query.test.ts`「asks for the All changes file list alone when only the tree shows」。
- 测试：`checkout-diff-file-reuse.test.ts`（12 条）、`use-diff-query.test.ts`、`working-diff-comparison/state.test.ts`、`panels/changes/file-expansion.test.ts` 逐个单独跑过并通过；全仓 typecheck、改动文件 lint 通过。整套交给开 PR 时的 CI。
- 截图：`screenshots/09-changes-all-changes-default-generated-collapsed-{top,bottom}-desktop-1280.png`。dev 桌面端 1280 宽，新建的演示工作区（11 个文件，`public/app.min.js`、`schema/types.ts`、`package-lock.json` 是生成文件）；顶部是「全部更改」，三个生成文件标「生成」并收起；`orders.ts` 是为打开差异面板点开的。启动时 Codex、Claude 的配置目录指向临时空目录，真实配置没被读写；演示工作区已归档。
- 视觉评审提的「前 3 个展开名额把生成文件也算进去」「收起的标题行没有箭头」「评论加号盖住行号（截图时鼠标停在那行）」「灰字对比度」都是现有界面行为，不是本工单引入，未处理。左下角的开发模式报错「React does not recognize the `importantForAccessibility` prop」来自 `components/context-window-meter.tsx:111` 的上下文圆环，与 Changes 无关，留给工单 13 或另开工单。
