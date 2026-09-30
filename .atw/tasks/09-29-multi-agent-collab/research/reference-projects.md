# 参考项目调研：@ 派发与子智能体卡片

调研日期 2026-09-29。源码根目录 `/Users/oxy/Documents/Configuration/dev-environment/demo/源码/`。

| 项目 | @ 派发智能体 | 子智能体实时卡片 | 点开读子会话 |
|---|---|---|---|
| codeg | 有，父智能体编排 | 有：Claude/Codex/Grok/OpenCode | 只读抽屉，实时 |
| codex-host | 有，`#` chip → skill 指令 → 父智能体调 CLI | 有（除 OpenCode） | 只读线程 |
| openchamber | 无（OpenCode 原生 @subagent，只认第一个） | 有：OpenCode，内联工具卡 | 只读标签页 |
| t3code | 无 | 有：内联 spawn 行 + fleet 面板 | 无 |
| orca | 无（CLI 编排 + 邮箱回传摘要） | 只有状态行 | 无 |
| desktop-cc-gui | 无 | 前端按工具名猜 | 无 |

## codeg（用户点名的参照）

- @ 面板和文件、会话、提交共用，候选是已启用的 ACP 智能体：`src/components/chat/composer/use-reference-search.ts:117-124`。选中后是行内徽章，序列化为 `[@Claude Code](codeg://agent/claude_code)`：`composer/reference-text.ts:104-112`。
- 消息原文发给当前（父）智能体。后端在末尾追加隐藏"路由帧"：列出去重后的 agentType，要求"必须走 `delegate_to_agent`，不要用你自己的子智能体"：`src-tauri/src/acp/agent_mentions.rs:102-182`、`acp/connection.rs:9377-9390`。路由帧会从历史和标题里剥掉；帧文本改动要升版本号，否则历史里会露出旧帧。
- 工具描述要求：提及即委派，每个智能体调用一次；子智能体看不到本对话，`task` 必须自带全部上下文：`src-tauri/src/acp/delegation/tool_schema.json`。
- 子会话继承父 cwd，不建 worktree；mode/model 取设置里每个智能体的"委派默认值"：`broker.rs:2466-2491`。委派默认关闭，深度上限 1。
- 一次性：子会话结束一轮就取最后一段助手文本作为结果并断开：`lifecycle.rs:406-479`、`broker.rs:3021`。续跑只能续中断的任务，不接受新指令。
- 父时间线只有一张状态卡 `DelegatedSubThread`，点"查看会话"打开只读抽屉实时显示子会话完整流：`src/components/message/delegated-sub-thread.tsx`、`sub-agent-session-dialog.tsx`。
- 结果不自动注入父上下文，父模型要主动调 `get_delegation_status`。
- 被提及的智能体互相不可见；没有"同步评审"机制，只能靠父模型在任务文本里分工或串行传递。
- 已知坑：父模型可能不听话改用自己的子智能体；tool_call_id 靠任务文本匹配，匹配不到卡片就不更新（`broker.rs:2363-2379`）。

## codex-host

- 触发符 `#`（`@` 被宿主占用）：`packages/renderer-extension/src/renderer-delegation-mention.ts:62,80`。
- Host 拦截 `turn/start`，把 chip 还原成 `@Label`，末尾追加"用 codexhost-delegation skill 委派"的指令并挂原生 skill 输入：`delegation-mention-rewrite.ts:21-82`。
- 子会话：cwd 继承父线程；子会话无人值守、全权限；父线程靠显式参数 → 环境变量 → 唯一活跃 turn 推断，推断不出报 `PARENT_THREAD_AMBIGUOUS`；30 秒内同父同目标同任务去重：`harness-delegation-coordinator.ts:195-371, 559-582`。
- 结果不自动注回父 turn，父对话里只有命令卡片和父智能体自己写的汇报。
- 子智能体 Host ID 用 sha256(父, nativeRef, 子ID) 派生，实时和回放拿到同一身份。

## openchamber

- 卡片就是工具 part 本身，子会话按 id 读取，不复制状态。
- 子会话 id 可能晚到（REST 加载拿不到 progress 事件），只在唯一候选时推断，拿到正式 id 立即替换：`packages/ui/src/components/chat/message/parts/taskToolModel.ts:48`。
- 子会话的权限请求汇总到父对话输入框上方，标注"来自子智能体"。
- 输出要先剥掉 `<subagent>`/`<task>` 包装并限长，否则 Markdown 渲染会出错。

## t3code

- 服务端统一打 `agentKind`，用黑名单不用白名单（白名单曾漏掉新出现的 `local_agent`）：`packages/contracts/src/providerRuntime.ts:552-575`。
- Codex 未识别方法默认路由到 parent，不静默吞掉。
- 不能把 root thread 登记成子智能体，否则父 turn 永远显示 working。
- 会话结束后要推导出 `interrupted`，否则面板一直 Working。

## orca

- 每条回报带 task 和 dispatch 两个 ID，防止旧尝试的迟到消息结掉新任务。
- 必须禁止 worker 调 AskUserQuestion，否则挂在发起方看不到的提示上。
- 子智能体比发起它的那一轮活得久，不能用"轮次结束"判定子智能体结束。

## desktop-cc-gui

- 按工具名猜子智能体会误判；Claude 子智能体的工具调用必须按 `parent_tool_use_id` 分流，否则混进主时间线。

## 补充：模型、目录、评审、权限（2026-09-29 二次调研）

| 问题 | codeg | codex-host |
|---|---|---|
| 子会话模型/模式 | 设置 `/settings/collaboration`"多智能体协作"卡片，"智能体默认值"标签页每个智能体一个标签按钮；字段按该智能体暴露的 config option 动态生成（模型、推理强度都走这里，无 config option 时才显示 mode）；每项有"Default"清除覆盖，回退到智能体自己的默认值：`src/components/settings/delegation-agent-defaults.tsx:45-50,150,224-247,332-352` | CLI `--model`、`--thinking`，不传用 Harness 原生默认值，skill 要求优先默认值；`harness inspect` 查可选项并校验；无按 provider 的设置界面：`delegation-cli-help.ts:4-9`、`coordinator.ts:582-620` |
| 父智能体能否覆盖 | 不能，`delegate_to_agent` 只有 `agent_type`/`task`/`working_dir`：`tool_schema.json:3-43` | 能，经 CLI 参数 |
| 总开关 | 全局 `delegation.enabled` + 深度 1-8；关闭时后端报 "delegation disabled"，但 @ 面板只看智能体是否启用、仍显示：`delegation-settings.tsx:7-8,49-50`、`broker.rs:2416-2424`、`use-reference-search.ts:117-121` | 无 |
| 工作目录 | 可选 `working_dir`，默认父会话目录；委派无 worktree 选项：`tool_schema.json:37-40` | 可选 `--cwd`，回退父线程目录再到进程 cwd；无 worktree：`coordinator.ts:199` |
| 同目录并发冲突 | 未找到处理 | 未找到处理 |
| 兄弟互看 / 起草+评审 | 无；`get_delegation_status` 只对发起方父会话可见：`broker.rs:3393-3397` | 无专门机制；父可 `thread read/wait/list --parent`，`thread read` 能读任意线程 |
| 权限请求 | 不自动批、不继承父权限模式；子会话停住，请求留在子会话；父时间线卡片显示"等待中"徽标，用户打开子会话弹窗批准；父只收到"等待人工决定"，不能代批：`delegation-context.tsx:19-27`、`delegated-sub-thread.tsx:9-14`、`broker.rs:1003-1021` | 写死 `unattended-full-access`：Codex `approvalPolicy: never` + `danger-full-access`，Claude 权限模式 `auto`，Kimi/Kiro 不支持直接报错；不可配置：`coordinator.ts:291`、`app-server-host.ts:1939-1946` |

Osuna 对照：Providers 设置里每个 provider 点开是 `ProviderDiagnosticSheet`（`packages/app/src/components/provider-settings-host.tsx`）；"启用 Osuna tools"是设置 → Host → 编排的全局开关（`packages/app/src/screens/settings/host-page.tsx:852`，`mcp.injectIntoAgents`），会话启动时注入（`agent-manager.ts:5155`）；按 provider 关闭只能写 config.json（`paseo-tool-policy.ts`）。

## 补充：子智能体默认值的存储、回退与叠加（2026-09-30 三次调研，05 号票）

| 项目 | 默认值谁定、存哪 | 未配置时 | 值失效时 | 模式/权限 | 预设叠加 |
|---|---|---|---|---|---|
| codeg | 用户设置，后端 SQLite `app_metadata` 键 `delegation.agent_defaults`，按智能体类型存 `{mode_id?, config_values}`，模型也是 config option：`src-tauri/src/commands/delegation.rs:36-39,68`、`acp/delegation/types.rs:27-39` | 不设，用智能体自身默认，不继承父会话：`broker.rs:2463-2470` | 子会话建好后逐项套用，不合法的跳过并记日志，不通知用户，设置页也不标失效：`acp/connection.rs:8449-8590` | 模式在同一组默认值里；有 config option 的智能体只显示 option，不单独显示 mode：`delegation-agent-defaults.tsx:316-332` | 无预设；自定义智能体与内置平级，各有一条 |
| codex-host | 父智能体经 CLI `--model`/`--thinking` 传，无用户设置：`host-runtime/src/delegation-cli.ts:217-250` | 不传，用目标 harness 原生默认 | 显式传入的值先 `inspect` 再校验，失败报 `INVALID_ARGUMENT` 并列出可选值：`harness-delegation-coordinator.ts:580-624` | 写死 unattended-full-access，各 adapter 翻译，翻译不了报错 | 无 |
| orca | 父智能体传 `--model`/`--effort`；用户按智能体类型存 `nativeChatSessionOptions`（`{model?, valuesByModel}`）与 `agentDefaultArgs`（含权限）：`shared/global-settings-types.ts:222-223,389-392` | 结构化 worker 用用户保存的选择做种子，传参则整份替换 | 模型原样透传，档位校验并报错：`worker-launch-preferences.ts:69-108` | 权限单独按智能体类型存，不继承父 | 无 |
| openchamber | OpenCode agent 配置（`provider/model#variant`）；新会话默认存服务端 `settings.json` | 取 agent 配置或 OpenCode 默认 | 模型不在目录中则保留原值；档位不在目录中则静默丢弃：`useConfigStore.ts:210-212,324-326` | 子会话权限继承父会话；权限是单独的全局设置 | settings 默认模型优先于 agent 自带模型，agent.variant 参与档位候选 |
| t3code | 服务端 `defaultModelSelection` + 前端按 provider 实例 sticky | — | 模型静默回退到 `isDefault` 或第一个；档位回退到默认选项：`apps/web/src/modelSelection.ts:289-325`、`packages/shared/src/model.ts:75-96` | `defaultRuntimeMode` 与模型分开存 | 无 |
| desktop-cc-gui | 按引擎存 `defaultModels`/`defaultEfforts`：`src-tauri/src/settings.rs:46-53` | — | 模型钉到目录第一项；档位原样透传 | 权限单独全局设置；引擎不支持时回退到第一个模式 | 无 |

要点：
- 只有 codeg 有与本任务同构的"按智能体配置委派默认值"，存后端、按智能体键、未配置用智能体自身默认、不继承父会话。
- 失效处理没有共识：静默跳过（codeg、t3code）、保留原值（openchamber）、报错（codex-host 显式参数、orca 档位）。没有项目在设置页标出失效值。
- 权限模式：codeg 把模式放进同一组默认值；其余项目把权限与模型分开。
- 没有项目让命名预设与按智能体的默认值逐字段叠加（openchamber 最接近，且是"设置优先于预设"）。
- 界面：codeg 是每个智能体一个标签按钮，一次只编辑一个，控件按智能体暴露的选项动态生成，下拉首项"默认（X）"清除覆盖，需点保存。

## 补充：mention 的线格式、触发来源、能力判定与路由块剥离（2026-09-30 四次调研，09 号票）

路径相对各项目根目录。openchamber 的 OpenCode 服务端源码不在仓库里，服务端行为未查。

| 问题 | codeg | codex-host | t3code | openchamber | orca / desktop-cc-gui |
|---|---|---|---|---|---|
| target 标识 | `codeg://agent/<agentType>`；自定义智能体 `custom:<id>` 前缀区分；无预设可被 @：`src-tauri/src/models/agent.rs:7,47-55,110,147-155` | `subagent://codexhost.<harnessId>`，`codexhost.` 与宿主原生 role 区分，命令 chip 用 `codexhost-command.`：`packages/shared-contracts/src/delegation-mention.ts:6-27,74-86` | `t3-context://v1/<kind>/<contextId>`，kind 是命名空间，带版本段；未知 kind 原样保留：`packages/shared/src/composerContextReferences.ts:10-60`、`packages/contracts/src/composerContext.ts:10-64,217-236` | 纯文本 `@name`，另发结构化 `agents:[{name}]`：`packages/ui/src/lib/opencode/client.ts:1093-1127` | 纯文本 `@path`，无 @agent |
| 改名/删除后旧消息 | 显示发送时的 label；图标现查，查不到退首字母或灰点；无失效标记：`src/components/agent-icon.tsx:493-630` | 落库前已换成 `@Label` 纯文本，显示发送时 label | records 随消息快照，显示当时 label | 显示存下的 name | — |
| 解析器位置 | 前后端各一份，不共享；规则有出入（大小写、尖括号、换行、slug 校验），前端显示成徽章的后端未必路由：`src-tauri/src/acp/agent_mentions.rs:49-58`、`src/lib/reference-link.ts:246-306` | 只在 Host 端识别 | 共享包 `packages/shared` 一份 | 前端解析 | — |
| 触发来源 | 所有进 provider 的 prompt（API、定时、IM、任务引擎、子会话首条），手打同形链接有意生效（测试 `agent_mentions.rs:563-581`）；原生 steer 不加帧：`connection.rs:3940-3972` | Host 转发的 `turn/start`、`turn/steer`；CLI/API 直发不改写：`app-server-host.ts:1549,3557-3586` | 无派发语义 | 仅输入框与排队消息；定时任务、API 用显式 agent 字段：`useQueuedMessageAutoSend.ts:94,119` | orca 只有 CLI 显式派发 |
| 代码里的链接 | 算（无排除） | 算（正则扫全文） | — | 算（反引号只作边界） | — |
| 子会话再 @ | 能，broker 派发时按深度上限（默认 1）拒绝：`broker.rs:2428-2462` | 能，无深度限制 | — | — | orca 深度默认 1，超限整段 SUB-DISPATCH 不写：`preamble.ts:141,191-218` |
| 能力/版本判定 | 无（单体应用） | 无 | `ExecutionEnvironmentCapabilities` 可选布尔，缺失即不支持，老服务端走旧格式：`packages/contracts/src/environment.ts:89-199` | 最低 OpenCode 版本号 | orca 能力字符串数组 `<域>.<功能>.v1`；老主机提示"Update Orca on this host" |
| 当前会话不能派发时 | @ 面板照常显示，后端静默不加帧：`connection.rs:6181-6230` | 不按线程判定 | 有置灰加原因的先例（模型行 `getModelDisabledReason`）：`ChatView.logic.ts:1042`、`ModelListRow.tsx:41-57` | — | desktop-cc-gui 权限菜单置灰加 title |
| 目标不可用 | 发送不查；非法 slug 丢弃，禁用/未装照写；工具调用返回错误码，卡片徽章显示"启动失败"等：`agent_mentions.rs:94-119`、`delegation-status-badge.tsx:69-87` | 菜单直接不列；发送不查；CLI 报 `HARNESS_NOT_FOUND` 等 | 缺失的引用写 `unavailable="true"`：`composerContextReferences.ts:245` | 匹配不到就当普通文本 | orca 报 `agent_unconfigured` |
| 新会话首条消息 | 支持；前端不判定，后端在连接启动时算好，prompt 先缓冲：`connection.rs:6270-6297` | 无特殊分支，父线程在 CLI 调用时推断 | — | — | — |
| 总开关 | `delegation.enabled` 默认关；无开启引导，欢迎页反而宣传 @：`welcome-hero.tsx:34,94` | 无，始终开 | — | agent 工具开关分项，默认开 | orca 无运行时总开关 |
| 路由块剥离 | 帧只存在于发给智能体的那份，数据库、广播、标题都用原文；回显不渲染；导入与历史统一套 `RouteSanitized`；识别靠 RS 分隔符 + kind/version/nonce + 按当前渲染器逐字节比对，只认当前版本：`agent_mentions.rs:13,208-233`、`parsers/mod.rs:295-409` | 不剥，气泡与线程预览里能看到指令 | 数据库只存规范链接与 records，只在发往 provider 时投影并追加 `<t3_context version="1">`，无需剥离；payload 里的闭合标签转义防伪造：`composerContextReferences.ts:121-142,258-291` | 靠结构（`synthetic` 角色），不靠文本 | desktop-cc-gui 读原生历史时按前缀/标签剥，标题单独去噪：`history/mod.rs:219-412` |
| 帧内容 | 只列去重后的 agentType，不写模型/模式；措辞只约束"走哪个工具"，不命令委派；测试钉住措辞：`agent_mentions.rs:153-182,596-625` | `[codexhost delegation] The user mentioned @X (Harness \`x\`) … delegate … instead of doing the task yourself.`：`delegation-mention-rewrite.ts:12-31` | — | — | orca 前导块，不隐藏 |

要点：
- 标识分命名空间的做法：codeg 用前缀（`custom:`），t3code 用路径段（`<kind>/<id>`，还带 `v1`）。
- 前后端各写一份解析器的 codeg 已经出现规则分叉；t3code 放共享包。
- 触发来源没有共识：codeg 全入口触发，codex-host 只看宿主转发的 turn，openchamber 只看输入框。
- 目标不可用时在发给模型的块里标出来，只有 t3code（`unavailable="true"`）这么做；其余都交给工具调用失败。
- 剥离做得最干净的两家（codeg、t3code）都不把路由块写进存储，只在发往 provider 的那一份里追加；剥离只用于 provider 自己回放的历史。
