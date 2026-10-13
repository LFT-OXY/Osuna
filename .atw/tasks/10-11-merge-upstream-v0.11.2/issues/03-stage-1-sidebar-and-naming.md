# 03 — 第一段的适配：侧栏两组与叫法

**What to build:** 第一段合完之后，侧栏是维护者确认过的样子：顶部的「用量」条目还在原位、点开是 Usage 页；底部图标行有「套餐用量」图标、没有「导入会话」图标，导入会话的入口在新建工作区页；设置 → 侧边栏多出底部条目一组，外观是 Osuna 的。用户升级前保存的侧栏条目顺序与显隐原样读出。这一段里已经出现在界面上的上游文案，凡是说订阅额度的都写「套餐用量」，应用里标着「用量」的入口只有 Usage 页那一个；术语表同步更新。在上游把套餐用量改成弹窗之前（第 6 段），底部的「套餐用量」图标点开 Osuna 的 Usage 页。规格见 `prd.md` 的「侧栏」「叫法」「中间段的处理原则」「UI and Design」。

**Blocked by:** 02
**Status:** ready-for-agent
**Impl:** done

- [x] 顶部组在上游的四项之后有 Osuna 的「用量」条目，默认可见，点开 Usage 页，文案键不变。
- [x] 底部图标行按上游的顺序：添加项目、套餐用量、主机、帮助、设置；没有「导入会话」图标。底部的套餐用量摘要默认隐藏。
- [x] 用户已保存的顶部条目顺序与显隐（含「用量」被隐藏、被挪到别的位置两种情况）升级后原样读出，不被当成底部条目，也不被上游的旧数据兼容处理改写。侧栏条目模型的测试里有对应用例。
- [x] 上游的两组用例通过；因 Osuna 多一个顶部条目而改的预期逐条记在 `## Comments` 下。
- [x] 导入会话的入口在新建工作区页，可用。
- [x] 这一段已出现的上游文案里，说订阅额度的都写「套餐用量 / Plan usage」，九种语言沿用 Osuna 已有的译法；zh-CN 下应用里标着「用量」的入口只有 Usage 页一个。代码里上游的命名没有改。
- [x] 术语表已更新：上游的 Usage source 记作 **Plan usage source / 套餐用量来源**，上游的 Usage report、Report ID、Usage（sidebar item）几条收进来并标明说的是套餐用量；Osuna 原有的 Usage、Usage source、Plan usage 词条不变。
- [x] 翻译资源测试通过。
- [x] typecheck 和 lint 通过；改动涉及的测试文件逐个跑过并通过。
- [x] UI：侧栏 / 默认状态 / 桌面 1280 — 顶部有「用量」条目，底部图标行有「套餐用量」图标、没有「导入会话」图标。
- [x] UI：设置 → 侧边栏 / 默认状态 / 桌面 1280 — 有顶部与底部两组条目，底部组里有「套餐用量摘要」开关且默认关闭；卡片 14 圆角、行高与同页其他设置项一致，卡片内没有通栏的横向分割线。
- [x] UI：新建工作区页 / 默认状态 / 桌面 1280 — 有导入会话入口。
- [x] UI：界面语言为中文 — 上述三处没有残留的英文。

## Comments

### 2026-10-11 实施记录

**侧栏条目模型（`sidebar-nav/model.ts`）。** 两个编号同为 `usage` 的条目保持各自的组与编号不变（顶部存 `sidebarNavItems`，底部存 `sidebarFooterItems`，上游在这一段没有任何把条目在两组之间搬动的兼容处理，本仓库也没有加）。凡是两者不同的地方收拢到模型里的一处：文案键（顶部 `sidebar.sections.usage`、底部 `sidebar.footer.usage`）、设置页的标签（底部用新键 `sidebar.footer.usageSummary`「套餐用量摘要」）、testID 的键（顶部 `usage-stats`、底部 `usage`）。底部摘要改成默认隐藏（所有布局），与上游 v0.11.2 最终版的 `HIDDEN_BY_DEFAULT` 一致，顺带去掉了上游中间版本的 `compact` 入参（上游最终版也没有）。

**上游两组用例里因 Osuna 改了预期的（`sidebar-nav/model.test.ts`）：**

- 顶部组的用例（`resolveSidebarNavItems`、`setSidebarNavItemVisible`、`moveSidebarNavItem`）：上游四项之后多一个 `usage`，这部分 02 已改，本次没有再动。
- `footer section › resolves the Usage item first, then plugin rows`：`usage` 的 `visible` 由 `true` 改为 `false`（默认隐藏）。
- `footer section › ignores header built-ins stored in footer preferences`：同上，`true` → `false`。
- `resolveSidebarNavItems on compact layouts › hides the Usage item until it is turned on`：改写为 `the footer Plan usage summary › starts hidden until it is turned on`，不再区分紧凑布局。
- 新增 `the header Usage item` 一组四条：顶部存的顺序含「用量」被隐藏、被挪到第一位两种情况原样读出；顶部默认可见而底部默认隐藏；文案键、设置页标签与 testID 键的区分。`hooks/use-settings/storage.test.ts` 新增一条：存了含「用量」的顶部列表时，顶部原样读出、底部列表仍为空。

**testID。** Osuna 的顶部「用量」行改为 `sidebar-usage-stats`（上游的底部摘要行保留 `sidebar-usage`，改 Osuna 这边是为了少和上游的用例相撞）；设置 → 侧边栏顶部卡片里的那一行改为 `sidebar-nav-item-usage-stats` / `sidebar-nav-toggle-usage-stats` / `sidebar-nav-move-*-usage-stats`。Osuna 的 e2e 辅助函数（`helpers/usage-page.ts`、`helpers/sidebar-nav-settings.ts` 的两张映射表）随之改。

**叫法。** `sidebar.footer.usage` 九种语言改为 Osuna 已有的 `usage.planUsage.title` 译法（en「Plan usage」、zh-CN「套餐用量」），用在底部图标的提示与底部摘要行；新键 `sidebar.footer.usageSummary`（「套餐用量摘要」）只用在设置页的开关。上游的 `usage/copy.ts` 的 21 句英文字面量全部改成翻译键的 getter，键放在 `usage.planUsage.*`：已有的 8 个键直接复用（title、refresh、refreshing、loading、empty、errorTitle、clientUnavailable、updated），新增 11 个（options、refreshFailed、noHosts、retry、connectHostToSee、updateHostToSee、pin、displayAs、displayUsed、displayRemaining、showInSidebar）九种语言齐全。英文只在说订阅额度的句子上把 Usage 改成 Plan usage（「Usage options」→「Plan usage options」），其余逐字不变（「Show in sidebar」保持原样）；02 临时借用的 `addProject.empty.noConnectedHosts`、`sessions.actions.tryAgain` 不再借用。`usage/model.ts` 的 `formatUsageFreshness` 改走带占位符的 `updated` 键，英文输出不变（`model.test.ts` 的三条断言原样通过）。代码里上游的变量名与目录名都没有改。这些句子里这一段在桌面端能看到的只有底部图标与摘要行的标签；其余在窄屏的底部弹层（options、display*、showInSidebar、loading、empty、errorTitle、retry、refreshFailed、pin）和没有接路由的上游独立页面（title、noHosts）。翻译守卫的 `migratedSourceLiterals` 加了 8 句。

**浏览器用例（`e2e/browser/`）。**

- `sidebar-nav-settings.spec.ts`：上游的 `expectFooterSeparator(page, shown)` 改为 `expectNoFooterRule(page)`（底部容器无上边框、无分割线元素，与摘要行显示与否无关）；`expectFooterIconRow` 的图标间距由 0 改为 2px（Osuna 的 `spacing[0.5]`）。两条要看到底部摘要的用例在种子里加 `{ key: "usage", visible: true }`（默认隐藏了）。Osuna 自己的 `expectSidebarItemHidden(page, "usage")` 经映射表指向 `sidebar-usage-stats`，不再和底部行相撞。
- `usage-sidebar-item.spec.ts`：「long usage reports…」保留（只用窄屏的底部弹层，Osuna 有）；「the Usage options…」改在窄屏弹层里走（种子打开摘要 → 弹层的选项菜单关掉「在侧栏显示」→ 摘要行消失、重载后仍不在 → 设置 → 侧边栏的开关再打开 → 摘要行回来）；「released hosts…」只留前半段（侧栏摘要行里的来源图标，种子打开摘要），去掉点进独立页面看报告卡片的后半段；「pinned windows…」整条标成 `test.skip` 并写明原因——要点进上游占用 `/usage` 的独立页面（报告卡片、固定窗口、页面上的选项菜单、主机设置页的套餐用量区块），Osuna 没有接这个页面，没有可改写的落点。上游在 v0.11.0 把这个页面换成弹窗，届时随上游处理（11）。
- `plugin-sidebar-items.spec.ts`：那条断言底部摘要行在插件行旁边的用例，种子里打开摘要。
- 本机跑过并通过（`--project=browser`，6 条）：`plugin-sidebar-items.spec.ts` 的「a plugin's screen, header row, footer popover and command work together」、`sidebar-nav-settings.spec.ts` 的「renders no top-level items…」与「owner reorders and hides footer rows…」、`usage-sidebar-item.spec.ts` 的「long usage reports…」「the Usage options…」「released hosts…」。`sidebar-nav-settings.spec.ts` 另外两条（「fixed footer line…」「owner reorders and hides top-level sidebar items」）断言 Ctrl+O / Ctrl+N，本机 macOS 是 ⌘，按既有做法只在 CI 验。
- 02 列的「已知红灯」里，`usage-screen.spec.ts` 仍是 02 跳过的状态，没有动。

**术语表（`docs/glossary.md`）。** 上游的四条按「叫法」改写：**Plan usage source / 套餐用量来源**、**Report ID**（标明属于套餐用量来源）、**Plan usage report**、**Plan usage summary**（上游的 Usage (sidebar item)），都注明上游原名并与 Osuna 的 **Usage**、**Usage source** 互相指向。**Sidebar items** 一条补上顶部的 Usage 与底部的 Plan usage summary，并去掉「Add project 与图标行之间」的旧说法（添加项目已在图标行里）。Osuna 原有的 Usage、Usage source、Plan usage 三条没有改。术语表里现在只有一条 Usage source。

**导入会话。** 入口在新建工作区页（`screens/new-workspace/import-session-button.tsx`，02 随上游合入）本次只核实、没有改；侧栏的空状态与命令菜单里的「导入会话」照旧。

**检查。** `npm run typecheck`、对改动文件的 `npm run lint` 与 `npm run format:files` 通过；单独跑过的单元测试：`sidebar-nav/model.test.ts`、`hooks/use-settings/storage.test.ts`、`i18n/resources.test.ts`、`usage/model.test.ts`、`usage/format.test.ts`、`usage/pinned.test.ts`、`usage/preferences.test.ts`。

**dev 桌面端截图（`screenshots/03-*`，1280 宽，zh 与 en 各一套；主机名在截图前临时改成 dev-host，截完改回）。**

- `03-sidebar-default-desktop-1280-{zh,en}`：顶部五项含「用量」；底部图标行依次为添加项目、套餐用量、主机、帮助与支持、设置（读到的 aria-label 为「添加项目 / 套餐用量 / 主机 / 帮助与支持 / 设置」），没有导入会话图标，没有分割线；底部摘要行默认不显示。
- `03-settings-sidebar-default-desktop-1280-{zh,en}`：顶部卡片五行（新建工作区、历史、搜索、计划、用量），底部卡片一行「套餐用量摘要」开关默认关（`aria-checked="false"`）；两张卡片圆角 14px，行高 56px 与同页一致；卡片内只有设计规范规定的行间分割线（`settingsStyles.rowBorder`），与 `03-settings-appearance-reference-*` 里外观页的卡片相同，没有另画的分割线。
- `03-new-workspace-import-entry-desktop-1280-{zh,en}`：输入框下方有「导入会话」入口（`new-workspace-import-session`）。
- 中文界面下上述三处没有残留的英文；输入框占位符里的 `@files`、`/commands`、`/skills` 是既有文案，不在本工单范围。

#### 评审（Standards、Spec、Visual 三个维度，各一轮；修复后只复查修过的，各一次）

- **已修（Standards 硬违规）：** `usage/copy.ts` 的 `key` 改为函数声明、文件头过期注释改写；`sidebar-nav-section.tsx` 的 `navItemTestKey` 三元改 `if`；`showInSidebar` 英文改回上游原文「Show in sidebar」（叫法只改说订阅额度的句子）。
- **已修（Standards 判断项，顺手收）：** e2e 辅助函数不再复刻 testID 映射，改从 `@/sidebar-nav/model` 导入；`isFooterUsageSummary` 命名条件；`expectNoPinnedUsage` 的文案改为「Plan usage」。
- **已修（Spec）：** 「released hosts…」保留前半段、「the Usage options…」改在窄屏弹层里走（上面「浏览器用例」已更新）；Comments 里的语言数与键数改正。
- **Visual：** 四条验收标准全部满足，没有偏离设计规范的地方。报了两处：底部卡片里关闭态开关对比度低（既有 `Switch` 关闭态样式，不属本工单）；新建工作区页「导入会话」按钮与输入框的间距偏紧（上游原样的位置，品味项，不动）。
- **判断项，照原样提交：** `usageCopy.title` 与 `planUsage` 指向同一键（保留上游的变量名）；`model.ts` 里注释中英并存（Osuna 的说明用中文、上游的保留英文，是仓库惯例）；三条 e2e 里「默认隐藏，先打开」的注释重复；zh-CN 复用的 `usage.planUsage.loading/empty/errorTitle` 写的是「正在加载用量…」「暂无用量数据」「无法加载用量」——这是 Osuna 自己的套餐用量卡片已有的译法，改它会连带改 Osuna 的卡片，交维护者决定；`test.skip` 的依据在本工单 Comments，PR 正文由 15 写。
- **本机没跑的：** `sidebar-nav-settings.spec.ts` 里断言 Ctrl+O / Ctrl+N 的两条（macOS 是 ⌘），交 CI；整套测试按仓库规则不在本机跑，推送后看 CI。
