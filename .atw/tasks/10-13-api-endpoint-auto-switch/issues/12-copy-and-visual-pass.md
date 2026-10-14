# 12 — 文案与视觉一致性收口

**What to build:** 对 08～11 产出的所有画面做一次整体核对：文案全部走 i18n，英文为源，九种语言补齐，旧键（`inUse`、`deleteActiveMessage`、`saveActiveMessage`、`codexVersionUnsupported`、`endpointToOfficial` 类提示等）从八个语言资源与守卫表移除；「使用中」「已暂停」不加入退役词模式；品牌类英文（API key、Anthropic、OpenAI Chat、OpenAI Responses、家族名）按需加入 zh-CN 英文白名单。Electron 与浏览器 Web 各取证一套截图、浅色与深色各一套，修掉各页面之间的风格漂移（间距、密度、状态色、开关样式）。不重新设计。对应 prd R-E6 与 `ui-direction.md` 验收重点。

**Blocked by:** 08, 09, 10, 11
**Status:** ready-for-agent
**Impl:** ready

- [ ] `resources.test.ts` 通过：九种语言键齐全、无回退英文、zh-CN 用词与 prd 术语节一致（可用 / 冷却中 / 需要检查 / 已关闭 / 使用第三方接口 / 默认模型 / 请求格式）。
- [ ] 旧键全部删除，无遗留引用；守卫表（退役词模式、英文白名单、豁免键）与现状一致。
- [ ] UI: 列表页、添加弹窗、详情页、Agent 页、聊天模型选择器 / 浅色与深色 / Electron 与浏览器 Web — 每处两套各一张截图，共四套；与现有设置页同组件同密度，无新的视觉语言。
- [ ] 截图对照后修正的漂移项逐条列在票内；没有改任何决策。
