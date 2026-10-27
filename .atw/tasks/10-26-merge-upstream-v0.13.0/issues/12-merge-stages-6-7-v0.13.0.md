# 12 — 第六、七段：合并到 v0.13.0

**What to build:** 合并分支上依次有两个 merge commit，分别合进上游 `30d8cb044`（v0.13.0-beta.2）与 `d34d17a90`（v0.13.0），每个之后分支都能通过检查。这两段带进来终端去掉 WebView 渲染器与粘贴图片、拖入文件，经中继连接必须带密码（#7668），Claude 代理的重写，术语表与发版文档的上游改动，安卓商店说明。规格见 `prd.md`「终端」「中继密码」「提供方」「文档」。

**Blocked by:** 07, 08, 09, 10, 11
**Status:** ready-for-agent
**Impl:** done

- [ ] 两个 merge commit 的双亲分别是合并前的分支头与对应的上游发布点；每段合完都过一遍本清单里的通用项，结果按段记在 `## Comments` 下。
- [ ] 终端：接受删掉 WebView 渲染器，设置页与存储测试里对旧渲染器开关的引用已清掉；Osuna 的字体、字号、四边内边距、配色派生与 DECSET 2031 主题推送的现有测试通过。
- [ ] 中继密码：接受强制校验，`relayPasswordOptional` 分支已删；会话准入认证的测试按新行为改预期并记下；`SECURITY.md` 与 `public-docs/security*.md` 不再写「放行不带密码的中继连接」；给下次发版更新日志的「行为变化」说明草稿记在 `## Comments` 下。
- [ ] Claude 代理的重写与 Osuna 的指令发现、Routing block 剥离、已装版本与一键升级两边都留；上游新 Claude 用例若触发进程启动，按 `.atw/spec/server/backend/testing.md` 改用例不改实现。
- [ ] `server/bootstrap.ts` 解完后不出现提供方名字。
- [ ] `docs/glossary.md`、`docs/release.md` 的冲突两边都留，术语以 Osuna 的为准。
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
- [ ] 合并分支包含 `d34d17a90`；`759532509` 与 `d34d17a90` 都是合并分支的祖先。
- [ ] dev 桌面端快速冒烟：侧栏、输入框、终端（粘贴一张图片）、Providers 页、第三方接口页、用量页、逻辑图、关于页打开正常，无报错。

## Comments

- 从工单 03 挪来：上游 #7611「元数据生成只用所选模型」（`457414231`）在第 6 段进来。合完照收逻辑（`structured-generation-providers.ts`、`git-metadata-generator.ts`），文案键 `fallbackHint` 换成 `modelHint` 后，九种语言里的 “Paseo” 改 “Osuna”（main 的 `fallbackHint` 已是），`metadata-generation-page.tsx` 不放回 paseo.sh 文档链接（feature-overlap 3.2 第 5 条）。
- 从工单 10 挪来：上游 #7683（`21e7ccb03`）在第 6 段把结束通知搬进 `agent/finish-subscriptions/internal/notification.ts`。合完把 Osuna 的权限文案（由用户在子会话里批准、未授权别用 `respond_to_permission`，现在在 `agent-prompt.ts` 的 `setupFinishNotification`）搬进新文件，同时收下上游的 `host unreachable`、`host removed` 两种原因，`serverId` 本段已有、照留（prd「连接的主机与 Agent 间消息」）；`agent-prompt.test.ts`「finish notifications survive permission responses」若随上游删掉，挪进新文件对应的测试，断言原文不变；再跑一次 `subagent-permission.e2e`。

### 双亲与提交
- 第 6 段 v0.13.0-beta.2：merge `7e2a7ef83` = `2c350eeb2` + `30d8cb044`。git 报 45 个冲突文件、1 个上游删 Osuna 改（WebView 终端产物）。适配 `274385b24`。
- 第 7 段 v0.13.0：merge `c644c42f6` = `274385b24` + `d34d17a90`。git 报 22 个冲突文件。
- 评审后的修正与本工单记录在随后的提交里。`759532509`、`d34d17a90` 都是合并分支的祖先（`merge-base --is-ancestor` 通过）。
- 逐文件裁决、依据的规则见 `research/stage6-7-resolutions.md`（按段、按区域）。

### 上游站点链接（全部 / 非测试）
合并前（`2c350eeb2`）：app 75 / 1，cli 13 / 3。第 6 段后、第 7 段后相同。

### COMPAT 改写（合并前 main 上不存在的名字 → v0.18.0，日期不动）
第 6 段：`automaticWorkspaceOrder`（app stores/sidebar-order-store.ts，第 7 段随上游删掉）、`pluginAgentPanelAlias`×2（plugin client/contracts.ts、app plugins/evaluate.ts）、`pluginPanelFlatProps`×8（plugin client/contracts.ts 4 处、app plugins/evaluate.ts、plugins/workspace-panels/panel.tsx 3 处）、`relayProtectedSecurity`×4（protocol connection-offer.ts、messages.ts 两处、server websocket-server.ts）、`workspace-open-url`（app `h/[serverId]/workspace/[workspaceId]/index.tsx`）、`workspaceSortTimes`（app stores/session-store.ts）。另：评审发现 `plugins/evaluate.ts:118` 的 `pluginReactNativeEntrypoint`（第 5 段名字，这一处第 6 段才带进来）漏改，已改 v0.18.0。第 7 段没有新名字。上游删掉的 `relayPasswordOptional` 随代码一起没了。

### 问过维护者的
本段没有。规则裁决不了或改变用户可见行为的地方都由 prd 已有决定覆盖：中继强制密码（prd「中继密码」，维护者 2026-10-26 确认）、结束通知的权限文案搬进新文件（本工单 Comments 从工单 10 挪来的一条）、逻辑图带行号节点仍开源码视图（prd「Markdown」）。

### 中继密码：下次发版更新日志「行为变化」草稿
> 设了密码的主机，经中继（relay）连接现在也必须带密码，与直连一致；旧版 Osuna 与官方 Paseo 手机 App 里经中继添加、没有保存密码的主机会连不上，需要在 App 里重新添加主机并输入密码。（上游 #7668）

本任务不发版；工单 14 把这段写进 PR 正文，发版时搬进 `CHANGELOG.md`。`SECURITY.md`、`public-docs/security.md`、`public-docs/security.zh-CN.md` 已随上游改为「中继客户端也必须带密码」，不再有「放行不带密码的中继连接」的说法。

### 会话准入认证的测试
`server/auth.test.ts` 由上游 #7668 自己改：准入函数去掉了 `transport` 参数，中继与直连走同一判断，所以「中继不带凭据放行为 owner」「中继错密码」两条断言随参数一起删掉，「不带凭据 → `password_required`」那条现在同样适用于中继。经中继的新行为由 `daemon-e2e/relay-transport.e2e.test.ts`「password-protected daemon refuses a relay client without the password」守着（本机跑过，在 CI 的 `test:integration` 过滤词里）。这几条都是上游的断言，Osuna 没改过。

### 因换成上游实现而改动的 Osuna 断言（PR 正文要列）
- `app/src/file-panels/choice/model.test.ts`：从 `file-pane-render-mode.test.ts` 挪来的 3 条（普通行号、逻辑图节点文档 `lineView: "preview"`、HTML 行号）预期从 `builtin:source` 改为 `builtin:markdown` / `builtin:html`，用例名随之改成「在内置面板里打开」（上游 #7614：Source 成了 Markdown / HTML 面板里的视图，面板见到行号切 Source）。用户看到的效果由 `file-editing.spec.ts` 新补的「opens a Markdown line target as source」与上游的 HTML 用例证明（只在 CI 跑）；节点文档的 `lineView` 不影响 `file-pane/pane.tsx` 传给面板的 `lineStart`。
- `app/e2e/browser/plugin-file-panel-examples.spec.ts`：「Source — Osuna」单选可见的断言随上游删掉独立 Source 面板改为上游的 `toHaveCount(2)`；helper 的 `SOURCE_OPTION` 常量删掉。
- `server/src/server/agent/agent-prompt.test.ts`：上游把结束通知用例整组挪走；Osuna 唯一改过的权限文案断言挪进 `finish-subscriptions/finish-subscriptions.test.ts`「permission checkpoint retains intent…」，原文与 `toContain` 不变。原用例里的权限请求 JSON 结构由 `mcp-server.test.ts`（按 `<permission-request>` 取 `requestId`）覆盖，批准后仍发「finished」由同一个 finish-subscriptions 用例覆盖。

### 按 Osuna 决定改写的上游测试（PR 正文要列）
- `plugin-file-panel-settings.spec.ts`：上游本地常量 “Source — Paseo” 改 “Source — Osuna”（内置面板提供者名是 Osuna，规则 1；断言 `toHaveCount(0)` 不改名就恒真）。
- `plugin-file-panel-examples.spec.ts:239`、`plugin-file-panels.spec.ts:98`：“Open with…” 菜单里的 “Markdown — Paseo” 改 “Markdown — Osuna”（评审发现）。
- `sidebar-nav-settings.spec.ts`：上游的 `expectFooterSeparator(page, true)` 换成 Osuna 的 `expectNoFooterRule`（Osuna 侧栏底部不画分割线），保留上游的 `expectCompactSidebarOpen`。
- `settings-toggle-tab-regression.spec.ts`：上游取可见 `message-input-root` 的写法照收，输入框按 Tiptap 读 `[role="textbox"]`。

### 只改调用或准备步骤的 Osuna 用例（断言不变）
`logic-map/panel-surface.browser.test.tsx` 的假 toast `show` 返回关闭函数（上游 `ToastApi.show` 改了签名）。

### 被删的测试行核对
脚本比对「合并后删掉、且不在该段合并基点里」的行：Osuna 的只有上面列出的几条。底线守卫对整个补丁报 171 条，逐条核对：142 条在上游自己的差异里同样出现；5 个删除的测试文件（WebView 终端两个、`switcher-layout`、`terminal-find.browser`、`notification-routing`）是上游删的、Osuna 没改过；11 个空 catch 与上游原文一致；`auth.test.ts`、`terminal-renderer-capability.test.ts` 与上游完全相同。

### 合并后核对
更新源 `publish` 仍是 LFT-OXY/Osuna；`appId: com.chinhae.osuna.desktop`、`productName: Osuna`，main.ts 的 userData 仍固定在 `Paseo`；desktop-release 的 `mac-sign.js`、`OSUNA_MAC_SIGNING_SHA1`、Verify macOS signature 都在；四个部署工作流只有 `workflow_dispatch`。CI：两段都没有新作业，第 6 段只在 `ci-paths.yml` 的 desktop 路径加了 `*.electron.{ts,tsx}`，装 Playwright 的作业仍是 `ubuntu-24.04`。`bootstrap.ts` 不含提供方名字（`claude.test.ts` 那条用例通过）。版本号全 0.17.0；CHANGELOG 与工单开始前逐字节相同；安卓商店说明 `130001`–`130004` 留 Osuna 的；本两段 README、`CLAUDE.md` 没有冲突。协议：第 6 段新增 `minimumSecurityMode`、`requireProtectedSecurity`、`relayProtectedSecurity`、`workspaceSortTimes`、`createdAt`、`lastUserMessageAt`，全部 optional；协议测试只有 `daemon-endpoints.test.ts` 新增用例，现有断言未改。
翻译键：第 6 段新增 `sort.*`、`preview`/`source`、终端 `fileUploaded`/`pasteFileFailed`/`uploadingFile`，第 7 段新增 `manual`，九种语言齐全，zh-CN 是真实译文（排序、创建时间、最近提示词、请更新主机以排序工作区、预览、源代码、文件已上传、无法粘贴文件、正在上传文件…、手动）。元数据生成提示 `modelHint` 九种语言的 “Paseo” 改 “Osuna”，不放回 `docs` 链接。`resources.test.ts` 两段各单独跑过并通过。

### package.json 与锁文件
第 6 段：相对合并前只多出上游在版本号之外的改动（app 删 `build:terminal-webview`，relay 加三个 `@noble` 包，server 的 `test:integration` 过滤词加上游的一条、Osuna 的两个 api-endpoint e2e 保留）。锁文件在只放 package.json 的临时目录里以合并前的锁为底重新生成，连跑两次不变，相对合并前只多出三个 `@noble` 条目。第 7 段：package.json 与锁文件都与合并前逐字节相同。

### 测试
- 第 6 段：新增或改动的 112 个测试文件，加冲突文件对应的与用到 `workspace-layout-store` 的测试，共 131 个逐个单独跑：`file-panels/choice/model.test.ts` 改断言后通过，其余首轮全部通过（含 `hosts.e2e`、`relay-transport.e2e`、Claude 代理 118 条、finish-subscriptions、`resources.test.ts`）。`daemon-e2e/daemon-restart-resume.e2e.test.ts` 会拉起真实 Codex，不在 CI 清单，未跑。
- 第 7 段：新增或改动的 16 个测试文件加冲突相关 3 个，共 19 个，全部通过。
- 指令目录（ADR 0003）：两段没有改到指令发现代码；Claude 的 `discoverCommands`、`resolveInstalledVersion`、`resolveCliLaunch` 都在，`claude/agent.test.ts`、`agent-manager.test.ts` 通过，断言未改。Routing block：导入预览仍经 `stripTrailingRoutingBlock`（「drops the Routing block from import previews」通过）。
- typecheck、lint 全仓通过；三次提交的钩子都过了 lint、format、typecheck。本机复核前挪开了 `packages/app/.expo` 与 `node_modules/.vite`。

### dev 桌面端冒烟（`.dev/paseo-home`、6769）
启动前备份真实 `~/.codex/config.toml`、`~/.claude/settings.json`，dev 数据里没有接管记录；结束后两份逐字节相同，正式版 daemon（6767）一直在。用 mock 提供方建临时演示工作区（用完已归档）：侧栏、输入框（Tiptap，中文输入正常）、终端粘贴图片（图片上传到 `.dev/paseo-home/uploads/` 后路径写入终端）、Providers 页、第三方接口页、用量页（套餐用量「已用 23%」）、主机用量设置、逻辑图（Explorer 加号打开，空状态）、关于页都打开正常，没有页面错误；控制台只有已知的 `uniProps` 落到 DOM、按钮套按钮两条开发警告。截图未入库。

### 评审（2026-10-27）
- Standards：2 项硬违规——`plugins/evaluate.ts:118` 的 COMPAT 版本没改；两个 e2e 仍写 “Markdown — Paseo”。都已修。判断项：`filePanelLineNavigation` 注释过期（已改）；model.test 用例名与断言不符（已改名）；zh-CN `editor.source`「源代码」与 `viewSource`「查看源码」两种说法（上游译文，本次不动，留给工单 13 的视觉走查一并看）；`docs/release.md` 发版清单取上游写法要求提交 `CHANGELOG.zh-CN.md` 条目，与 prd「Osuna 不写中文条目」有出入（留给工单 14 改发版文档时处理）；`StatusIcon` 描边表与 layout store 的多处同步是上游写法，不改。守卫 171 条全部放行，安全检查没有失败项。
- Spec：(a) 第 7 段记录、外链、COMPAT、合并后核对、行为变化草稿未写——已在本节与裁决记录补齐；会话准入测试未记下——见上「会话准入认证的测试」。(c) 两处 “Markdown — Paseo”、`evaluate.ts:118`——已修；逻辑图用例只断言面板、权限用例只挪了一行——已在「因换成上游实现而改动的 Osuna 断言」写明覆盖关系；`SOURCE_OPTION` 记录与代码不符——裁决记录已更正。
- 修正后复核：`rg "— Paseo"` 在 `packages/app/e2e` 下为空；`COMPAT(pluginReactNativeEntrypoint)` 四处都是 v0.18.0；`model.test.ts`、`evaluate.test.ts` 重跑通过（78 条）。

### 留给后续工单
- 13：zh-CN「源代码」与「源码」两种说法一并看。
- 14：PR 正文写上面「行为变化」草稿与断言改动清单；`docs/release.md` 同步点、补丁分支一节、开 PR 时机，以及发版清单里 `CHANGELOG.zh-CN.md` 那句对 Osuna 不适用；官网 e2e `i18n.spec.ts`「shows the changelog in Chinese」在 Osuna 没有中文条目时可能挂（第 5 段带进来，评审提醒，未本机验证），看 CI。
