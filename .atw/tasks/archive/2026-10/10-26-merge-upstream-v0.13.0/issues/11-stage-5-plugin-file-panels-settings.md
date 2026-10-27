# 11 — 第五段适配：插件文件面板与设置 → 文件分区

**What to build:** 插件文件面板、标签状态、Agent 面板、运行时翻译、清单翻译、宿主 Markdown 组件、内联 SVG 图标、UI 入口改名照收。设置里新的「文件」分区用 Osuna 设置页的外观与翻译键，zh-CN 是真实翻译。规格见 `prd.md`「插件与翻译」「设置页」，裁决见 `research/feature-overlap.md` 3.2 第 13–17 条。

**Blocked by:** 06
**Status:** ready-for-agent
**Impl:** done

- [x] Osuna 兜底文案里加的 `t()` 与上游插件翻译并存，语言清单一致。
- [x] 设置 → 文件分区用 Osuna 的设置行与卡片，没有硬编码英文，九种语言齐全。
- [x] 手机设置首页不收上游的大方块样式，保留 Osuna 的行列表；按下态等与外观无关的改动照收。
- [x] typecheck 和 lint 通过；改到的测试文件逐个单独跑过并通过（不跑整套）。
- [x] 没有 Osuna 的断言被删除或放宽；必须跟着改的断言逐条记在 `## Comments` 下，供 14 写 PR 正文用。
- [x] UI：dev 桌面端 1280 宽、中文界面 / 设置 → 文件分区 — 截图上行高、卡片圆角与同页其他设置项一致，卡片内没有通栏的横向分割线，文字是中文。

## Comments

### 核对结论（代码在第五段合并与适配时已到位，本工单没有改产品代码）
- 插件翻译与 Osuna 兜底文案并存：`plugins/surface-screen.tsx:157-160` 先按插件翻译解析标题，没有插件时走 `pluginSurface.fallbackTitle`；`plugins/workspace-panels/panel.tsx:118-146` 的离线、不可用文案走 `panels.plugin.*`，面板标题走插件翻译。插件拿到的语言就是应用当前语言（`plugins/registry.ts:206`），所以语言清单与应用的九种语言一致；内置插件都不带自己的翻译。
- 设置 → 文件分区（`screens/settings/files-section.tsx`，上游原文件未改）用的是 Osuna 的 `SettingsSection`、`SettingsCard`、`SettingsRow`（`components/settings`）与 `settingsStyles`，文案全走 `settings.files.*`、`panels.file.filePanels.*`，九种语言齐全（`resources.test.ts` 通过）。
- 手机设置首页仍是 Osuna 的 `SettingsNavRow`（`screens/settings-screen.tsx:738`），没有上游的 `SidebarGroup` 大方块；按下态由 `Row` 的 `pressed` 状态给出。
- 截图验收「卡片内没有通栏的横向分割线」：行与行之间只有 Osuna 卡片统一的 `borderCardRow` 淡分割线（`docs/design.md` §5，同页「打开位置」卡片同样如此），实测两者行高都是 56、圆角 14、分割线同色（`rgba(228,228,231,0.5)`）。没有别的分割线。

### 跟着改的上游断言（供 14 写 PR 正文；按 Osuna 决定改写，不是 Osuna 原有断言）
- 第五段把内置文件面板的提供者名 `panels.file.filePanels.builtin.owner` 改成 Osuna（ADR 0002 的显示身份），菜单与选择器里显示「Markdown — Osuna」「Source — Osuna」。上游 e2e 仍按「— Paseo」找，CI 必挂：`e2e/support/helpers/markdown-file-panel-plugin.ts` 的 `BUILTIN_MARKDOWN_OPTION`、`SOURCE_OPTION`，`e2e/browser/plugin-file-panel-examples.spec.ts` 两处 radio 名字，改成「— Osuna」。只改名字，断言的动作与数量不变。没有删除或放宽任何 Osuna 断言。

### 跑过的测试（逐个文件）
- app：`i18n/resources.test.ts` 48、`file-panels/settings/rows.test.ts` 9、`plugins/registry.test.ts` 11、`styles/theme.test.ts` 164；plugin：`client/translations.test.ts` 4；全部通过。
- Playwright：`plugin-file-panel-settings.spec.ts` 改前 2 挂 1 过（就是上面的「— Paseo」），改后 3 条全过；`plugin-file-panels.spec.ts` 1 条通过。`plugin-file-panel-examples.spec.ts` 本机挂在第 186 行，比改动的第 196 行更早：Chromium 自带 PDF 查看器按本机中文系统把按钮显示成「打印」，用例找「Print」（测试轨迹里搜得到「打印」）。CI 是英文环境，交给 CI。
- `npm run typecheck` 全仓通过；改到的两个 e2e 文件 lint、format 通过。

### 观察到、不在本工单范围的问题（交给 13 视觉走查决定）
- dev 版每次加载都弹「React does not recognize the `uniProps` prop on a DOM element」的报错提示条。来源是 unistyles 网页端的 `withUnistyles`（`node_modules/react-native-unistyles/src/core/withUnistyles/withUnistyles.tsx`，`deepMergeObjects(..., props)` 把 `uniProps` 原样往下传），侧栏的 lucide 图标把它传到了 `<svg>` 上。全应用凡是 `withUnistyles` 包的图标都会触发，与文件分区无关；只在开发版出现，正式包不显示。合并前 main 上是否也弹没有核对（unistyles 版本两边都是 3.2.4，React 从 19.1.0 升到了 19.2.3）。

### 截图
- `screenshots/11-settings-files-rows-electron-1280-zh.png`：dev 桌面端 1280 宽、中文，文件分区有三行（临时写入 `.md`、`.html`、`Dockerfile` 三条面板记忆造出，截完已删）。只截右侧详情区，避开侧栏里的本机主机名。
- `screenshots/11-settings-files-empty-electron-1280-zh.png`：同条件下没有插件面板时的空状态。

### 审查（atw-code-review，三个维度）
- Standards：无硬违规。底线检查报的两行 `assertion-removed`（examples spec :196、:200）是同一条断言改了名字，依 PRD「规则」放行。判断题：examples spec 手写了选项名而没用 helper 常量，这份重复是上游原有的，为少制造冲突不动。
- Spec：无缺失、无范围蔓延；Comments 的行号与结论和源码一致。
- Visual：三条 UI 验收满足。空状态卡片高约 53，和 Osuna 主机页的空状态写法相同（`host-page.tsx:1710`），按现有约定不改。其余几条（区块标题与页头同名、每行「重新询问」、选项带「— Osuna」后缀）是上游的界面设计，不在本工单改。
- 补丁之外：两处代码注释仍写 Paseo（`file-panels/choice/presentation.ts:24`、`screens/settings/files-section.tsx` 的 `associatedValueLabel` 注释）。它们是上游原文，不改，以免增加以后合并的冲突。
