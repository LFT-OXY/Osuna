# 01 — 准备：Osuna 的 Usage 代码让出上游要占的位置

**What to build:** 合并分支 `merge-upstream-v0-11-all`（从 main 开出）上有一个只挪位置、不改行为的准备提交：Osuna 的 Usage（token 与估算花费）应用侧模块搬到 `usage-stats`，服务端处理 Usage 请求的会话处理器同样改名（文件与类）。做完之后用户看到的一切照旧——Usage 页、轮次页脚的花费、价格表、`/usage` 地址——而上游在 v0.11 里要占用的那个同名目录与同名文件已经空出来，后面八段合并不再在这两处撞名。同时写下一条 ADR，说明为什么代码里的 `usage` 归上游的套餐用量、Osuna 的 Usage 代码叫 `usage-stats`、界面与术语表的叫法归 Osuna。规格见 `prd.md` 的「合并前的准备提交」「文档」。

**Blocked by:** None — can start immediately
**Status:** ready-for-agent
**Impl:** doing

- [x] 合并分支就是这个 worktree 当前的分支 `merge-upstream-v0-11-all`（Paseo 按会话标题自动改的名，与 main `802b17d8c` 同一提交），不另开分支、不再改名；任务记录里的分支名与它一致；任务目录的文件随第一个提交进入该分支。
- [x] `upstream` remote 仍配置为不抓取 tag；八个发布点（`4aa2f2817`、`8498c7416`、`6166a7aca`、`6b00310f7`、`15d774d4a`、`22488d450`、`ab10a6694`、`759532509`）都已在本机；本地 tag 列表与开工前相同。
- [x] Osuna 的 Usage 应用侧模块位于 `usage-stats`，原目录下不再有 Osuna 的文件；所有引用已改到新位置。
- [x] 服务端处理 Usage 请求的会话处理器已改名（文件与类），原文件名空出。
- [x] 没有改名的东西确实没动：Usage 的组件目录、服务端的统计服务、协议里的 Usage 消息、`features.usage`、`/usage` 路由、界面文案键。
- [x] 提交只含移动与引用改动：除导入路径与类名外没有行为差异。
- [x] Usage 的全部现有测试（应用侧、服务端、协议）逐个文件跑过并通过，无一改动断言；改动只有导入路径。
- [x] 改名后对上游 `759532509` 重新做一次模拟合并：原来的目录撞名、服务端同名文件的冲突不再出现；`format` 两个文件不再是三样东西挤在一个路径上，但仍以套餐用量自身的冲突留在清单里，归 02。新的冲突文件数与清单记在 `## Comments` 下，作为 02 的起点。（2026-10-11 按实测改写。原文是「原来的目录撞名、`format` 两个同名文件的冲突、服务端同名文件的冲突不再出现」；`format` 那两处只要不动套餐用量就消不掉，见 Comments。）
- [x] 新 ADR 已写：决定、被否掉的三种做法（界面只留 Osuna 的、全用上游的、两边共用一个目录）与原因。按 `docs/adr/` 现有的格式与编号。
- [x] typecheck 与 lint 通过。
- [x] dev 桌面端打开 Usage 页与一个有历史的智能体：页面有数据，轮次页脚有花费，无报错。

## Comments

### 2026-10-11 实施记录

**分支与任务记录。** 合并分支是这个 worktree 的 `merge-upstream-v0-11-all`，开工时与 main 同为 `802b17d8c`；`task.json` 的 `branch` 与它一致，`implementation_base_sha` 为 `802b17d8c`。任务目录随本提交进入分支。

**上游与 tag。** `upstream` 的 `tagOpt` 是 `--no-tags`，fetch 只有 `+refs/heads/*`。八个发布点都已在本机（`git cat-file -t` 逐个为 commit）。本地 tag 开工前后都是 14 个，列表逐行相同。

**搬了什么。**

- 应用侧：`packages/app/src/usage/`（34 个文件）→ `packages/app/src/usage-stats/`。34 个文件内容逐字节相同（git 判为 R100）。引用它的 34 个文件里 79 处 `@/usage/…` 改成 `@/usage-stats/…`；其中 5 个文件的 import 因变长被格式化工具折行，去掉空白与逗号后与改路径前逐字相同。
- 服务端：`session/usage/usage-session.ts` → `session/usage-stats/usage-stats-session.ts`。`UsageSession`、`UsageSessionHost`、`UsageSessionOptions`、`CreateUsageSessionOptions`、`createUsageSession` 各加上 `Stats`。`session.ts` 里的字段与局部变量 `usageSession` 同样改成 `usageStatsSession`：上游在 `session.ts` 里也有一个 `private readonly usageSession: UsageSession`，不改会在合并后重名。处理各消息的方法名（`handleUsageSessionsListRequest` 等）没动。
- 新目录用 `session/usage-stats/` 而不是把文件留在 `session/usage/` 下改名：上游在 `session/usage/` 里还有 `usage-session.test.ts`，整个目录让给上游。

**没动的。** `components/usage/`、`server/usage/`、`protocol/src/usage/`、`usage.*` 消息、`features.usage`、`/usage` 路由、文案键。

**测试（改名前后各跑一遍，文件数与用例数相同，断言零改动）。**

| | 文件 | 用例 |
| --- | --- | --- |
| app：`usage-stats/`、`price-table/`、`provider-usage/` 的单元测试 | 21 | 230 |
| app：`turn-usage-panel.browser.test.tsx`（browser 项目，仅改名后） | 1 | 11 |
| server：`server/usage/`、`usage/pricing/`、`daemon-e2e/usage-*.e2e.test.ts` | 14 | 112 |
| protocol：`messages.usage.test.ts` | 1 | 18 |

测试文件的改动只有导入路径（`price-table/pricing.test.ts`、`price-table/view.test.ts`、`provider-usage/format.test.ts`、`strip.test.ts`、`view.test.ts`、`turn-usage-panel.browser.test.tsx`）。全仓 typecheck、全仓 lint 通过。

**ADR。** `docs/adr/0006-usage-in-code-is-upstream-plan-usage.md`。

**dev 桌面端。** `npm run build:server` 后以 `.dev/paseo-home`、6769 启动。Usage 页：总 token、估算花费、统计面板、热力图、明细（82 行）、来源卡片（23 张）、套餐用量卡片都有数据，没有主机错误条。打开一个有历史的 Claude 智能体：轮次页脚显示 `· ↑2 ↓529 · $0.11`，Composer 用量条在。渲染进程没有 console error 与未捕获异常，`daemon.log` 没有 error 级日志。截图带真实用量数字，没有入库。

**改名后的模拟合并（`git merge-tree`，对 `759532509`）。** 冲突文件 150 → 149。

- 不再出现：`packages/server/src/server/session/usage/usage-session.ts`（原 add/add）。合并结果里上游的 `usage-session.ts`、`usage-session.test.ts` 与 Osuna 的 `usage-stats/usage-stats-session.ts` 并存。
- 目录撞名不再出现：Osuna 的 34 个文件在合并结果的 `usage-stats/` 下原样存在，上游的文件独占 `app/src/usage/`。
- `app/src/usage/format.ts` 与 `format.test.ts` **仍在冲突清单里，原因变了**。改名前是三样东西挤在一个路径上（Osuna 的用量统计 `format`、Osuna 改过的 `provider-usage/format`、上游改名并重写的 `format`），git 报 `rename involved in collision`、`implicit dir rename`，并提示可能出现嵌套的冲突标记。改名后只剩 Osuna 的 `provider-usage/format.ts`（Osuna 相对基点 +101 −29）对上游的重写，是普通的 `content` 冲突；`format.test.ts` 是 Osuna 新增的 `provider-usage/format.test.ts` 被 git 的目录改名检测挪进 `usage/` 后与上游新增的同名测试 add/add。这两处是套餐用量自己的冲突，按 PRD「套餐用量」在 02 里取上游的。
- 其余 `app/src/usage/` 下的 8 个条目（`balance-bar.tsx`、`strip*.ts(x)`、`use-provider-usage-hosts.ts`、`use-provider-usage.test.ts`、`view*.ts`）同样是 Osuna 的 `provider-usage/` 文件对上游目录改名的 `file location` / `rename/delete`，与本工单的撞名无关。

冲突类型：content 119、modify/delete 17、file location 8、add/add 6、rename/delete 2。按位置：`packages/app` 82、`packages/server` 39、`docs/` 6、`fastlane/metadata` 4、`packages/cli` 3、`packages/client` 2、`packages/protocol` 2，其余各 1（`.github/workflows`、`CHANGELOG.md`、`README.md`、`package.json`、`package-lock.json`、`packages/desktop`、`packages/expo-two-way-audio`、`packages/highlight`、`packages/plugin`、`packages/relay`、`packages/website`）。

这是最终发布点对当前分支的累计数；02 合的是 `4aa2f2817`，实际清单以那次合并为准。

**评审（Standards 与 Spec 两个维度，本工单不改界面，没有 Visual）。** 两边都没有发现行为差异或被改动的断言。修掉的：`.atw/spec/app/frontend/hooks-and-data.md` 里 4 处仍写 `usage/…` 的路径改成 `usage-stats/…`；ADR 里重述术语表的一句改成链接；删掉空目录 `session/usage/`。按实测改写了上面模拟合并那条验收项。留给后面的：ADR 0006 还没有从别的文档链入，`docs/glossary.md` 与 `docs/release.md` 都在冲突清单里，记进了 15 的验收项。没有改的判断项：`usage-stats` 这个名字与统计面板的 `UsageStatsCard`、`stats.ts` 重叠，`UsageStatsSession` 里的方法与服务仍叫 `Usage…`，都是「只挪两处撞名」的直接结果，ADR 0006 已写明。

<details>
<summary>149 个冲突文件</summary>

```
.github/workflows/deploy-website.yml
CHANGELOG.md
README.md
docs/custom-providers.md
docs/design.md
docs/explorer-sidebar.md
docs/glossary.md
docs/providers.md
docs/release.md
fastlane/metadata/android/en-US/changelogs/110001.txt
fastlane/metadata/android/en-US/changelogs/110002.txt
fastlane/metadata/android/en-US/changelogs/110003.txt
fastlane/metadata/android/en-US/changelogs/110004.txt
package-lock.json
package.json
packages/app/e2e/browser/file-editing.spec.ts
packages/app/e2e/browser/provider-usage-tooltip.spec.ts
packages/app/e2e/browser/usage-page-plan-usage.spec.ts
packages/app/e2e/support/helpers/explorer-plugin-menu.ts
packages/app/e2e/support/helpers/provider-usage.ts
packages/app/package.json
packages/app/src/appearance/apply.test.ts
packages/app/src/appearance/apply.ts
packages/app/src/appearance/provider.tsx
packages/app/src/components/adaptive-modal-sheet.tsx
packages/app/src/components/add-host-modal.tsx
packages/app/src/components/add-project-flow.tsx
packages/app/src/components/context-window-meter.tsx
packages/app/src/components/left-sidebar.tsx
packages/app/src/components/message.tsx
packages/app/src/components/model-browser.tsx
packages/app/src/components/provider-diagnostic-sheet.tsx
packages/app/src/components/provider-icons.test.ts
packages/app/src/components/provider-icons.ts
packages/app/src/components/schedules/schedule-row.tsx
packages/app/src/components/sidebar/project-leading-visual.tsx
packages/app/src/components/sidebar/sidebar-header-row.tsx
packages/app/src/components/sidebar/sidebar-help-menu.tsx
packages/app/src/components/sidebar/sidebar-nav-rows.tsx
packages/app/src/components/sidebar/sidebar-separator.tsx
packages/app/src/composer/agent-controls/index.tsx
packages/app/src/composer/agent-controls/model-sheet.tsx
packages/app/src/composer/agent-controls/utils.test.ts
packages/app/src/composer/agent-controls/utils.ts
packages/app/src/composer/index.tsx
packages/app/src/composer/input/input.tsx
packages/app/src/contexts/session-context.tsx
packages/app/src/git/pull-request-panel/checks-section.tsx
packages/app/src/git/pull-request-panel/checks-summary.test.ts
packages/app/src/git/pull-request-panel/checks-summary.ts
packages/app/src/git/pull-request-panel/data.test.ts
packages/app/src/git/pull-request-panel/data.ts
packages/app/src/hooks/use-agent-autocomplete.ts
packages/app/src/hooks/use-settings/storage.test.ts
packages/app/src/hooks/use-settings/storage.ts
packages/app/src/hosts/host-confirmation-sheet.tsx
packages/app/src/i18n/resources.test.ts
packages/app/src/i18n/resources/ar.ts
packages/app/src/i18n/resources/en.ts
packages/app/src/i18n/resources/es.ts
packages/app/src/i18n/resources/fr.ts
packages/app/src/i18n/resources/ja.ts
packages/app/src/i18n/resources/ko.ts
packages/app/src/i18n/resources/pt-BR.ts
packages/app/src/i18n/resources/ru.ts
packages/app/src/i18n/resources/zh-CN.ts
packages/app/src/plugins/surface-screen.tsx
packages/app/src/plugins/workspace-panels/panel.tsx
packages/app/src/provider-usage/card.tsx
packages/app/src/provider-usage/list.tsx
packages/app/src/provider-usage/tone.ts
packages/app/src/provider-usage/tooltip-section.tsx
packages/app/src/provider-usage/types.ts
packages/app/src/provider-usage/use-provider-usage.ts
packages/app/src/runtime/host-runtime.test.ts
packages/app/src/runtime/host-runtime.ts
packages/app/src/screens/settings-screen.tsx
packages/app/src/screens/settings/appearance/appearance-section.tsx
packages/app/src/screens/settings/host-page.tsx
packages/app/src/screens/settings/providers-section.tsx
packages/app/src/screens/settings/sidebar/sidebar-nav-section.tsx
packages/app/src/screens/workspace/explorer-sidebar-tab-rail.tsx
packages/app/src/screens/workspace/explorer-sidebar.tsx
packages/app/src/sidebar-nav/model.ts
packages/app/src/styles/theme.ts
packages/app/src/terminal/runtime/terminal-emulator-runtime.browser.test.ts
packages/app/src/terminal/webview/terminal-emulator-webview-html.ts
packages/app/src/usage/balance-bar.tsx
packages/app/src/usage/format.test.ts
packages/app/src/usage/format.ts
packages/app/src/usage/strip-gauge.tsx
packages/app/src/usage/strip.test.ts
packages/app/src/usage/strip.ts
packages/app/src/usage/use-provider-usage-hosts.ts
packages/app/src/usage/use-provider-usage.test.ts
packages/app/src/usage/view.test.ts
packages/app/src/usage/view.ts
packages/cli/package.json
packages/cli/src/commands/daemon/lifecycle.e2e.test.ts
packages/cli/tests/15-provider.test.ts
packages/client/package.json
packages/client/src/daemon-client.ts
packages/desktop/package.json
packages/expo-two-way-audio/package.json
packages/highlight/package.json
packages/plugin/package.json
packages/protocol/package.json
packages/protocol/src/messages.ts
packages/relay/package.json
packages/server/package.json
packages/server/src/server/agent/agent-prompt.ts
packages/server/src/server/agent/provider-registry.test.ts
packages/server/src/server/agent/provider-registry.ts
packages/server/src/server/agent/provider-snapshot-manager.ts
packages/server/src/server/agent/providers/claude/agent.test.ts
packages/server/src/server/agent/providers/claude/agent.ts
packages/server/src/server/agent/providers/claude/models.test.ts
packages/server/src/server/agent/providers/codex-app-server-agent.test.ts
packages/server/src/server/agent/providers/codex-app-server-agent.ts
packages/server/src/server/agent/providers/codex/rewind.ts
packages/server/src/server/agent/providers/cursor-acp-agent.ts
packages/server/src/server/agent/providers/generic-acp-agent.commands.test.ts
packages/server/src/server/agent/providers/generic-acp-agent.ts
packages/server/src/server/agent/providers/kiro-acp-agent.ts
packages/server/src/server/agent/providers/omp/agent.ts
packages/server/src/server/agent/providers/omp/host-tools.ts
packages/server/src/server/agent/providers/omp/provider-config.ts
packages/server/src/server/agent/providers/omp/session-descriptor.test.ts
packages/server/src/server/agent/providers/omp/session-descriptor.ts
packages/server/src/server/agent/providers/omp/tool-call-mapper.test.ts
packages/server/src/server/agent/providers/opencode/v2/agent.test.ts
packages/server/src/server/agent/providers/opencode/v2/turns.ts
packages/server/src/server/agent/providers/pi/agent.ts
packages/server/src/server/agent/providers/pi/extensions/subagent-fixture-test.ts
packages/server/src/server/agent/providers/pi/history-mapper.ts
packages/server/src/server/agent/providers/trae-acp-agent.ts
packages/server/src/server/authorization/operation-permissions.ts
packages/server/src/server/config.ts
packages/server/src/server/session.ts
packages/server/src/server/session/daemon/daemon-self-updater.test.ts
packages/server/src/server/session/daemon/daemon-self-updater.ts
packages/server/src/server/session/daemon/install-origin.ts
packages/server/src/server/session/daemon/npm-global-cli.test.ts
packages/server/src/server/session/daemon/npm-global-cli.ts
packages/server/src/server/session/provider/provider-catalog-session.test.ts
packages/server/src/server/session/provider/provider-catalog-session.ts
packages/server/src/server/test-utils/paseo-daemon.ts
packages/server/src/server/websocket-server.ts
packages/website/package.json
```

</details>
