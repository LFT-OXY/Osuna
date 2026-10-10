# 01 — 第一段：合并到上游 v0.10.0-beta.1

**What to build:** 合并分支 `merge-upstream-v0.10.3` 上有一个把上游 `52d345db7`（v0.10.0-beta.1，同步点之后的前 33 个提交）合进来的 merge commit，并开出指向 main 的草稿 PR。合完之后 Osuna 多出上游这一段的内容——OpenCode 2.x 支持、Pi 扩展适配、带密码主机的连接、设置页新分栏、约 20 个修复——而 Osuna 自己的功能和有意做的决定都在：指令列表仍不启动进程，Pi、OpenCode 1.x、OMP 的 `paseo.create_agent` 命名与子智能体权限归属、各提供方的已装版本与一键升级照常。设置页在这张工单结束时按上游的分栏能打开、能用，外观与文案的细调留给 02。这一段占本次 33 个代码冲突文件里的 29 个。规格见 `prd.md` 的「合并方式」「冲突裁决」「版本号与发版元数据」「协议与兼容」；冲突清单见 `research/discovery.md`。

**Blocked by:** None — can start immediately
**Status:** ready-for-agent
**Impl:** doing

- [x] `upstream` remote 已抓到五个发布点的提交，仍配置为不抓取 tag；合并前后本地 tag 列表不变。
- [x] 合并前按 `docs/release.md`「合并后核对」的口径统计一次应用与 CLI 源码中指向上游站点的链接数，记在本工单的 `## Comments` 下，作为后续各段的基线。
- [x] 合并分支包含一个以合并前的分支头与 `52d345db7` 为双亲的 merge commit。
- [x] 每个冲突文件怎么裁的、依据哪条规则，逐个记在 `## Comments` 下，供 07 写 PR 正文用。规则裁决不了、或保留两边会改变用户可见行为的冲突没有自行取舍：已停下来问过维护者，问答记在 `## Comments` 下。
- [x] 应用级设置栏目清单是上游的：通用、外观、侧边栏、聊天、终端、浏览器、编辑器、快捷键、集成、通知、权限、诊断、关于；「布局」不再出现。设置项的归属按 `prd.md`「设置页分栏」。
- [x] Osuna 独有的设置项与页面都在：终端字体与终端字号在「外观」的字体分组，系统字体选择器、字号重置、终端预览、深浅色配对、Providers 两级页、用量页、关于页的应用更新卡片、提及智能体默认值卡片。
- [x] 提示框组件的接口是两边的并集，Osuna 现有调用方无一改坏。
- [x] 指令列表保持 Osuna 的做法：通用 ACP 智能体首次取列表不等待程序报回，OpenCode 1.x 取列表前不重连；指令目录的现有测试全部通过，无一改动断言。上游为「等待程序报回」新增的测试已按 Osuna 的行为改写或移除，处理方式记在 `## Comments` 下。
- [x] 上游「切换分支后刷新项目技能」的改动已收；新会话指令查询的键取上游的结构，Osuna 有意去掉的 mode / model / thinking / features 不加回来（维护者 2026-10-10 确认，原文「键两边的字段都在」的前提有误，见 `## Comments`）。
- [x] Pi 以上游按扩展拆分的适配器写法为底；`paseo.create_agent` 命名与父工具调用归属、`display:false` 的 custom 消息不进时间线、skill 展开块还原、思考档位按模型过滤、已装版本与一键升级的现有测试全部通过，无一改动断言。
- [x] OpenCode 1.x 的桥接以上游写法为底；`paseo.create_agent` 命名与子智能体权限归属的现有测试全部通过，无一改动断言。
- [x] Claude 两边都留：上游从提供方自己的配置目录读历史，Osuna 的已装版本、一键升级与 CLI 启动解析；对应测试通过。
- [x] 所有工作区版本号仍是 `0.14.2`；各 `package.json` 相对合并前的差异只有上游在冲突块之外加的内容；`package-lock.json` 是重新生成的，差异只有上游新增的那个外部依赖及其传递依赖。
- [x] `CHANGELOG.md` 与合并前逐字节相同。
- [x] 协议新增的字段都是可选的；上游新带进来的 `COMPAT(...)` 标签已按「合并后核对」改写版本号。
- [x] `docs/release.md`「合并后核对」逐项过完，结果记在 `## Comments` 下；任何一项有变化都已查清原因。
- [x] 翻译资源测试通过；上游新增的键九种语言齐全。
- [x] 对本段冲突涉及的测试文件对比合并前后，没有 Osuna 的断言行被悄悄删掉；因分栏变化必须跟着改的断言逐条记在 `## Comments` 下。
- [x] typecheck 和 lint 通过；本段冲突文件对应的测试文件逐个单独跑过并通过。
- [ ] 合并分支已推到 `origin`，并开出指向 main 的草稿 PR（推送与开 PR 前先向维护者说明并取得同意）。

## Comments

### 2026-10-10 实施记录

**提交。** merge commit `0535af41b`（双亲 `56cccc196` 与 `52d345db7`）；紧跟的适配 `0cfd79d03`。两次提交的钩子（lint、format、typecheck）都通过。合并后本地 tag 仍是 14 个，`git tag | shasum` 不变。

**抓取与 tag。** `upstream` 的 `tagOpt` 是 `--no-tags`，五个发布点（`52d345db7`、`c481ecf3e`、`c5236c00d`、`919c737c1`、`b4af508e2`）与同步点 `c67b7158b` 都已在本机。合并前本地 tag 14 个（`git tag | shasum` = `8625da06…`），合并后复核见文末。

**上游站点链接数基线（合并前，`docs/release.md` 的口径）。**

| | 全部 | 非测试 |
| --- | --- | --- |
| `packages/app/src` | 70 | 1 |
| `packages/cli/src` | 13 | 3 |

本段合完：app 72 / 1，cli 13 / 3。多出的 2 处都在上游新带来的测试 `components/pair-link-credentials.test.ts` 里，是配对链接解析用的假地址；非测试数不变，界面上没有新增上游链接。

**问过维护者的两处（2026-10-10，评审后）。** 都记在下面「与规格的出入」里，维护者的答复：

- 问：新会话里只换模型或模式时，`/` 指令菜单要不要重新加载？答：保持现状，不重新加载。`prd.md` 那句话按更正后的写法保留。
- 问：Pi 的后台子智能体跑完后，聊天里要不要显示那条完成通知？答：不显示，按既定规则；不为 pi-subagents 开例外。
- 另：维护者同意本机提交后推送合并分支并开指向 main 的草稿 PR。

这两处我先按规则处理了再问的；评审（Spec 轴）指出第 1 处改的是维护者确认过的句子，应当先问。其余冲突规则都裁得动。

#### 机械性冲突（15 个）

| 文件 | 裁决 | 依据 |
| --- | --- | --- |
| 12 个 `package.json` | 冲突块取 Osuna（版本号、`@getpaseo/*` 内部依赖）。与合并前比对，只有 `packages/server/package.json` 多了上游在冲突块外加的两处：`@opencode/client 2.0.10` 与 `test:integration` 里追加的 `opencode-bridge.local.e2e` | 版本号与发版元数据表 |
| `package-lock.json` | 从合并前的文件出发用 `npm install --package-lock-only --ignore-scripts` 重新生成。相对合并前只多 15 个包（`@opencode/client` 及其传递依赖），逐个与上游锁文件一致。两处手工校正：`fast-check` 被解析成 4.10.2，改回上游锁定的 4.10.0；npm 给官网包的 `react` / `react-dom` / `scheduler` 多写的 `"peer": true` 去掉（两边的锁文件都没有） | 同上 |
| `CHANGELOG.md` | 冲突块取 Osuna，与合并前逐字节相同 | 同上 |
| `packages/app/src/provider-usage/settings-section.tsx` | 保持删除。Osuna 已把套餐用量搬进「用量」页，上游只给里面一个提示框加了 `size="sm"` | 踩过的坑：Osuna 已删除、上游又改了的东西 |

#### 代码与文档冲突（28 个）

| 文件 | 裁决 | 依据 |
| --- | --- | --- |
| `docs/glossary.md` | 侧栏词条取上游改写，Osuna 的三条字体词条保留 | prd「文档」 |
| `docs/providers.md` | Osuna 的 Pi custom 消息段落 + 上游重写的 OpenCode 段落；基点里的旧 OpenCode 段落随上游替换 | 规则 3 |
| `i18n/resources/zh-CN.ts` | 栏目键取上游（`sidebar` / `terminal` / `browser`，去掉 `layout`） | prd「设置页分栏」 |
| `pi/rpc-types.ts` | 字段并集：`customType`（一份）、`details`、`display` | 规则 3 |
| `pi/history-mapper.ts`、`pi/agent.ts` | 上游的扩展映射照常执行；`display:false` 的消息本身不进时间线（回放与实时两条路径） | prd「Pi」 |
| `pi/tool-call-mapper.ts` | 以上游为底：`resolveToolCallName`、MCP 代理命名、xdev、task 详情随上游挪进扩展目录。补回 Osuna 的 `readPaseoCreateAgentInput` / `parseMcpProxyArgs`，以及它们要用、上游已从本文件删掉的 `isRecord` / `readNonEmptyString` | 规则 2 |
| `pi/tool-call-mapper.test.ts` | 上游删掉的 task / subagent / MCP 命名用例随上游（已在扩展目录里有对应用例）。Osuna 的「Paseo create_agent calls」用例原样保留；它调用的 `resolveToolCallName` 已不存在，在测试文件里加了一个同名辅助函数，口径与 `agent.ts` 的 `emitToolCallEvent` 相同（扩展给了名字用扩展的，否则用解析出的工具名），断言一字未改 | 规则 2；测试规则 |
| `pi/agent.test.ts` | 两边各加一条用例，都留 | 规则 3 |
| `opencode-agent.ts` | `listCommands()` 取 Osuna：不调 `reconnectIfServerExited()`，只用已持有的服务，每轮上报 `commands_changed` | ADR 0003；prd「指令列表」 |
| `opencode/bridge.ts`、`opencode/bridge.test.ts` | 两边各加的函数与用例都留 | 规则 3 |
| `claude/agent.ts` | 上游的 `claudeConfigDir(env)` 与同一个 env 的模式目录；Osuna 的 `installedVersion`、`resolveInstalledVersion`、`resolveCliLaunch`。Osuna 的 `discoverCommands` 改用 `claudeConfigDir(this.buildProviderEnv())` | prd「Claude」 |
| `claude/models.ts` | Osuna 的 `resolveClaudeConfigDir` 删掉，留上游的 | prd「Claude」 |
| `claude/agent.test.ts` | Osuna 的版本号 `2.1.280` + 上游把 `configDir` 选项换成的 `runtimeSettings.env.CLAUDE_CONFIG_DIR` | 同上 |
| `generic-acp-agent.ts` | 取 Osuna：不传 `waitForInitialCommands`。与合并前逐字节相同 | ADR 0003；prd「指令列表」 |
| `hooks/agent-commands-query.ts` 及测试 | 见「与规格的出入」第 1 条 | 规则 1、规则 2 |
| `components/ui/control-geometry.ts` | 5 个冲突块取 Osuna 的圆角与分段控件写法。上游新增的提示框尺寸表（冲突块之外）照收 | prd「设置页分栏」外观条 |
| `components/ui/control-geometry.test.ts` | 两边各加的用例都留 | 规则 3 |
| `components/ui/alert.tsx` | 接口取并集：上游的 `size`；`icon` 属性上游已删、Osuna 没有调用方在用，不留。排布取上游（首行 + 缩进、按尺寸取尺寸表）。颜色按 Osuna：variant 样式表、`warning` 的浅底色块与 `radius.md`、图标用 `withUnistyles`，不用 `useUnistyles()` | prd「提示框组件」；`docs/unistyles.md` |
| `components/ui/dropdown-trigger.tsx` | 接口取并集：Osuna 的 `children: ReactNode`、`chevron`、`tone`，上游的 `leading`、`size`。`children` 是字符串时由触发器自己排成文字。外框是 Osuna 的（`borderInput`，悬停或展开 `borderAccent`），上游的 `borderAccent` 常亮与按下变淡不收 | prd「设置页分栏」外观条 |
| `components/sidebar/sidebar-header-row.tsx` | 全取 Osuna，与合并前逐字节相同。上游只调了图标大小与行高 | 同上 |
| `components/settings/index.tsx` | 取上游：`SettingsSelect` 传字符串给触发器，Osuna 的 `value` 样式随之无人使用 | 规则 3 |
| `screens/settings/host-appearance-section.tsx` | 3 个冲突块取上游的调用写法（`leading` + 字符串） | 规则 3 |
| `screens/settings/appearance/appearance-section.tsx` | 聊天相关的三行与侧栏条目随上游挪走。Osuna 的字体分组（界面、代码、终端字体与终端字号）、字号重置、深浅色配对行、终端预览、翻译过的主题名都留。主题菜单收下上游的 `scrollable` | prd「设置页分栏」 |
| `screens/settings-screen.tsx` | 栏目清单、`isSectionAvailable`、按 `Content` 渲染、通用页拆成「语言 + 发送 + 打开位置」取上游。Osuna 的 `SettingsNavRow`、页头（图标徽标 + 标题或提供方面包屑）、提供方详情页、关于页更新卡片都留。上游的纯外观改动不收：导航图标描细、行高 28、分组标题配色、列表间距、把页面标题挪进内容区 | prd「设置页分栏」；`docs/design.md` §186 |
| `e2e/support/helpers/agent-profiles.ts` | 上游新增的模型行辅助函数照收，分节标题用 Osuna 的 | 规则 3 |

#### 冲突之外、随 merge commit 一起改的

不改这些，merge commit 过不了 typecheck、lint 或测试。

- `opencode/runtime-client.ts`：上游新加的版本选择包装层调用了 Osuna 已去掉的客户端级 `listCommands(config)`，又没有转交 Osuna 的三个入口。去掉 `listCommands`，加上 `discoverCommands`、`resolveInstalledVersion`、`resolveCliLaunch`，都交给 1.x 客户端。`discoverCommands` 不探测版本、不拉起服务。先在 `runtime-client.test.ts` 加了一条用例并确认失败，再实现。**已装版本与一键升级因此覆盖 2.x**（两者只看配置的命令）。
- `websocket-server.ts`：构造函数复杂度 21，上限 20（两边各加了分支）。把 Osuna 自己的 `usageService` 字段从 `UsageService | null` 改成 `UsageService | undefined`，少一个 `??`，行为不变。
- `i18n/resources/zh-CN.ts`：补 `settings.layout.openInSidePane.sources.serviceUrls.label`。Osuna 的这一块是展开写的，上游新增的键落不进来。
- Osuna 的测试，因上游删了它们用到的东西：`mcp-server.test.ts` 里的 `rmSync` 改用上游的 `removeAgentStateDir`；`claude/agent.test.ts`、`provider-snapshot-manager.test.ts` 里传给 `ClaudeAgentClient` 的 `configDir` 改成 `runtimeSettings.env.CLAUDE_CONFIG_DIR`。断言都没动。
- 新增一条 Osuna 用例（评审后补）：`pi/agent.test.ts`「names a Paseo create_agent call behind the mcp proxy paseo.create_agent」，走真实会话路径（工具调用事件 → 时间线），断言工具名与摊平后的入参。此前 Pi 目录里只有映射层的用例在证明这个命名。
- `docs/design.md` §5 里 `<DropdownTrigger>` 的描述改成合并后的接口（`size`、`leading`、字符串或节点）。
- 上游的测试，因不知道 Osuna 的改动：`desktop/src/daemon/daemon-manager.test.ts` 新用例调 `createDaemonCommandHandlers()` 没带 Osuna 的必填参数 `appUpdates`，补上。

#### 按 Osuna 的决定改写的上游测试（写进 PR 正文）

- `generic-acp-agent.test.ts`：去掉上游加的预期 `waitForInitialCommands: true`。ADR 0003。
- `generic-acp-agent.commands.test.ts`（上游新文件，两条用例）：原来断言「首次取列表等到程序报回」与「超时后返回空列表」。改成 Osuna 的行为：报回之后 `listCommands()` 才是那份列表；从不报回的程序返回 `null`，不等待。两条都还有可断言的内容，没有移除。ADR 0003。
- `pi/extensions/subagent-fixture-test.ts`（上游的共用辅助）：见「与规格的出入」第 2 条。

#### 改动过的 Osuna 断言（写进 PR 正文）

只有一条，不属于分栏：`agent-commands-query.test.ts` 的整键断言，由 `["agentCommands","server-1","draft","codex","cwd","/repo"]` 改为 `["agentCommands","server-1","draft","cwd","/repo","provider","codex"]`。键里的信息没变（服务器、工作目录、提供方），顺序跟了上游。Osuna 的「只换模型或模式时键不变」用例没动，照常通过。

因分栏变化改动的断言：本机跑到的单元测试里没有。端到端辅助文件里的栏目名、设置项所在页面是上游自己改的（`e2e/support/helpers/settings.ts`、`chat-outline.ts`、`sidebar-nav-settings.ts`、`desktop/e2e/settings-memory.electron.mjs`）。

对两边都改过的 26 个测试与 e2e 辅助文件逐个比对了合并前后：除上面这一条外，被删或被改的断言行都是上游对它自己用例的改动（`pi/tool-call-mapper.test.ts`、`pi/agent.test.ts` 里挪进扩展目录的用例，`cli/.../lifecycle.e2e.test.ts` 的本机凭据用例）。

#### 与规格的出入

1. **新会话指令查询的键。** `prd.md` 写「键两边各加了字段，都留」。对照基点，实际情况是：基点的键里本来就有 `mode` / `model` / `thinking` / `features`，Osuna 在 `de65b2445` 里有意去掉了（只换模型或模式不该让 `/` 菜单闪一下「加载中」，并有一条用例守着）；上游这次只做了一件事——把工作目录提到键的前缀，好在切分支时按前缀清掉缓存。两边都留会把 Osuna 去掉的四个字段加回来，那条用例就挂了。处理：键的结构取上游（前缀 + `provider`），Osuna 去掉的四个字段不加回来；上游的「切换分支后刷新项目技能」照常生效（daemon 每次取列表都重新扫描技能目录）。`prd.md` 的这句话已改正。
2. **pi-subagents 的后台完成通知。** 上游的共用测试辅助断言：录制数据里每条 custom 消息都显示成助手消息。pi-subagents 的后台完成通知（「Background task completed: …」）带 `display: false`，按 `prd.md`「Pi」与用户故事 15 不进时间线。处理：辅助函数改成按 `shouldDisplayPiCustomMessage` 断言——该显示的显示，`display:false` 的在实时与回放两条路径上都不出现。用户可见的差别：用 pi-subagents 跑后台子智能体时，聊天里不出现那条完成通知，子智能体本身照常出现在 Subagents track 里并更新状态。写进 PR 正文。

#### 紧跟 merge commit 的适配提交

- Osuna 自己的 10 处 `<Alert>`（会话历史、用量卡片、提供方详情、API 端点、提供方目录对话框）加 `size="sm"`。上游把提示框的默认尺寸定成了更宽松的 `md`，并给它自己的调用处逐个写了尺寸；`sm` 就是合并前的内边距。
- 终端回滚行数的输入框在紧凑布局用 `md`（Osuna 原有的写法），随这一行挪到 `screens/settings/terminal/terminal-section.tsx`。
- 上游新带来的 `COMPAT(connectionPassword)`（2 处）、`COMPAT(headerAuth)`（2 处）、`COMPAT(relayPasswordOptional)`（1 处）由 `v0.9.1` 改写为 `v0.15.0`，日期不动。三个标签名在合并前的 main 上都不存在。

#### 协议

上游给协议加的内容：`hello` 里可选的 `protocolVersion` 与 `auth`、可选的客户端能力 `helloRejection`、新消息 `hello.rejected`、`relay://` 连接串的解析与序列化。新字段都是可选的，没有收窄、删除或改成必填，线上 schema 里没有转换。

#### 合并后核对

- 更新源：`electron-builder.yml` 的 `publish` 仍是 `LFT-OXY/Osuna`。
- 桌面身份与数据目录：`appId` `com.chinhae.osuna.desktop`、`productName` `Osuna`；`main.ts` 仍把 userData 固定在原目录名。
- 签名与签名断言：`mac-sign.js` 钩子、`OSUNA_MAC_SIGNING_SHA1`、`Verify macOS signature` 都在；没有 Apple 公证变量。
- 部署工作流：四个文件的 `on:` 只有 `workflow_dispatch`。
- 以上四项：`electron-builder.yml`、`main.ts`、`.github/`、`packages/desktop/scripts` 相对合并前没有任何差异。
- 上游站点链接数：见上表。
- 翻译键：`i18n/resources.test.ts` 38 条通过。
- `COMPAT(...)`：见适配提交。

#### 留给后面工单的事

- **02**：提示框的圆角。尺寸表是上游的（`xs` 12，其余 16），合并前 Osuna 的提示框是 12；`warning` 仍是 `radius.md`。上游把「打开位置」各行的英文标签改成了「Clicking …」的说法，zh-CN 仍是原来的译法。上游新增页面里的写死英文、「布局」旧地址的实测都在 02。
- **05**：2.x 会话的 `listCommands()` 先调 `reconnectIfExited()`（`opencode/v2/session.ts`）；2.x 客户端级的 `listCommands(config)` 会为取列表拉起服务（`opencode/v2/agent.ts`），在 Osuna 里已无调用方。2.x 的静态指令现在与 1.x 共用 `OPENCODE_HANDLED_BUILTIN_SLASH_COMMANDS`，是否都适用于 2.x 待核实。
- **07**：`docs/release.md`「踩过的坑」这一段新踩到的四条已在本工单补进去（测试文件不在 typecheck 里、客户端包装层不转交可选方法、复杂度上限、调研要对照合并基点）；07 只需更新同步点与补丁分支的写法。

#### 验证

- `npm run typecheck`、`npm run lint`、`npm run format:check`：通过。
- 本段新增或改动过的 63 个单元测试文件逐个单独跑过。60 个通过；另 3 个是 `packages/cli/tests/` 下的 tsx 脚本，不是 vitest 用例，由 CI 的 cli-tests 跑。
- 其中与验收项对应的：`pi/agent.test.ts` 125、`pi/tool-call-mapper.test.ts` 11、`pi/history-mapper.test.ts` 7、`opencode/bridge.test.ts` 8、`opencode-agent.test.ts` 136、`omp/agent.test.ts` 38、`claude/agent.test.ts` 88、`claude/models.test.ts` 49、`claude/agent-commands.e2e.test.ts` 4、`acp-agent.test.ts` 108、`agent-manager.test.ts` 200、`provider-registry.test.ts` 51、`provider-snapshot-manager.test.ts` 91、`mcp-server.test.ts` 126、`agent-commands-query.test.ts` 5、`control-geometry.test.ts` 13。
- 本机用真实浏览器跑了两个设置页的端到端文件（`npx playwright test --project=browser`，自带临时 daemon 与 Metro）：`settings-navigation.spec.ts` 9 条、`settings-i18n.spec.ts` 2 条，全部通过。其中有「点栏目会换地址并渲染该页」「设置页是 14 圆角卡片、56 高的行、28 高的控件」「切换界面语言」。
- 整套测试交给 CI。
