# 06 — 第五段：合并到上游 v0.13.0-beta.1

**What to build:** 合并分支上有一个把上游 `3fa625701`（v0.13.0-beta.1，52 个提交、946 个改动文件）合进来的 merge commit。这一段带进来连接的主机、Explorer 三端统一、`file-pane` 改名 `file-panels` 与插件文件面板、Changes 的 All changes、套餐用量的新文案键、按需加载翻译、通知批处理、setup 重写、官网简中与 `CHANGELOG.zh-CN.md`。模拟新增 51 个冲突文件；这张工单做到「分支能通过检查、Osuna 原有行为不丢」为止，各块的适配在 07–11。规格见 `prd.md` 全文相关节。

**Blocked by:** 05
**Status:** ready-for-agent
**Impl:** done

- [ ] 合并分支包含一个以合并前的分支头与 `3fa625701` 为双亲的 merge commit。
- [ ] Markdown 文件预览是上游 `file-panels` 下的那套，Web 与 Electron 不再有 Osuna 的 DOM 预览；逻辑图「打开源码视图定位」的用例挪到上游做同一决定的位置后仍通过。
- [ ] 上游删掉的手机与平板 Explorer 侧栏接受删除，分支能编译；会话历史的补回在 07。
- [ ] 上游新增的 `CHANGELOG.zh-CN.md` 原样收下，官网代码能编译（维护者 2026-10-26 确认）。
- [ ] 按需加载翻译照收；Osuna 测试里直接取中文翻译函数的地方先加载中文。
- [ ] Changes 的比较模式不再写死成 base，分支能编译；按文件复用接到 All changes 的行为在 09。
- [ ] 结束通知搬进上游的新文件时，Osuna 的权限文案随之搬过去（完整核对在 10）。
- [ ] Osuna 的会话历史与逻辑图面板按上游新的面板清单补上必填的「紧凑抽屉」字段；插件图标解析函数改名后 Osuna 的调用处跟改。
- [ ] 合并前按 `docs/release.md`「合并后核对」的口径统计应用与 CLI 源码中指向上游站点的链接数（全部与非测试），记在 `## Comments` 下；合完后非测试数不多于合并前。
- [ ] 每个冲突文件怎么裁的、依据哪条规则，按区域逐个记在 `## Comments` 下，供 14 写 PR 正文用。规则裁决不了、或保留两边会改变用户可见行为的冲突没有自行取舍：已停下来问过维护者，问答记在 `## Comments` 下。
- [ ] 所有工作区版本号是 `0.17.0`；各 `package.json` 相对合并前的差异只有上游在版本号之外的改动；`package-lock.json` 是重新生成的，差异能逐项对应到上游新增或升级的依赖。
- [ ] `CHANGELOG.md` 与合并前逐字节相同；与 Osuna 同名的安卓商店说明文件留 Osuna 的；README 与 `CLAUDE.md` 的冲突块取 Osuna 的。
- [ ] 协议新增的字段都是可选的，协议的现有测试无一改动断言；上游新带进来的 `COMPAT(...)` 标签（合并前 main 上不存在的名字）改写为 `v0.18.0`，清单记在 `## Comments` 下。
- [ ] `docs/release.md`「合并后核对」逐项过完，结果记在 `## Comments` 下：更新源、桌面身份与数据目录、签名与签名断言、只手动触发的部署工作流、上游站点链接、翻译键。
- [ ] 翻译资源测试单独跑过并通过；上游新增的键九种语言齐全，zh-CN 是真实翻译、符合术语表。
- [ ] 对本段冲突涉及的测试文件对比合并前后，没有 Osuna 的断言行被悄悄删掉；必须跟着改的断言逐条记在 `## Comments` 下。
- [ ] 指令目录的现有测试全部通过，无一改动断言；取指令列表不启动进程（ADR 0003）。
- [ ] typecheck 和 lint 通过；本段冲突文件对应的测试文件、以及本段新增或改动过的测试文件逐个单独跑过并通过（不跑整套）。
- [ ] dev 桌面端快速冒烟：侧栏、输入框、Explorer、Changes、终端、用量页、逻辑图打开正常，无报错。

## Comments

### 双亲与提交
- 第 5 段 v0.13.0-beta.1：merge `f44be7529` = `f98b93b1d` + `3fa625701`。git 报 76 个冲突文件（`file-pane/markdown-preview/` 的 13 个改名冲突因工单 05 先删掉而没有出现）。
- 适配：`eeb3b5362`（COMPAT 改写）、`fa09280cd`（Expo 57 导航上下文，冒烟发现）、评审后的修正与本工单记录在随后的提交里。
- 逐文件裁决、依据的规则与核对见 `research/stage5-resolutions.md`（按区域）。

### 上游站点链接（全部 / 非测试）
合并前（`f98b93b1d`）：app 75 / 1，cli 13 / 3。合并后相同。

### COMPAT 改写（合并前 main 上不存在的名字 → v0.18.0，日期不动）
`checkoutDiffAll`（app git/use-diff-query.ts）、`fileByteWrites`×5（app file-panels/file 两处、protocol messages.ts 两处、server websocket-server.ts）、`fileVersionKind`（app file-panels/file/daemon-session.ts）、`pluginReactNativeEntrypoint`×3（app plugins/evaluate.ts、plugin client/react-native.ts、server plugin-sdk-specifiers.ts）、`pluginSettingsGroup`×2（app plugins/react-native/ui.ts、plugin client/ui.ts）、`workspaceSetupCombinedLog`（server worktree-bootstrap.ts）、`workspaceSetupObservation`×3（app session-store.ts、protocol messages.ts、server session.ts；e2e 辅助里那处没写版本，不动）。另：随代码挪进 `agent-messages/envelope.ts` 的 `legacySystemEnvelope`、`agentMessageToolEnvelope` 写回第 1 段定的 v0.18.0；`usage/model.ts` 的 `usageLoginErrors` 写回 Osuna 原来的 v0.15.0。

### 问过维护者的
本段没有。规则裁决不了、或改变用户可见行为的两处按 prd 已有决定处理：套餐用量行写明「已用」（prd 用户故事 32/33），内置文件面板提供者名写 Osuna（规则 1，见裁决记录 i18n 一节）。

### 因换成上游实现而改动的 Osuna 断言（PR 正文要列）
- `app/src/usage/format.test.ts`：`formatDisplayPct(31, "used")` 从 `"31%"` 改为 `"31% used"`（en）、`"已用 31%"`（zh-CN），用例名跟着改（上游 #7376，prd 用户故事 32）。
- `app/src/usage/pinned.test.ts`：中文用例 `"Codex Weekly"` → `"Codex 每周"`（上游起已知窗口名按界面语言写）。
- `app/e2e/browser/usage-settings.spec.ts`：冲突块之外上游自动合并进来的 `"70%"` → `"70% used"`、`"64%"` → `"64% used"`（同上，保留）。
- `app/src/workspace-tabs/explorer-sidebar.test.ts`「selects Session history in the compact Explorer」：`usePanelStore.explorerTab === "sessions"` 改为断言布局里 Explorer 聚焦 `session_history`（上游 #7424 删了 panel store 的 explorerTab）。
- `app/src/components/file-pane-render-mode.test.ts`：上游删了被测模块，4 个 `filePreviewRenderKindForLocation` 用例挪进 `file-panels/choice/model.test.ts`，经 `filePanelLineNavigation` 走上游的面板选择，节点文档与 HTML 两条仍传 `lineView: "preview"`，断言意思不变。

### 按 Osuna 决定改写的上游测试（PR 正文要列）
- `app/src/components/connection-failure-copy.test.ts`「preserves authentication failures and their technical details」→「reports authentication failures with the localized reason only」：Osuna 的密码被拒只给本地化原因（`9be046d8c`）。
- `app/src/usage/pinned.test.ts` 上游用例里的动态 `import("@/i18n/i18next")` 删掉（与 Osuna 顶部 import 重名，lint 报遮蔽）。
- `app/e2e/browser/add-changed-file-to-chat.spec.ts`：按 textarea 读 Composer 改为 `expectComposerText`（Tiptap）。
- `app/e2e/mobile/status-ring/native.tsx`（上游新测试壳）：`useStatusRingRotation()` 补 Osuna 的 `{ enabled: true }`。

### 只改调用或准备步骤的 Osuna 用例（断言不变）
`workspace-tab-layout.test.ts` 补 `compact: false`；`explorer-sidebar.test.ts`、`session-history/internal/open-terminal-tab.test.ts` 去掉上游删掉的 `supportsPaneSplits`、`checkout`；`styles/theme.test.ts` 插件夹具补 `locale`、`i18n`、`filePanels`；`logic-map/draft-logic-map-store.test.ts` 写入前先 `await before.persist.rehydrate()`（上游起存储读取期间的写入会被丢掉）。

### 被删的测试行核对
脚本比对「合并后删掉、且不在合并基点 `cafe4b01c` 里」的行：Osuna 的只有上面列出的几条。底线守卫另报的 285 行删除断言都是上游这一段改它自己的用例；8 个删除的测试文件中 7 个是 Osuna 没改过的上游文件（`compact-explorer-sidebar-host-state`、`read-result`、`editor/model`、`observation-source`、`live-file/model`、`preview-lifecycle/model`、`plugins/icons`），1 个是上面挪走的 `file-pane-render-mode.test.ts`。

### 合并后核对
更新源 `publish` 仍是 LFT-OXY/Osuna；`appId: com.chinhae.osuna.desktop`、`productName: Osuna`、`desktopName: Osuna.desktop`，main.ts 的 userData 固定不变；desktop-release 的 `mac-sign.js`、`OSUNA_MAC_SIGNING_SHA1`、Verify macOS signature 都在；四个部署工作流只有 `workflow_dispatch`。CI 本段：`pull_request` 去掉 `branches: [main]`，app-tests 作业加了 Android 模块测试（`test:android`，Java 21），没有新的装 Playwright 的作业，已有的都是 `ubuntu-24.04`。版本号全 0.17.0；CHANGELOG 逐字节相同；`CHANGELOG.zh-CN.md` 是上游原样；README 冲突块取 Osuna，CLAUDE.md 冲突块外上游加的两行文档表照收、「When Mo requests an APK」一句删掉；本段没有安卓商店说明冲突。`bootstrap.ts` 新增的是 `closeStaleAgentRecords` 等，不含提供方名字。协议：新增字段与 RPC 都是可选或新 schema，`mode` 枚举只加 `"all"`；协议测试只有上游新增用例与一行 import 合并，现有断言未改。
翻译键：上游新增键九种语言齐全；zh-CN 的 `filePanels.*`、`settings.files.*`、`all`（「全部更改」）是真实译文；`providerUsage.*` 的上游中文措辞（「已使用」「提供商」「刷新中...」）不符合术语表，这次只把本段测试碰到的几个写回 Osuna 译法（见裁决记录），其余由工单 08 改回。`resources.test.ts` 单独跑过并通过。

### package.json 与锁文件
各 package.json 相对合并前的差异只有上游在版本号之外的改动（Expo 54 → 57、React 19.2.3、React Native 0.86.3、client/protocol 新导出、plugin 的 react peer 范围、server 新依赖与 `test:integration` 的连接主机用例）。锁文件：在合并前的锁上 `npm install --package-lock-only` 报「已是最新」却把 Expo 留在 54；改为以上游锁为底、补 Osuna 独有的 34 个包（沿用合并前版本），在没有 node_modules 的临时目录里规整，详见裁决记录「元数据」。

### 测试
- 本段新增或改动的 162 个测试文件（去掉 `*.real.*`）逐个单独跑：除下列外全部通过。
  - `app/plugins/with-paste-input.test.ts`：不在 app 任何 vitest 项目的 include 里，上游 CI 也不跑，未运行。
  - `server/src/server/agent/mcp-parity.e2e.test.ts` 4 条（结束通知的 `serverId`、取消算 errored）：评审要求核实后，在纯上游 `3fa625701` 导出的代码上装依赖跑同一文件，同样 4 条失败、32 条通过——是上游这一版自己的用例与代码不一致，该文件不在 CI 清单，按 prd「上游缺陷只在弄坏 Osuna 功能或让 CI 变红时处理」不改。
  - `server/src/server/daemon-e2e/checkout-ship.e2e.test.ts`：要拉起真实 Codex，不在 CI 清单，不作数。
  - `*.local.e2e`（opencode-bridge、codex-auto-review）按约定不跑。
- 另补跑套餐用量、plan-usage、文件面板选择、标签栏、Explorer、push-router、git、逻辑图、子 Agent、状态环、连接失败文案等 82 个文件，与所有用到 `createValidatedPersistStorage` 的 11 个存储测试，全部通过。
- 指令目录（ADR 0003）：本段没有改到指令发现相关代码，`agent-manager.test.ts`、`create.test.ts` 等相关文件在上面的清单里通过。
- typecheck、lint 全仓通过；提交钩子每次都过了 lint、format、typecheck。

### dev 桌面端冒烟（`.dev/paseo-home`、6769）
启动前备份真实 `~/.codex/config.toml`、`~/.claude/settings.json`，结束后逐字节相同；dev 数据里没有接管记录。侧栏、输入框（Tiptap，中文输入正常）、Explorer（文件 / 更改 / 会话历史 / 逻辑图）、Changes（默认「全部更改」）、终端、套餐用量（「已用 35% · 1h 后重置」）、用量统计页、Providers 页、第三方接口页、逻辑图、Markdown 文件预览（上游的预览，带 Markdown / 源代码切换）都打开正常。冒烟中发现：用量统计、Providers、第三方接口三页从 `@react-navigation/native` 取 `useIsFocused`，Expo 57 起拿不到导航上下文，用量统计页一打开就崩到错误页；按上游同期的写法改从 `expo-router/react-navigation` 取（`fa09280cd`），复测三页正常。控制台只剩第 1 段已记的 `uniProps` 落到 DOM、按钮套按钮两条开发警告。

### 评审（2026-10-27）
- Standards：1 项硬违反——断言改动没记进 `## Comments`（`format.test` 两条、`usage-settings.spec` 两条），已在上面补齐。判断项：格式名 Markdown/HTML 应放 abbreviations（已挪）；挪过来的逻辑图用例测不到 `lineView`（已改，见下）；`providerUsage.timing.runsOutNow` 九种语言暂无人引用、`copy.ts` 的 `title`/`planUsage` 同键、两套用量文案键并存、`format.test` 上下游各有一条重复意思的断言——都属工单 08 的套餐用量文案整理，这次不动。
- Spec：(a) `mcp-parity` 4 条失败未证实来源——已在纯上游上复现，结论见「测试」；(a) 「行号视图」没挪进上游做同一决定的地方——把 `pane.tsx` 里内联的判断抽成 `file-panels/choice/model.ts` 的 `filePanelLineNavigation`，挪来的用例经它传入带 `lineView: "preview"` 的位置；裁决记录里与代码不符的描述已更正；(b) 内置面板提供者名改 Osuna 属越界——理由写进裁决记录（界面上的应用名，规则 1）；(c) `usage-settings.spec` 记录与实际不符——已更正并列入上面；`formatUsageFreshness` 只剩测试调用——Osuna 用例仍在用，去留归工单 08。

### 留给后续工单
- 08：`usage.planUsage` 与 `providerUsage` 两套键合一；`formatUsageFreshness`、`planUsageAccountNames` 去留；`providerUsage.timing.runsOutNow` 无人引用；`providerUsage.*` 其余中文措辞改回 Osuna 译法；`copy.ts` 同键 getter。
- 07：标签底色换回 Osuna 的悬停与选中色值；`docs/explorer-sidebar.md` 并入会话历史与逻辑图两节；手机默认预置会话历史。
- 09：All changes 下 Osuna 的按文件复用（`checkout-git.ts` 本段只把 `context` 传进上游新拆出的 `readCheckoutDiff`，私有 index 下是否正确未验证）。
- 14：`mcp-parity.e2e` 的上游缺陷不修，在 PR 正文写明。

### 规范更新
- Expo 57 下从 `@react-navigation/native` 取导航钩子会在 Web 上崩：做成 lint 规则（`.oxlintrc.json` 的 `packages/app/src/**` 块加 `no-restricted-imports`），把用量页改回出错的写法验证过会报错；`.atw/spec/app/frontend/quality-guidelines.md` 新增规则表并登记这一条。
- `docs/release.md`：「版本号与发版元数据」补锁文件「已是最新」却不升级的做法；「踩过的坑」补共用存储模块改时序后 Osuna 用例要先 rehydrate、上游 e2e 本机挂了先在纯上游代码上复现两条。
