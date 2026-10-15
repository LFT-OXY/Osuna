# 设置页左栏切换栏目后滚动位置丢失

## Goal

设置页左栏滚到底部后点任一栏目，左栏回到顶部。原因：每个栏目是独立路由（settings/[section]、settings/hosts/[serverId]/...），切换时 router.replace 换页，SettingsScreen 连同左栏 ScrollView 重新挂载。原来就有，不是第三方接口任务引入的；该任务给左栏加了「第三方接口」一项后更容易碰到。2026-10-15 工单 14 真实验收时用户发现。

## Requirements

- 宽屏分栏布局（`SettingsScreen` 走 desktop split view：Electron 桌面、浏览器宽窗口、平板横屏）下，设置页左栏（`SettingsSidebar` 的 `settings-sidebar-scroll-body`）记住滚动位置；切换栏目、切换主机后重新挂载时恢复到原位置。
- 恢复不能有可见跳动：不允许先渲染在顶部再跳回。
- 记忆范围：应用本次运行期间（内存中，不持久化）。离开设置页再回来仍恢复；重启应用回到顶部。
- 不改路由拓扑：各设置栏目保持独立同级路由（见 `docs/expo-router.md` "Settings detail routes are separate siblings on purpose"），不引入共享 layout / catch-all / `getId` 等方案。

## Out of Scope

- 右侧内容区滚动：换栏目照旧从顶部开始。
- 紧凑（手机窄屏）布局：栏目列表是独立一页、点栏目是 push，推测返回时列表仍保留位置，不改动。实现时需确认；若紧凑布局同样会重置，先停下来与用户确认，不自行扩大范围。
- 选中项不在可视区时自动滚动到选中项（例如深链直达靠下栏目、窗口较矮）。

## Decisions

- 方案选"记住并恢复滚动位置"，否决"左栏只挂载一次"的路由重构：后者违反 `docs/expo-router.md` 的路由约束并影响返回行为。
- 不新增术语、不写 ADR：改动可随时撤回。

## Acceptance Criteria

- [x] 电脑开发版（Electron）中把左栏滚到底，依次点"应用"组和"主机"组的若干栏目，左栏位置不变，且看不到闪回顶部再跳回；附截图。（`screenshots/settings-sidebar-01~04-*-electron-1200x800.png`；逐帧采样 838 次无偏差）
- [x] 同上场景下切换主机，左栏位置不变。（Electron 开发版只有一台主机，由 e2e 两台种子主机验证，截图 `settings-sidebar-06/07-*-web-1280x560.png`）
- [x] 离开设置页回到工作区后再进入设置页，左栏仍在原位置。
- [x] 重启应用后进入设置页，左栏从顶部开始。（以重新加载窗口验证，记忆只存在页面内存里，`settings-sidebar-05-after-reload-top-electron-1200x800.png`）
- [x] 右侧内容区换栏目后从顶部开始（行为不变）。（外观页右栏滚到 300 → 换到可滚动的 Agent 页为 0）
- [x] 紧凑布局行为已确认未受影响（原生端实机免验收）。（Web 390 宽：列表 296 → 进"关于"再返回仍 296；紧凑布局本来就保留位置，未改动）
- [x] 新增自动测试覆盖"切换栏目后左栏滚动位置保持"，加入现有测试套件。（`settings-navigation.spec.ts` "Settings sidebar scroll position"）

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, slice the work into `issues/NN-slug.md` tickets before `task.py start`.
