# 02 — 客户端：面板立刻出现、聚焦预取、列表不全提示

**What to build:** 用户在 Composer input 输入 `/` 时 Command menu 立刻出现：有缓存数据直接显示并在后台重新请求、原地替换；完全没数据时显示一行"加载中"。Composer input 获得焦点时就预取列表。daemon 返回 `partial` 为真时，列表底部显示不可选的提示行"发送一条消息后加载全部指令"。连旧 daemon（无 `partial`）时照常工作、不显示提示。见 PRD「客户端」一节。

**Status:** ready-for-agent
**Impl:** ready

**Blocked by:** 01

- [ ] 去掉"加载中就隐藏面板"的条件；无数据时可见并显示加载中
- [ ] 每次打开菜单都重新请求，期间保留旧数据不闪空
- [ ] Composer input 聚焦且 pane 活动时预取（沿用现有连接与 retained-panel 条件）
- [ ] `partial` 为真显示提示行，键盘导航跳过它；字段缺省不显示
- [ ] 新文案进 i18n，所有现有语言补齐
- [ ] 测试：`use-agent-commands-query.test.ts` 或 autocomplete 可见性纯函数测试覆盖"无数据可见""重新请求期间不隐藏""partial 提示"
- [ ] Electron 实测：已开过的目录输入 `/` 立即出列表；新目录立即出面板与提示；`typecheck`、`lint` 通过
