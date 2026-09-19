# 插件主题与内置主题重名的消歧

## Problem Statement

主题选择器把内置主题和插件贡献的主题列在同一个下拉里，中间只隔一条分隔线。两边的
显示名完全由各自决定，谁也不知道对方叫什么 —— 于是选择器里可以出现两条一模一样的
文字，用户没有任何线索分辨哪条是哪条。

这不是假想。`8eadc588b` 把 Catppuccin Mocha / Latte 做成了内置主题，而 Catppuccin
插件（`plugin-examples/catppuccin`）贡献的两套主题正是这两个名字。装了这个插件的用户
现在打开主题下拉，会看到两条 `Catppuccin Mocha`。选完之后触发器上写着
`Theme: Catppuccin Mocha`，同样分不出选中的是哪一个。

`09-19-branch-e2e-drift` 撞上了同一件事：插件主题 e2e 的 `getByText("Catppuccin Mocha",
{ exact: true })` 命中两个元素而失败。那次只把夹具改名绕开，真实用户的那条路没动。

功能层面没有坏 —— 插件主题的 id 是 `<pluginId>/theme/<themeId>`，天然唯一，选中、
持久化、跨 host 合并都按 id 走。坏的只有**识别**：界面把两个不同的东西画成了同一个样子。

## Solution

给撞名的插件主题行加一条来源副标题，内容是贡献它的插件 id。不撞名的行一个字不变。

- 「撞名」= 这个插件主题的显示名，和某个内置主题的显示名相同，或和目录里另一个插件
  主题的显示名相同。
- 副标题走 `MenuItem` 已有的 `description` 槽位，不新增组件。
- 选中一个撞名的插件主题后，触发器也带上限定，否则 `Theme: Catppuccin Mocha` 这条
  无障碍标签仍然指向两个东西。

不做注册期拒绝。插件作者无从知道内置主题清单，而内置清单会增长 —— 这次就是
Catppuccin 变成内置之后把插件主题挤掉，用户选中的主题会毫无预兆地消失，比看到两条
重名糟得多。

也不给所有插件主题行都标来源。没有歧义的行加副标题只是把菜单变高，不解决任何问题。

## User Stories

1. 作为装了 Catppuccin 插件的用户，我希望主题下拉里那两条 `Catppuccin Mocha` 能区分开，这样我知道自己选的是哪一个。
2. 作为同一个用户，我希望区分开的方式告诉我「这条是插件贡献的」，这样我知道它会随插件一起消失。
3. 作为同一个用户，我希望副标题写的是贡献它的插件，这样我卸载插件时知道会影响哪条。
4. 作为选中了撞名插件主题的用户，我希望设置页触发器上也能看出选的是插件那个，这样我不用重新打开下拉去确认。
5. 作为用读屏器的用户，我希望 `Theme: {{value}}` 这条标签在撞名时也是明确的，这样它不会把两个主题读成同一个。
6. 作为装了两个都贡献 `Dracula` 的插件的用户，我希望这两条也能分辨，这样问题不只在「插件 vs 内置」这一种撞法上被解决。
7. 作为主题名没有和任何东西撞的插件的用户，我希望我的主题行保持单行，这样菜单不会为了别人的问题变高。
8. 作为把 app 语言切成中文的用户，我希望撞名判断跟着当前语言走，这样中文下才撞的名字也能被认出来。
9. 作为同一个用户，我希望切语言之后不撞了的行会自动去掉副标题，这样界面不留下失效的限定词。
10. 作为插件作者，我希望我的主题不会因为和内置主题重名就被静默丢掉，这样我的用户不会突然失去他选中的配色。
11. 作为插件作者，我希望我不必去猜内置主题清单来给自己的主题取名，这样我的插件不会因为 Paseo 新增内置主题而失效。
12. 作为在多个 host 上装了同一个插件的用户，我希望撞名判断发生在跨 host 合并之后，这样同一个主题不会因为出现在两个 host 上就被当成两个重名主题。
13. 作为维护者，我希望消歧算在一个纯函数里，这样它能被单测覆盖，而不必渲染整个设置页。
14. 作为维护者，我希望插件主题 e2e 的夹具改回会撞名的名字，这样这条测试从绕开问题变成验证问题已被解决。
15. 作为维护者，我希望 e2e 在撞名时定位的是带副标题的那一行，这样断言表达的是「两条能分辨」而不是「恰好只有一条」。
16. 作为维护者，我希望这次不动插件主题的 id、持久化格式与协议，这样验收边界是清楚的。
17. 作为下一个往内置主题清单里加主题的人，我希望撞名这件事自己会显示出来，而不是靠谁记得去查。

## Implementation Decisions

### 消歧算在目录层，不算在组件里

- `collectPluginThemes` 是唯一的判定点。它在跨 host 合并（`selectTarget`）**之后**统计
  显示名，所以同一个主题出现在多个 host 上不会被误判成重名。
- `PluginThemeOption` 增加一个限定词字段，值为贡献插件的 id，仅在撞名时非空；不撞名时
  是 `null`，调用方据此决定渲染不渲染副标题。
- 撞名的两类来源合成一个判定：与内置主题显示名相同，或与目录内另一个插件主题显示名
  相同。两类都撞时也只标一次。

### 内置主题名要从外面传进来

- 内置主题的显示名是 i18n 的（`settings.appearance.theme.options.*`），而
  `collectPluginThemes` 现在不碰 i18n。把「已解析好的内置主题显示名集合」作为入参传进去，
  函数保持纯的、可单测的；由 `usePluginThemeCatalog` 解析后传入。
- 由此撞名判断随 app 语言变化。这是对的：用户看到的是哪一套文字，撞不撞就按哪一套算。
- 解析这一步落在 `appearance/theme-labels.ts`：`getBuiltInThemeLabel(t, name)` 是菜单行和
  对照集合共用的那一个 key 路径，`collectBuiltInThemeNames(t)` 按它铺开 `THEME_OPTIONS`，
  `useBuiltInThemeNames()` 是给 `usePluginThemeCatalog` 用的 hook 包装。两处各自拼 key 会在
  下一次改键名时静默失配 —— 谁都撞不上，功能无声停摆。设置页原来私有的 `getThemeLabel`
  就是这个函数，移过去后 `SystemPairingRow` 一并改用它。
- 「System」（`auto`）也算进对照集合。它在同一个下拉里占一行，插件主题叫这个名字一样分不清。

### 同一个插件内部撞名

- 一个插件贡献两个同名主题时，插件 id 分辨不了它们。这种情况下限定词退化为主题自己的
  id（`<themeId>`），保证两行文字不同。

### 触发器

- 选中的插件主题带限定词时，触发器的可见文字与 `settings.appearance.theme.accessibilityLabel`
  的 `value` 都用限定后的写法。触发器是单行窄控件，限定后的文本按既有的截断规则处理，
  不为此改版式。
- 限定后的写法是新键 `settings.appearance.theme.qualifiedValue`（英文 `"{{name}} ({{qualifier}})"`，
  中日文用全角括号），九个 locale 都补齐。限定只加在插件那一侧：内置那条保持裸名，于是
  `Theme: Catppuccin Mocha (catppuccin)` 与 `Theme: Catppuccin Mocha` 各指一个。
- `SystemPairingRow`（跟随系统的深浅配对行）只列内置主题，插件主题不参与配对，
  不受本次影响。

### 不动的部分

- 插件主题 id（`<pluginId>/theme/<themeId>`）、`theme: "plugin"` + `pluginThemeId` 的持久化
  形状、`rememberPluginContributionHost` 的 host 记忆、`features.pluginThemes` 的能力门，
  全部不变。
- 协议不动，daemon 不动，`@getpaseo/plugin` 的 `addTheme` 契约不动。契约没变，但显示名撞名
  之后会发生什么是插件作者从代码里看不出来的约定，写进 `docs/plugins.md` 的
  「Contribute a theme」（那一节是 `addTheme` 的 owner）。
- 不新增菜单组件、不加分组标题。

## Testing Decisions

好的测试只验外部可观察的行为：菜单里两条同名主题能不能被分辨，而不是限定词是怎么算出来的。

- **`collectPluginThemes` 的单测是主验收层，也是最高的接缝。** 用例加进
  `packages/app/src/plugins/theme.test.ts` 已有的 `describe("collectPluginThemes")`，
  和同族的跨 host 合并、能力门用例挨着写。要覆盖：与内置主题撞名、两个插件互相撞名、
  同一插件内部撞名、完全不撞名（限定词为空）、同一主题跨多 host 合并后**不**算撞名、
  内置主题名集合换一套（模拟切语言）后判定跟着变。
- **端到端确认加在既有的 `packages/app/e2e/browser/plugin-theme.spec.ts` 里**，不新开文件。
  夹具的两套主题改回 `Catppuccin Mocha` / `Catppuccin Latte` —— 这正是
  `09-19-branch-e2e-drift` 为了绕开问题而改掉的名字，改回来这条测试就从「绕开」变成
  「验证已解决」。断言两条同名行能各自定位（撞名的那条带插件 id 副标题），
  且选中插件那条后触发器指向插件主题。
- `appearance/theme-labels.test.ts` 守住上面那条共用解析路径：对照集合的大小等于
  `THEME_OPTIONS` 的行数，且没有一条是没解析出来的 i18n key —— i18n 没初始化时 `t()` 原样
  返回 key，那样集合里全是 key、谁都撞不上，正是会静默失效的那一种。
- 不新增 npm script、不新增 CI job。
- 本地只跑改到的单个文件；全量由 CI 验证。

## Out of Scope

- **插件主题参与「跟随系统」的深浅配对。** 现在配对行只列内置主题，这是既有行为，
  本任务不碰。
- **给插件一个人类可读的显示名。** app 侧的 `InstalledPlugin` 只有 `id`，没有 `name`；
  加一个要动清单格式与协议，能独立验收、独立上线，属于另一个任务。本任务用 id 作限定词。
- **插件主题的分组标题 / 版式改版。** 菜单里插件段落前已有分隔线，本任务不加 `MenuLabel`。
- **内置主题之间重名。** 内置清单是自己维护的，重名在评审时就该拦下，不需要运行期消歧。
- 插件贡献的其他东西（侧栏项、工作区面板、斜杠命令）与内置项重名 —— 同类问题，但各自
  界面不同、判定点不同，不在本任务里顺手做。

## Acceptance Criteria

- [ ] 装了贡献同名主题的插件时，主题下拉里那两条能被区分：插件那条带插件 id 副标题。
- [ ] 不撞名的插件主题行保持单行，没有副标题。
- [ ] 两个插件贡献同名主题时，两条都带各自的插件 id。
- [ ] 同一个插件贡献两个同名主题时，限定词退化为主题 id，两行文字不同。
- [ ] 同一个主题出现在多个 host 上不会被判成重名。
- [ ] 选中撞名的插件主题后，触发器文字与 `Theme: {{value}}` 无障碍标签都是明确的。
- [ ] 撞名判断随 app 语言变化：换一套内置主题显示名，判定跟着变。
- [ ] 与内置主题重名的插件主题**仍然可选、仍然生效**，没有被丢弃。
- [ ] `plugin-theme.spec.ts` 的夹具改回 `Catppuccin Mocha` / `Catppuccin Latte`，
      该文件断言两条同名行能各自定位。
- [ ] 插件主题 id、持久化形状、协议、`addTheme` 契约均未改动。
- [ ] `docs/plugins.md` 的「Contribute a theme」写明撞名会被限定、且不会被拒绝。
- [ ] `npm run typecheck` 与 `npm run lint` 通过。

## Further Notes

- 本任务由 `09-19-branch-e2e-drift` 分出。那次的归因记录在
  `.atw/tasks/archive/2026-09/09-19-branch-e2e-drift/research/failure-attribution.md`
  的第 3 条与「决策」第 2 条。
- 撞名当时的表现是 e2e 的 `getByText(..., { exact: true })` 命中两个元素而 strict mode
  失败 —— 测试撞上的和用户撞上的是同一件事。
- `MenuItem` 的 `description` 槽位（`components/ui/menu/menu-item.tsx`）已经在用，
  渲染为第二行 muted 文字，最多两行。本任务不改它。
