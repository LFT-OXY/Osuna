# 02 — 第一段收尾：上游新界面向 Osuna 靠拢

**What to build:** 第一段带进来的上游新界面，在中文界面下读起来、看起来都是 Osuna 的一部分：文案有中文，插件的安装与来源变更查看界面用 Osuna 设置页的外观，应用与 CLI 里没有多出指向上游站点的链接，上游新增的临时兼容标签写的是 Osuna 的版本号。做完之后草稿 PR 上的整套 CI 是绿的，合并分支处在一个可以放心继续往下合的状态。规格见 `prd.md` 的「界面文案」「外链与 `ExternalLink` 组件」「协议」里的 COMPAT 一条、「UI and Design」。

**Blocked by:** 01
**Status:** ready-for-agent
**Impl:** done

- [x] 第一段新增的翻译键在九种语言里齐全；zh-CN 是真实翻译，不是英文占位；用词遵循 `docs/glossary.md`。
- [x] 上游在设置界面新增的硬编码英文改走翻译键，并加入现有的源码扫描清单。
- [x] 翻译资源测试通过。
- [x] 上游新增的插件安装与来源变更查看界面，使用 Osuna 设置页现有的卡片、行高与下拉触发器样式，没有引入第二套设置页外观。
- [x] 上游新代码里指向上游站点的固定链接已处理：有对应内容的指向本仓库，没有的连同承载按钮一起去掉。应用与 CLI 源码中的上游站点链接数不多于 01 记下的基线。
- [x] 插件"打开外部链接"与"从 npm 安装插件"两项能力保留可用。
- [x] 第一段带进来的上游 `COMPAT(...)` 标签，版本号已改写为合并后的首个 Osuna 版本；Osuna 已有的标签未动。
- [x] Osuna 原有的测试没有被删除、跳过或放宽断言；上游带来的测试通过，因 Osuna 有意做的决定而改动的上游测试，逐条记在 `## Comments` 下并写明是哪条决定。
- [x] typecheck 和 lint 通过。
- [x] 草稿 PR 上 CI 全绿，Nix 与 Nix Update Hash 除外；已知偶发失败重跑后通过。
- [x] 本工单的界面截图验收并入 06 统一做，不在这里单独启动桌面端。

## Comments

### 文案

- 第一段新增或改名的翻译键只有 `settings.plugins` 下的五个：`sourceLabel`、`sourcePlaceholder`、`docs`、`actions.menu`、`states.sourceUpdateTitle`（`install` 改了值）。九种语言都由上游自带，zh-CN 是真实翻译（「插件来源」「目录、Git URL 或 npm 包」「文档」「{{id}} 的操作」「更新此主机以安装插件」），`resources.test.ts` 的键同步、zh-CN 允许清单、旧用词三项都通过。
- 上游在设置界面没有新增硬编码英文：对 `git diff d38d186bd 503a3e7cb -- packages/app/src`（去掉测试与 i18n）的新增行扫过一遍，`plugins-page.tsx`、`components/settings/index.tsx`、`plugins/settings/index.tsx`、`form-field.tsx` 里的界面文字全部走 `t()`。唯一命中的英文是 `plugins/hosts/index.ts`、`plugins/host-navigation.ts` 里抛给插件代码的 `Error`，不是界面文案。所以源码扫描清单（`migratedSourceLiterals`）没有可加的条目，未改。
- 留给 06：安装失败时反馈条显示的是 daemon 返回的英文报错原文（例如 `Request failed: Plugin source is neither an existing directory nor a Git URL…`）。这是合并前就有的行为（`errorMessage(error)` 原样显示），不属于「上游新增的硬编码英文」，但中文界面截图里会看到英文句子，验收时按此说明。

### 外观

对照合并前 Osuna 的插件页和设置页现有写法，上游新结构有三处不是 Osuna 的样子，已改（`plugins-page.tsx`）：

| 位置 | 上游 | 改为 | 依据 |
| --- | --- | --- | --- |
| 插件行的说明 | `fontSize.base`（14）、上间距 4 | `settingsStyles.rowHint`（`caption` 12） | `docs/design.md`：设置行是 `body` 标题加 `caption` 说明；改前它比上面「启用插件」那行的说明大一号 |
| 插件行的来源 | `fontSize.sm`、上间距 4、`foregroundExtraMuted` | `settingsStyles.rowHint`，与说明完全相同 | 同上；`docs/design.md` 把 `foregroundExtraMuted` 留给被动的界面装饰，不用于要读的信息（评审实测它在卡片上的对比度只有 2.56:1）；合并前 Osuna 的插件路径一行也是 `rowHint` |
| 行尾「更多操作」按钮 | 4px 内边距、`borderRadius.sm`、18 号图标、无悬停反馈、`color={styles.x.color}` | 28×28、`radius.md`、悬停 `surface2` / 按下 `surface3`、`ICON_SIZE.sm`、`withUnistyles` + `uniProps` | 与 `keyboard-shortcuts-section.tsx`、`provider-detail/header.tsx` 的同类按钮一致；`docs/unistyles.md` 要求图标颜色走 `withUnistyles` |

没有动的：安装表单那张卡片（`[settingsStyles.card, styles.install]` + `Field` + `FormTextInput` + 整行按钮）与合并前 Osuna 自己的目录安装表单是同一个结构，只是从两个输入框变成一个；全局开关卡片本来就是 Osuna 的写法；插件列表的卡片与行分隔在 01 已由 `SettingsCard` / `SettingsRow` 落到 `settingsStyles` 上。

**来源变更查看界面在应用里不存在。** 第一段里它只有 CLI 形态（`paseo plugin update`，`packages/cli/src/commands/plugin/update.ts`）和 client 方法（`previewPluginUpdates` / `applyPluginUpdates`），应用设置页没有对应界面，所以这条验收项在应用侧只落在安装表单与插件行上。03、04 合并时若上游把它带进应用，再按同样的规则对齐。

截图（浏览器 Web，英文界面，来自 `e2e/browser/plugin-management.spec.ts` 自带的截图步骤，不是桌面端验收截图）在 `screenshots/`：

- `02-before-plugins-row-menu-open-web-1280.png`：改前。
- `02-plugins-row-menu-open-web-1280.png`：改后，三种状态的插件行，菜单展开。
- `02-plugins-npm-row-web-1280.png`、`02-plugins-npm-row-web-390.png`：改后，从 npm 安装成功后的行。
- `02-plugins-install-error-web-390.png`：改后，安装失败。

### 外链

- `plugins-page.tsx` 的 `PLUGIN_SOURCE_DOCS_URL` 从 `https://paseo.sh/docs/plugins/reference#plugin-sources` 改为 `https://github.com/LFT-OXY/Osuna/blob/main/public-docs/plugins/reference.md#plugin-sources`。本仓库有对应内容：`public-docs/plugins/reference.md` 的「Plugin sources」一节随第一段进来，`docs/plugins.md` 也把它当作来源写法的出处。按钮（「文档 ↗」）保留。
- **这是替维护者做的选择，可以改。** PRD 的规则是「有对应内容就指向本仓库，没有就连同按钮去掉」，这里按字面属于前者。但先例 `584c270bb` 对文档站链接是一律连按钮删掉的，即使 `public-docs/` 里有同名页面（schedules、metadata-generation）。两种做法都满足「链接数不增加」。要改成删掉按钮的话，改动是 `plugins-page.tsx` 去掉 `sourceDocsLink` 与 `Field` 的 `trailing`，并删掉 e2e 里的 `expectPluginSourceDocsOpen`。
- 这个链接在 PR #13 并入 main 之前打开是 404（文件还不在 main 上），并入后生效。
- 计数（口径同 01）：

| 范围 | 全部命中行 | 非测试命中行 | 01 基线（全部 / 非测试） |
| --- | --- | --- | --- |
| `packages/app/src` | 70 | 1 | 71 / 1 |
| `packages/cli/src` | 13 | 3 | 13 / 3 |

  第一段在 server、protocol、client、desktop、plugin、cli 的非测试源码里没有新增上游站点链接。

### COMPAT 标签

第一段带进来的五个标签共 10 处，`v0.8.0` 改为 `v0.15.0`，移除日期与说明不动：

| 标签 | 位置 |
| --- | --- |
| `pluginSourceInstallation` | `protocol/src/messages.ts`、`client/src/daemon-client.ts`、`cli/src/commands/plugin/shared.ts`、`app/src/screens/settings/plugins-page.tsx` |
| `pluginSourceUpdates` | `protocol/src/messages.ts`、`client/src/daemon-client.ts`、`cli/src/commands/plugin/shared.ts` |
| `plugin-immediate-update` | `server/src/server/plugins/index.ts` |
| `plugin-source-record`、`plugin-git-layout` | `server/src/server/plugins/managed-source.ts` |

判定办法：这五个标签名在 main `d38d186bd` 上一处都没有（`git grep 'COMPAT(<名字>)' d38d186bd`）。仓库里其余写着 `v0.8.0` 的标签（`ownedSubscriptions`、`workspaceRequestReceipts` 等）在分叉基点之前就有，属于 Osuna 已有的标签，没有动。

### 因 Osuna 的决定而改动的上游测试

都在 `packages/app/e2e/browser/plugin-management.spec.ts`，**06 写 PR 正文时要列**：

| 断言 | 上游 | 改为 | 哪条决定 |
| --- | --- | --- | --- |
| `expectPluginSourceDocsOpen`：点「Docs」后打开的地址 | `https://paseo.sh/docs/plugins/reference#plugin-sources` | `https://github.com/LFT-OXY/Osuna/blob/main/public-docs/plugins/reference.md#plugin-sources` | 外链只指向本仓库（`584c270bb`） |
| `expectSourceHierarchy`：说明文字的颜色 | `rgb(113, 113, 122)` | `rgb(113, 113, 123)` | 默认主题换成 t3code 色板（`ba9490ea6`），`foregroundMuted` 是 `#71717b`。**这条在本工单动手之前就是红的** |
| `expectSourceHierarchy`：来源文字的颜色 | `rgb(161, 161, 170)` | `rgb(113, 113, 123)` | 设置页外观：行说明只有一种样式（`caption` + `foregroundMuted`） |
| `expectSourceHierarchy`：来源字号小于说明字号 | `toBeLessThan` | 两者相等（`toBe`） | 同上 |

文档链接仍在新页面打开并带 `#plugin-sources`，这条行为没变。后三行改完之后，`expectSourceHierarchy` 断言的是「说明与来源两行都是 Osuna 的行说明样式」，上游想要的「来源比说明更小更淡」这层区分在 Osuna 上不存在了——这是外观决定的直接结果，不是测试写松了。Osuna 原有的测试没有删除、跳过或放宽。

### 两项插件能力

- 从 npm 安装插件：`plugin-management.spec.ts` 的「installs an npm source and manages its row」在 1280 与 390 两个视口通过（先装一个不存在的包看到 404 并保留输入，再装 `npm:@paseo-fixture/review@^2.0.0`，然后重载、移除）。
- 插件打开外部链接：`plugins/react-native/ui.ts` 导出的 `ExternalLink` 本工单没有改；`plugin-workspace-panels.spec.ts` 本机通过，其中插件里的 `ExternalLink` 与 `openExternalUrl` 各打开一次外部页面。

### 运行记录（2026-10-10，本机）

- 改之前先跑一遍 `plugin-management.spec.ts`：4 过 2 挂，挂的就是上表第二行那条颜色断言。
- 先改测试预期，文档链接用例变红（等不到发往 `github.com/LFT-OXY/Osuna/` 的导航请求），再改代码。
- 改完后 `npx playwright test --project=browser e2e/browser/plugin-management.spec.ts e2e/browser/plugin-workspace-panels.spec.ts`：7 条全过（评审后的修正之后重跑的结果）。
- `npx vitest run src/screens/settings/plugins-page.test.tsx src/i18n/resources.test.ts src/styles/unistyles-module-scope.test.ts`：全过。
- `npm run typecheck`：通过。本机这次跑 e2e 生成了 `packages/app/.expo`，所以另用排除 `.expo` 的临时 tsconfig 复核了一次 app：`plugins-page.tsx` 与 `plugin-management.spec.ts` 没有报错（复核配置自身漏了浏览器测试的类型，报的 7 条都在 `*.browser.test.tsx`，与本次无关；CI 的 typecheck 在上一次推送上是绿的）。
- `npm run lint`（7 个改动文件）：0 警告 0 错误。`npm run format:files`：无改动。
- 整套测试没有在本机跑，交给 CI。

### 评审（`atw-code-review`，Standards、Spec、Visual 三轴）

- Standards 硬违规 1 条，已修并复查：来源行的样式最初写成模块级数组 `[settingsStyles.rowHint, styles.pluginSource]`，违反 `docs/unistyles.md`「Do Not Materialize Styles At Module Scope」，守护测试 `styles/unistyles-module-scope.test.ts` 会红。修法是不再给来源行单独配色，直接用 `settingsStyles.rowHint`（见上面外观表第二行），守护测试、插件页单测、两份 e2e 重跑通过。
- Standards 判断题，照规则原样提交并上报：
  - 「更多操作」按钮的样式与两个渲染函数现在在 `plugins-page.tsx`、`keyboard-shortcuts-section.tsx`、`provider-detail/header.tsx` 各有一份，`docs/design.md` 说三处以上就该抽成共享原语；`foregroundMutedColorMapping` 与 `components/ui/icon-color.ts` 的 `mutedIconColorMapping` 重复。抽取会改到另外两个文件，超出本工单。
  - 本次碰到的 10 行 COMPAT 注释是上游原文的格式（分号分隔；`plugin-source-record` 没有 `added in` 和日期，`plugin-git-layout` 没有日期），只改了版本号。
  - 菜单里「移除」的图标是 16（设计规范写菜单项图标 14），与上游原值和 `provider-detail/header.tsx` 相同。
  - 文档链接的 e2e 会真实访问外站（上游就是这个形态，现在是 github.com）。
- Spec：没有缺项。两条需要维护者拍板，见「外链」一节的选择，以及上表后三行（评审指出来源行用 `micro` 11 号字可以保住上游的字号断言；没有采用，因为设置页没有任何地方用 `micro`）。
- Visual：验收点没有不满足的，本次改动没有引入新的视觉问题。评审列出的都是改前就有的，留给 06 或以后：安装失败时 daemon 的报错原文（含 `requestType=… code=handler_error`）整段排成红色标题；长路径在来源行折成两三行，各行高度不一；安装卡片里输入框与禁用的按钮是两条几乎一样的灰条；菜单里只有「移除」带图标，文字起点不齐。

### 给后续工单

- 03、04：合并后先 `rg 'toHaveCSS' packages/app/e2e` 看上游新带来的断言有没有写死上游色值，再对照 `styles/theme.ts` 改；`rg 'COMPAT\(' ` 新增的标签照本工单的办法判定（标签名在合并前的 main 上不存在才算上游新带来的）。
- 05：值得写进文档的坑——上游的 e2e 会写死上游主题的色值（差 1 也会挂）；上游新界面里的说明文字、操作菜单按钮要对回 `settingsStyles` 与设置页已有写法；上游新链接的处理与计数口径。
- 05 / 06：规范已补两条（`.atw/spec/app/frontend/component-guidelines.md` 的设置行说明与操作菜单按钮，`testing.md` 的颜色断言）。

### 推送与 CI

- 推送 `f7cc79106`、`1ab602e75` 到 `identify-fork-base`（草稿 PR #13），只推这一条分支。依据是 PRD「每段推送后看 CI」和本工单的 CI 验收项，没有另行询问。
- `1ab602e75` 上 CI 工作流 18 项全部通过：format、lint、typecheck、app-tests、sdk-tests、relay-tests、server-tests（ubuntu / windows）、desktop-tests（ubuntu / windows）、cli-tests 三片、playwright 四片、changes。Desktop Packages 的 `linux` 也通过。Nix 与 Nix Update Hash 这次没有被触发。
- 上一轮（`5f33df56a`，工单 01 的提交）的两项红灯：
  - playwright 第 4 片挂的正是 `plugin-management.spec.ts` 的两条 npm 用例（193 过 2 挂），即上面那条写死上游色值的断言，本工单已改。
  - Desktop Packages 的 `linux` 挂在「受限用户命名空间下启动 AppImage」的自检：应用在打开调试端口前以 127 退出，日志里解压文件清单还在输出时启动脚本已经开始跑。两次运行之间 `packages/desktop` 没有改动，这一轮通过，main 上也一直是绿的，按偶发处理。**只有一次样本**；03、04 再遇到先重跑，连续出现再查自检脚本里解压与启动的先后。
