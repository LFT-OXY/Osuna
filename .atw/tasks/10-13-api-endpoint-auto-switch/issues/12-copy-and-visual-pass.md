# 12 — 文案与视觉一致性收口

**What to build:** 对 08～11 产出的所有画面做一次整体核对：文案全部走 i18n，英文为源，九种语言补齐，旧键（`inUse`、`deleteActiveMessage`、`saveActiveMessage`、`codexVersionUnsupported`、`endpointToOfficial` 类提示等）从八个语言资源与守卫表移除；「使用中」「已暂停」不加入退役词模式；品牌类英文（API key、Anthropic、OpenAI Chat、OpenAI Responses、家族名）按需加入 zh-CN 英文白名单。Electron 与浏览器 Web 各取证一套截图、浅色与深色各一套，修掉各页面之间的风格漂移（间距、密度、状态色、开关样式）。不重新设计。对应 prd R-E6 与 `ui-direction.md` 验收重点。

**Blocked by:** 08, 09, 10, 11
**Status:** ready-for-agent
**Impl:** done

- [x] `resources.test.ts` 通过：九种语言键齐全、无回退英文、zh-CN 用词与 prd 术语节一致（可用 / 冷却中 / 需要检查 / 已关闭 / 使用第三方接口 / 默认模型 / 请求格式）。
- [x] 旧键全部删除，无遗留引用；守卫表（退役词模式、英文白名单、豁免键）与现状一致。
- [x] UI: 列表页、添加弹窗、详情页、Agent 页、聊天模型选择器 / 浅色与深色 / Electron 与浏览器 Web — 每处两套各一张截图，共四套；与现有设置页同组件同密度，无新的视觉语言。
- [x] 截图对照后修正的漂移项逐条列在票内；没有改任何决策。

## 实现记录

- 旧的单接口文案段 `settings.providers.apiEndpoints.*` 在九种语言里删掉 81 个键，只留仍在用的 `inheritedTitle` / `inheritedDescription`（`provider-detail/index.tsx`）；`zhCNEnglishAllowlist` 去掉 3 个、`zhCNRetiredTermExemptKeys` 去掉 2 个对应条目。新增两条资源测试：旧段只剩这两个键；zh-CN 状态词、总开关、默认模型、请求格式与 prd 术语节一致。「使用中」「已暂停」未进退役词模式。新文案在八种非英语资源里都有译文，只剩品牌名（三种格式名、Qwen）与英文相同，均已在白名单或属非 zh 语言。
- `.atw/spec/app/frontend/component-guidelines.md` 里拿已删的 `settings.providers.apiEndpoints.impact` 作例子，换成 `sidebar.workspace.checks.failed`。
- 截图 28 张：`screenshots/12-*`，五处界面（列表、添加弹窗、详情页上下两屏、Agent 页、聊天模型选择器）× 浅 / 深 × Electron / 浏览器 Web，外加提供方列表基线一张（浅深各一）。浏览器 Web 用一次性 Playwright 用例 + 假上游拍；Electron 用 dev 桌面端（`.dev/paseo-home`，`CLAUDE_CONFIG_DIR` / `CODEX_HOME` 指临时目录，真实配置 mtime 未变）+ CDP 拍，拍完清空接口并把主题设回浅色。压缩用 256 色：128 色会把成功 / 警告 / 危险三种状态色抹成一种。

### 截图对照后修正的漂移

1. 列表行「立刻恢复」原是 sm 按钮、放在开关左边；改为 xs outline、接在「冷却中，x 分钟后恢复」后面，与 `ui-direction.md`「状态文字后加一个『立刻恢复』小按钮」和提供方列表行内「升级到 v…」一致（行会略高，同提供方列表）。
2. Agent 页入口行汇总「N 个开着 · 某家冷却中」的间距从 `spacing[1]` 改为 `spacing[1.5]`，与列表行状态行（`ProviderStatusLine`）一致。
3. zh-CN `agent.noUsableEndpoint`「开启一家并勾选模型」改为「并选好模型」：模型用开关挑，不是勾选框。

### 核对过、未改的

- 各页卡片、56px 设置行、Switch、下拉、StatusBadge、分组标题 ⓘ 与提供方页一致；模型名不用等宽，次要操作不用蓝色链接，没有勾选框。连接卡地址代码里是等宽字体。
- 「拉取于 just now」「已更新 4m ago」的英文相对时间是全应用的老问题，归 `10-13-zh-relative-time-and-plan-labels`。
- 添加弹窗在 800 高的窗口里底部说明被按钮栏盖住半行（弹窗正文可滚动），属于弹窗布局，未改。
- 列表空状态卡的标题 + 说明 + 按钮沿用 08 票定稿，未改。
- 提供方列表 Claude 行「第三方接口：{{name}}」（`settings.providers.statuses.apiEndpoint`）与 `inheritedTitle`「也会走 Claude Code 启用的第三方接口 {{name}}」仍按「当前启用的那一家」说话，由 daemon 的 `activeEndpoint` 取默认模型所在的接口；是否改文案留给用户决定，本票未动。

