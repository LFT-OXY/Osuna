# 05 — 第四段：合并到上游 v0.10.2，并核实 OpenCode 2.x 路径

**What to build:** 合并分支上多一个把上游 `919c737c1`（v0.10.2，本段 7 个提交，5 个是 OpenCode 2.x 的修复）合进来的 merge commit。到这一段 OpenCode 2.x 路径的代码已经齐了，在这里把它对着 Osuna 的决定核实一遍：2.x 取指令列表同样不启动进程、不拉起服务（ADR 0003）；Osuna 加在 1.x 路径上的独有行为哪些在 2.x 上缺失，列成一份经过核实的清单，供 07 写进 PR 正文并记成后续任务。缺失的行为这次不移植。规格见 `prd.md` 的「冲突裁决 → 指令列表、OpenCode」与「Out of Scope」。

**Blocked by:** 04
**Status:** ready-for-agent
**Impl:** done

- [x] 合并分支包含一个以合并前的分支头与 `919c737c1` 为双亲的 merge commit。
- [x] 冲突文件的裁决与依据记在 `## Comments` 下；模拟合并里这一段没有新的代码冲突，出现时按 `prd.md` 的规则裁决。
- [x] 版本号仍是 `0.14.2`；`CHANGELOG.md` 与合并前逐字节相同；`docs/release.md`「合并后核对」逐项过完。
- [x] OpenCode 2.x 路径取指令列表的行为已读代码核实，结论与依据记在 `## Comments` 下：对已有会话、对新会话各是怎么取的，是否会启动进程、拉起或重连服务。
- [x] 若 2.x 路径取指令列表会启动进程或拉起服务：已改成只用会话已持有的服务，有测试守着，改动在 merge commit 之后单独提交。若不会：不改代码。
- [x] OpenCode 2.x 上缺失的 Osuna 行为清单记在 `## Comments` 下，逐项写明核实方式（读了哪段逻辑）。至少核实：`paseo.create_agent` 的工具名规范与父工具调用归属、子智能体权限请求的归属、向指令目录上报指令列表、已装版本显示、一键升级。
- [x] OpenCode 1.x 路径的现有测试全部通过，无一改动断言；上游为 2.x 带来的测试通过。
- [x] typecheck 和 lint 通过。
- [x] 已推送，草稿 PR 上本段的 CI 已看过；失败项逐个有结论。

## Comments

### 2026-10-11 实施记录

**本段上游的 7 个提交。** `ee89f4917`（#5609，2.x 已完成的编辑保留编辑文本）、`e26eb483e`（#5674，2.x 长轮次靠执行事件收尾，不再用会超时的 `session.wait`）、`86df0587b`（#5679，2.x 问题卡片显示题目并允许打字作答）、`9744da6e4`（#5696，2.x 补丁式编辑显示为差异）、`81fc6134a`（#5710，2.x 轮次中上下文用量有读数）、`c5b4b7bae`（更新日志）、`919c737c1`（发版提交，只改版本号）。

**提交。** merge commit `a36ecb8de`（双亲 `d6a32fb08` 与 `919c737c1`）；紧跟的适配 `cc9a3cb9e`。两次提交的钩子（lint、format、typecheck）都通过。合并后本地 tag 仍是 14 个，`git tag | shasum` 不变。

#### 冲突（14 个，全部机械性）

模拟合并里这一段没有新的代码冲突，实际也没有。做法与 03、04 相同：脚本只把冲突块取 HEAD 一侧，冲突块之外保持自动合并的结果，再用 `shasum -c` 对合并前的指纹核对。指纹清单 89 个文件（仓库里全部 `package.json`、`package-lock.json`、`CHANGELOG.md`、安卓商店说明），全部一致。

| 文件 | 裁决 | 依据 |
| --- | --- | --- |
| 12 个 `package.json` | 冲突块取 Osuna（版本号、`@getpaseo/*` 内部依赖），共 17 个冲突块。解完与合并前逐字节相同：上游这一段在冲突块之外没有加东西 | 版本号与发版元数据表 |
| `package-lock.json` | 16 个冲突块取 Osuna 后与合并前逐字节相同；再用 `npm install --package-lock-only --ignore-scripts` 重新生成，仍逐字节相同。上游这一段没有改外部依赖 | 同上 |
| `CHANGELOG.md` | 冲突块取 Osuna，与合并前逐字节相同 | 同上 |

安卓商店说明这一段没有冲突：上游新增的 `100021.txt` – `100024.txt`（上游 0.10.2 的说明）在 Osuna 这边没有同名文件，按上游的进来，与 v0.9.2 那次的 `90011.txt` – `90024.txt` 是同一种情况。

#### 自动合并的 18 个文件

- `opencode/v2/` 下 10 个文件（`session.ts`、`turns.ts`、`permissions.ts`、`api.ts`、新增的 `usage.ts`，以及测试文件 `agent.test.ts`、`permissions.test.ts`、`streaming.test.ts`、新增的 `timeline.test.ts` 与 `usage.test.ts`）与 `opencode/test-utils/v2-harness.ts`：合并前与上游 `c5236c00d` 逐字节相同，合并后与上游 `919c737c1` 逐字节相同。2.x 路径按上游的原样收下。
- `opencode/tool-call-detail-parser.ts`：1.x 与 2.x 共用。上游加了两处：工具名 `patch` 映射成编辑详情、编辑输入里文件字段叫 `path` 的形状。1.x 的映射测试 21 条通过。
- `opencode/tool-call-mapper.test.ts`：上游加一条 `patch` 用例；Osuna 的 `paseo.create_agent` 用例原样在。
- `docs/providers.md`：上游加一段，说明 2.x 用执行事件触发轮次完成、不用 `session.wait`。
- 4 个安卓商店说明文件，见上。

#### OpenCode 2.x 取指令列表：核实结果

读的是合并后的代码。

**新会话（草稿）。** 不启动进程，不拉起服务，没有改动。`AgentManager.listCommands()`（`agent-manager.ts`）对草稿只调客户端的 `discoverCommands(cwd)`。OpenCode 的客户端是版本选择包装层 `OpenCodeRuntimeClient`（`opencode/runtime-client.ts`），它的 `discoverCommands()` 直接交给 1.x 客户端，返回 `compact`、`summarize` 两条固定的内置指令；不走 `this.client()`，所以不跑 `opencode --version`，也不加载 2.x 的代码。这两条内置指令对 2.x 成立：`v2/turns.ts` 的 `dispatch()` 把 `/compact` 与 `/summarize` 都交给 `session.compact`。`runtime-client.test.ts` 里 01 加的用例守着这一条。

**已有会话。** 合并进来的写法会启动进程：`OpenCodeV2Session.listCommands()`（`v2/session.ts`）先调 `reconnectIfExited()`，辅助服务已退出时走 `reconnect()` → `acquire()` → `V2Runtime.acquire()` → `start()`，后者 `spawnProcess(opencode serve …)` 起一个新的服务进程，再等它就绪、重放 MCP 与系统提示词。违反 ADR 0003 与 `AgentSession.listCommands` 的接口约定（`agent-sdk-types.ts`：「Never start a process or reconnect to get it … return null when nothing is running」）。

**已改（merge commit 之后单独提交）。** `listCommands()` 在会话已关闭或辅助服务已退出时返回 `null`，否则只向会话已持有的服务取（`plugin.list` 就绪检查、`command.list`、`skill.list` 三个 HTTP 请求）。返回 `null` 后指令目录给出上次记下的列表加内置指令，与 1.x 一致。先在 `v2/agent.test.ts` 加了一条用例「lists commands only from the helper the session already holds」并确认失败，再改实现。用例里的假运行时第二次被要求取服务就抛错；它断言三件事：服务在时返回该服务报的列表（两条内置指令、一条配置的指令、一条技能），服务退出后返回 `null` 且没有第二次取服务，会话关闭后返回 `null`。把实现换回上游写法，用例立刻以「Listing commands must not start a helper」失败，调用栈是 `listCommands` → `reconnectIfExited` → `reconnect` → `acquire`。这是 `opencode/v2/` 下第一处与上游不同的地方，上游以后改 `listCommands()` 那几行会冲突。

没有改、如实记下的两点：

- 2.x 客户端级的 `OpenCodeV2AgentClient.listCommands(config)`（`v2/agent.ts`）会为取列表 `runtime.acquire()` 拉起服务。它在 Osuna 里没有调用方：`AgentClient` 接口没有这个方法，包装层不转交，`AgentManager` 只调 `discoverCommands`。保持上游原样，没有删。
- 已有会话取列表时，`commands()`（`v2/commands.ts`）先等位置就绪（`waitForLocationReady`，最长 30 秒）。它只发 HTTP 请求，不启动进程。会话初始化时已经等过同一个检查，服务一直在的情况下第一次请求就返回。例外是重连窗口：别的操作（发消息、换模型等）触发重连时，`reconnect()` 先换上新连接并把 `exited` 置回 `false`，再跑 `configureConnection()`；这时取列表会在刚起来的服务上等就绪，`/` 菜单要等到它就绪或 30 秒超时报错。进程是那次操作起的，不是取列表起的。没有改，列进下面的缺口表。

#### OpenCode 2.x 上缺失的 Osuna 行为

对照的是 Osuna 在 1.x 路径上相对上游多出的全部改动（`git diff 919c737c1 -- opencode-agent.ts opencode/`，`v2/` 除外）。

| 行为 | 2.x 上 | 核实方式 |
| --- | --- | --- |
| `paseo.create_agent` 的工具名规范 | 有 | `v2/timeline.ts` 的 `toolFromV2()` 调的是与 1.x 共用的 `mapOpencodeToolCall()`（`opencode/tool-call-mapper.ts`），后者把 `paseo_create_agent` 改写成 `paseo.create_agent`；2.x 的桥接插件（`v2/bridge-plugin.mjs`）注册的工具名同样是 `paseo_<name>`。只有共用函数的用例，没有 2.x 专门的用例，没有实测 |
| `create_agent` 的父工具调用归属 | **缺** | 1.x 的插件（`opencode/bridge-plugin.mjs`）把工具上下文的 `callID` 放进 `X-Paseo-Tool-Call-Id` 请求头，`bridge.ts` 读出来作为 `providerToolCallId` 传给工具执行。2.x 的插件（`v2/bridge-plugin.mjs`）的 `request()` 只带认证与内容类型两个头，`execute(input, call)` 里没有读调用编号。派发出去的子智能体因此不带父工具调用的归属 |
| 子智能体权限请求的归属 | **缺** | 1.x 在 `appendOpenCodePermissionAsked()` 与子会话问题转发两处给请求加 `providerSubagentPermissionMetadata(子会话 id)`。2.x 的 `SessionPermissions.reconcile(sessionID)`（`v2/permissions.ts`）对子会话也会被调用（`v2/children.ts` 的 `reconcileChild()`），但发出的权限请求与问题表单都不带 `metadata`；子会话 id 只留在内部的 `permissionOwners` 里用来回复 |
| 向指令目录上报指令列表 | **缺** | 1.x 在每轮开始后 `reportRunningCommands()` 发 `commands_changed`，`AgentManager` 据此写指令目录。`opencode/v2/` 下没有任何地方发 `commands_changed`。后果：2.x 的列表只在用户对一个运行中的 2.x 智能体打开 `/` 菜单时才被记下（`CommandCatalog.lookup()` 会记录 `live`）；在那之前，同目录草稿的 `/` 菜单只有两条内置指令，并带「列表不全」提示 |
| 已装版本显示 | 有 | 包装层的 `resolveInstalledVersion()` 交给 1.x 客户端，后者用配置的命令跑 `--version` 并解析，与走哪条路径无关（01 的记录已核实，这次复读了 `provider-cli-version.ts`） |
| 一键升级 | 有（入口） | 包装层的 `resolveCliLaunch()` 交给 1.x 客户端；升级执行的是 `opencode upgrade`（`provider-upgrade-command.ts`）。2.x 的命令行是否保留 `upgrade` 子命令，代码里看不出来，本机的 OpenCode 是 1.15.10，没有核实 |
| 取列表失败时返回 `null` 而不是只给内置指令 | 不同 | 1.x 的 `listOpenCodeCommandsFromSdk()` 在请求失败时返回 `null`。2.x 的 `commands()` 请求失败时抛错，`/` 菜单收到错误与空列表。服务已退出的情况这次已改成返回 `null`；服务还在但请求失败的情况没有改 |
| 取列表不等待 | 不同 | 1.x 的 `listCommands()` 只发一次 `command.list`。2.x 的 `commands()` 先等位置就绪；在上面写的重连窗口里会等到新服务就绪，最长 30 秒 |

缺的三项与最后两项这次不移植，留给 07 写进 PR 正文并记成后续任务。

**另外留给 07 写进 PR 正文的两条。**

- prd 写的是 PR 正文单列「没有收的两处上游改动」。这一段多出第三处同类的偏离：2.x 会话的 `listCommands()` 去掉了上游的 `reconnectIfExited()`，原因同样是 ADR 0003。行为差异：OpenCode 2.x 的辅助服务退出后，在下一次发消息把它重新拉起之前，`/` 菜单显示的是上次记下的列表加内置指令，不是实时列表。
- 新增的一条用例（`v2/agent.test.ts`「lists commands only from the helper the session already holds」）。prd 写的是只用已有的和上游带来的测试；这一条是工单要求的「有测试守着」，加在已有的测试文件里，与 04 那一条同样处理。

#### 合并后核对

- 更新源：`electron-builder.yml` 的 `publish` 仍是 `LFT-OXY/Osuna`。
- 桌面身份与数据目录：`appId` `com.chinhae.osuna.desktop`、`productName` `Osuna`；`main.ts` 仍把 userData 固定在原目录名。
- 签名与签名断言：`mac-sign.js` 钩子、`OSUNA_MAC_SIGNING_SHA1`、`Verify macOS signature` 都在；`notarize: false`。
- 部署工作流：四个文件的 `on:` 只有 `workflow_dispatch`。
- `packages/desktop`、`.github`、`packages/app`、`packages/protocol`、`packages/cli`、`packages/relay`：相对合并前没有任何差异。本段上游只动了 server 的 OpenCode 目录、`docs/providers.md` 与版本号类文件。
- 上游站点链接数：app 72 / 1，cli 13 / 3，与合并前相同。
- 翻译键：本段上游没有改翻译资源；`i18n/resources.test.ts` 38 条通过。
- `COMPAT(...)`：本段没有新带进来的标签。
- 协议：协议包没有改动。
- 版本号仍是 `0.14.2`；`CHANGELOG.md` 与合并前逐字节相同；本地 tag 仍是 14 个，`git tag | shasum` 仍是 `8625da06…`。

#### 测试文件对比

本段新增或改动过的测试文件 6 个。相对合并前被删掉或改掉的行在 `v2/agent.test.ts`（28 行）与 `v2/streaming.test.ts`（5 行）里；这两个文件合并前与上游 `c5236c00d` 逐字节相同，里面没有 Osuna 的用例，所以被改的是上游自己的行。`tool-call-mapper.test.ts`、`v2/permissions.test.ts`、`v2/timeline.test.ts`、`v2/usage.test.ts` 只有新增。1.x 路径的其余测试文件这一段没有变。

#### 验证

- merge commit 那个状态（适配之前）：`npm run typecheck`、`npm run lint`、`npm run format:check` 通过；下面清单里的 OpenCode 测试文件 24 个共 375 条通过。
- 加上适配之后：`npm run typecheck` 通过；改动的两个文件 lint 与格式检查通过。
- 本机逐个跑过的测试文件（适配之后）：`opencode-agent.test.ts` 140、`opencode-agent.full-access.test.ts` 12、`opencode-agent.list-models-timeout.test.ts` 6、`opencode-agent.permission-actions.test.ts` 2、`opencode-agent.recovery.test.ts` 5、`opencode-agent.slash-command-timeout.test.ts` 8、`opencode-bridge-adapter.test.ts` 2、`opencode-server-manager.test.ts` 20（另有 1 条只在 Windows 上跑）、`opencode/bridge.test.ts` 8、`event-consumer.test.ts` 14、`event-translator.test.ts` 38、`rewind.test.ts` 4、`runtime-client.test.ts` 20、`subagent-presentation.test.ts` 10、`tool-call-mapper.test.ts` 21、`v2/agent.test.ts` 29（merge commit 那一笔是 28，适配加 1 条；评审后改写过这一条，改写后重跑 29 条通过）、`v2/configuration.test.ts` 5、`v2/mapping.test.ts` 1、`v2/permissions.test.ts` 4、`v2/readiness.test.ts` 3、`v2/streaming.test.ts` 4、`v2/timeline.test.ts` 1、`v2/usage.test.ts` 1、`terminal/agent-hooks/opencode/opencode.test.ts` 18、`agent-manager.test.ts` 201、`provider-registry.test.ts` 52；app 的 `i18n/resources.test.ts` 38。
- 本机没有跑的：需要真实 OpenCode 的 `*.real.e2e.test.ts` 与 `*.local.e2e.test.ts`（其中 `opencode-v2.local.e2e.test.ts` 里有两处对已连接的会话调 `listCommands`）。OpenCode 2.x 与任何提供方的登录不在本机实测，见 prd「Out of Scope」。
- 整套测试交给 CI。

#### 评审（2026-10-11）

提交前对未提交的 merge 加适配做了 Standards、Spec 两个维度的评审（本工单不改界面，没有 Visual 维度），修一次、只对修过的地方复查一次。

- Standards：没有硬性违规。判断项里处理了三条：新用例只守了「服务已退出」一支，「会话已关闭」没有断言（已补）；新用例在旧代码上是卡到 30 秒超时才失败，不是以明确的原因失败（已改成假运行时第二次取服务就抛错，旧代码上 7 毫秒失败）；夹具变量叫 `first` 却没有 `second`（已改名 `harness`）。没有处理、如实报给维护者的：新用例的脚手架与上一条上游用例相同，抽出来要动上游的行；`this.closed || this.exited` 两个子句没有另起名字，与 1.x 同形；这一行注释是中文，1.x 同一处是英文。上游代码里字面上不合 `docs/testing.md` 的三处（`v2/agent.test.ts` 的「recovers a missed completion through %s」用例体里有分支且一支靠真实计时、`v2/usage.test.ts` 用 `setTimeout` 排序、新增的 8 条用例重复同一段样板）按原样收下，没有改。
- Spec：没有范围蔓延，没有阻断项；调用链与缺口表逐行对过代码，结论一致，没有发现漏列的 1.x 独有行为。指出的问题：给 07 的交接不全（第三处偏离与新用例要进 PR 正文，已补）；新用例不守「正常取得到列表」，误改成恒返回 `null` 不会被发现（已补正向断言）；本记录两处写得不准（「初始化时已经等过」在重连窗口不成立；`v2/timeline.test.ts` 也是新增文件），已按代码改正。
- 复查：改写后的用例在上游写法上失败、在适配后通过；`v2/agent.test.ts` 29 条通过；两个文件的 lint 与格式检查通过。

#### 规范回写

- `docs/providers.md`：每轮上报指令列表的那一句写明是 OpenCode 1.x；2.x 会话不上报，列表只在对运行中的智能体打开 `/` 菜单时进指令目录。
- `docs/release.md`「踩过的坑」补一条：上游整套新写的提供方路径按原样收下时，它的会话级 `listCommands()` 不会冲突，要逐个打开看有没有先重连再取列表。
- `.atw/spec/server/backend/quality-guidelines.md`「Listing commands never starts a provider process」补上 OpenCode 1.x 与 2.x 的重连函数名与对应用例。

#### 推送后的 CI（2026-10-11）

工单 04 的关票提交 `d6a32fb08`、merge commit `a36ecb8de` 与适配 `cc9a3cb9e` 推到 `origin/merge-upstream-v0.10.3`。草稿 PR #15 上 CI（运行 38083690752）第一次 19 项里 18 项通过、1 项失败；重跑失败项后 19 项全部通过。另一个工作流 `Desktop Packages`（运行 38083690682）通过。

失败的 1 项是 app-tests：688 个测试文件里 1 条失败，`src/components/ui/autocomplete.browser.test.tsx`「Command menu › scrolls a group's title into view with its first row」，断言分组标题已滚出可视区时它还在。这是已知的 CI 偶发（指令菜单的滚动用例）；本段相对合并前在 `packages/app`、`packages/protocol`、`packages/client` 下没有任何差异。`gh run rerun --failed` 后通过，没有改代码。

server-tests 三个平台第一次就通过，包含本段新增的 `v2/agent.test.ts` 用例与 04 记下的那条 Windows 上偶发超时的 `opencode-bridge.local.e2e.test.ts`。

playwright 里首次失败、重试后通过的 5 条，都不是本段带来的（本段没有改 app）：

- `settings-providers-list-detail.spec.ts:58`：与 02 – 04 记录的是同一条。
- `usage-page-details.spec.ts:80`、`composer-diff-stat.spec.ts:60`、`composer-provider-selector.spec.ts:243`、`sidebar-context-menu.spec.ts:17`：前三次运行（38064080720、38071614134、38079909604）里没有出现过。对照那三次，每次重试后通过的用例都不一样（`agent-tab-image-stability`、`creation-old-daemon`、`plugin-buttons`、`command-center-file-search` 等各出现一两次），只有 `settings-providers-list-detail.spec.ts:58` 每次都在。
