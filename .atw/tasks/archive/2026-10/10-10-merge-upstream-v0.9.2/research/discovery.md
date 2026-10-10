# 合并上游 v0.9.1 / v0.9.2：现状摸底

调查日期 2026-10-10，基于 main `9010d774c`。数字来自 `git merge-tree` 模拟合并，未改动仓库。
做法沿用 `docs/release.md` 的「Fork 分发 → 从上游同步」，这里只记本次特有的事实与决定。

## 同步点与范围

- 当前同步点：上游 `v0.9.0` = `7f7e60bcb`，`git merge-base origin/main upstream/main` 给出的就是它。
- 本次分段点（上游附注 tag 对应的提交，都在上游 main 的主线上）：

| 段  | 上游发布点 | 提交        | 本段提交数 | 发布日期   |
| --- | ---------- | ----------- | ---------- | ---------- |
| 1   | v0.9.1     | `818658520` | 7          | 2026-09-22 |
| 2   | v0.9.2     | `c67b7158b` | 55         | 2026-09-24 |

- 合计 62 个提交，181 个文件，+9584 / −1243。按包：server 91、app 30、cli 11、fastlane 8、website 6、desktop 2。
- v0.9.2 之后到上游 v0.10.0（`c481ecf3e`）还有 39 个提交，不在本次范围。
- Osuna 当前版本 `0.14.2`。没有开着的 PR。

## 上游带来的内容

| 类别               | 提交                                                                                                             |
| ------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Claude             | #5200（Opus 5.5）#5326（列出 settings.json 映射的 Fable）#5206 #5240 #5285 #5289（回退对话）                     |
| 其他提供方         | #5174（Codex 导入会话）#5273 #5239（Codex）#5274（Cursor）#5296（OpenCode 权限）#3258 #5243 #5235（Pi / OMP）    |
| daemon 启动与稳定  | #5277 #5306 #5301 #5332 #5315 #5337（pid、schedules、config.json）#5170 与两个无编号提交（watcher、堆增长）      |
| 工作区与归档       | #5205 #5227 #5229 #5238 #5249 #5322 #5221 #5079                                                                  |
| 应用界面           | #5320（多选问题卡片）#5317（上传保留文件名）#5224 #5255 #5272 #5287（快捷键）#5189 #5286（侧栏、时间线）#5245    |
| 插件与 Hub         | #5231 #5253 #5298 #5302 #5248                                                                                    |
| CLI                | #5305 #5310 #5335                                                                                                |
| 其他               | #5190（目录建议扫描）#5258（MiniMax 用量）#5281（语音提示音）#5290（replica cache）                              |
| 官网               | #5219 #5297（赞助页改版，只动 `packages/website` 与四个 README）                                                 |
| 发版事务           | 2 次 cut、2 次 changelog、2 次 lockfile/Nix hash、`.gitignore` 加 `*.heapsnapshot`                               |

## 上游没有碰的地方

`git diff 7f7e60bcb c67b7158b` 逐项核对：

- `packages/protocol`：只有 `package.json` 的版本号。没有新消息、新字段。
- 新增 `COMPAT(...)` 标签：0。
- `packages/app/src/i18n`：无改动。
- 外部依赖：无增删改；根 `package.json` 只多一个脚本 `analyze:observer-metrics`。
- `packages/app/src`、`packages/cli/src` 新增的上游站点链接：0。
- `electron-builder.yml`、`desktop-release.yml`、`packages/desktop/src/main.ts`：无改动。
- `.github/workflows/ci.yml`：新增作业 `server-tests-macos`（macos-14，只跑文件观察相关的 server 测试）。
- fastlane：新增 8 个文件 `90011`–`90014`、`90021`–`90024`，与 Osuna 已有文件不重名。

## 冲突规模

| 合并到 | 冲突文件 | 机械性 | 代码 |
| ------ | -------- | ------ | ---- |
| v0.9.1 | 17       | 15     | 2    |
| v0.9.2 | 25       | 19     | 6    |

机械性 = 12 个 `package.json`、`package-lock.json`、`CHANGELOG.md`、`.gitignore`，第二段再加 4 个 README。
处理办法见 `docs/release.md`「版本号与发版元数据」；`.gitignore` 两边各加一条，都留。

代码冲突：

| 文件                                               | 冲突块 | 首次出现 | 上游提交          | Osuna 一侧                                                                   |
| -------------------------------------------------- | ------ | -------- | ----------------- | ---------------------------------------------------------------------------- |
| `providers/claude/model-manifest.ts`               | 4      | 段 1     | #5200             | `88e5c0d71` 自己加的 Opus 5.5                                                |
| `providers/claude/models.test.ts`                  | 3      | 段 1     | #5200             | 同上                                                                         |
| `app/src/components/question-form-card.tsx`        | 8      | 段 2     | #5320             | `9af4490f8` 编号行列表、单选点击即作答                                       |
| `server/agent/agent-manager.ts`                    | 4      | 段 2     | #5286 #5229       | `paseoToolsGateReason`、历史事件里的 `withoutTrailingRoutingBlock`           |
| `providers/claude/agent.ts`                        | 1      | 段 2     | #5289 #5285 #5240 | import 块：`commands.js` 的 `CLAUDE_ROOT_ONLY_BUILTIN_COMMANDS` 等           |
| `providers/claude/agent.test.ts`                   | 1      | 段 2     | 同上              | import 块                                                                    |

路径前缀：前两行与后两行在 `packages/server/src/server/agent/` 下，第三行在 `packages/` 下。

### 两处重复实现

**Opus 5.5。** 两边的清单条目只差一行：上游多了 `defaultThinkingOptionId: "medium"`。
`label`、`defaultPriority`、最低 CLI 版本 `2.1.280`、1M 上下文、档位、`supportsFastMode: true`
都相同。两边都修了"带前缀的 `claude-opus-5-5` 被截成 `claude-opus-5`"，写法不同：Osuna 提了一个
`hasOneMillionContext` 局部变量，上游内联。

测试结论相反的只有一处：`models.test.ts` 第 179–180 行，Osuna 断言 Opus 5.5 的默认思考档位是
`high`（全局默认 `CLAUDE_DEFAULT_THINKING_OPTION_ID`），上游断言 `medium`。上游提交说明：
"Claude Code 2.1.280 introduces Opus 5.5 with 1M context, medium effort, and always-on thinking"。
另外日期后缀样例两边不同（Osuna `20260926`，上游 `20260401`），以及一条用例标题不同，断言内容相同。

Osuna 独有、上游没有的断言：`us.anthropic.claude-opus-5-5` 与 `...[1m]` 解析到清单条目
（`models.test.ts` 第 504–505 行）。上游独有：`anthropic/claude-opus-5-5`、
`us.anthropic.claude-opus-5-5-20260401-v1:0` 的归一化，`2.1.280` 下默认模型是 Opus 5.5。

**问题卡片。** Osuna 重做了卡片外观与单选交互；上游 #5320 修的是多选题里已勾选项与"其他"答案
不一起提交。上游的逻辑改动在 `question-form-card-core.ts` 及其测试里，这两个文件自动合并成功；
冲突只在 `.tsx`。

## 访谈确认的决定（2026-10-10）

1. 建 ATW 任务，走中等路径。
2. 问题卡片：保留 Osuna 的外观与"单选点击即作答"，移植上游的多选修复，用测试证明多选加"其他"一起提交。
3. Opus 5.5：以上游写法为底，补回 Osuna 多出的行为（`us.anthropic.` 前缀的两条解析断言）。默认思考档位
   取上游的 `medium`；Osuna 在 `models.test.ts` 里断言 `high` 的那条改成 `medium`，在 PR 正文里写明。
   两边测试结论相反，这一条由维护者单独确认。
4. 验收减量：CI 全绿（Nix 两项除外）；dev 桌面端实测并截图四处——多选问题卡片、Claude 模型列表的
   Opus 5.5 与思考档位、Claude 回退对话、刷新智能体后时间线不重复；快速冒烟侧栏、输入框、设置页、
   终端，不逐项截图；更新源、签名、外链计数等固定项用命令核对。
5. 不发版。

照 `docs/release.md` 办、未单独问的：分支 `merge-upstream-v0.9.2` 从 main 开；两段各一个 merge commit；
第一段合完开草稿 PR；以 merge commit 并入；版本号保持 `0.14.2`；`CHANGELOG.md`、README、fastlane 归
Osuna；官网赞助页照收；原生端免验收。

## 需要留意

- `agent-manager.ts`：上游 #5286 把刷新时的历史事件改成先收集再统一处理（`historyEvents.push(event)`）。
  Osuna 在同一处对每个事件去掉末尾的 Routing block 再入时间线。合并后这一步要落在上游的新流程里，
  Osuna 现有的 Routing block 测试守着。
- `prepareSessionConfig` 的签名上游改成了选项对象（`{ env, purpose }`），Osuna 的返回值多一个
  `paseoToolsGateReason`。两边都留。
- 新作业 `server-tests-macos` 会在 fork 的 CI 上跑 macOS runner。上游是为 watcher 的 bug 加的，照收。
- 上次踩过的坑里与本次相关的：上游改旧用例的断言不会报冲突，合并后对冲突涉及的测试文件跑
  `git diff <合并前> -- <测试文件>` 找被删掉的断言行。
