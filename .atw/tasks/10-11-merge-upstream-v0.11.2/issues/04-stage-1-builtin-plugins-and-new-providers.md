# 04 — 第一段的适配：内置插件与两个新提供方

**What to build:** Muse Code 与 Antigravity 出现在设置 → Providers 的列表与详情两级页里，图标是上游的，能照上游的方式使用。内置插件（两个新提供方与全部套餐用量来源）在 dev daemon 下正常加载，在设置 → 插件页里的表现与上游一致。Osuna 独有的已装版本、一键升级、安装指引这次不给两个新提供方补：逐项核实它们在这两个提供方上实际是什么表现，把缺口写清楚并记成后续任务。规格见 `prd.md` 的「插件登记处与内置插件」「两个新提供方」「Out of Scope」。

**Blocked by:** 02
**Status:** ready-for-agent
**Impl:** doing

- [x] 设置 → Providers 的列表里有 Muse Code 与 Antigravity，点进去是 Osuna 的详情页，图标取上游的。列表 → 详情两级结构不变。
- [ ] 本机没有装这两个 CLI 时，列表与详情页显示的是「不可用」一类的正常状态，没有报错或空白。（未勾：实际是上游原样的「错误」态——红点加「无法启动」错误卡，页面完整、没有空白。原因见 Comments「CLI 缺失时的状态」；是改验收句还是改代码，交维护者定。）
- [x] 逐项核实并记在 `## Comments` 下：已装版本、一键升级、安装指引这三项在两个提供方上各显示什么（缺失、空白、还是错误的内容）。显示成错误内容或会误导用户的，改成不显示；其余按缺口记录。
- [x] 两个新提供方缺口的后续任务已建，内容含上面的核实结果；任务编号记在 `## Comments` 下。
- [x] dev daemon 启动日志里内置插件全部加载成功；有加载失败的已查清原因。
- [x] 内置插件在设置 → 插件页里怎么显示、能否停用，与上游的行为一致，核实结果记在 `## Comments` 下。
- [x] 上游为内置插件加的构建步骤在 Osuna 的构建脚本里也在；Osuna 的桌面发版工作流是否需要跟着改，结论记在 `## Comments` 下（真正的进包核对在 15）。
- [x] 提供方图标、提供方注册、提供方快照、Providers 页的现有测试通过，无一改动 Osuna 的断言。
- [x] 没有在本机测试任何提供方的登录与认证。
- [x] typecheck 和 lint 通过；改动涉及的测试文件逐个跑过并通过。
- [x] UI：设置 → Providers / 列表 / 桌面 1280 — 有 Muse Code 与 Antigravity 两行，行的样式与其他提供方一致。
- [x] UI：设置 → Providers / Muse Code 的详情页 / 桌面 1280 — 是 Osuna 的详情页样式，没有显示错误的版本号或升级按钮。
- [x] UI：设置 → 插件 / 默认状态 / 桌面 1280 — 页面正常打开，内置插件的显示方式已截图。

## Comments

### 2026-10-11 实施记录

这张票没有改代码：两个新提供方已按规格出现在 Osuna 的界面里，三项 Osuna 独有功能在它们身上都不出现，没有要改成不显示的东西。以下是依据。基点 `d8180bab9` 是 `tickets.py claim` 记下的认领时 HEAD（关闭工单 03 的提交），与工单 03 的做法相同，没有设回；它与本票提交之间另有一个不属于本票的提交 `150a8da7e`（02 的三处 e2e 修复），评审补丁按工作树相对当时的 HEAD 冻结，不含它。

**两个提供方怎么进来的。** `muse-provider`、`antigravity-provider` 是根目录 `plugins/` 工作区里的内置插件（`packages/server/src/server/plugins/builtin/index.ts` 的清单），daemon 启动时由 `PluginService.start()` 无条件加载（不受设置 → 插件页「启用插件」总开关影响），各注册一个提供方：`muse`（标签 Muse Code，命令 `muse`）、`antigravity`（标签 Antigravity，命令 `agy`），图标是插件目录里的 `icon.svg`，经快照的 `iconSvg` 字段传到应用，应用侧 `components/provider-icons.ts` 从 `providerSnapshotIcons` 取。列表 → 详情两级页（`screens/settings/providers-page.tsx` → `provider-detail/view.tsx`）是 Osuna 的，这一段没有动。

**三项 Osuna 独有功能在两个提供方上的表现（本机两个 CLI 都没装）：**

| 项 | 表现 | 原因 |
| --- | --- | --- |
| 已装版本 | 列表状态行和详情页都没有版本号，详情页没有「版本」一节 | 快照把插件提供方标为 `source: "custom"`（`provider-snapshot-manager.ts` 的 `createGeneration`，上游原样），`readInstalledVersion` 只对 `source === "builtin"` 跑；`version` 字段为空时 `provider-detail/index.tsx` 的 `selectShownVersion` 返回空，版本一节不渲染 |
| 一键升级 | 列表行和详情页都没有「升级」按钮 | 按钮只在「有已装版本且有新版本」时出现；daemon 的 `ProviderVersionCheckService` 只查 `source === "builtin"` 且在 `AGENT_PROVIDER_DEFINITIONS` 里有 `npmPackage` 的提供方，`ProviderUpgradeService` 对不在 `hasProviderUpgradeCommand` 里的提供方返回 `unsupported` |
| 安装指引 | 详情页没有「安装与升级」区块 | `provider-install-guide/internal/model.ts` 的 `resolveGuidedProvider`：不在 `BUILTIN_PROVIDER_IDS` 里的提供方按 `extends` 找内置 CLI，插件提供方没有 `extends`，返回 null |

全部记进后续任务。

**CLI 缺失时的状态。** 列表行显示红点「错误」，详情页头部徽章「错误」，正文顶部是错误卡「Muse Code 无法启动 / muse not found on PATH」加「刷新」「运行诊断」，模型卡片写「启动失败，没有检测到模型」，诊断一节正常；Antigravity 同样（`agy not found on PATH`）。内置提供方在同样情况下是黄点「未安装」（同页的 Mock Slow Provider）。触发点在快照刷新的第一步：`provider-snapshot-manager.ts` 先调 `client.getCatalogCacheKey`，两个插件都声明了 `getCatalogCacheKey`，它经 `agent/plugin-provider.ts` 的 `catalogCacheKey()` → `resolveLaunch()`，命令不在 PATH 时 `throw new Error("muse not found on PATH")`，快照在这一步就记成 `error`，还没走到后面会问 `isAvailable()`（即插件 `status().available`，这里会得到 `false` → 「未安装」）的那一段。这几处在上游 v0.11.0-beta.1 与 v0.11.2 里相同，Osuna 对 `plugin-provider.ts` 的改动只有指令列表那几处（ADR 0003），所以是上游原样的表现，按 `prd.md`「Out of Scope：修上游自己的缺陷」没有动。验收项第二条因此没有勾：要改成「未安装」得让 `catalogCacheKey` 在命令缺失时不抛错（返回 undefined 或让快照先问可用性），是对上游文件的一处偏离；改验收句还是改代码，交维护者定，已记进后续任务。

**⋯ 菜单里的「移除提供方」。** 两个提供方的 ⋯ 菜单都有「诊断」和「移除提供方」两项（截图 `04-settings-provider-muse-menu-*`）。「移除」出现是因为 Osuna 的 `provider-detail/header.tsx` 里 `canRemove = hostSupportsRemoval && providerSource === "custom"`，而快照把插件提供方标为 `custom`；上游列表页用的是同一条规则（`canRemove={supportsProviderRemoval && entry.source === "custom"}`，beta.1 与 v0.11.2 都如此）。点它会发 `removeProviders: ["muse"]`，daemon 只删这个提供方在 `config.json` 里的覆盖项，插件注册的提供方本身还在，刷新后行还在。它不在本票「已装版本、一键升级、安装指引」三项的范围里，没有改，记进后续任务。

**后续任务：** `10-11-muse-antigravity-osuna-gaps`（`task.py create --no-start` 建的，未切换当前任务；状态 discover，`prd.md` 里记了上面三项缺口和两处上游原样的表现，验收待 discover 后写）。

**内置插件的加载。** 这次启动（dev daemon pid 95517，`.dev/paseo-home/daemon.log`）11 个内置插件全部 `Loaded plugin`，没有 warn/error：`antigravity-provider`（providers: antigravity）、`muse-provider`（providers: muse）、`claude-`、`codex-`、`copilot-`、`cursor-`、`grok-`、`kimi-`、`minimax-`、`opencode-go-`、`zai-usage-source`（各注册用量来源，providers 为空）。

**设置 → 插件页。** 内置插件不在页里：`PluginService.listPlugins()` 只列 `config.plugins` 里配置的插件，页面显示「没有已配置的插件」，「启用插件」总开关默认关、且只管配置的插件（`handleGlobalSwitch` 只停 `stopConfiguredPlugins`），内置插件照常运行。所以内置插件不能从插件页停用；两个提供方可以在 Providers 页用行上的开关停用（写 `providers.muse.enabled`，与别的提供方相同）。这与上游 beta.1 一致（`plugins/index.ts` 对上游只差一个 COMPAT 版本号），上游 v0.11.2 的 `listPlugins()` 也仍只列配置的插件。插件页本身的样式是 Osuna 的（02 合入时改的菜单按钮与行提示样式）。

**构建步骤。** 上游在 beta.1 为内置插件加的都在：根 `package.json` 的 `workspaces` 含 `plugins`、`typecheck:server` 含 `@getpaseo/builtin-plugins`；server 的 `build:lib` 把 `../../plugins` 拷进 `dist/server/builtin-plugins`（滤掉 node_modules、test、测试文件）；`ci.yml` 的「Verify built-in plugins from built output」（`scripts/builtin-plugins-dist.test.mjs`）与「Run built-in plugin tests」两步；`scripts/trace-daemon.mjs` 的排除项。上游在 beta.1 **没有**改 `electron-builder.yml`、`desktop-release.yml`、`desktop/src/main.ts`。调研记录里说的 `electron-builder.yml` +4 行（把 `dist/server/builtin-plugins` 从 asar 排除、作为 `extraResources` 的 `builtin-plugins` 目录带上）和 `builtin/index.ts` 的 `app.asar` 路径探测都在上游提交 `70df09dae`，它首次出现在 v0.11.0-beta.2，归 05；`desktop-packages.yml` 的 `paths` 多一行 `plugins/**` 也在那之后。**Osuna 的桌面发版工作流不用改：** 它调的是 `npm run build:desktop` → desktop 的 `build` → 根 `build:server:clean`，内置插件随 server 的 `build:lib` 进 `dist`，05 收下 `electron-builder.yml` 的那几行后自动进 `extraResources`。按上游 `70df09dae` 的提交说明，beta.1 这一版打出来的桌面包里内置插件在 asar 内、插件进程读不到，所以 15 的进包核对要在 05 之后做。

**检查。** `npm run typecheck` 通过；没有改源码，lint 没有新对象。单独跑过并通过：app 的 `components/provider-icons.test.ts`、`components/provider-icon-name.test.ts`、`screens/settings/providers-section.test.tsx`、`screens/settings/providers-view.test.ts`、`provider-detail/index.test.tsx`、`provider-install-guide/internal/model.test.ts`（6 个文件 191 条）；server 的 `agent/provider-registry.test.ts`、`agent/provider-registry-wrap.test.ts`、`agent/provider-snapshot-manager.test.ts`（3 个文件 154 条）。断言一条没改。没有在本机测任何提供方的登录。

**dev 桌面端截图（`screenshots/04-*`，Electron 1280 宽，zh 与 en 各一套，主机名仍是 03 改好的 dev-host）：**

- `04-settings-providers-list-desktop-1280-{zh,en}`：已启用组 8 行，Antigravity 与 Muse Code 在 Mock Slow Provider 之后，带上游的图标，行高、开关、箭头与其他行相同；两行状态为「错误 / Error」，没有版本号、没有升级按钮（Claude、Codex、Oh My Pi 三行有）。
- `04-settings-provider-muse-detail-desktop-1280-{zh,en}`：Osuna 的详情页布局（头部图标 + 名称 + 徽章、启用开关、刷新、⋯），没有「版本」节、没有升级按钮、没有「安装与升级」区块；有错误卡、模型卡片、诊断节。
- `04-settings-provider-muse-menu-desktop-1280-{zh,en}`：⋯ 菜单两项「诊断」「移除提供方」。
- `04-settings-plugins-default-desktop-1280-{zh,en}`：插件页正常打开：信任提示、「启用插件」开关（关）、插件来源输入框与「安装插件」、「没有已配置的插件」。
- 中文界面下上述页面没有残留的英文；错误卡里的 `muse not found on PATH` 是 daemon 原样返回的错误原文（等宽），不是界面文案。

#### 评审（Standards、Spec、Visual 三个维度，各一轮；修复后只复查修过的，各一次）

- **已修（Standards 硬违规 + Spec）：** 「CLI 缺失时的状态」原先把触发点写成取模型目录，实际是快照第一步的 `getCatalogCacheKey` → `catalogCacheKey()` → `resolveLaunch()` 抛错（本文与后续任务 `prd.md` 都已改写，改法也随之改）。
- **已修（Spec）：** 验收项第二条取消勾选并注明待维护者裁决；「移除提供方」不改的理由改为「不在本票三项范围」，不再援引上游缺陷豁免。
- **已修（Standards 判断项）：** 去掉开头重复的一句；后续任务 `task.json` 的描述口径与 `prd.md` 统一为「v0.11.0-beta.1（第一段）」，所属包改为 `server`（三项缺口的改动点主要在 daemon）。
- **Visual：** 三条界面验收标准满足。报的几处都不是本票带来的：详情页「错误」徽章看起来灰底红字——`StatusBadge` 的 `error` 变体用的就是 `statusDangerTint` 12% 淡红底，截图 128 色压缩后偏灰；详情页模型空卡与插件页空卡高度不同、同一动作多处入口（头部「刷新」/错误卡「刷新」、错误卡「运行诊断」/诊断卡/⋯ 菜单）是 Osuna 详情页已有的设计（`provider-detail/index.tsx` 文件头注释写明错误卡带两个恢复动作）；插件页标题下紧接分区标签「插件」是上游页面的原样。插件页列表里看不到内置插件是上游行为，上面「设置 → 插件页」已写明。⋯ 菜单截图下方的灰色残影是弹层阴影被 128 色压扁，两张菜单截图改用 256 色重截。
