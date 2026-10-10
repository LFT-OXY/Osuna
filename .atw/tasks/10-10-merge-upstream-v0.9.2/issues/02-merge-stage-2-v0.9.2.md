# 02 — 第二段：合并到上游 v0.9.2

**What to build:** 合并分支上再多一个把上游 `c67b7158b`（v0.9.2，v0.9.1 之后的 55 个提交）合进来的 merge commit。合完之后 Osuna 多出上游这一段的全部修复——daemon 启动与稳定性、Claude 对话回退、多步快捷键、归档与工作区、插件、CLI——并且多选问题卡片里勾选项与「其他」答案一起提交。问题卡片的外观与单选题「点击即作答」保持 Osuna 的样子；刷新智能体后时间线不重复，历史消息末尾仍不显示 Routing block。规格见 `prd.md` 的「合并方式」「冲突裁决 → 问题卡片」及其后的四个文件、「版本号与发版元数据」「CI 与官网」「UI and Design」；冲突清单见 `research/discovery.md`。

**Blocked by:** 01
**Status:** ready-for-agent
**Impl:** done

- [x] 合并分支包含一个以合并前的分支头与 `c67b7158b` 为双亲的 merge commit；抓取上游后分支与上游 main 的共同祖先是 `c67b7158b`。
- [x] 每个冲突文件怎么裁的、依据哪条规则，逐个记在 `## Comments` 下，供 03 写 PR 正文用。规则裁决不了的冲突没有自行取舍：已停下来问过维护者，问答记在 `## Comments` 下。
- [x] 问题卡片以 Osuna 的卡片为底：多选题先勾选项再填「其他」、或先填「其他」再勾选项，两者都保留；提交内容为勾选项标签在前、「其他」文本在后，以 `, ` 连接。
- [x] 上游新增的卡片浏览器测试里多选的两条用例原样在 Osuna 的卡片上通过。
- [x] 上游卡片浏览器测试里单选的用例，与「点击即作答」矛盾之处按 Osuna 的行为改写；改写后仍覆盖「单选题里选项与『其他』互相替换」。改了哪几条、改前改后各断言什么，记在 `## Comments` 下。
- [x] 问题卡片纯逻辑模块的测试通过，Osuna 原有的用例一条不少。
- [x] 智能体管理：上游"刷新时先收集历史事件再统一处理"的流程与会话配置准备的选项对象参数照收；Osuna 的两件事落在新流程里——历史事件入时间线前去掉末尾的 Routing block，会话配置准备仍返回 Paseo 工具门控原因。
- [x] Routing block 的现有测试（去尾逻辑的单元测试、智能体管理的测试、提及路由的 daemon e2e）全部通过，无一改动断言。
- [x] Claude 会话及其测试的 import 冲突两边都保留；Claude 会话的测试与上游新增的回退锚点测试通过。
- [x] 所有工作区版本号仍是 `0.14.2`；`packages/server/package.json` 多出上游的一个脚本（`analyze:observer-metrics`），此外各 `package.json` 与合并前相同；`package-lock.json` 重新生成后与合并前逐字节相同。
- [x] `CHANGELOG.md` 与合并前逐字节相同；四个 README 的冲突块取 Osuna 的；上游新增的八个安卓商店说明文件照收。
- [x] 上游在 CI 里新增的 macOS 文件观察作业在；官网赞助页的改动只落在官网包里。
- [x] `docs/release.md`「合并后核对」逐项过完，结果记在 `## Comments` 下：更新源、桌面身份与数据目录、签名与签名断言、只手动触发的部署工作流、上游站点链接数不多于 01 的基线、翻译键、`COMPAT(...)` 标签。任何一项有变化都已查清原因。
- [x] 上游在设置界面新带来的用户可见英文（若有）已改走翻译键，九种语言齐全。
- [x] 对本段冲突涉及的测试文件对比合并前后，没有 Osuna 的断言行被悄悄删掉；Osuna 原有的测试没有被删除、跳过或放宽断言。
- [x] typecheck 和 lint 通过；本段每个代码冲突文件对应的测试文件单独跑过并通过。两边都改过、git 自动合上的应用文件（快捷键、replica cache）补跑对应测试。
- [x] 已推送，草稿 PR 上本段的 CI 结果记在 `## Comments` 下；因合并引起的失败已修复，已知偶发失败已重跑。
- [x] UI：聊天 / 多选问题卡片，勾选两个选项并在「其他」里填了文字 / 桌面 1280——卡片仍是编号行列表，勾选状态与「其他」里的文字同时可见。
- [x] UI：聊天 / 上一条的问题提交之后 / 桌面 1280——显示的回答同时含勾选项与「其他」的文字。
- [x] UI：聊天 / 单选问题卡片 / 桌面 1280——点击某个选项即完成作答，不出现额外的提交步骤。
- [x] 截图存入任务目录的 `screenshots/`。

## Comments

### 2026-10-10 第二段处理记录

合并前分支头 `43f9827c7`，merge commit `381896b91`，双亲 `43f9827c7` 与 `c67b7158b`。
抓取上游后 `git merge-base HEAD upstream/main` = `c67b7158b`。合并前后 `git tag` 都是 14 个，逐行相同。
冲突之外的适配单独提交在 `d5dcb2916`。

**冲突裁决（22 个文件：机械性 18 + 代码 4）。** 模拟合并的累计数字是 19 + 6，第一段已解掉
`.gitignore` 与两个模型清单文件，与实际一致。

| 文件 | 裁决 | 依据 |
| ---- | ---- | ---- |
| 12 个 `package.json`（根目录与 11 个工作区） | 冲突块（版本号与 `@getpaseo/*` 内部依赖版本）取 Osuna 的，冲突块之外保持自动合并的结果。上游本段除版本号外只加了一行：`packages/server/package.json` 的脚本 `analyze:observer-metrics`，照收。其余 11 个文件与合并前逐字节相同 | 版本号与发版元数据 |
| `package-lock.json` | 冲突块取 Osuna 的，再用 `npm install --package-lock-only --ignore-scripts` 重新生成；`cmp` 与合并前逐字节相同 | 同上 |
| `CHANGELOG.md` | 冲突块取 Osuna 的；`cmp` 与合并前逐字节相同 | 同上 |
| 4 个 README（`README.md`、`.ja`、`.ko`、`.zh-CN`） | 冲突块取 Osuna 的（上游在同一位置加了 Sponsors 与 Related projects 段落）。四个文件与合并前相同 | 同上 |
| `app/src/components/question-form-card.tsx` | 8 个冲突块全部取 Osuna 的，再改两处，见下「问题卡片」 | 规则 1（Osuna 的卡片外观与单选交互），维护者已确认以 Osuna 的卡片为底 |
| `server/agent/agent-manager.ts` | 4 个冲突块两边都留，见下「智能体管理」 | 规则 3 |
| `providers/claude/agent.ts` | import 块两边都留：上游的 `type ClaudeRewindSdk`（`./rewind.js`），Osuna 的 `./commands.js` 三个导入 | 规则 3 |
| `providers/claude/agent.test.ts` | import 块两边都留：上游的 `AgentPromptInput`、`AgentAttachment`、`buildAgentPrompt` / `renderPromptAttachmentAsText`，Osuna 的 `AgentSlashCommand`、`CLAUDE_ROOT_ONLY_BUILTIN_COMMANDS` | 规则 3 |

`prd.md` 与 `discovery.md` 原先写的「根 `package.json` 多出一个脚本」不准：脚本在
`packages/server/package.json`，根 `package.json` 与合并前逐字节相同。`prd.md` 已改。

**规则裁决不了、问过维护者的两处（2026-10-10）。**

1. 问：Osuna 现有用例 `typed other text and preset options replace each other` 用一道多选题断言「选项与
   『其他』互相替换」，与已定的「多选题两者都保留」相反，`prd.md` 又规定 Osuna 的断言结论只许改 Opus 5.5
   那一条。答：**按原决定，改这条测试**——多选题两者都保留；该用例改用单选题断言互相替换，另加一条多选题
   两者都保留的用例。这是本次第二处改动 Osuna 既有断言结论的地方。
2. 问：上游两条多选浏览器用例直接往「其他」输入框打字，Osuna 的卡片要先点开「其他...」行才有输入框，原样跑
   找不到输入框。答：**只改测试的辅助步骤**——两条用例正文不改，辅助函数 `type` 加一步「输入框没出现就先
   点开『其他...』行」；卡片外观不变。工单验收项里的「原样」按这个口径理解。

**问题卡片。**

- 组件 `.tsx`：以合并前的 Osuna 文件为底。上游对这个文件的改动全部是多选修复本身（`otherInputRef`、
  `toggleOption` / `setOtherText` 里的分支），Osuna 的卡片没有这些函数，状态在纯逻辑模块里，所以不逐块搬。
  相对合并前只改两处：`handlePickOption` 里把「收起『其他』输入行」挪到单选分支（多选题勾选项时输入行
  不动）；`handleActiveTextChange` 把题目列表传给 `setQuestionOtherText`。上游用 ref 清空输入框的那一步
  不需要：Osuna 的单选题点选项后输入行直接收起、卸载，屏幕上不会留旧文字。
- 纯逻辑模块 `question-form-card-core.ts`：上游对 `buildQuestionFormAnswers` 的改动已自动合并（多选题
  「勾选项标签, 其他」）。另改 Osuna 的两个状态函数：`pickQuestionOption` 在多选题里不再清掉「其他」的
  文字；`setQuestionOtherText` 多一个 `questions` 参数，多选题里不再清掉勾选项。单选题两个方向仍互相替换。
- 纯逻辑测试 `question-form-card-core.test.ts`：合并前 Osuna 19 条，现在 22 条 = 19 + 上游 2 条 + 新增 1 条，
  Osuna 的用例一条不少。改动：
  - `typed other text and preset options replace each other` → 标题加 `on a single-select question`，夹具
    `multiSelect: true` → `false`，三条断言原样（输入后选择清空、再选后文字清空、答案为 `A`）。
  - 新增 `typed other text and checked options are kept together on a multi-select question`：先勾后填
    得 `B, custom`，先填后勾得 `A, custom`。
  - 5 处 `setQuestionOtherText(...)` 调用补上 `questions` 参数，断言不变。
- 浏览器测试 `question-form-card.browser.test.tsx`（上游新增）：
  - 多选两条 `keeps checked options when the other answer is typed afterwards` 与
    `keeps the typed other answer when options are checked afterwards`：`it(...)` 正文与上游逐字相同，通过。
  - 辅助函数：`type` 先点开 `question-form-other-option`；`mountCard` 可带后续题目；加 `option`、
    `queryOtherInput`、`press`、`showQuestion`、`respondCount`。
  - 单选 `replaces the selected option with the typed other answer`。改前：选 Codex → 输入 OpenCode → 点
    Submit → 答案 `{ Provider: "OpenCode" }`。Osuna 的单选题点选项即作答，没有「选完未提交」的状态，所以
    改后挂两道题：选 Codex（跳到第二题）→ 回到第一题，断言 Codex 为选中 → 输入 OpenCode，断言 Codex 变为
    未选中 → 点 Next → 第二题选 Now → 答案 `{ Provider: "OpenCode", Rollout: "Now" }`。
  - 单选 `clears the typed other answer on screen when an option is picked afterwards`。改前：输入 OpenCode →
    选 Codex → 输入框的值为空 → 点 Submit → 答案 `{ Provider: "Codex" }`。改后：输入 OpenCode → 选 Codex →
    输入框已不在屏幕上、只回应了一次、答案 `{ Provider: "Codex" }`，没有点 Submit 这一步。
  - 依据的决定：`prd.md`「冲突裁决 → 问题卡片」的「单选题点击即作答保持不变」。
  - 把修复临时撤掉重跑：多选两条失败，单选两条通过；恢复后四条通过。

**智能体管理（`agent-manager.ts`）。**

- `prepareSessionConfig`：签名取上游的选项对象 `{ env?, purpose? }`，函数体里保留 Osuna 的
  `paseoToolsGateReason`，返回值四个字段。四个调用点都取了 `paseoToolsGateReason`：新建（传 `{ env }`）、
  恢复（传 `{ purpose }`）、导入、刷新。
- 恢复：上游把配置准备挪到「先从持久状态判定驻留」之后，Osuna 原来在前面的那次调用去掉，只剩上游位置的一次。
- 历史回放：上游的「先收集、流完再动存储」照收。Osuna 的 `withoutTrailingRoutingBlock` 落在收集这一步，
  `primeTimelineFromLegacyProviderHistory` 与强制刷新的回放两处都有。

**两边都改过、自动合上的文件。** 下表之外的 server 文件（`agent-sdk-types.ts`、`plugin-provider.ts`、
`acp-agent.ts`、`claude/models.ts`、`codex-app-server-agent.ts`、`omp/agent.ts`、`opencode-agent.ts`、
`paseo-tools.ts`、`operation-permissions.ts`、`bootstrap.ts`、`persisted-config.ts`、`session.ts`、
`websocket-server.ts`、`workspace-git-service.ts`）与 app 的快捷键、replica cache、`vitest.config.ts` 由
typecheck、lint 和各自的测试覆盖。

对两边都改过的 13 个测试文件对比合并前后（`git diff 43f9827c7 381896b91 -- <文件>`）被删掉的行：

| 文件 | 删掉的行 | 说明 |
| ---- | -------- | ---- |
| `question-form-card-core.test.ts` | 10 | 上文列的那一条用例与 5 处调用签名，经维护者确认 |
| `plugin-provider.test.ts` | 1 | 上游改自己的 import |
| `acp-agent.test.ts` | 6 | 上游改自己的 `createSession` 辅助函数 |
| `opencode-agent.test.ts` | 37 | 上游重写自己的权限规则用例（#5296） |
| 其余 9 个 | 0 | 只增不删 |

后三个文件删掉的每一行在共同祖先 `818658520` 里都有，是上游的行，不是 Osuna 的断言。没有 Osuna 的测试被
删除、跳过或放宽。

**git 没报冲突、结果却不对的（一处）。** 上游新文件 `isolated-bottom-sheet-modal/back-press.ts` 的注释里
写了 `` `BackHandler` ``，Osuna 的翻译守卫（`i18n/resources.test.ts` 的 `keeps migrated English literals
out of app source`）按反引号加文字开头扫描，报 `back-press.ts: Back`，CI 的 app-tests 会变红。它不是界面
文字。`d5dcb2916` 改写了那句注释的措辞，守卫没有放宽，代码无变化。

**合并后核对（`git diff 43f9827c7 381896b91`）。** 全部无变化：

- 更新源：`electron-builder.yml` 的 `publish` 仍是 `github` / `LFT-OXY` / `Osuna`，文件无改动。
- 桌面身份与数据目录：`appId: com.chinhae.osuna.desktop`、`productName: Osuna`；`main.ts` 无改动。
- 签名与签名断言：`desktop-release.yml`、`mac-sign.js`、`verify-mac-signature.mjs` 无改动；Apple 公证变量 0 处。
- 只手动触发的部署工作流：四个文件的 `on:` 都只有 `workflow_dispatch`。`.github/workflows` 只有 `ci.yml`
  多了上游的 `server-tests-macos` 作业（macos-14，只跑文件观察相关的 server 测试）。
- 上游站点链接数：`packages/app/src` 70 / 非测试 1，`packages/cli/src` 13 / 非测试 3，与 01 的基线相同。
- 翻译键：`packages/app/src/i18n` 无改动。上游本段在设置界面只改了快捷键分区的一行按键判断，没有新的
  用户可见文案，无需新增翻译键。
- `COMPAT(...)` 标签：新增 0。
- `packages/protocol/src` 无改动。

`nix/npm-deps.hash` 跟着上游变了，按 `docs/release.md` 不追。上游本段新增的四个安卓商店说明文件
`90021.txt`–`90024.txt` 与 Osuna 已有文件不重名，照收（连同第一段的四个共八个）。官网赞助页的改动只落在
`packages/website`（5 个文件），应用里没有赞助入口。上游的三个新 e2e 没有写死色值。

**本机运行。** 跑之前挪开了 `packages/app/.expo` 与 `packages/app/node_modules/.vite`。

| 检查 | 结果 |
| ---- | ---- |
| `npm run typecheck` | 通过，0 个错误。第一次在 CLI 报 1 个 `PidLockInfo.serverId` 不存在，是 server 的 `dist` 声明旧了；`npm run build:server` 后通过 |
| `npm run lint`（全仓 4629 个文件） | 0 warning 0 error |
| `server/agent/agent-manager.test.ts` | 198 条通过 |
| `providers/claude/agent.test.ts` | 88 条通过 |
| `providers/claude/agent.rewind-anchors.test.ts`（上游新增） | 4 条通过 |
| `providers/claude/models.test.ts` | 48 条通过 |
| `agent/trailing-routing-block.test.ts`、`routing-block.test.ts`、`agent-prompt.test.ts`、`agent-projections.test.ts` | 2 / 9 / 15 / 21 条通过，无一改动 |
| `daemon-e2e/agent-mention-routing-block.e2e.test.ts` | 22 条通过，无改动 |
| `mcp-server`、`plugin-provider`、`acp-agent`、`codex-app-server-agent`、`omp/agent`、`opencode-agent`、`plugins/runtime.posix` 的测试 | 124 / 25 / 107 / 161 / 34 / 135 / 40 条通过 |
| `app/src/components/question-form-card-core.test.ts` | 22 条通过 |
| `app/src/components/question-form-card.browser.test.tsx`（Chromium，全新预构建缓存） | 4 条通过 |
| `app/src/keyboard/keyboard-shortcuts.test.ts`、`runtime/replica-cache/index.test.ts` | 132 / 27 条通过 |
| `app/src/i18n/resources.test.ts` | 改注释前 1 条失败（见上），改后 38 条通过 |
| `cli/src/commands/permit/permit-output.test.ts`（上游新增） | 2 条通过 |

`packages/cli/src/commands/daemon/lifecycle.e2e.test.ts` 与上游新增的三个 app e2e、两个 CLI e2e 留给 CI。

**界面实测（dev 桌面端，Electron，窗口 1280×900，浅色，中文）。** 截图在 `screenshots/`：

| 截图 | 看到的 |
| ---- | ------ |
| `chat-question-card_multi-select-two-checked-plus-other_desktop-1280_light_zh.png` | 多选卡片是编号行列表；iOS、Web 为勾选，第 4 行「其他」里是 watchOS，三者同时可见；底部「跳过」「提交」 |
| `chat-question-card_multi-select-submitted-answer_desktop-1280_light_zh.png` | 提交后智能体回显 `platforms=iOS, Web, watchOS` |
| `chat-question-card_single-select-before-pick_desktop-1280_light_zh.png` | 单选卡片底部只有「跳过」，没有「提交」 |
| `chat-question-card_single-select-answered-on-click_desktop-1280_light_zh.png` | 点 Dark 后卡片消失，回显 `theme=Dark`，没有额外的提交步骤 |

题目由 mock 智能体发出（`emit synthetic questions multi-select` / `single-choice`）。mock 的多选题没有
「其他」行，实测时在本机临时给它加了 `allowOther: true` 并重建 server，截图后已还原并重建，没有提交。
回显文字是 mock 把收到的答案写成的助手消息，证明的是 daemon 收到的内容。原生端免验收。

**评审（Standards / Spec / Visual 三个维度，各一个独立子代理，只读）。**

- Standards 标了三处硬违规，都已处理：`setQuestionOtherText` 里的 `questions[qIndex]?.multiSelect` 改成与
  `pickQuestionOption` 一样的 `if (!question) return state`；两处历史回放里
  `{ ...event, item: withoutTrailingRoutingBlock(event.item) }` 改成先取局部变量（其中一处是合并前就有的
  Osuna 写法，一并改成一致）；本记录当时还没写。改完重跑了卡片的两个测试文件、`agent-manager.test.ts` 与
  提及路由的 daemon e2e，全部通过。
- Standards 的判断项不改，留给维护者：「单选替换、多选并存」在四处各按 `multiSelect` 分支一次；
  `(state, questions, qIndex)` 总是一起传，`setQuestionOtherText` 现在是 4 个位置参数；上游的浏览器测试用了
  `@testing-library/dom`（`quality-guidelines.md` 禁止新测试用它，这是上游带来的文件，按 `prd.md` 照收，
  规范里已注明这个例外）。
- Spec：没有要改代码的发现。提醒两件事，都已照做：注释的适配单独提交；`prd.md` 里三处「只有一条例外」的
  说法与维护者的新决定矛盾，已改成两条。
- Visual：三条界面验收都满足，没有偏离设计规范。指出一处不在本次范围内的现象：多选题「其他」行填了文字后
  编号圆圈仍是灰色数字，不像已选行那样变成蓝色对勾，失焦后看不出这行会不会一起提交。这是 Osuna 卡片原有的
  样子，本次没有改外观，留给维护者决定是否另开工单。

**留给 03 的事。**

- PR 正文要写：多选问题卡片的行为变化；改掉的那条 Osuna 用例（第二处）；浏览器测试里改写的两条单选用例与
  辅助函数；`back-press.ts` 的注释适配。
- `docs/release.md` 的同步点那一句还没更新（并入 main 时改）；「踩过的坑」本段新踩的三条已在 `d5dcb2916` 补上。
- 多选行为变化是用户可见的，本次不发版、不动 `CHANGELOG.md`，下次发版写条目时要带上（连同 01 的 Opus 5.5
  默认档位）。

**草稿 PR 上的 CI（2026-10-10，PR #14，分支头 `fdbbe8ff7`）。** 两个工作流都是第一次运行就通过，没有重跑，
没有因合并引起的失败。

| 工作流 | 运行 | 结果 |
| ---- | ---- | ---- |
| CI | 38042465086 | 19 个作业全部通过：`changes`、`format`、`lint`、`typecheck`、`app-tests`、`sdk-tests`、`relay-tests`、`cli-tests` 3 个分片、`server-tests`（ubuntu、windows）、上游新增的 `server-tests (macos-14, file observation)`、`desktop-tests`（ubuntu、windows）、`playwright` 4 个分片 |
| Desktop Packages | 38042465090 | `linux` 通过 |

本机留给 CI 的 `lifecycle.e2e.test.ts`、上游新增的三个 app e2e 与两个 CLI e2e 所在的作业都通过了。这个 PR 上
没有触发 Nix 与 Nix Update Hash。

**关票前的复核（2026-10-10，对分支头 `fdbbe8ff7`）。** merge commit `381896b91` 的双亲是 `43f9827c7` 与
`c67b7158b`；重新抓取上游 main（不抓 tag）后 `git merge-base HEAD upstream/main` = `c67b7158b`，`git tag`
仍是 14 个。12 个 `package.json` 的版本号都是 `0.14.2`；相对 `43f9827c7`，`package.json` 一类文件里只有
`packages/server/package.json` 多一行脚本，`package-lock.json`、`CHANGELOG.md` 与四个 README 无差异。验收项
里原先写的「根 `package.json` 多出一个脚本」已按实际改成 `packages/server/package.json`。评审提出的三处
修改都在分支头的代码里。四张截图复看过，与上表描述一致。
