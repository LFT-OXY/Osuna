# 合并上游 v0.12.0 – v0.13.0：现状摸底

2026-10-26 在 worktree `pale-manatee`（分支 `merge-upstream-paseo-updates`，HEAD `b8d4f55e7`，与 origin/main
相同，Osuna 0.17.0）上核实。数据来自 `git merge-tree` 的模拟合并与 `git log`，没有改动工作区。做法沿用
`docs/release.md`「Fork 分发 → 从上游同步」，这里只记这一次特有的事实与访谈确认的决定。

冲突细目见 [conflicts.md](conflicts.md)，两边功能重叠见 [feature-overlap.md](feature-overlap.md)。

## 同步点与范围

- 当前同步点：上游 v0.11.2（`759532509`），是 main 的祖先；`git merge-base main <v0.13.0>` 是 v0.11.1（`ab10a6694`）。
- 目标：上游 v0.13.0（`d34d17a90`，2026-10-24）。`main..v0.13.0` 共 328 个上游提交。
- 维护者给的本地上游克隆（`~/Documents/Configuration/dev-environment/demo/agent客户端源码/paseo`）在 `e958540b0`，
  是 v0.13.0 之后 27 个未发版的提交；GitHub 上游 main 再多 3 个（`902b0c7a1`）。都不在范围内。
- Osuna 自同步点以来有约 1128 个非合并提交。
- 上游补丁版 v0.11.3（`dd25057bb`）、v0.11.4（`dc5b02f7d`）不在上游 main 上，4 个修复在 v0.12.0 主线上都有
  等价提交（`7aa3fac06`、#7030 `2d86b94b2`、#6953 `16bb179e6`、#6568 `e8108d909`），不单独合。

| 段  | 上游发布点     | 提交        | 日期       | 本段上游提交数 | 本段改动文件数 | 对 main 的累计冲突文件数 |
| --- | -------------- | ----------- | ---------- | -------------- | -------------- | ------------------------ |
| 1   | v0.12.0-beta.1 | `e2f4948f9` | 2026-10-16 | 165            | 827            | 97                       |
| 2   | v0.12.0-beta.2 | `c517d07d6` | 2026-10-17 | 27             | 133            | 109                      |
| 3   | v0.12.0-beta.3 | `cc748dfe1` | 2026-10-18 | 22             | 125            | 122                      |
| 4   | v0.12.0        | `cafe4b01c` | 2026-10-19 | 22             | 96             | 130                      |
| 5   | v0.13.0-beta.1 | `3fa625701` | 2026-10-22 | 52             | 946            | 180                      |
| 6   | v0.13.0-beta.2 | `30d8cb044` | 2026-10-23 | 27             | 411            | 199                      |
| 7   | v0.13.0        | `d34d17a90` | 2026-10-24 | 13             | 73             | 204                      |

第 1 段的提交数与改动文件数从 v0.11.2 起算。累计冲突数是各发布点分别对 main 模拟的结果，逐段实做时
每段的数字会不同。

## 访谈确认的决定（2026-10-26）

第一轮：

1. 范围停在上游 v0.13.0；之后未发版的提交不合，等上游下一个正式版。
2. 按上游 7 个发布点分 7 段，每段一个 merge commit，一个 PR，以 merge commit 并入。
3. 建任务，按流程走（discover → specify → slice → implement）。
4. 7 段在本机全部做完，每段只跑改到的测试；全部做完再开一个 PR，CI 只跑一次。
   `docs/release.md`「分段与并入」里「第一段合完就开草稿 PR，之后每段推送后看 CI」改成同样的说法。
5. 上游新带来的 `COMPAT(...)` 标签改写成 Osuna `v0.18.0`；发版时版本号不同再统一改。

按已有规则直接定的：v0.11.3 / v0.11.4 不单独合；从 GitHub 的 `upstream` remote 按 SHA 合，不从本地克隆合。

第二轮（题号对应 feature-overlap.md 3.1 与 conflicts.md）：

6. Markdown 文件预览全部改用上游的 enriched 渲染器（`file-panels/markdown-preview/`），Osuna 的 Web DOM 预览
   （`file-pane/markdown-preview/` 下 `*.web.*`、`github-alerts.ts`、`resource.ts` 等）不保留。与 ADR 0001 相反，范围见第三轮。
7. 聊天 Markdown 用上游引擎（#6973），Osuna 样式迁到 `components/markdown/styles.ts`；原生端代码块失去语言标签头，
   接受。
8. 套餐用量文案以上游 `providerUsage.*` 与 `usage/copy.ts` 为底，各语言的值改回 Osuna 译法，补回 Osuna 独有键，
   删掉 `usage.planUsage` 中与上游重复的键。界面上的中文不变。
9. 接受 #7668：设了密码的主机，经中继连接必须带密码；删除 `COMPAT(relayPasswordOptional)`。合并后首个 Osuna 版本的
   CHANGELOG「行为变化」写明旧 App 要重新添加主机，`SECURITY.md` 同步。
10. 手机上逻辑图首次自动打开只加 Explorer 标签，不弹出。
11. `paseo/no-raw-pressable`：合并时把 Osuna 约 27 个直接用 `Pressable` 的文件加进豁免名单（违背上游「只许移出」
    的注释，维护者已知），迁移另开工单并截图验收。
12. 远端子 Agent 不进派发组：这次不补，另开工单。
13. 上游 `CHANGELOG.zh-CN.md` 原样收下，只为官网代码（`packages/website/src/changelog.ts`）能编译，不写 Osuna 条目。
14. 验收照上次：CI 全绿（Nix 两项除外）；有变化的桌面界面截图；原生端不测；本机打 macOS 包核对内置插件目录、
    新提供方与套餐用量。不含发版。

按已有规则直接定的（维护者已知悉）：feature-overlap.md 3.2 的 33 条；手机 Explorer 接受上游 #7424 的删除并补回会话
历史标签；接受 #7639 删掉 WebView 终端渲染器；手机端收下 #6531 全屏编辑，Web/Electron 保留 Tiptap 输入；
新增的 Playwright 分片固定到 `ubuntu-24.04`；`docs/release.md`「上游的补丁分支」里「合 v0.12 没有要重解的文件」改为
实际的 16 个。

第三轮：

15. 第 6 条照上游原样：Osuna 预览独有的效果（`[!NOTE]` 提示框、HTML 居中与徽章行、预览代码块按语法主题着色、仓库内链接
    chip、缺图占位、磁盘变更刷新）不在上游渲染器上补回；逻辑图带行号的节点改为打开源码视图定位。
    `file-pane/markdown-preview/` 的 `document.test.ts`、`resource.test.ts`、`source-line.browser.test.tsx` 随代码删除，
    是「Osuna 原有的测试不删除」的例外，PR 正文写明。想要哪项以后单开工单。
16. ADR 0001 标为被 [ADR 0016](../../../../docs/adr/0016-markdown-file-preview-follows-upstream.md) 取代，原因：跟着上游走，
    减少以后合并的冲突。已写（2026-10-26）。

## 未决

没有等维护者回答的问题。写 PRD 时要补查的事实（见 conflicts.md、feature-overlap.md「没查完的」）：

- 大冲突块的具体裁决：`composer` 的 `input.tsx`（Tiptap 对 #6531 全屏编辑）、`workspace-desktop-tabs-row.tsx`、
  `provider-catalog-list.tsx`、`question-form-card.tsx`、`agent-manager.ts`、`claude/agent.ts`（#7431 #7626）、
  #7370 在 `session.ts` 与 `websocket-server.ts` 的冲突块。
- 协议层撞名（RPC 名、`server_info.features.*`）逐项比对。
- #7424 顺带把 Expo 升到 57 的影响。
- 逻辑图在 Web 上失去预览定位后，带 `lineView: "preview"` 的调用方是否全部走源码视图回退。
- `.atw/spec/app/frontend/styling.md` 引用了 `markdown-preview` 的 DOM 预览，删除时同步改。
