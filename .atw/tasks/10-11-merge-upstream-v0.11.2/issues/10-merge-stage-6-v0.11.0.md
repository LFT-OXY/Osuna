# 10 — 第六段：合并到上游 v0.11.0

**What to build:** 合并分支上有一个把上游 `22488d450`（v0.11.0，58 个提交）合进来的 merge commit。这一段上游把套餐用量从独立页面改成了弹窗并删掉了那个页面，PR 面板等处的文案改走翻译，还带来这一版剩下的修复与两个新提供方、插件登记处的收尾。合完之后 `/usage` 仍是 Osuna 的 Usage 页；侧栏底部的「套餐用量」图标点开上游的弹窗；Osuna 的套餐用量入口仍有数据。弹窗的叫法、侧栏摘要与外观在 11，Osuna 三个入口换数据在 12。上次合并遗留的补丁分支重解在这一段收尾（提供方注册、OpenCode 2.x 等）。模拟合并里这一段新增约 17 个冲突文件。规格见 `prd.md` 的「合并方式」「中间段的处理原则」「补丁分支」「提供方的冲突」「版本号与发版元数据」。

**Blocked by:** 09
**Status:** ready-for-agent
**Impl:** done

- [x] 合并分支包含一个以合并前的分支头与 `22488d450` 为双亲的 merge commit。
- [x] 每个冲突文件怎么裁的、依据哪条规则，逐个记在 `## Comments` 下。规则裁决不了、或保留两边会改变用户可见行为的冲突没有自行取舍。
- [x] `/usage` 路由仍在并指向 Osuna 的 Usage 页（上游在这一段删掉了它自己的那个路由文件）；上游的中间页面及其测试随上游删除，前面各段为它改写过的测试不再残留。
- [x] 侧栏底部的「套餐用量」图标点开上游的弹窗；顶部的「用量」条目与已保存顺序的行为与 03 做完时相同，03 加的用例通过。
- [x] Osuna 的套餐用量入口（Usage 页卡片、Composer 用量条、上下文圆环悬浮卡）仍有数据；主机设置页仍是价格表。
- [x] 补丁分支分叉处剩下的文件按固定裁决处理完；`docs/release.md`「上游的补丁分支」列的十个文件都已解过，逐个的落点（在哪一段解的）记在 `## Comments` 下。
- [x] OpenCode 2.x：按上游原样收下，上次为 ADR 0003 改的那一处（服务不在时取指令列表返回空、不重连）仍在，守着它的用例通过。
- [x] PR 面板：上游的翻译改动与 Osuna 的改动两边都留，对应的测试通过。
- [x] README 的冲突块取 Osuna 的；与 Osuna 同名的四个安卓商店说明文件留 Osuna 的。
- [x] 所有工作区版本号是 `0.14.2`；`CHANGELOG.md` 与合并前逐字节相同；`package-lock.json` 的差异能逐项对应到上游的依赖改动。
- [x] 协议新增的字段都是可选的；新带进来的 `COMPAT(...)` 标签已改写版本号。
- [x] `docs/release.md`「合并后核对」逐项过完，结果记在 `## Comments` 下；上游站点链接的非测试数不多于基线。
- [x] 翻译资源测试通过（上游在这一段改了翻译守卫的测试文件：Osuna 的守卫没有被放宽）；指令目录的现有测试通过，无一改动断言。
- [x] Claude、Codex、Pi、OMP、OpenCode 1.x 上 Osuna 的独有行为对应的现有测试全部通过，无一改动断言。
- [x] 对本段冲突涉及的测试文件对比合并前后，没有 Osuna 的断言行被悄悄删掉。
- [x] typecheck 和 lint 通过；本段冲突文件对应的测试文件、本段新增或改动过的测试文件逐个单独跑过并通过。
- [x] 推到 `origin` 后草稿 PR 上的 CI 结果已看过并记在 `## Comments` 下。

## Comments

### 2026-10-12 实施记录

**基线（合并前 `e4f50bdb6`，认领提交；代码与 `52fea912c` 相同）。** 13 个工作区版本号 `0.14.2`；`CHANGELOG.md`、`README.md`、`package-lock.json`、各 `package.json`、安卓商店说明取了指纹；上游站点链接 `packages/app/src` 全部 73、非测试 1，`packages/cli/src` 全部 13、非测试 3（与 09 相同）；`COMPAT(...)` 标签名清单取了快照。

#### 第六段：v0.11.0（`22488d450`，58 个提交）→ merge commit `e57639e38`（双亲 `e4f50bdb6`、`22488d450`）+ 适配提交 `cde8316a3`

- **冲突 47 个文件**（模拟合并同为 47）：内容冲突 42，两边各加一份 4（安卓商店说明），上游删 Osuna 改 1（`app/usage.tsx`）。这一段的合并基点是上一段的发布点 `15d774d4a`，不再是 v0.10.0。按 `docs/release.md`「冲突裁决」三条规则逐个裁，下面标 ①②③。
- **版本号与发版元数据 20 个文件（①）**：`CHANGELOG.md`、13 个 `package.json`（根、app、cli、client、desktop、expo-two-way-audio、highlight、plugin、protocol、relay、server、website、plugins）冲突块只有版本号，取 Osuna 一侧；解完 `CHANGELOG.md` 与其中 12 个 `package.json` 与合并前逐字节相同（`cmp` 核对），`packages/website/package.json` 多一行上游在冲突块之外新增的开发依赖 `parse5`。`package-lock.json` 取合并前内容后用 `npm install --package-lock-only --ignore-scripts` 重新生成，相对合并前只多 `parse5` 这一行。四个安卓商店说明 `110001.txt` – `110004.txt` 留 Osuna 的，与合并前逐字节相同。
- **`README.md`（①）**：4 个冲突块取 Osuna 的。冲突块之外上游自动合并进来三条特性说明、一句指向 `paseo.sh/docs/parallel-development` 的链接、改写过的 Plugins 第一段。Osuna 的 README 此前没有一处指向上游站点的链接，所以那句链接改指本仓库的 `public-docs/parallel-development.md`，两处「in Paseo」按 README 的写法改成「in Osuna」；其余照收。**这是实施者的决定**，规格只写了「冲突块取 Osuna 的」。
- **`/usage` 路由（①）**：上游删了 `app/usage.tsx`（它自己的中间页面的路由文件），Osuna 改过它，保留 Osuna 的（指向 `@/screens/usage-screen`）。**没有报冲突、但被自动删掉的三处**：`app/_layout.tsx` 里 `pathname === "/usage"`（应用外壳是否显示）与 `<Stack.Screen name="usage" />`，`utils/host-routes.ts` 的 `buildUsageRoute()`——两边原先各写了一模一样的行，上游一删就跟着没了；三处补回，这两个文件解完与合并前逐字节相同。上游的中间页面 `usage/usage-screen.tsx` 随上游删除，`@/usage` 不再导出 `UsageScreen`。
- **`usage/sidebar-item.tsx`（②）**：2 块取上游。`UsageSidebarRoot` 不再挂 Osuna 在 06 留下的「窄屏开抽屉、宽屏进 `/usage`」，改成上游的 `UsageModal`：底部图标与摘要行都在当前页面上打开弹窗（桌面是对话框，窄屏是底部抽屉）。
- **`usage/usage-modal.tsx`（没有冲突，为通过 typecheck 改一处）**：上游用 `builtinSidebarNavLabelKey("usage")` 取弹窗标题；Osuna 的这个函数要说明取哪一组（两组里各有一个 `usage`），改成 `("usage", "footer")`。于是弹窗标题现在就是「套餐用量 / Plan usage」。标题的叫法原本归 11，这里只做了让类型通过的那一个参数，其余文案与外观仍归 11。
- **PR 面板 5 个文件（②，两边各做了一遍翻译）**：上游这一段把 PR 面板改走翻译键，Osuna 之前已经做过一遍。`pane.tsx` 两边的键名相同，自动合并，Osuna 多出的 `Copy → common.actions.copy` 仍在。检查汇总两边写法不同：Osuna 是 `summarizeChecks(checks)` + `formatChecksHeadline / formatChecksCount / formatChecksGroupLabel(t, …)`，键在 `workspace.git.pr.checks.*`；上游是 `summarizeChecks(checks, t)` 直接给出 `headline`、`parts[].text`、`detailLead / detailTrail`、`groups[].label`，键在 `workspace.git.pr.checksOverview.*`，并保留了按状态的 testID。工单写的是「两边都留」；两套写法并存做不到（同一段界面只能渲染一套），按规则 ② 以上游写法为底、补回 Osuna 多出的：
  - `checks-summary.ts`、`checks-section.tsx` 取上游整份。Osuna 多出的两处行为补回，都算在 `summarizeChecks` 里、组件只管渲染：计数短语之间的分隔符随语言变（上游写死 `", "`，Osuna 的中文是全角逗号）——每个 `parts[]` 多一个 `lead`（第一段为空，其后读 Osuna 原有的键 `workspace.git.pr.checks.countSeparator`）；标题栏的无障碍名称多一个 `accessibilityLabel` 字段，走 Osuna 原有的翻译模板 `workspace.git.pr.checks.accessibilityLabel`（中文是「{{headline}}。{{detail}}」）。`PRESENTATION_ORDER` 保持导出（Osuna 的用例在用）。
  - `data.ts` 取上游（`getStateLabelKey` / `getActivityVerbKey` 两边同名，上游的返回值是字面量类型）。
  - Osuna 被上游取代的键 `workspace.git.pr.checks.{headline,count,countLine}.*` 从九种语言删除（14 个键 × 9）；`countSeparator` 与 `accessibilityLabel` 留在原处。
  - **中文界面看到的字不变**：zh-CN 的 `checksOverview.*` 写 Osuna 原来的译法（「{{count}} 项失败」、明细行不带「检查：」前缀、分组标题与计数短语相同），由新用例「joins the count phrases the way the language punctuates a list」证明（明细行 `2 项失败，1 项成功`、无障碍名称 `部分检查未通过。2 项失败，1 项成功`）。**其余七种非英文语言看到的字变了**：Osuna 原来在这些语言里放的是英文占位（`{{count}} failing`、`{{parts}} checks`），现在是上游的译文，明细行按上游的写法以名词开头（法文 `Vérifications : 2 en échec, …`）。
- **`components/message.tsx`（②）**：轮次页脚的「Worked for」两边各翻译了一遍。取上游的 `getTurnDurationLabel()` 与键 `message.turnFooter.workedFor`；Osuna 的键 `message.workedFor` 没有别的调用方，从九种语言删除；zh-CN 的 `turnFooter.workedFor` 写 Osuna 原来的「已工作 {{duration}}」（上游是「工作了」），其余语言取上游。
- **`components/sidebar/project-leading-visual.tsx`（③）**：无障碍名称取上游的 `getStatusBucketLabel(statusBucket, t)`（翻译），底色函数留 Osuna 改过名的 `getSurfaceBackdropFillStyle`。
- **翻译资源 9 个文件**：`fr.ts` 57 块（上游 #6004 把法文整份重译，2349 行），`ar / es / ja / ko / pt-BR / ru` 各 4 块，`zh-CN` 2 块，`en` 1 块。做法：冲突块先统一取上游一侧，再用一次性脚本把基点、Osuna、上游三份资源摊平成「键 → 值」做按键的三方合并（一边没动取另一边），与文件实际内容逐键比对并改到一致；两边都改且不同的键逐条裁：
  - `fr.ts` 两边都改的 67 个键：Osuna 已删、上游又改了译文的 24 个（应用更新旧状态、文档站链接、`contextWindow.sessionCost` 等）保持删除（①）；两边各加了一份、Osuna 那份是英文占位的 9 个取上游的法文；Osuna 只把品牌名换成 Osuna、上游重译了整句的 25 个取上游的新句子并把 Paseo 换回 Osuna（`de Osuna → d’Osuna`、`que Osuna → qu’Osuna`）；Osuna 改过含义的 6 个（应用更新「可用 / 准备重启 / 安装会重启应用」）留 Osuna 的；`contextWindow.used / tokens / accessibility` 3 个取上游的新译文。冲突块里 Osuna 独有的 117 个键补回，Osuna 改过、上游没动的值恢复。
  - 其余六种非英文语言各 9 个键（PR 面板的「添加到聊天」「动态」「已解决」等）：Osuna 那份是英文占位，取上游的译文。zh-CN 两边都改的只有 `pr.accessibility.threadActions`，留 Osuna 的「讨论主题操作」；`pr.sections.reviews` 留 Osuna 的「审查」（上游是英文占位）。
  - **自动合并出来的重复键**：`pr.accessibility.commentActions / threadActions` 两边各加了一份，九个文件里都重复，去掉 Osuna 位置的那一份、留上游位置的。
- **`i18n/resources.test.ts`（③）**：上游新增的「PR 面板与侧栏状态分组保持已翻译」守卫与 Osuna 的「已迁移英文字面量」守卫都留。上游这一段原地保留的「keeps local connection fallback errors translated」Osuna 早已用自己的守卫替换，不恢复。**Osuna 的守卫没有放宽**；它点名了上游 `checks-summary.ts` 里的一句注释（`/** e.g. "Some checks were not successful" */`，守卫连注释一起扫），按 `docs/release.md` 改写那句注释。
- **e2e 5 个文件**：
  - `e2e/browser/usage-modal.spec.ts`（上游由 `usage-screen.spec.ts` 改名，②）：取上游整份。02 – 09 为上游的中间页面写的跳过与改写（`describe.skip`、4 条 `test.skip`、只留侧栏摘要那一半的两条、改到窄屏抽屉的一条）全部不再残留。
  - `e2e/browser/usage-sidebar-item.spec.ts`（②）：取上游整份，同上。
  - `e2e/support/helpers/usage-sidebar-item.ts`（②）：取上游的 `openUsageFromIcon / openUsageFromItem`。
  - `e2e/browser/sidebar-help.spec.ts`（②）：窄屏底部按钮 44pt 的亚像素比较两边各修了一遍，取上游的（容差 0.01），06 里 Osuna 的 `Math.round` 写法随之去掉。
  - `e2e/support/helpers/sidebar-nav-settings.ts`（①）：`expectFooterIconRow` 留 Osuna 的（按钮间距 2px、轮询到稳定）；上游改成一帧内取全部框、间距按 0 断言，与 Osuna 的外观不符。
- **`docs/glossary.md`（③，以 Osuna 的词条为底）**：留 Osuna 的一组词条，按上游这一段把两条改成弹窗的说法——**Plan usage report**「卡片出现在套餐用量弹窗与上下文窗口详情里」，**Plan usage summary**「两个入口都在当前页面上打开弹窗，桌面是对话框、窄屏是底部抽屉，弹窗没有自己的路由」，代码位置补 `usage/usage-modal.tsx`。上游写的「主机设置页也显示卡片」没有收（Osuna 不挂载那个区块）。
- **`packages/cli/src/commands/daemon/lifecycle.e2e.test.ts`（②）**：「pid 锁文件先出现、内容后写入」两边各修了一遍，取上游的轮询写法（`readDaemonInstance(home)?.pid`），断言内容不变。
- **`packages/server/src/server/agent/agent-prompt.ts`（③）**：上游给 `ensureAgentLoaded` 包了一层「加载失败就把归档状态放回去」，Osuna 用它的返回值算路由块；两边都留（`let agent; try { agent = await … } catch { … }`）。
- **按 Osuna 决定改写的上游测试（给 15 写 PR 正文，逐条）：**
  1. `e2e/support/helpers/usage-sidebar-item.ts`：`openUsageFromIcon` 由按钮名 `Usage` 改成 testID `sidebar-usage-icon`（Osuna 的底部图标叫「套餐用量」，顶部另有一个叫「用量」的条目）；`summaryInSidebarSwitch` 仍按 testID 找行内开关（06 的改写，文案走翻译键）。
  2. `e2e/browser/usage-modal.spec.ts`「Usage Settings cog」四条：齿轮的无障碍名称由 `Settings` 改成 `Plan usage options`（叫法）。
  3. `e2e/browser/usage-sidebar-item.spec.ts`：`expectFooterSeparator(page, false)` 改成 `expectNoFooterRule(page)`（不画横向分割线）；「pinned windows show…」里去掉「去主机设置页的套餐用量区块核对固定项」那一步（主机设置页是价格表）；设置 → 侧边栏里底部条目的名字由 `Usage` 改成 `Plan usage summary`。
  4. `i18n/resources.test.ts`「separates French interpolation placeholders from neighboring words」：Osuna 的已装版本与一键升级有三个键是版本号前缀紧贴占位符（`settings.providers.version.value` 的 `v{{version}}`、`version.update` 的 `v{{from}} → v{{to}}`、`upgrade.actionTo` 的 `… vers v{{version}}`），守卫按键放过这三个，其余键照查。
  5. `claude/agent.redesign.test.ts`「does not keep a query started in a mode that Claude Code rejected」：上游用 `session.listCommands()` 触发重启；Osuna 的 `listCommands()` 不启动进程（ADR 0003），换成同样要先确保进程在的 `session.setModel(null)`，断言不变。
  6. `claude/agent.interrupt-restart-regression.test.ts`：上游这一段让每个自发轮次以 `init` 开头，Osuna 在每个 `init` 上都会上报一次指令列表（`commands_changed`），三条用例按顺序读事件时被它挤错位；`subscribeToEvents` 略过 `commands_changed`，断言不变。
  7. `packages/desktop/e2e/browser-tabs.e2e.mjs`（上游 #6207 新加的「后台标签页里打字不进 Composer」，`5bc3a51c3`）：上游用 `composer.inputValue()` 读 Composer 里的字；Osuna 的 Composer 是 contenteditable 的编辑器（Tiptap），不是 textarea，改成读 `textContent`，断言不变。这条本机跑不了，是 CI 第一轮报出来的。
- **因换成上游实现而改动的 Osuna 断言（给 15 写 PR 正文，逐条）：**
  - `pull-request-panel/checks-summary.test.ts`：以上游的用例为底。Osuna 原来经 `formatChecksHeadline / formatChecksCount / formatChecksGroupLabel` 断言的文字，改成断言 `summarizeChecks(…, t)` 的 `headline / detail / groups[].label`，文字逐条相同；`parts` 的断言多了 `text` 字段；`parts` 另多 `lead`；分组的 `count` 字段不再存在，改断言分组里的检查名；「每种状态都有计数短语」的键前缀由 `checks.count` 改成 `checksOverview.count`；`actionRequired` 的标题原来直接按结果名取，现在用带 `action_required` 特征的检查造出来。新增一条中文分隔符的用例。
  - `pull-request-panel/data.test.ts`：Osuna 的「键名 + 英文」与上游的「英文 + 法文」合成一张表，三样都断言。
  - `cli/.../lifecycle.e2e.test.ts`、`e2e/browser/sidebar-help.spec.ts`：Osuna 的修法被上游等价的修法取代（见上）。
- **没有报冲突、核对过的自动合并**：`usage/{controls.tsx,hosts.ts,index.ts,model.ts}`（`resolveUsageScreenHostId` 改名 `resolveUsageModalHostId`）；`components/sidebar/{sidebar-status-list.tsx,sidebar-workspace-menu.tsx,sidebar-popover.tsx}`（相对上游只剩 Osuna 的行样式与翻译）；`runtime/host-runtime.ts`（排队的消息改用 `activeTurnBehavior: "steer"`）；`claude/agent.ts`、`acp-agent.ts`、`opencode/v2/{session.ts,turns.ts,permissions.ts}`；`provider-registry.ts`（上游给包装多传 `configuredModelIds`，Osuna 的 `forwardOsunaClientMethods` 仍在）；`config.ts`、`persisted-config.ts`、`config-environment.ts`——**上游 #6224 取消了 `pluginRegistryEnabled` 开关，登记处安装默认开启**（给 15 的 PR 正文与更新日志）。上游这一段没有改 `.github/`、`electron-builder.yml`、`main.ts`。
- **补丁分支的十个文件（`docs/release.md`「上游的补丁分支」）逐个的落点**，用各段 merge commit 的双亲重算冲突清单核对：

  | 文件 | 在哪一段冲突并解过 | 现在相对上游 v0.11.0 |
  | --- | --- | --- |
  | `e2e/browser/file-editing.spec.ts` | 第 1 段（02） | 只剩 Osuna 的改动 |
  | `components/adaptive-modal-sheet.tsx` | 第 1 段（02） | 只剩 Osuna 的外观 |
  | `i18n/resources/fr.ts` | 第 1 段（02）；第 6 段（本工单，上游的法文重译，与补丁分支无关） | 见上 |
  | `runtime/host-runtime.test.ts` | 六段都没有报冲突，自动合并 | 只多 Osuna 的 `readHostConnectionStatuses` 一组用例 |
  | `provider-registry.ts` | 六段都没有报冲突，自动合并 | 只多 Osuna 的三处（`peekRepoRoot`、`forwardOsunaClientMethods`、`COMPAT` 版本号） |
  | `codex-app-server-agent.ts` | 第 1 段（02）、第 4 段（06） | Osuna 的改动 |
  | `codex-app-server-agent.test.ts` | 第 1 段（02） | Osuna 的改动 |
  | `codex/rewind.ts` | 第 1 段（02） | 逐字节相同 |
  | `opencode/v2/agent.test.ts` | 六段都没有报冲突，自动合并 | 只多 Osuna 为 ADR 0003 加的那条用例 |
  | `opencode/v2/turns.ts` | 六段都没有报冲突，自动合并 | 逐字节相同 |

  规格与工单估计「分叉处的一部分落在第 6 段」，实际十个文件的分叉在第 1 段就全部过完了（第 1 段合完后合并基点落到上游主线上）；四个文件 git 自己合对了，逐个比过上游 v0.11.0，没有重复的代码块。
- **OpenCode 2.x**：按上游原样收下（#6177、#6188：关掉问题卡片或拒绝权限后回到空闲）。`opencode/v2/session.ts` 的 `listCommands()` 仍是「服务不在就返回 `null`、不重连」，守着它的用例「lists commands only from the helper the session already holds」通过。
- **Osuna 的断言有没有被悄悄删掉**：对本段改动的 62 个测试与 e2e、辅助文件逐个比对（被删的行里、基点 `15d774d4a` 没有的才算 Osuna 写的），共 106 行，分布在 7 个文件，都在上面逐条列过：两个 e2e 与辅助文件里为中间页面写的跳过与改写（46 行）、`checks-summary.test.ts`（38）、`data.test.ts`（13）、`lifecycle.e2e.test.ts`（6）、`sidebar-help.spec.ts`（3）。没有别的。
- **合并后核对**：更新源（`publish: github / LFT-OXY / Osuna`）、桌面身份（`appId com.chinhae.osuna.desktop`、`productName Osuna`）与数据目录（`main.ts` 的 userData 目录名未动）、签名（`mac-sign.js`、`OSUNA_MAC_SIGNING_SHA1`、`Verify macOS signature` 都在，`notarize: false`，没有 Apple 公证变量）——上游这一段没有改这几个文件；四个部署工作流的 `on:` 仍只有 `workflow_dispatch`；外链四个数字与基线相同（73 / 1、13 / 3），非测试的四行逐行相同；翻译键：九种语言齐全，`resources.test.ts` 通过，zh-CN 是真实翻译；`COMPAT(...)`：这一段没有新带进来的标签名。
- **协议**：`PluginListItemSchema` 新增 `name`、`icon`、`media`，都是可选的。`plugin-registry.ts` 里登记处索引的 `screenshots` 改名 `media`、新增必填的 `featured`——那是解析上游登记处 HTTP 接口返回的 JSON，不是 daemon 与客户端之间的消息，这个文件在 Osuna 已发布的版本里也不存在。Osuna 的 Usage 消息与 `features.usage` 原样。
- **跑过并通过（本机，逐个文件）：** 先 `npm run build:server`，挪开 `packages/app/.expo` 与 `node_modules/.vite`；全仓 `npm run typecheck`、`npm run lint`、`npm run format:check`，两个提交都过了提交钩子，没有 `--no-verify`。
  - 应用 unit：本段改动的 11 个文件 268 条；相关的 22 个文件 259 条（`sidebar-nav/model`——03 的「顶部用量条目原样读出」、`usage/{copy,format,pinned,preferences}`、`provider-usage/` 四个、`composer/agent-controls/`、`utils/host-routes`、`usage-stats/` 三个等）；浏览器项目 `assistant-selection-copy/content.browser.test.ts` 48 条。
  - 协议 5 个文件 103 条（含 `messages.wire-compat.test.ts`）；highlight 2 个 45 条；桌面 2 个 72 条；CLI unit 2 个 36 条、`lifecycle.e2e.test.ts` 18 条通过 1 条自行跳过；官网 3 个文件 453 条。
  - 服务端：本段改动的文件加提供方注册、发消息、指令目录共 30 个文件 1016 条通过、2 条自行跳过；`agent/providers/` 下全部 unit 加版本检查、一键升级、派发子智能体、`claude/agent-commands.e2e.test.ts`（取指令列表不启动进程）共 131 个文件 1928 条通过、22 条自行跳过——Claude、Codex、Pi、OMP、OpenCode 1.x 上 Osuna 独有行为的用例断言未动。`daemon-e2e/file-download.e2e.test.ts` 通过。
  - 本机 Playwright（`--project=browser`）：`usage-modal`、`usage-sidebar-item` 22 条；`sidebar-help`、`sidebar-workspace`、`context-window-meter`、`assistant-selection-copy`、`plugin-management`、`sidebar-nav-settings`、`usage-page-plan-usage`、`composer-plan-usage-strip`、`usage-price-table`、`usage-page` 73 条里 71 条通过，剩下 2 条是 `sidebar-nav-settings.spec.ts` 断言 `Ctrl+O` / `Ctrl+N` 的已知本机问题（macOS 绑定是 ⌘），只在 CI 验。底部图标打开弹窗、Usage 页卡片、Composer 用量条、圆环悬浮卡有数据、主机设置页是价格表，都由这些用例走过。
- **本机没通过或没跑、不是这次合并带来的：**
  - `e2e/browser/usage-modal.spec.ts`「Usage Settings cog desktop light / dark」本机偶发：7 次里 2 次、另一轮 12 次里 1 次，都挂在 `closeUsageOptions` 读不到刚打开的选项浮层的位置（浮层自己又收起了）；窄屏两条稳定通过。Osuna 对弹窗、下拉菜单这几个组件相对上游只有外观改动，没有查到原因，也没有改上游的辅助函数。CI 有一次重试，推上去看；记给 11（弹窗的外观在那张工单）。
  - `daemon-client.e2e.test.ts`：上游这一段新加的一条通过；3 条旧用例本机失败——上传文件的一条期望 `upload_<requestId>`，而实现自上游 #5317 起就用随机编号（上传代码这一段没动）；另两条要本机登录好的真实提供方。这个文件不在 CI 的测试脚本里。
  - `packages/cli/tests/e2e/plugin-lifecycle.test.ts`：直接跑在 macOS 上挂在 `/var` 与 `/private/var` 的软链接差异（上游新加的相对路径用例拿 `tmpdir()` 拼期望值）；把 `TMPDIR` 换成真实路径后通过。Linux 上没有这个差异，交 CI。
  - 没跑：三个 `*.real.e2e.test.ts`（要真实的 Claude / OMP，属于规格「Out of Scope」）、`packages/desktop/e2e/browser-tabs.e2e.mjs`（桌面 e2e，本机 macOS 跑不通，CI 的 desktop-tests 覆盖）、`packages/website/e2e/plugins.spec.ts`（官网的 Playwright）。`e2e/browser/usage-settings.spec.ts` 仍是 02 标的 `describe.skip`（主机设置页不挂套餐用量区块），给 12。
- **47 个冲突文件逐个的裁决**：① `CHANGELOG.md`、`package.json` ×13、`README.md`、`fastlane/…/changelogs/11000{1,2,3,4}.txt`、`app/usage.tsx`（保留）、`e2e/support/helpers/sidebar-nav-settings.ts`；② `usage/sidebar-item.tsx`、`components/message.tsx`、`pull-request-panel/{checks-section.tsx,checks-summary.ts,checks-summary.test.ts,data.ts,data.test.ts}`、`e2e/browser/{usage-modal,usage-sidebar-item,sidebar-help}.spec.ts`、`e2e/support/helpers/usage-sidebar-item.ts`、`cli/…/lifecycle.e2e.test.ts`；③ `docs/glossary.md`、`components/sidebar/project-leading-visual.tsx`、`i18n/resources.test.ts`、`server/agent/agent-prompt.ts`；按键三方合并：`i18n/resources/{ar,en,es,fr,ja,ko,pt-BR,ru,zh-CN}.ts`；重新生成：`package-lock.json`。冲突之外为通过 typecheck 跟着改的：`app/_layout.tsx`、`utils/host-routes.ts`（补回）、`usage/usage-modal.tsx`；为通过测试跟着改的（`cde8316a3`）：`claude/agent.redesign.test.ts`、`claude/agent.interrupt-restart-regression.test.ts`。规则裁决不了的：没有。实施者自己拿的主意三处，都写在上面：PR 面板按规则 ② 而不是工单字面的「两边都留」、README 冲突块之外的两处改写、弹窗标题那一个参数。
- **给 15 的「踩过的坑」候选：** 两边原先各写了一模一样的行，上游删掉时不报冲突、Osuna 那一份跟着消失（这次是 `/usage` 的路由接线）——合完用 `git diff <合并前> -- <Osuna 仍在用的入口文件>` 看被删的行；上游整份重译某种语言时，冲突块取上游、再按键做三方合并比逐块手工合可靠，合完查重复键；上游的新用例拿 `listCommands()` 当「确保进程在」用，在 Osuna 里要换一个调用；上游用例按顺序读事件时会被 Osuna 的 `commands_changed` 挤错位；CLI 的 e2e 脚本在 macOS 上要用真实路径的 `TMPDIR`。

#### 评审（Standards 与 Spec 两个维度；评审对象是 `e4f50bdb6..cde8316a3`；本工单没有截图验收项，没有 Visual）

- **Standards 的硬违规（已修，提交见下）：** (1) `.atw/spec/app/frontend/component-guidelines.md`「A noun only English needs wraps the translated parts」仍写 Osuna 旧的检查汇总写法——按现在的写法重写。(2) 补回的两处 Osuna 行为没被测试守住：无障碍名称的模板没有用例；可见那一行的分隔符在组件里自己拼，改回 `", "` 不会红。先写了一个 jsdom 渲染测试并确认两处改坏都会红，但它要 `vi.mock` 同目录的圆环组件、`vi.stubGlobal("React")`，违反 `.atw/spec/app/frontend/testing.md`（新测试不 mock 应用代码、不改全局；带 `withUnistyles` 取色的组件不在 vitest 里渲染），撤掉；改成把两处拼接都挪进 `summarizeChecks`（`parts[].lead`、`accessibilityLabel`，去掉先前加的 `separator`），组件里不再有判断，`checks-summary.test.ts` 断言英文与中文的 `lead`、`detail`、`accessibilityLabel`。
- **Standards 的判断项：** 已改——`docs/glossary.md`「the modal's settings」按界面上的名字写成 `the modal's "Plan usage options" menu`；`README.md` 的 Plugins 一节合并后没有安装说明，补回上游的一句（`paseo plugin add owner/slug`，或 Git、本地目录）。照原样留下——`checks-summary.ts` 里上游的注释指向不存在的 `STATUS_ORDER`（上游原文，不动）；`resources.test.ts` 里上游的 PR 面板守卫清单与 Osuna 的已迁移字面量清单有 8 条重叠（按规则 ③ 两边都留）；补回的字段与 JSX 之间的接线没有渲染层用例（同上一条的理由）。
- **Spec 报的：** (a) 工单「PR 面板两边都留」字面上没有满足——按规则 ② 裁，评审认为站得住，写在上面，**报给维护者**；无障碍名称没有用例——同 Standards (2)，已修。(b) README 冲突块之外的改写与弹窗标题那一个参数——评审认为可留。(c) Comments 里「其余语言原来同样是机器译文」不实，原值是英文占位，而且明细行多了名词前缀，是那七种语言里用户看得见的变化——记录已改正，**报给维护者**（中文与英文界面不变）；法文守卫的豁免原来写成全局正则——改成按三个键放过并写明对应的 Osuna 功能；`fr.ts` 里上游用弯撇号、Osuna 独有的键用直撇号，只是外观，没有改。评审核对无出入的：47 个冲突文件与补丁分支十个文件的落点、`/usage` 三处接线、无新增 `COMPAT` 与上游链接、协议新字段可选、Osuna 的断言未删未跳过未放宽。
- **复查（只查已修的五条，一次）：** 五条都回「已解决」，没有发现修复引入的错误。复查者补了两句：按键放过是整值豁免，这三个键里若再出现别的粘连不会被拦；`.atw/spec/server/backend/testing.md` 新加的「每个 init 都上报」说宽了（要进程在且取列表成功），已改写那一句。
- **规范更新（同一提交）：** `.atw/spec/app/frontend/component-guidelines.md`（PR 检查汇总现在的形状、Osuna 多出的两个字段、上游再改这个文件时要留住它们）；`.atw/spec/server/backend/testing.md`（上游的 Claude 用例在 Osuna 里的两个注意点：`listCommands()` 不启动进程、init 之后的 `commands_changed`）。
- **评审之后本机重跑：** `pull-request-panel/` 下 9 个测试文件与 `i18n/resources.test.ts` 共 172 条；全仓 typecheck、lint、format 通过。

#### 推送后的 CI（草稿 PR #16）

- **第一轮（`8e14fdb0e`，run 38224870824）：** `desktop-tests (ubuntu-latest)` 红，1 条失败——`packages/desktop/e2e/browser-tabs.e2e.mjs` 的 `verifyBackgroundTypingStaysInGuest` 报 `locator.inputValue: Node is not an <input>, <textarea> or <select> element`：上游这一段新加的用例按 textarea 读 Composer，Osuna 的 Composer 是 contenteditable 的编辑器。按上面第 7 条改写后推送（`5bc3a51c3`）；这一轮随之被新一轮顶掉，`playwright (shard 2/4)` 显示 cancelled，其余 17 项通过（format、lint、typecheck、app-tests、server-tests 三个平台、desktop-tests windows、cli-tests 三片、sdk-tests、relay-tests、changes、playwright 第 1、3、4 片），同一提交上的 Desktop Packages（run 38224870839）通过。
- **第二轮（`5bc3a51c3`，run 38227801363）：** 20 项全部通过（format、lint、typecheck、app-tests、server-tests 三个平台、desktop-tests 两个平台、cli-tests 三片、sdk-tests、relay-tests、changes、playwright 四片）；Desktop Packages（run 38227801358）通过。
- **首跑失败、重试后通过的 7 条：** 之前各段记过的 5 条——`agent-consecutive-turns.spec.ts:814`、`agent-timeline-scroll-smoothness.spec.ts:137`（两轮都是；09 记给 15 的那条，仍然每轮首跑都挂）、`provider-settings-refresh.spec.ts:152`、`settings-providers-list-detail.spec.ts:59`、`sidebar-project-filter.spec.ts:110`（后三条两轮都是）。这一段新出现的 2 条：`usage-sidebar-item.spec.ts:173`「pinned windows show…」首跑挂在 `closeUsageOptions` 读不到刚打开的选项浮层——与本机「Usage Settings cog desktop」的偶发是同一个现象，这次出在上游原样的一步里、在 Linux 上，所以不是本机环境问题（记给 11）；`context-window-meter.spec.ts:245`「the context window hover card shows the agent's usage (dark)」首跑报「The test scripts every agent usage request」（悬浮卡多取了一次数），上游这一段改过这个文件，本机跑过一次是通过的，记给 15 并入前看。本机偶发的「Usage Settings cog desktop light / dark」在 CI 两轮里都是一次通过。
- 本机没跑或本机挂的几项在 CI 上的结果：`packages/cli/tests/e2e/plugin-lifecycle.test.ts` 在 cli-tests 里通过（Linux 没有 `/var` 软链接的差异）；`browser-tabs.e2e.mjs` 第二轮通过；`sidebar-nav-settings.spec.ts` 断言 `Ctrl+O` / `Ctrl+N` 的两条在 CI 通过。
- **验收项对照：** 全部勾选。带说明的三条——「规则裁决不了、或保留两边会改变用户可见行为的冲突没有自行取舍」与「PR 面板：两边都留」：PR 面板按规则 ② 以上游写法为底、补回 Osuna 多出的两处，中文与英文界面看到的字不变，其余七种非英文语言由英文占位变成上游的译文，已报给维护者；「本段新增或改动过的测试文件逐个单独跑过并通过」：三个 `*.real.e2e.test.ts`（要真实的提供方）与 `packages/website/e2e/plugins.spec.ts` 没有跑，`browser-tabs.e2e.mjs` 只在 CI 上跑，`daemon-client.e2e.test.ts` 本机有 3 条与本段无关的旧失败（见上）。关闭工单的提交只改任务目录，没有另行推送。
