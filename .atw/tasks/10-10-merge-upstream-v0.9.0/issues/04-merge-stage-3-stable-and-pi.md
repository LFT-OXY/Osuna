# 04 — 第三段：合并到上游 v0.9.0，Pi 思考档位以上游为底

**What to build:** 合并分支上新增一个把上游 `7f7e60bcb`（v0.9.0 正式版，累计 29 个提交）合进来的 merge commit，至此上游 v0.9.0 全部进入合并分支。这一段带来聊天、文件、终端统一用 Command+F 查找、流式回复可搜、匹配数按整个聊天统计、新建聊天的平稳交接，以及 Pi 的按模型 thinking 配置。Pi 这一项两边各做过一遍：采用上游的形态，把 Osuna 原有的行为补回去，Pi 用户感受到的和合并前一样。终端的查找与 Osuna 的终端内边距、字体栈并存。规格见 `prd.md` 的「Pi 的按模型 thinking 配置」「冲突裁决规则」「界面文案」「版本号与发版元数据」。

**Blocked by:** 03
**Status:** ready-for-agent
**Impl:** done

- [x] 合并分支包含一个以上一段结果与 `7f7e60bcb` 为双亲的 merge commit；`7c1958f5b`、`e9d32a17d`、`7f7e60bcb` 各对应一个 merge commit。
- [x] 所有冲突按 `prd.md` 的三条裁决规则处理，每个代码冲突文件的裁决与依据记在 `## Comments` 下；裁决不了的已问过维护者。
- [x] Pi 采用上游的形态：模型定义直接携带思考档位列表与默认档位，上游在 agent 管理、输入框 agent 控件和 e2e 上的配套改动一并保留。
- [x] Pi 行为，各有通过的测试：非推理模型不给思考档位。
- [x] Pi 行为，各有通过的测试：模型档位映射里标为不可用的档位不出现。
- [x] Pi 行为，各有通过的测试：最高的两档只在模型显式映射了才出现。
- [x] Pi 行为，各有通过的测试：切换模型后当前档位若不被支持，先往更高档、再往更低档对齐到最近的可用档位。
- [x] Pi 行为，各有通过的测试：设置档位后以回读到的实际生效档位为准；回读失败时退回请求的档位并记日志，设置操作不失败。
- [x] Osuna 原有的 Pi 测试用例与合并后的用例逐条对应，对应表记在 `## Comments` 下；改写后覆盖的行为不少于改写前。
- [x] 终端里的查找可用，同时 Osuna 的终端四边内边距、对比度修正与等宽字体栈保留，对应的现有测试通过。
- [x] 安卓商店说明里与上游同名的四个文件是 Osuna 的版本；所有工作区版本号仍是 `0.14.2`；`CHANGELOG.md` 不含上游的 0.9.0 系列条目；`package-lock.json` 是重新生成的。
- [x] 这一段带进来的上游 `COMPAT(...)` 标签版本号已改写；新增翻译键九种语言齐全、zh-CN 为真实翻译；翻译资源测试通过。
- [x] 应用与 CLI 源码中的上游站点链接数不多于 01 记下的基线。
- [x] Osuna 原有的测试没有被删除、跳过或放宽断言。
- [x] typecheck 和 lint 通过；本段每个代码冲突文件对应的测试文件单独跑过并通过。
- [x] 草稿 PR 上 CI 全绿，Nix 与 Nix Update Hash 除外；已知偶发失败重跑后通过。
- [x] 本工单的界面截图验收并入 06 统一做。

## Comments

### 范围

merge commit 是 `e0373b2ff`，双亲 `9ba17ecfe`（上一段的结果，工单 03 的关票提交）与 `7f7e60bcb`。至此 `7c1958f5b`、`e9d32a17d`、`7f7e60bcb` 各对应一个 merge commit：`503a3e7cb`、`0798c61c8`、`e0373b2ff`。

上游 `e9d32a17d..7f7e60bcb` 共 8 个提交：#4413（Pi 按模型的 thinking 配置）、#5129（聊天、文件、终端统一用 Command+F 查找）、#5146（流式回复可搜）、#5167（匹配数按整个聊天统计）、#5168（新建聊天的平稳交接）、一次 lockfile 与 Nix 哈希、一次 changelog、一次 cut。

实际冲突 24 个文件：机械性 18 个，代码 6 个。discovery 估的 `desktop-release.yml` 这一段没有冲突，也没有改动（上游这 8 个提交没碰它）。

### 冲突裁决

机械性 18 个：

| 文件 | 裁决 | 规则 |
| --- | --- | --- |
| 12 个 `package.json` | 冲突块全是版本号（本包版本与 `@getpaseo/*` 内部依赖），取 Osuna 的 `0.14.2`。这一段上游没有改任何外部依赖，解完后 12 个文件与合并前逐字节相同 | 版本号与发版元数据 |
| `package-lock.json` | 取 Osuna 一侧后跑 `npm install --package-lock-only --ignore-scripts` 重新生成，结果与合并前逐字节相同（上游这一段对它的改动全是 `0.9.0-beta.2` → `0.9.0`） | 同上 |
| `CHANGELOG.md` | 与合并前逐字节相同。文件里唯一的 `## 0.9.0` 是 Osuna 自己在 2026-09-27 发的那一版 | 同上 |
| `fastlane/metadata/android/en-US/changelogs/90001.txt`–`90004.txt` | 两边同名同路径各加了一份，取 Osuna 的，与合并前逐字节相同 | 同上 |

代码 6 个：

| 文件 | 裁决 | 规则 |
| --- | --- | --- |
| `packages/app/src/terminal/runtime/terminal-emulator-runtime.ts` | 一处导入冲突，两边都留：上游把查找快捷键判定挪到 `@/pane-find/find-shortcut` 与 `@/utils/mac-user-agent`（旧的 `terminal-find-shortcut.ts` 随上游删除），Osuna 的 `resolveTerminalMinimumContrastRatio`（对比度修正）保留 | 3 |
| `packages/app/src/terminal/webview/terminal-emulator-webview-html.ts` | 这是打包产物，不手工合并：用 `npm run build:terminal-webview` 按合并后的源码重新生成，再过一遍格式化。生成结果里上游的 `isMacUserAgent` 与 Osuna 的内边距、对比度修正都在 | 3 |
| `packages/server/src/server/agent/providers/pi/agent.ts` | 见下一节 | 2 |
| `packages/server/src/server/agent/providers/pi/rpc-types.ts` | 取上游的 `Record<string, string \| null>`，补回 Osuna 的 `\| null`（Osuna 的目录用例覆盖"字段为 null"）与那行注释 | 2 |
| `packages/server/src/server/agent/providers/pi/test-utils/fake-pi.ts` | 取 Osuna 的：切模型时既换模型也按脚本重置档位，是上游那一行的超集 | 2 |
| `packages/server/src/server/agent/providers/pi/agent.test.ts` | 两边的用例都留，见「Pi 测试对应表」 | 2；改动的上游用例按"测试规则"第二条 |

### Pi：以上游为底，补回 Osuna 的行为

取上游的形态，原样保留：

- 模型目录由上游的 `resolvePiThinkingConfig` 算，模型定义直接带档位列表与默认档位。Osuna 的 `getSupportedPiThinkingLevels`、`clampPiThinkingLevel`、`mapThinkingOption` 和自己那份 `resolvePiThinkingConfig` 与它重复，全部去掉。
- 会话不再有 `lastKnownThinkingOptionId` / `resolveThinkingOptionId`；创建、恢复、切模型、设档位之后都回读 Pi 的状态；启动时没选档位就不传 `--thinking`，由 Pi 自己定。
- 上游的配套改动都在：agent 管理（设档位后读会话的实际档位）、输入框 agent 控件（只有一档的模型也显示档位控件；Osuna 在 `757ba8a29` 已经改成同样的 `> 0`，两边一致）、mock 提供方的单档模型、e2e。

在上游形态上补的四处，都在 `pi/agent.ts`：

1. **目录**：推理模型的档位全被映射成 `null` 时不给档位（上游给的是空列表加默认档 `off`）。一处提前返回。
2. **切模型后重新下发档位**：会话多一个 `selectedThinkingLevel`，记着要重新下发的那一档。切到有档位的模型后把它发给 Pi，由 Pi 先往高、再往低收敛，回读后与切换前上报的档位不同就发 `thinking_option_changed`；重新下发失败只记日志，切模型仍算成功。当前模型没有档位时 Pi 报 `off`，不拿它覆盖记着的那一档，所以经过没有档位的模型再切回来还是原来的档位；这期间对外上报的也是记着的那一档。
3. **设档位后回读失败**：按请求的档位记、记一条 warn 日志，不抛错。
4. **切模型后读不到状态**：按切换成功记（模型取切模型命令的返回值）、记一条 warn 日志，不抛错。维护者 2026-10-10 定的，见「问过维护者的三件事」。

评审后另修了一处两边都没有的行为：切模型后重新下发档位失败时，档位停在 Pi 重置后的值，这时也要发 `thinking_option_changed`，否则界面还显示旧档位。新增用例「reports the level Pi reset to when re-applying the thinking level fails」，先在旧逻辑下失败、修正后通过。

五条行为与测试：

| PRD 的行为 | 实现在哪 | 测试 |
| --- | --- | --- |
| 非推理模型不给思考档位 | 上游已覆盖 | Osuna「exposes only the thinking levels each model's thinkingLevelMap supports」的 `plain-model`；上游「resolves Pi thinking options for a non-reasoning model」 |
| 标为不可用的档位不出现 | 上游已覆盖 | 同一条 Osuna 用例的 `gpt-6-astra`、`deepseek-flash`；上游「honors per-model Pi thinking maps…」「…for a partial thinking map」 |
| 最高两档只在显式映射了才出现 | 上游已覆盖 | 同一条 Osuna 用例的 `grok-4.5`、`grok-4.3`；上游「…for no thinking map」「…for explicitly mapped extended levels」 |
| 切模型后对齐到最近的可用档位 | 补的第 2 处 | Osuna 的六条切模型用例（见下表） |
| 设档位后以回读为准，回读失败退回请求的档位 | 回读是上游的；失败兜底是补的第 3 处 | Osuna「reports the thinking level Pi applied after setting a thinking option」「keeps the requested thinking level when reading Pi state back fails」 |

为确认这些用例真的守着行为，评审之前故意把实现改坏四次、每次只跑 `pi/agent.test.ts`，都被抓到，之后还原：去掉回读失败的兜底（1 条失败）；切模型后不重新下发（6 条）；全 `null` 的模型不按无档位处理（3 条）；没有档位的模型上也用 Pi 的 `off` 覆盖记着的档位（2 条）。

### Pi 测试对应表

Osuna 原有的用例（`c1c21c76d` 加的 9 条，加上它改过前置条件的 2 条旧用例），合并后全部还在，测试体逐字节相同，没有一条改过断言：

| Osuna 用例 | 合并后 |
| --- | --- |
| keeps the current thinking level when switching to a model that supports it | 同名，未改 |
| reports the clamped thinking level when switching to a model that lacks it | 同名，未改 |
| restores the thinking level after passing through a non-reasoning model | 同名，未改 |
| keeps the thinking level when passing through a model with no supported levels | 同名，未改 |
| applies the default thinking level when leaving a non-reasoning launch model | 同名，未改 |
| completes a model switch when re-applying the thinking level fails | 同名，未改 |
| keeps the requested thinking level when reading Pi state back fails | 同名，未改 |
| reports the thinking level Pi applied after setting a thinking option | 同名，未改 |
| exposes only the thinking levels each model's thinkingLevelMap supports | 同名，未改 |
| updates model and thinking through Pi runtime commands | 同名，未改 |
| discovers models from a short-lived Pi session in the requested cwd | 同名，未改 |

整个文件：合并前 101 处用例声明（100 个 `test` 加 1 个 `test.each`），名字在合并后一个不少；合并后 111 处声明（107 个 `test` 加 4 个 `test.each`），共 120 条用例。

上游这一段给这个文件加了 10 组用例：5 组原样保留，4 组改了，1 组没留。另有 4 条合并前就有的旧用例被上游改过。**06 写 PR 正文时列下面两张表：**

| 上游新增的用例 | 处理 | 因为 Osuna 的哪条决定 |
| --- | --- | --- |
| surfaces state refresh failures after a Pi thinking update | 没留。它断言"设档位后回读失败 → 设置报错、档位不变"，与 Osuna 的同场景用例「keeps the requested thinking level when reading Pi state back fails」结论相反 | PRD「Pi 的按模型 thinking 配置」第五条 |
| surfaces state refresh failures after a Pi model update | 改写为「completes a model switch when reading Pi state back fails」：同样的前置条件，预期从"切模型报错"改成"切模型成功，记下的模型是新模型" | 原 Pi 任务里确认过的决定，维护者 2026-10-10 再次确认 |
| resolves Pi thinking options for no supported thinking levels | 预期从"空列表、默认档 `off`"改成"不给档位" | Osuna 的目录用例对同一种模型断言不给档位（原 Pi 任务的决定：全 `null` 按非推理模型处理） |
| stores Pi's $effective thinking level after requesting $requested（3 条） | 只改前置条件，断言没动：原来是先把假 Pi 的状态改成目标档位，现在用 `thinkingLevelClamp` 表达 Pi 的收敛 | Osuna 的假 Pi 会按下发的档位改状态，预先写进去的状态会被覆盖 |
| refreshes Pi's thinking level after changing models | 同上，只改前置条件：用 `thinkingLevelClamp` 表达"这个模型不支持 medium，Pi 收敛到 high" | 切模型后 Osuna 会重新下发档位（PRD 第四条） |

原样保留的上游用例：lets Pi choose the thinking level when none is requested；adopts Pi's $effective level when creating with $requested（2 条）；adopts Pi's clamped thinking level when resuming a session；reports updated Pi thinking state instead of a cached selection；honors per-model Pi thinking maps and clamps the catalog default upward；resolves Pi thinking options 的其余 5 条。`agent-manager.test.ts` 里上游新增的两条也原样保留并通过。

合并前就有、被上游这一段改过的旧用例（都不是 Osuna 写的，是分叉基点之前上游自己的用例；改动随合并自动进来）：

| 旧用例 | 上游改了什么 | 依据 |
| --- | --- | --- |
| appends agent and daemon prompts after Pi's discovered system prompt | 启动参数的预期里去掉 `--thinking medium` 两行 | 没选档位时不再默认传 medium，维护者 2026-10-10 同意跟上游 |
| injects MCP servers without replacing the Pi global MCP config | 同上 | 同上 |
| does not pass MCP config when pi-mcp-adapter is not loaded | 同上 | 同上 |
| imports JSONL sessions with the recorded model and thinking level | 多了一步前置条件：让假 Pi 的状态报 `high`。断言没动 | 会话现在以 Pi 回读的档位为准，假 Pi 得报出会话里记录的档位 |

### 问过维护者的三件事（2026-10-10）

Pi 两边做法不同、用户能感觉到的三处。一开始按规则 2 自行定了并打算交付时上报；Spec 评审指出这三处该先问，于是在合并提交之前问了维护者：

| 场景 | 上游 | 合并前的 Osuna | 维护者的决定 |
| --- | --- | --- | --- |
| 新建 Pi 会话时没有指定档位 | 不传 `--thinking`，由 Pi 按自己的设置定，定下来的档位回读后显示 | 默认传 medium（原 Pi 任务 PRD："没选时传 medium"） | **跟上游。** 从 App 新建时界面会带上模型的默认档，主要影响 CLI 与 MCP 不带档位的创建 |
| 切模型后立刻读不到 Pi 状态 | 切模型报错，界面仍是旧模型 | 算切换成功，只记日志（原 Pi 任务里确认过：避免 Pi 已换模型而 agent manager 仍记旧模型） | **保持合并前。** 已实现，见上面补的第 4 处 |
| 设档位后一直读不到 Pi 状态 | 设置报错、保留原档位（agent 管理层设完再读一次，那一步读不到就报错） | 设置成功，按请求的档位记 | **维持现状，不改上游的 agent 管理层。** 会话这一层按 PRD 第五条兜住：读取偶尔失败一次时设置成功。Pi 的状态一直读不出来时，上游 agent 管理层的那次读取仍会报错 |

第三条意味着 PRD 第五条的"不让设置操作失败"在会话这一层成立，有用例；穿过 agent 管理层之后，只在读取能恢复时成立。这是 PRD 的两条要求（保留上游在 agent 管理上的配套改动、设置操作不失败）相互牵制的结果，维护者选了不动上游那一层。

还有一处不对称，评审指出、没有改：从没有档位的模型上启动、又没记着档位的会话，切到有档位的模型时下发 medium（Osuna 用例「applies the default thinking level when leaving a non-reasoning launch model」断言如此）；而直接在有档位的模型上启动、不指定档位时听 Pi 的（上面第一条）。两者各有用例守着，一并留给维护者知悉。

### 终端

查找用上游的新写法：快捷键判定在 `pane-find/find-shortcut.ts`，macOS 上是 Command+F，其他平台 Ctrl+F，聊天、文件、终端共用。Osuna 的四边内边距、对比度修正、等宽字体栈都在，对应的测试见运行记录。

### 冲突之外

- **`COMPAT(...)` 标签**：这一段带进来 3 处，都是 `timelineSearchCount`（标签名在合并前的 main `d38d186bd` 上不存在）。`packages/protocol/src/messages.ts` 与 `packages/app/src/agent-stream/chat-find/model.ts` 两处写着 `v0.9.0`，改成 `v0.15.0`；`model.test.ts` 那一处没有版本号，不动。只改版本号，日期不动（工单 02 的做法）。在紧跟 merge commit 的提交里改。
- **翻译键**：聊天查找换了一批键（`searchFailed` → `connectionFailure`，新增 `historyChangedFailure`、`revealFailure`，去掉 `chatPosition`）。九种语言上游都已自带，zh-CN 是真实翻译；Osuna 展开写的 zh-CN 区块里没有留下旧键。没有新增设置界面的硬编码英文。
- **上游站点链接**：`packages/app/src` 70 / 1，`packages/cli/src` 13 / 3（全部 / 非测试），与工单 02、03 相同，不多于 01 的基线 71 / 1、13 / 3。
- 新增的 `toHaveCSS` / 色值断言：0 处。
- 被删除的文件只有上游删的 `terminal-find-shortcut.ts`，Osuna 自基点以来没有改过它；测试文件新增行里没有 `.skip` / `.only` / `.todo` / `.fixme`。
- 冲突之外需要手工改的自动合并结果：0 处。
- `.github/workflows/` 与 `packages/desktop/electron-builder.yml` 这一段没有改动，更新源仍是 `owner: LFT-OXY` / `repo: Osuna`。
- 所有工作区版本号 `0.14.2`（12 个）。`nix/npm-deps.hash` 自动合成了上游的值，没有追。本地 tag 合并前后都是 14 个。

### 运行记录（2026-10-10，本机）

本工作树有 `packages/app/.expo` 与 `packages/app/node_modules/.vite`。跑全仓 typecheck 时把 `.expo` 挪到了仓库外、跑完放回；跑浏览器测试前把旧的 `.vite` 预构建缓存挪走。下面的结果不受这两项影响。

合并提交之前：

- `npm run build:server`：通过。
- `npm run typecheck`（挪开 `.expo`）：第一次报 1 个错误，是我手写的 `piModelHasThinkingLevels` 参数类型少了 `undefined`；改后 0 个错误。之后的改动只在 `pi/agent.ts` 与它的测试，server 的 typecheck 每次都重跑过，0 个错误；提交钩子又跑了一遍全仓 typecheck，通过。
- `npm run lint`：0 警告 0 错误。`npm run format:check`：通过。
- server，逐个文件：`providers/pi/agent.test.ts`（120 条）、`pi/cli-runtime.test.ts`（20）、`pi/history-mapper.test.ts`（7）、`pi/session-descriptor.test.ts`（5）、`pi/tool-call-mapper.test.ts`（18）、`pi/usage-poller.test.ts`（4）、`agent/agent-manager.test.ts`（196，含上游新增的两条）、`agent/chat-search/index.test.ts`（5）、`providers/mock-load-test-agent.test.ts`（20）。全部通过。
- protocol：`messages.test.ts`、`messages.wire-compat.test.ts` —— 46 条通过。
- app 单元：`agent-stream/chat-find/model.test.ts`、`agent-stream/presentation.test.ts`、`timeline/viewed-timeline-sync.test.ts`、`timeline/replica.test.ts`、`utils/__tests__/split-markdown-blocks.test.ts`、`agent-stream/chat-outline/use-chat-outline.test.tsx`、`stores/workspace-layout-store.test.ts`、`i18n/resources.test.ts`、`pane-find/find-shortcut.test.ts`、`terminal/runtime/terminal-emulator-runtime.test.ts`、`terminal/runtime/terminal-contrast.test.ts`、`terminal/runtime/terminal-key-dispatch.test.ts` —— 12 个文件 387 条通过。
- app 浏览器测试（`--project browser`）：`terminal/runtime/terminal-emulator-runtime.browser.test.ts`、`terminal/runtime/terminal-find.browser.test.ts`、`terminal/webview/terminal-find.browser.test.ts`、`terminal/runtime/terminal-resize-repro.browser.test.ts`、`agent-stream/chat-find/ranges.browser.test.ts`、`agent-stream/chat-find/viewport.browser.test.ts`、`assistant-selection-copy/content.browser.test.ts` —— 7 个文件 85 条通过。终端的查找、内边距、对比度修正与字体都在这几个文件里。
- app 浏览器 e2e：`chat-find.spec.ts`、`pane-find.spec.ts`、`command-center-agent-controls.spec.ts`、`assistant-selection-copy.spec.ts`、`agent-message-submission.spec.ts` —— 58 条里 56 条通过，2 条在本机失败，都与宿主机是 macOS 有关，交给 CI（Linux）判定：
  - `chat-find.spec.ts`「opens and refocuses Find with Control+f from the composer」：这条按非 macOS 写的，本机浏览器报的是 macOS，查找绑的是 Command+F。
  - `pane-find.spec.ts`「macOS › opens Find with Meta+f and leaves Control+f to text editing」：预期"1 of 2"，本机得到"2 of 2"。macOS 上 Control+F 会把光标往前挪一格，查找从第二处开始数。
- 整套测试没有在本机跑，交给 CI。

合并提交之后：改写两处 `COMPAT` 版本号，重跑 `protocol/src/messages.test.ts`（29 条）与 `app/src/agent-stream/chat-find/model.test.ts`（9 条），通过。

### 评审（`atw-code-review`，Standards 与 Spec 两轴；本工单截图并入 06，无截图，Visual 轴未跑）

评审在合并提交之前、对暂存区做的。

- Standards：
  - 正确性，已修并复查：切模型后重新下发档位失败时没有通知界面（补了用例）；在没有档位的模型上设档位会用 `off` 覆盖记着的那一档（回读失败的兜底改为走 `syncThinkingOption`）。
  - 硬违规，已修：`piModelHasThinkingLevels` 的 `!model || …` 把两件事混在一个布尔表达式里（`docs/coding-standards.md` 的 Density），拆成提前返回。
  - 已修：`setModel` 里一句过时的注释。
  - 规范漂移，已在本工单补上：`.atw/spec/server/backend/quality-guidelines.md` 那条还写着 agent 管理层用请求值覆盖档位。
  - 判断题，照规则原样提交并上报：`selectedThinkingLevel` 多数时候存的是 Pi 回读的档位，名字不够贴切；切模型后判断新模型有没有档位用的是切模型命令的返回值，同步时用的是状态查询里的模型，两个来源；`thinkingLevelMap` 的类型按上游放宽成任意字符串键，拼错的键名编译器不再拦。
- Spec：没有范围蔓延；Pi 确实以上游为底，Osuna 的 11 条用例逐字节未改。三条，已处理：
  - 「跟着上游变了的 Pi 行为」里的三处不该自行定。已问维护者，结论与依据见「问过维护者的三件事」；其中切模型一条改回了合并前的行为。
  - "Osuna 没有针对默认传 medium 的用例"不准确：有 3 条旧用例断言启动参数含 `--thinking medium`，随上游改动去掉了。已补进对应表。
  - 用例声明数算错（109 应为 110，合并前 100 应为 101）。已改，现为 111（评审后又加了一条）。
- 修正后的复查：只对改过的地方做了一次。重跑 `pi/agent.test.ts`（120 条通过）、server typecheck（0 错误）、这两个文件的 lint 与格式检查（通过），并通读了改后的 `setModel` 与 `applyThinkingLevel`。没有做第二轮完整评审。

### 规范补充

- `.atw/spec/server/backend/quality-guidelines.md`：改写"会话上报提供方实际生效的档位"一条——agent 管理层现在设完会读会话的实际档位；`setAgentModel` 只靠 `thinking_option_changed` 得知档位变化；Pi 用 `selectedThinkingLevel` 记要重新下发的档位，没有档位的模型上不被 `off` 覆盖；会话内读不到状态时记日志不抛错，这一点与上游不同。
- `docs/providers.md` 的 Pi 段落仍然准确，没有改。

### 给后续工单

- 05：值得写进文档的——打包产物（`terminal-emulator-webview-html.ts`）冲突时重新生成，不手工合并；两边各做了一遍的功能，除了源码还要对两边的测试逐条过一遍，结论相反的用例就是要问维护者的地方，别等评审指出来；上游改旧用例的断言不会报冲突，要主动用 `git diff <合并前> -- <测试文件>` 找被删的断言行。
- 06：PR 正文列「Pi 测试对应表」的两张表和「问过维护者的三件事」；Pi 思考档位的截图要覆盖"切换模型后对齐"。本工单的界面截图并入 06。
- 06：堆上限（工单 03 留下的 arm64 取 8192 还是 4096）仍待维护者答复。

### 推送与 CI

- 推送 `e0373b2ff`（merge commit）、`2fb2ee869`（COMPAT 版本号）与 `c2ed3e794`（本工单记录）到 `identify-fork-base`（草稿 PR #13），只推这一条分支，没有推 tag。依据是 PRD「每段推送后看 CI」和本工单的 CI 验收项。
- `c2ed3e794` 上 CI 工作流 18 项全部通过，整轮没有重跑：changes、format、lint、typecheck、app-tests、sdk-tests、relay-tests、server-tests（ubuntu / windows）、desktop-tests（ubuntu / windows）、cli-tests 三片、playwright 四片。Desktop Packages 的 `linux` 也通过。Nix 与 Nix Update Hash 这次没有被触发。
- 本机因宿主机是 macOS 而失败的两条 e2e，在 CI（Linux）上都通过：`chat-find.spec.ts`「opens and refocuses Find with Control+f from the composer」、`pane-find.spec.ts`「macOS › opens Find with Meta+f and leaves Control+f to text editing」。
- playwright 有 3 条用例第一次失败、由 Playwright 自己重试后通过（计为 flaky，不算失败）：`agent-tab-image-stability.spec.ts`「a real assistant PNG remains reachable through pagination and remount」、`creation-idempotency.spec.ts`「retrying failed agent initialization preserves its workspace」、`settings-providers-list-detail.spec.ts`「pushes the detail and returns through the breadcrumb on a wide window」。都不在本段手工改过的文件里；工单 03 那次 CI 同样有 3 条重试后通过，其中两条在相同的文件里。`creation-idempotency` 那条是这次新出现的，06 看 CI 时留意它是否反复出现。
- `9ba17ecfe`（工单 03 的关票提交）上的那次 CI 显示"已取消"：是被这次推送顶掉的，不是失败。

### 验收项说明

- 第 2 条"裁决不了的已问过维护者"：Pi 的三处已问，见「问过维护者的三件事」。
- 第 8 条"设置操作不失败"：在 Pi 会话这一层成立并有用例；Pi 的状态一直读不出来时，上游 agent 管理层的读取仍会报错。维护者 2026-10-10 选择维持这样。
- 第 14 条"Osuna 原有的测试没有被删除、跳过或放宽断言"：Osuna 自己写的用例一条没动。分叉基点之前就有的 3 条上游用例，被上游自己去掉了 `--thinking medium` 的断言，随合并进来；维护者同意跟上游的这个行为。
- 最后一条：本工单没有截图，界面截图验收在 06 做。
