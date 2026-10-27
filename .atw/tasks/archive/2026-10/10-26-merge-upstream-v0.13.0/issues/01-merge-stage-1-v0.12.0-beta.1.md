# 01 — 第一段：合并到上游 v0.12.0-beta.1

**What to build:** 合并分支 `merge-upstream-paseo-updates` 上有一个把上游 `e2f4948f9`（v0.12.0-beta.1，同步点 v0.11.2 之后 165 个提交）合进来的 merge commit。合完后 Osuna 多出上游这一段的内容——新的 Markdown 渲染器、手机全屏 Composer、Hoplite 与提供方目录、Agent 间消息的发送者信封与默认插话、后台工作区、`paseo usage` CLI 等——而 Osuna 自己的功能和有意做的决定都在。这是本次最大的一段（模拟 97 个冲突文件），merge commit 不能拆；这张工单做到「分支能通过检查、Osuna 原有行为不丢」为止，聊天 Markdown 与 Composer 的适配留给 02，提供方的适配留给 03。规格见 `prd.md` 的「合并方式」「补丁分支」「Markdown」「Composer」「提供方」「连接的主机与 Agent 间消息」「版本号与发版元数据」「协议与兼容」。

**Blocked by:** None — can start immediately
**Status:** ready-for-agent
**Impl:** done

- [x] 开工先确认分支是 `merge-upstream-paseo-updates`、基于 main `b8d4f55e7`、工作区干净；`upstream` remote 不抓 tag。
- [x] 合并分支包含一个以合并前的分支头与 `e2f4948f9` 为双亲的 merge commit。
- [x] 补丁分支分叉处的 16 个文件（15 个版本号与锁文件、依赖补丁脚本）按固定裁决处理：上游的部分取主线一侧，Osuna 的改动保留；依赖补丁脚本取主线一侧。
- [x] 上游删掉的聊天 Markdown 样式文件与语言识别模块：Osuna 引用它们的地方先接到上游的新位置，分支能编译；Osuna 样式的完整迁移在 02。
- [x] Composer：Web 与 Electron 仍是 Tiptap 输入，测高模块不在 Web 端恢复；冲突最多的输入组件解完后分支能编译，手机全屏编辑的接法在 02。
- [x] Agent 间消息：上游的发送者信封与默认插话照收；经 Agent mention 派发的消息末尾仍有 Routing block（ADR 0004），由现有测试证明。
- [x] `agent-manager` 里 Osuna 放行带父标签 Agent 的 attention 等改动保留；问题卡片的作答状态仍在 Osuna 的 core 模块里，上游对状态的改动改到 core 里。
- [x] Claude、Codex、Pi、OMP、OpenCode 的 `paseo.create_agent` 命名与父工具调用归属、子智能体权限归属、已装版本与一键升级、CLI 启动解析、第三方接口切换的现有测试全部通过，无一改动断言。
- [x] 合并前按 `docs/release.md`「合并后核对」的口径统计应用与 CLI 源码中指向上游站点的链接数（全部与非测试），记在 `## Comments` 下；合完后非测试数不多于合并前。
- [x] 每个冲突文件怎么裁的、依据哪条规则，按区域逐个记在 `## Comments` 下，供 14 写 PR 正文用。规则裁决不了、或保留两边会改变用户可见行为的冲突没有自行取舍：已停下来问过维护者，问答记在 `## Comments` 下。
- [x] 所有工作区版本号是 `0.17.0`；各 `package.json` 相对合并前的差异只有上游在版本号之外的改动；`package-lock.json` 是重新生成的，差异能逐项对应到上游新增或升级的依赖。
- [x] `CHANGELOG.md` 与合并前逐字节相同；与 Osuna 同名的安卓商店说明文件留 Osuna 的；README 与 `CLAUDE.md` 的冲突块取 Osuna 的。
- [x] 协议新增的字段都是可选的，协议的现有测试无一改动断言；上游新带进来的 `COMPAT(...)` 标签（合并前 main 上不存在的名字）改写为 `v0.18.0`，清单记在 `## Comments` 下。
- [x] `docs/release.md`「合并后核对」逐项过完，结果记在 `## Comments` 下：更新源、桌面身份与数据目录、签名与签名断言、只手动触发的部署工作流、上游站点链接、翻译键。
- [x] 翻译资源测试单独跑过并通过；上游新增的键九种语言齐全，zh-CN 是真实翻译、符合术语表。
- [x] 对本段冲突涉及的测试文件对比合并前后，没有 Osuna 的断言行被悄悄删掉；必须跟着改的断言逐条记在 `## Comments` 下。
- [x] 指令目录的现有测试全部通过，无一改动断言；取指令列表不启动进程（ADR 0003）。例外一处：`generic-acp-agent.commands.test.ts` 的期望列表随上游改了 fake 脚本（多报一条 status、review 带参数提示）跟着改，「等报回、不等进程」的写法与 null 用例不变，见 Comments。
- [x] typecheck 和 lint 通过；本段冲突文件对应的测试文件、以及本段新增或改动过的测试文件逐个单独跑过并通过（不跑整套）。
- [x] dev 桌面端快速冒烟：侧栏、输入框、聊天、Providers 页、第三方接口页、用量页打开正常，无报错。
- [x] 本段不推送、不开 PR（维护者 2026-10-26 确认：七段全部做完再开 PR）。

## Comments

### 开工核对
- 分支 `merge-upstream-paseo-updates`，基于 main `b8d4f55e7`（另有一个规划提交 `3fc36c0a8`），工作区干净；`upstream` remote 配了 `tagOpt --no-tags`。
- 合并：`git merge --no-ff e2f4948f9`，git 报 97 个冲突文件（与模拟一致），其中 5 个是一边删一边改。

### 上游站点链接数（docs/release.md 的 PAT，全部 / 非测试）
- 合并前：`packages/app/src` 73 / 1，`packages/cli/src` 13 / 3。
- 合并后：`packages/app/src` 74 / 1，`packages/cli/src` 13 / 3。非测试数不变；全部多出的 1 处在上游的 `components/markdown/renderer.test.ts`（测试样例，不改）。

### COMPAT 标签（合并前 main 上不存在的名字，已改写为 v0.18.0，日期不动）
`agentMessageToolEnvelope`、`legacySystemEnvelope`（server agent-messages/index.ts）、`internalAgents`、`internalWorkspaces`、`hopliteProvider`（protocol messages.ts）、`hopliteProvider`（app hooks/use-acp-provider-catalog.ts）、`backgroundRunFlag`（cli commands/agent/run.ts）。

### docs/release.md「合并后核对」
- 更新源：electron-builder.yml 的 `publish` 仍是 github / LFT-OXY / Osuna。
- 桌面身份与数据目录：`appId: com.chinhae.osuna.desktop`、`productName: Osuna`；main.ts 仍把 userData 固定在原目录（上游只加了 protectConsoleStreams 与 showWindowWhenReady）。
- 签名与签名断言：desktop-release.yml 的 mac-sign.js、`OSUNA_MAC_SIGNING_SHA1`、Verify macOS signature 都在，本段上游没动 .github。
- 只手动触发的部署工作流：android-apk-release、deploy-app、deploy-website、deploy-relay 的 `on:` 只有 workflow_dispatch。
- 上游站点链接：见上，非测试数不增。
- 翻译键：resources.test.ts 单独跑过 46/46 通过；zh-CN 新键逐个核对（见下文「i18n」）。
- 版本号：13 个 package.json 全是 0.17.0，内部依赖也是 0.17.0；package-lock.json 重新生成，差异只有上游 #6973 新增的 react-native-enriched-markdown、mdast-util-from-markdown、mdast-util-gfm-table、micromark-extension-gfm-table、micromark-util-decode-string 与删掉的 react-native-markdown-display、react-native-uitextview 及其依赖。
- CHANGELOG.md 与合并前逐字节相同；README 四份与合并前相同；本段没有安卓商店说明冲突。
- 协议：新增字段都是可选的（新 schema agent-message.ts 内的必填字段属于新对象本身）；协议现有测试未改断言。
- `server/bootstrap.ts` 不含提供方名字。

### 问过维护者的（2026-10-26）
1. 手机端标签切换栏：上游 #6431 重做后，Osuna 改过的箭头尺寸与 mobileTabsRow 去分割线对应的代码已不存在。维护者答「接受」——手机上直接用上游官方 App，不用 Osuna 手机端。
2. CLAUDE.md 文档表两边各加一行：工单写「冲突块取 Osuna」，实际两边都留（上游新增的 docs/markdown-renderer.md、native-text-selection.md 已进仓库）。维护者答「保留」。

### 冲突裁决（逐文件）与改动的测试断言
完整记录见 `research/stage1-resolutions.md`（按区域：元数据与文档、协议、server、app 各区、编译接线、改动的上游测试、本机跑测试的结果）。供 14 写 PR 正文的要点：
- 因换成上游实现而改的 Osuna 断言：`agent-prompt.test.ts` 权限文案改为对解开信封后的正文断言（内容不变）；`generic-acp-agent.commands.test.ts` 期望值换成上游 fake 脚本的两条命令；`agent-mention-routing-block.e2e.test.ts` 两条「不带 Routing block」改为解析信封 + 逐条比对（先滤掉上游的结束通知），老客户端辅助函数等第一帧再发；`autocomplete-utils.test.ts` 的 bottomInset 两条挪进 `scroll-reveal.test.ts`、另两条与上游重复删去；`markdown-styles.test.ts` 随样式文件删除，Osuna 的断言**由工单 02 迁到上游 components/markdown/styles.ts 的测试上**。
- 按 Osuna 决定改的上游测试：`agent-stream/model.test.ts`、`timeline/turn-time.test.ts` 补 turnId / userMessageId；`website/src/data/sponsors.test.ts` 改为断言 README 没有赞助表（规则 1）；`i18n/resources.test.ts` 允许清单加 `providerCatalog.types.acp`（协议名 ACP）。
- 留给后续工单：02——聊天 Markdown 样式迁移、手机全屏编辑接入 input.tsx（含 composer/index.tsx 暂不传的 editingSession / submissionError、textarea 的输入法用例改写）；03——provider-catalog-list 接 rankProviderCatalog、Hoplite 能力位与删除条件、#6507、acp-provider-catalog.spec.ts 按 Osuna 结构适配；05——DOM 预览删除后可去掉 highlighted-code-block 导出的 fenceLanguageToExtension 与 dom-markdown 里的临时首词函数。
- 本机已知与合并无关的失败：daemon-e2e/git-operations.e2e.test.ts 的 4 条 setup / 归档用例、file-observer 的「ignore update is a barrier」，合并前代码上同样失败。
- 冒烟中看到、与合并无关的控制台警告：用量页模型排行同名模型重复 key（usage-stats 本段未改）、提供方页按钮嵌套按钮（providers-section 取 Osuna 原样）、一条 uniProps 落到 DOM 的 React 开发警告（未定位来源）。

### 评审
- Standards：无硬性违反；8 条判断项（back-header 被改动的 useUnistyles、tab-switcher 五处补标签名等），本段不改，PR 正文提一句。
- Spec：已处理——定时任务断言改回逐条比对、问题卡片核对上游未改作答状态、漏记文件补记、本节记录；两项用户可见取舍已问维护者（见上）。

