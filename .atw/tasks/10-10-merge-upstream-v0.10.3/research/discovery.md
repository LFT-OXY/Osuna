# 合并上游 v0.10.0 – v0.10.3：现状摸底

调查日期 2026-10-10，基于 main `56cccc196`。数字来自 `git merge-tree` 模拟合并，未改动仓库。
做法沿用 `docs/release.md` 的「Fork 分发 → 从上游同步」，这里只记本次特有的事实与决定。

## 同步点与范围

- 当前同步点：上游 `v0.9.2` = `c67b7158b`，`git merge-base HEAD upstream/main` 给出的就是它。
- 本次分段点（上游附注 tag 对应的提交）：

| 段  | 上游发布点     | 提交        | 本段提交数 | 文件数 | 发布日期   | 在上游 main 上           |
| --- | -------------- | ----------- | ---------- | ------ | ---------- | ------------------------ |
| 1   | v0.10.0-beta.1 | `52d345db7` | 33         | 255    | 2026-09-27 | 是                       |
| 2   | v0.10.0        | `c481ecf3e` | 6          | 27     | 2026-09-28 | 是                       |
| 3   | v0.10.1        | `c5236c00d` | 12         | 50     | 2026-09-29 | 否，`release/0.10.1`     |
| 4   | v0.10.2        | `919c737c1` | 7          | 32     | 2026-09-30 | 否，`release/0.10.2`     |
| 5   | v0.10.3        | `b4af508e2` | 4          | 44     | 2026-10-02 | 否，`hotfix/0.10.3`      |

- 合计 62 个提交。Osuna 当前版本 `0.14.2`，上游外部依赖只新增 `@opencode/client 2.0.10`。
- 上游已到 v0.11.2，不在本次范围。

## 补丁分支

v0.10.1 – v0.10.3 在上游从 v0.10.0 分出的补丁分支上，互为祖先链（0.10.0 < 0.10.1 < 0.10.2 < 0.10.3），
但都不是 `upstream/main`、v0.11.0-beta.1、v0.11.0 的祖先；与 v0.11.0 的 merge-base 是 `c481ecf3e`（v0.10.0）。

`git cherry upstream/main b4af508e2 c481ecf3e`：补丁分支上的功能提交在主线上都有内容等价的提交，
例外是 `9f387873b`（#5587，主线上是 `940dbfd24`，上下文不同）与各次 `chore(release): cut` 及 0.10.3 的 changelog 提交。

后果：

- 并入后 `git merge-base main upstream/main` 给出 v0.10.0，不再等于同步点。`docs/release.md` 里那句自检要改成
  `git merge-base --is-ancestor <同步点> main`。
- 以后合 v0.11 时，上游补丁分支与主线分叉处会再冲突一次。上游自身 `b4af508e2` 对 `22488d450`（v0.11.0）
  的模拟合并，除版本号类文件外冲突 9 个代码文件：`file-editing.spec.ts`、`adaptive-modal-sheet.tsx`、
  `i18n/resources/fr.ts`、`host-runtime.test.ts`、`provider-registry.ts`、`codex-app-server-agent.ts` 及其测试、
  `codex/rewind.ts`、`opencode/v2/agent.test.ts`、`opencode/v2/turns.ts`。裁决固定：上游部分取主线一侧。

## 模拟合并的冲突

累计冲突文件数：beta.1 43，v0.10.0 47，v0.10.1 54，v0.10.2 54，v0.10.3 55。

机械性 22 个：`CHANGELOG.md`、`package-lock.json`、12 个 `package.json`、8 个安卓商店说明
（`100001`–`100004`、`100011`–`100014`，与 Osuna 同名）。

代码与文档 33 个（冲突块数 / 冲突行数）：

| 区域         | 文件                                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------------------- |
| 设置页       | `settings-screen.tsx` 17/410、`appearance-section.tsx` 8/218、`host-appearance-section.tsx` 3/18、`components/settings/index.tsx` 1/4、`provider-usage/settings-section.tsx`（内容无冲突块） |
| 通用控件     | `ui/alert.tsx` 4/228、`ui/dropdown-trigger.tsx` 3/168、`ui/control-geometry.ts` 5/56 及测试 1/45、`sidebar-header-row.tsx` 3/90、`adaptive-modal-sheet.tsx` 1/5 |
| 指令列表     | `agent-commands-query.ts` 1/13 及测试 1/21、`generic-acp-agent.ts` 1/7、`opencode-agent.ts` 1/20         |
| Pi           | `pi/agent.ts` 1/23 及测试 1/114、`pi/tool-call-mapper.ts` 1/72 及测试 1/96、`pi/history-mapper.ts` 1/8、`pi/rpc-types.ts` 1/5 |
| OpenCode     | `opencode/bridge.ts` 1/53 及测试 2/225                                                                   |
| Claude       | `claude/agent.ts` 1/24 及测试 1/7、`claude/models.ts` 1/7                                                |
| Codex        | `codex-app-server-agent.ts` 3/93、`provider-registry.test.ts` 1/52                                       |
| 其他         | `i18n/resources/zh-CN.ts` 1/7、`e2e/browser/file-editing.spec.ts` 1/7、`e2e/support/helpers/agent-profiles.ts` 1/49、`docs/glossary.md` 1/8、`docs/providers.md` 1/7 |

两边各是哪些提交：

- 设置页与通用控件：上游 `d7b7016cc`（#5459 设置重组）与 `e1c769c01`（#5393 密码）；Osuna `f8e980a85`、
  `b91e6a3ca`、`8377ff61b`（新外观）、`38ac3a4f5` `57617df2f` `accd7aa08`（终端字体、字体选择器、预览）、
  Providers 两级页与桌面更新卡片。
- Pi：上游 `c081e0350`（#5309 按扩展的适配器）；Osuna `86475c4ec`（工具名规范为 `paseo.create_agent`）、
  `2838a4c53`（隐藏 `display:false` 的 custom 消息）。
- OpenCode bridge：上游 `c906c2f4a`（#5198 v2）；Osuna `86475c4ec`。
- Claude：上游 `76a9781ba`（#5437 从 provider 自己的配置目录读历史）；Osuna 的已装版本与一键升级。
- Sonnet 5.5（`12cd5345d`）Osuna 没有自己加过，无重复实现。

## 上游触及的敏感区域

- 协议包 7 个文件 +120 / −3。
- 翻译资源 9 个文件 +218 / −42。
- 新带入 `COMPAT(...)`：`connectionPassword`、`headerAuth`、`relayPasswordOptional`（写的是上游版本号 v0.9.1，按
  「合并后核对」改写）。
- 桌面打包与工作流：只动了 `packages/desktop/package.json`。

## 设置页重组（#5459）

上游栏目由 `general / appearance / layout / editor / …` 变为
`general / appearance / sidebar / chat / terminal / browser / editor / …`，主机侧栏目不变。

| 设置项                                         | Osuna 现在   | 上游 v0.10.3                 |
| ---------------------------------------------- | ------------ | ---------------------------- |
| 聊天大纲、详情级别、自动展开思考、工具调用详情 | 外观         | 聊天                         |
| 终端回滚行数                                   | 通用         | 终端                         |
| 默认发送方式                                   | 通用         | 通用 →「发送」分组           |
| 侧栏条目顺序                                   | 外观         | 侧边栏                       |
| 在侧边窗格打开、服务 URL                       | 布局 / 通用  | 「打开位置」分组             |
| 浏览器数据                                     | —            | 浏览器（仅桌面）             |
| 终端字体、终端字号（Osuna 独有）               | 外观 → 字体  | 无                           |
| 系统字体选择器、字号重置、终端预览、深浅色配对 | 外观         | 无                           |

## 指令列表与 ADR 0003

Osuna 的 `AgentManager.listCommands` 走指令目录（`command-catalog.ts`），草稿没有会话，不调 provider。
上游的 `listDraftCommands` 为草稿建一个会话取完列表再关掉。

- `generic-acp-agent.ts`：上游加 `waitForInitialCommands`，首次 `listCommands()` 等 `available_commands_update`。
- `opencode-agent.ts`：上游 `listCommands()` 先 `reconnectIfServerExited()`；Osuna 只用已持有的 server，
  并在每轮上报 `commands_changed`。
- `agent-commands-query.ts`：查询键 Osuna 加了 `cwd`，上游加了 mode / model / thinking / features。
  （实施工单 01 时对照基点更正：这四个字段是基点原有的，Osuna 在 `de65b2445` 有意去掉；上游只把 `cwd` 提到了键的前缀。裁决见工单 01 的 `## Comments`。）
- Osuna 指令目录来自 4 个提交：`20c80c8fa`、`7360f4787`、`9b070b645`、`de65b2445`。

## OpenCode v2

- 上游按 `opencode --version` 选路径：1.x 走旧路径，2.x（≥ 2.0.10）走 `opencode/v2/`。
- 本机 `opencode` 是 1.15.10。
- Osuna 加在旧路径上的行为，`opencode/v2/` 里没有：`paseo.create_agent` 工具名规范、
  `providerSubagentId` 权限归属。指令目录上报、已装版本、一键升级是否覆盖 v2 待实施时核实。
- Osuna 现有代码只依赖 `@opencode-ai/sdk 1.14.46`。上游提交说明写明 2.0.4 起移除了 `/api/health` 等端点，
  据此推断 Osuna 现在配 2.x 不可用，未实测。

## 访谈确认的决定（2026-10-10）

1. 四个版本都合，接受以后合 v0.11 时在补丁分支分叉处再解一次，并写进 `docs/release.md`。
2. 设置页分栏跟上游，外观保持 Osuna 的。Osuna 独有的终端字体、终端字号留在「外观」的字体分组；
   其余 Osuna 独有项（系统字体选择器、字号重置、终端预览、深浅色配对）本来就在「外观」，不动。
3. 指令列表保持 Osuna 现有做法，ADR 0003 不变（维护者先选了取上游，了解范围后改回）。上游的两处改动不收：
   `generic-acp-agent.ts` 的 `waitForInitialCommands`（#5411）与 `opencode-agent.ts` 里 `listCommands()` 前的
   `reconnectIfServerExited()`。PR 正文写明这两处没有收以及原因。
4. OpenCode v2 上缺的 Osuna 行为这次不补，PR 正文列清缺口，另开后续任务。
5. 建任务 `merge-upstream-v0.10.3`，同名分支，五段，一个 PR，merge commit。
6. 不发版，版本号保持 `0.14.2`。

7. ADR 0003 对 OpenCode v2 路径同样适用：实施时核实 v2 取指令列表是否会起进程，会就在本次改掉。
   v2 不向指令目录上报 `commands_changed`（草稿菜单因此一直是 partial）属于第 4 条的缺口，不在本次补。
8. 验收证据：
   - CI 全绿，已知红灯 Nix / Nix Update Hash 除外。
   - 开发版桌面端实测截图：新分栏下的通用、外观（含终端字体）、侧边栏、聊天、终端、浏览器各页；
     带密码主机的密码提示；配对新主机前的确认框；新会话的 `/` 菜单；模型列表里的 Sonnet 5.5。
   - `docs/release.md`「合并后核对」逐项过：桌面身份与数据目录、更新源、签名、外链数、翻译键、`COMPAT` 标签。
   - 不做：原生端实测、OpenCode 2.x 实测（本机 1.15.10）、Pi 扩展实测、任何 provider 登录、安装包。
9. PR 的合并由维护者发话；收尾（勾工单、归档、journal）在合并之前做完，因为合并后 worktree 会被自动归档。
10. 实施中遇到两条裁决规则互相矛盾、或保留两边会改变用户可见行为时停下来问维护者。

## 未决

无。访谈于 2026-10-10 结束，维护者逐条确认。
