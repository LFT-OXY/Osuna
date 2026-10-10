# 04 — 第三段：合并到上游 v0.10.1

**What to build:** 合并分支上多一个把上游 `c5236c00d`（v0.10.1，本段 12 个提交，位于上游的补丁分支上）合进来的 merge commit。合完之后 Claude 模型列表里有 Sonnet 5.5，Codex 自定义提供方在回退后保留提供方与 Paseo 工具、按自己的 `CODEX_HOME` 读提示词、归档后从「导入会话」消失，OpenCode 换模型时清掉不支持的思考档位；Osuna 的 Codex 官方与第三方接口切换、子智能体权限归属、指令目录上报照常。规格见 `prd.md` 的「补丁分支」「冲突裁决 → Codex、Sonnet 5.5、OpenCode」。

**Blocked by:** 03
**Status:** ready-for-agent
**Impl:** doing

- [ ] 合并分支包含一个以合并前的分支头与 `c5236c00d` 为双亲的 merge commit。
- [ ] 每个冲突文件怎么裁的、依据哪条规则，逐个记在 `## Comments` 下；规则裁决不了的已停下来问过维护者。
- [ ] Codex 两边都留：上游的回退保留提供方与工具、按提供方读提示词、归档同步；Osuna 的接口切换、子智能体权限归属、指令目录上报、已装版本与一键升级。Codex 会话与提供方注册的测试通过，Osuna 的断言无一改动。
- [ ] Sonnet 5.5 的清单条目是上游的写法，上游为它带来的测试通过。
- [ ] OpenCode 1.x 换模型清思考档位的上游改动已收；01 里对取指令列表的裁决没有被这一段冲掉。
- [ ] 与 Osuna 同名的安卓商店说明文件留 Osuna 的；版本号仍是 `0.14.2`；`CHANGELOG.md` 与合并前逐字节相同。
- [ ] `docs/release.md`「合并后核对」逐项过完，结果记在 `## Comments` 下。
- [ ] 对本段冲突涉及的测试文件对比合并前后，没有 Osuna 的断言行被悄悄删掉。
- [ ] typecheck 和 lint 通过；本段冲突文件对应的测试文件逐个单独跑过并通过。
- [ ] 已推送，草稿 PR 上本段的 CI 已看过；失败项逐个有结论。
- [ ] UI：新建智能体 / Claude 模型列表 / 桌面 1280 — 列表里有 Sonnet 5.5。截图存入 `screenshots/`。

## Comments

### 2026-10-11 实施记录

**本段上游的 12 个提交。** `0c1814496`（Codex 回退后保留自定义提供方与 Paseo 工具）、`c938e1cf4`（#5379，运行 `cursor-agent` 的终端配置显示 Cursor 图标）、`b013e0d42`（#5450，Codex 从提供方自己的 `CODEX_HOME` 读提示词）、`09f87df1b`（#5386，后台 `send_agent_prompt` 对已接受的提示返回运行中）、`b44e7b0b9`（#5451，子智能体开在打开它的分屏里）、`437aef1a7`（#1987，Windows 上文件链接显示相对路径）、`006bae289`（#5572，归档智能体时一并归档自定义 Codex 提供方的会话）、`2c6d4e528`（#5577，流式回复里以缩进结尾的分片保留换行）、`12cd5345d`（#5583，Sonnet 5.5）、`9f387873b`（#5587，OpenCode 换模型时清掉不支持的思考档位）、`d1443064d`（更新日志）、`c5236c00d`（发版提交，只改版本号）。

**提交。** merge commit `260c79631`（双亲 `586d716fa` 与 `c5236c00d`）；紧跟的适配提交见文末「推送后的 CI」。两次提交的钩子（lint、format、typecheck）都通过。合并后本地 tag 仍是 14 个，`git tag | shasum` 不变。

#### 冲突（22 个：18 个机械性 + 4 个代码）

机械性的 18 个，做法与 03 相同：脚本只把冲突块取 HEAD 一侧，冲突块之外保持自动合并的结果，再用 `shasum -c` 对合并前的指纹核对。指纹清单 89 个文件（仓库里全部 `package.json`、`package-lock.json`、`CHANGELOG.md`、安卓商店说明），全部一致。

| 文件 | 裁决 | 依据 |
| --- | --- | --- |
| 12 个 `package.json` | 冲突块取 Osuna（版本号、`@getpaseo/*` 内部依赖），共 17 个冲突块。解完与合并前逐字节相同：上游这一段在冲突块之外没有加东西 | 版本号与发版元数据表 |
| `package-lock.json` | 冲突块取 Osuna 后与合并前逐字节相同；再用 `npm install --package-lock-only --ignore-scripts` 重新生成，仍逐字节相同。上游这一段没有改外部依赖 | 同上 |
| `CHANGELOG.md` | 冲突块取 Osuna，与合并前逐字节相同 | 同上 |
| `fastlane/metadata/android/en-US/changelogs/100011.txt` – `100014.txt` | 留 Osuna 的，与合并前逐字节相同（add/add，上游的 0.10.1 与 Osuna 的版本号算出了同名文件） | 同上 |

代码的 4 个：

| 文件 | 裁决 | 依据 |
| --- | --- | --- |
| `codex-app-server-agent.ts`（3 个冲突块） | 见下一节 | prd「Codex」：两边都留；ADR 0003 |
| `provider-registry.test.ts` | 两边的用例都留：Osuna 的两条（包装后的 Claude 配置保留不启动进程的指令发现、保留升级用的 CLI 启动方式），上游的一条（继承 Codex 的提供方归档与取消归档原生会话） | 规则 3 |
| `claude/agent.test.ts` | 「Ultra Code」那条用例的假版本号取上游的 `2.1.284`。Osuna 为 Opus 5.5 把它从 `2.1.219` 改成了 `2.1.280`，上游为 Sonnet 5.5 改成 `2.1.284`；同一条用例里两边的断言都要成立，取较高的那个。Osuna 的断言行一行没动 | 规则 3 |
| `e2e/browser/file-editing.spec.ts` | 冲突块里两边的 import 都留：Osuna 的 `expectDiagramWithLabels`，上游新用例用到的 `seedWorkspace`、`getServerId`、`waitForSidebarHydration`。上游同时加的 `gotoAppShell` 那一行在冲突块之外，是自动合并的 | 规则 3 |

模拟合并（对 main 一次合到 v0.10.1）里本段新增的两个 Codex 文件都如期冲突。`claude/agent.test.ts` 与 `file-editing.spec.ts` 在 01 里解过，这一段上游又改了相邻的行，所以再冲突一次。

#### Codex：`codex-app-server-agent.ts`

上游 #5450 把「Codex 主目录」从读 daemon 自己的环境变量改成按会话传入（`deps.codexHome`，由提供方的运行环境算出），提示词与技能都从它读。Osuna 这边取指令列表走的是另一套结构（ADR 0003）：会话的 `listCommands()` 只问已连上的 app-server、不为取列表重连；草稿的列表来自客户端级的 `discoverCommands()` 目录扫描；每轮结束上报 `commands_changed`。

- 冲突块 1：取上游的新签名 `listCodexCustomPrompts(codexHome)`。上游一侧冲突块里带着的 `parseFrontMatter` 是基点原有的函数，Osuna 已把它挪到 `front-matter.ts`，不收回来。
- 冲突块 2：`listCommands()` 取 Osuna 的（未连接时返回 `null`，不调 `connect()`）。上游这里的改动只是把 `this.codexHome` 传给读提示词的函数，在冲突块 3 里体现。
- 冲突块 3：结构取 Osuna 的（`buildAppServerCommands` / `reportAppServerCommands` / `listInvocableCommands`），读提示词改成上游的 `listCodexCustomPrompts(this.codexHome)`。上游一侧的 `fallbackSkills` 与内联的内置指令在 Osuna 这边对应 `listInvocableCommands` 里的目录扫描与 `codexBuiltinCommands`，不重复收。
- 冲突块之外，git 自动合并出了一处编不过的地方：上游把 `listCodexSkills` 里的 `resolveCodexHomeDir()` 换成了参数 `codexHome`，而那段函数体在 Osuna 这边已拆到 `scanCodexSkills` 里，合并后引用了一个不存在的变量。给 `scanCodexSkills` 与 `discoverCodexCommands` 各加一个 `codexHome`，会话一侧传 `this.codexHome`；`scanCodexSkills` 因此有三个入参，按 `docs/coding-standards.md` 改成对象参数。merge commit 里客户端级的 `discoverCommands()` 传的是 `resolveCodexHomeDir(process.env)`，与合并前的行为相同。
- 上游的其余改动（`resolveCodexHomeDir(env)`、`sessionDeps(launchEnv)`、执行 `/prompts:` 时从会话的主目录读文件、回退时把 `buildCodexInnerConfig()` 传给 fork）都是自动合并，原样收下。

**适配（单独提交）。** 客户端级的 `discoverCommands()` 也按提供方自己的 `CODEX_HOME` 读（`resolveCodexHomeDir(buildCodexAppServerEnv(this.runtimeSettings))`）。不这样做的话，上游 #5450 在 Osuna 里只对已经连上的会话生效，自定义提供方的新会话 `/` 菜单仍列出 daemon 主目录下的提示词，对不上 prd 的用户故事 23。`buildCodexAppServerEnv` 只是合并环境变量，不启动进程，不违反 ADR 0003。先在 `codex-app-server-agent.test.ts` 加了一条用例「discovers prompts and skills from the CODEX_HOME a custom provider runs Codex with」并确认失败（列出的是 daemon 主目录下的），再改实现。

Osuna 一侧核对过仍在的：`listCommands()` 不重连（用例「does not reconnect a disconnected app-server to list commands」）、`discoverCommands()` 不启动 app-server 也不跑 git、官方与第三方接口切换（`customProviderConfig` / `buildCodexInnerConfig`）、子智能体权限归属、`commands_changed` 上报、已装版本与一键升级。上游的两条新用例（自定义提供方的提示词列表与执行）不用改就通过：`createSession` 之后会话已连接。

#### 自动合并的 28 个文件

- **Sonnet 5.5**（`claude/model-manifest.ts`、`claude/models.test.ts`、`cli/tests/15-provider.test.ts`）：清单条目是上游的写法，一字未改（`minimumClaudeCodeVersion: "2.1.284"`、1M 上下文、不能关思考）；上游同时把 Sonnet 5 的说明改成「Previous release」。Osuna 的 Opus 5.5 条目与它的用例不受影响。
- **OpenCode**（`opencode-agent.ts`、`opencode-agent.test.ts`、`opencode/v2/session.ts`、`opencode/v2/agent.test.ts`、`opencode-model-switch.real.spec.ts`）：1.x 与 2.x 的 `setModel()` 换模型时查目标模型支持的档位，不支持就清掉并发 `thinking_option_changed`；`agent-manager.ts` 在换模型后多调一次 `refreshSessionPersistence`。01 的裁决没有被冲掉：1.x 的 `listCommands()` 仍只用已持有的服务、不调 `reconnectIfServerExited()`（上游这一段在 `setModel()` 里新加了一次重连，那是换模型，不是取列表）。01 留给 05 的那一条不受影响：2.x 会话的 `listCommands()` 仍先调 `reconnectIfExited()`。
- **Codex 其余**（`codex/rewind.ts`、`provider-registry.ts`、`codex-app-server-agent.test.ts`、`codex-custom-provider-archive.local.e2e.test.ts`）：回退时把提供方配置带进 fork；包装层转交 `archiveNativeSession` / `unarchiveNativeSession`。
- **其余**：`paseo-tools.ts` 与 `mcp-server.test.ts`（#5386）、`agent-manager.test.ts`、`open-beside.ts` 与两个 e2e（#5451）、`assistant-file-links/` 三个文件与 `workspace/file-open/` 两个文件（#1987）、`agent-stream/presentation.ts` 及其测试（#5577）、`protocol/src/terminal-profiles.ts` 及其测试（#5379）。

#### 合并后核对

- 更新源：`electron-builder.yml` 的 `publish` 仍是 `LFT-OXY/Osuna`。
- 桌面身份与数据目录：`appId` `com.chinhae.osuna.desktop`、`productName` `Osuna`；`main.ts` 仍把 userData 固定在原目录名。
- 签名与签名断言：`mac-sign.js` 钩子、`OSUNA_MAC_SIGNING_SHA1`、`Verify macOS signature` 都在；`notarize: false`，没有 Apple 公证变量。
- 部署工作流：四个文件的 `on:` 只有 `workflow_dispatch`。
- 以上四项涉及的 `packages/desktop`（`package.json` 除外，它与合并前逐字节相同）、`.github`，以及 `packages/app/src/i18n`：相对合并前没有任何差异。
- 上游站点链接数：app 72 / 1，cli 13 / 3，与合并前相同。
- 翻译键：本段上游没有改翻译资源；`i18n/resources.test.ts` 通过。
- `COMPAT(...)`：本段没有新带进来的标签。
- 协议：协议包只改了 `terminal-profiles.ts` 里命令名到图标名的对照表（加一条 `cursor-agent` → `cursor`），没有动任何线上 schema。
- 版本号仍是 `0.14.2`；本地 tag 仍是 14 个，`git tag | shasum` 仍是 `8625da06…`。

#### 测试文件对比

本段新增或改动过的测试文件 18 个。相对合并前被删掉或改掉的行共 7 行，逐行对过基点 `c481ecf3e`：

- 上游改自己的行（基点里就有、Osuna 没碰过）：`cli/tests/15-provider.test.ts` 2 行（「日常模型」从 Sonnet 5 换成 Sonnet 5.5）、`terminal-profiles.test.ts` 1 行（`cursor-agent` 从「没有图标」的清单里拿掉）、`claude/models.test.ts` 1 行（默认假版本号 `2.1.280` → `2.1.284`）、`codex-app-server-agent.test.ts` 1 行（`listCodexSkills` 多一个参数）、`opencode/v2/agent.test.ts` 1 行（import）。
- `claude/agent.test.ts` 1 行：上面冲突表里的假版本号，是测试的输入，不是断言。

没有 Osuna 的断言行被删掉或放宽。

#### 验证

- `npm run typecheck`、`npm run lint`、`npm run format:check`：通过。挪开 `packages/app/.expo` 与 `packages/app/node_modules/.vite` 后单独复核了 app 的 typecheck，通过。
- 本机逐个跑过的测试文件：`codex-app-server-agent.test.ts` 168（merge commit 那一笔是 167，适配提交加 1 条）、`provider-registry.test.ts` 52、`claude/agent.test.ts` 89、`claude/models.test.ts` 55、`opencode-agent.test.ts` 140、`opencode/v2/agent.test.ts` 19、`agent-manager.test.ts` 201、`mcp-server.test.ts` 128、`protocol/src/terminal-profiles.test.ts` 67；app 的 `agent-stream/presentation.test.ts`、`assistant-file-links/tooltip-path.test.ts`、`workspace/file-open/index.test.ts`、`i18n/resources.test.ts` 四个文件共 86。
- Playwright（`--project=browser`）：`file-editing.spec.ts`、`subagent-origin-pane.spec.ts`、`launcher-tab.spec.ts` 共 39 条通过。
- 本机没有跑的：`cli/tests/15-provider.test.ts`（交给 CI 的 cli-tests）；`codex-custom-provider-archive.local.e2e.test.ts` 与 `opencode-model-switch.real.spec.ts` 没有跑，也不在 PR 的 CI 里。前者不需要登录（它让真实的 `codex` 程序连一个本地的假接口，主目录是临时目录），但要在本机运行真实的 `codex`，维护者的约定是不在本机跑；后者要真实的 OpenCode。所以「归档后从导入会话里消失」（用户故事 21）在本机只有 `provider-registry.test.ts` 里包装层转交的那条用例作证，端到端没有实测。
- 整套测试交给 CI。

#### 截图

`screenshots/new-agent_claude-model-list-sonnet-5-5_desktop-1280.png`：dev 桌面端（1280 宽，本机 Claude Code 2.1.295），新建 Agent 草稿 → 提供方选 Claude → 点开模型列表，滚到中段，Sonnet 5.5 排在 Opus 4.8 之后、Sonnet 5 之前，说明文字是「Best for everyday tasks」。截图前用 DOM 把输入框下方的套餐档位与用量读数隐藏了（仓库是公开的），其余画面未动。

#### 评审（2026-10-11）

提交前对未提交的 merge 做了 Standards、Spec、Visual 三个维度的评审，各修一次、只对修过的地方复查一次。

- Standards：一条硬性违规，`scanCodexSkills(cwd, codexHome, repoRoot)` 三个位置参数，违反 `docs/coding-standards.md`「3+ args → object」。已改成对象参数，复查通过。判断项如实报给维护者、没有处理：`resolveCodexHomeDir(buildCodexAppServerEnv(…))` 在 `sessionDeps`（上游）与 `discoverCommands()` 各写了一遍，抽出来要动上游那一行；`discoverCommands(cwd)` 拿不到按智能体传入的环境变量，按智能体覆盖 `CODEX_HOME` 时草稿扫描与会话读的目录会不同，是接口所限；新用例的双主目录夹具与上游的 `withCustomCodexProviderHome` 形状相近，后者会起假 app-server，不能复用；上游的 `listPromptCommandsFromCustomCodexHome` 对 `session.listCommands!()` 的结果直接 `.map`，在 Osuna 这个返回值可以是 `null`，只有 `skills/list` 失败时才会出错。
- Spec：没有范围蔓延，没有实现错误。`discoverCommands()` 的适配在范围内（不改则用户故事 23 对草稿不成立），不违反 ADR 0003。指出的问题：适配要与 merge commit 分开提交，且 merge commit 那个中间状态要验证过（已拆成两笔，中间状态跑过 `codex-app-server-agent.test.ts` 167 条、`provider-registry.test.ts` 52 条与 server 的 typecheck）；本记录三处写得不准（`gotoAppShell` 的 import、没跑归档 e2e 的理由、测试条数），已按实际改正，复查通过。留给维护者的一条：用户故事 21 的归档同步没有端到端实测，见「验证」。
- Visual：验收点满足，列表里有 Sonnet 5.5。没有这次合并带来的视觉缺陷。两条都是既有情况：模型列表每行的说明文字先重复一遍模型名（上游清单的文案），有区分度的后半句被省略号截掉；行高约 40，`docs/design.md` 写桌面菜单行高 30、紧凑 40，这个弹层是否适用那一条未核对。都没有在本次处理。
- 新增的一条用例（`discoverCommands()` 读提供方自己的 `CODEX_HOME`）要列进 PR 正文：prd 写的是只用已有的和上游带来的测试，这一条加在已有的测试文件里。留给 07。

#### 规范回写

- `.atw/spec/server/backend/quality-guidelines.md`「Provider directories」补上 Codex 的写法与对应用例。
- `docs/release.md`「踩过的坑」补一条：上游修会话级的取指令列表时，Osuna 客户端级的 `discoverCommands()` 要对照补上。
