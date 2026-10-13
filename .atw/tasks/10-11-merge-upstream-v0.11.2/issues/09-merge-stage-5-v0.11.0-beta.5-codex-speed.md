# 09 — 第五段：合并到上游 v0.11.0-beta.5，含 Codex 速度菜单

**What to build:** 合并分支上有一个把上游 `15d774d4a`（v0.11.0-beta.5，23 个提交）合进来的 merge commit，以及紧跟其后的适配。合完之后 Codex 的「快速模式」开关变成速度菜单，列出当前模型提供的普通、快速、超快，样子是 Osuna 的；Osuna 在 Composer 上原有的东西——用量条、官方与第三方接口切换、provider 图标与控件的样式——都在。模拟合并里这一段新增 5 个冲突文件，集中在 Composer 的智能体控件。速度菜单落在这一段是按冲突文件的出现推断的，以实际差异为准：不在这一段就把速度菜单的验收项挪到它实际所在的那张合并工单并记下。规格见 `prd.md` 的「合并方式」「其余看得见的变化」「UI and Design」。

**Blocked by:** 07, 08
**Status:** ready-for-agent
**Impl:** done

- [x] 合并分支包含一个以合并前的分支头与 `15d774d4a` 为双亲的 merge commit。
- [x] 每个冲突文件怎么裁的、依据哪条规则，逐个记在 `## Comments` 下。规则裁决不了的没有自行取舍。
- [x] Codex 的速度菜单以上游为底：列出当前模型提供的档位，选中后生效；上游带来的偏好兼容处理已收，旧的「快速模式」偏好升级后读成对应的档位。
- [x] 速度菜单的触发器与菜单项用 Osuna 的控件样式。上游「选中快速或超快时图标变黄」与 Osuna 给快速模式定的样式不一致时按 `docs/design.md`，并截图给维护者看，结论记在 `## Comments` 下。
- [x] Osuna 在 Composer 上原有的东西都在：用量条、官方与第三方接口切换、模型与模式控件；对应的现有测试通过，无一改动断言。
- [x] Composer 智能体控件的工具函数测试：上游的速度用例与 Osuna 的用例都通过。
- [x] daemon 自更新保持删除（上游在这一段又改了它的一个测试文件）。
- [x] 所有工作区版本号是 `0.14.2`；`CHANGELOG.md` 与合并前逐字节相同；`package-lock.json` 的差异能逐项对应到上游的依赖改动，上游没有改外部依赖时与合并前逐字节相同。
- [x] 协议新增的字段都是可选的；新带进来的 `COMPAT(...)` 标签已改写版本号。
- [x] `docs/release.md`「合并后核对」逐项过完，结果记在 `## Comments` 下；上游站点链接的非测试数不多于基线。
- [x] 翻译资源测试通过；指令目录的现有测试通过，无一改动断言。
- [x] 对本段冲突涉及的测试文件对比合并前后，没有 Osuna 的断言行被悄悄删掉。
- [x] typecheck 和 lint 通过；本段冲突文件对应的测试文件、本段新增或改动过的测试文件逐个单独跑过并通过。
- [x] 推到 `origin` 后草稿 PR 上的 CI 结果已看过并记在 `## Comments` 下。
- [x] UI：Composer / Codex 智能体、速度菜单展开 / 桌面 1280 — 菜单列出该模型的档位，当前档位有选中标记；菜单的圆角、底色与 Osuna 其他菜单一致。
- [x] UI：Composer / Codex 智能体、选中快速档 / 桌面 1280 — 触发器的样子与 Osuna 其他 Composer 控件一致，能看出当前不是普通档。
- [x] UI：界面语言为中文 — 速度菜单里没有残留的英文。

## Comments

### 2026-10-12 实施记录

**基线（合并前 `39d411fea`，认领提交；代码与 `91c775635` 相同）。** 13 个工作区版本号 `0.14.2`；`CHANGELOG.md`、`package-lock.json`、各 `package.json` 取了指纹；上游站点链接 `packages/app/src` 全部 73、非测试 1，`packages/cli/src` 全部 13、非测试 3（与 06 相同）；`COMPAT(...)` 标签名清单取了快照。

#### 第五段：v0.11.0-beta.5（`15d774d4a`，23 个提交）→ merge commit `5e5ea92c6`（双亲 `39d411fea`、`15d774d4a`）+ 适配提交 `b9c2bca76`

- **速度菜单实际落在第 1 段，不在这一段。** 上游 #5708「Support catalog-driven Codex Fast and Ultrafast speeds」（`60aff2346`）在 v0.11.0-beta.1 里，02 合进来时速度菜单与 `COMPAT(codexFastPreference)` 的偏好兼容就已经在分支上了（02 的记录里只有标签改写那一句）。这一段带来的是 #6152「选了 Fast 或 Ultrafast 时闪电变黄」，正是工单点名要对照 `docs/design.md` 的那一处。02 已关闭，速度菜单的验收项没有挪回去，留在本工单按当前分支的实际状态验完，在这里记下。
- **冲突 21 个文件**（模拟合并同为 21）：内容冲突 18，Osuna 删上游改 3（daemon 自更新）。按 `docs/release.md`「冲突裁决」三条规则逐个裁，下面标 ①②③。
- **版本号类 15 个文件（①）**：`CHANGELOG.md` 与 13 个 `package.json`（根、app、cli、client、desktop、expo-two-way-audio、highlight、plugin、protocol、relay、server、website、plugins）冲突块只有版本号，取 Osuna 一侧；解完 14 个文件都与合并前逐字节相同（`cmp` 核对）——上游这一段没有改任何外部依赖。`package-lock.json` 取合并前内容后用 `npm install --package-lock-only --ignore-scripts` 重新生成，与合并前逐字节相同。
- **daemon 自更新（①，保持删除）**：上游 #6095「Name a linked global install as the reason daemon self-update is refused」改了 `session/daemon/daemon-self-updater.test.ts`、`npm-global-cli.ts`、`npm-global-cli.test.ts`，Osuna 已删；三个文件 `git rm`，`session/daemon/` 仍只有 `daemon-session.ts`、其测试与 `diagnostics.ts`。全仓 `rg` 没有别处引用。`server_info` 不声明这项能力（`daemonSelfUpdate` 仍只是协议里那个可选的旧字段）。
- **`composer/agent-controls/utils.ts`（①：设置之外的外观决定，Osuna 在 `6bb673f4e` 定的「快速模式 = 实心闪电 + 提供方品牌色」）**：1 块。上游把 `service_tier`（速度菜单）与 `fast_mode` 一起映射到 `"yellow"`；Osuna 的 `FeatureHighlightColor` 没有黄色，`fast_mode` 走 `"providerBrand"`。取 Osuna 的高亮，把上游新增的 `case SPEED_FEATURE_ID` 并进同一分支：两者都是 `"providerBrand"`。上游新增的 `isFeatureActive()`（开关看值、选择型看是否选了非默认项）在冲突块之外，照收。
- **`composer/agent-controls/utils.test.ts`（①）**：1 块。Osuna 的断言 `fast_mode → providerBrand` 原样保留；上游新增的 `service_tier → yellow` 改成 `providerBrand`（**按 Osuna 决定改写的上游测试，给 15**）。上游新增的 `isFeatureActive` 用例在冲突块之外，照收。
- **`composer/agent-controls/index.tsx`（②为底 + ①的外观）**：4 块。上游把 `getFeatureIconColor` 的入参从「功能编号 + 是否开启」换成整个功能对象，并给选择型功能的触发器也传图标色（经 `theme.colors`）；Osuna 的写法是 `iconColorMapping` 交给 `AgentControlTrigger` 经 `withUnistyles` 取色、组件里不订阅主题（`docs/unistyles.md`）。裁法：`getFeatureIconColor` 留 Osuna 的签名与 `providerBrand` 分支，第二个参数改叫 `active`；`useFeatureIconColorMapping(feature, provider)` 里用上游的 `isFeatureActive(feature)` 算是否高亮（于是选择型功能选了非默认项也高亮，这是上游这一段要的行为）；四处触发器（桌面与抽屉 × 开关型与选择型）都用 `iconColorMapping`，上游自动合并进来的两处 `iconColor={getFeatureIconColor(… theme.colors …)}`（选择型，引用了 Osuna 组件里不存在的 `theme`）一并换掉。Osuna 的 `getToggleFeatureIcon` 改名 `getFeatureIcon` 并覆盖速度菜单：`fast_mode` 开着或 `service_tier` 选了非默认档时用实心的 `FastModeOnIcon`。
- **「选中时变黄」对照 `docs/design.md` 的结论**：不取黄色。`docs/design.md` 讲 Composer 的那一段写的是「Fast mode, when on, is a filled bolt in the brand color; plan mode and auto-accept, when on, keep their blue and green」，Osuna 的功能高亮里没有黄色这一档（`.atw/spec/app/frontend/styling.md`「Agent controls」同）。速度菜单沿用同一样式：普通档是描边的 `foregroundMuted` 闪电，快速 / 超快是实心的品牌色闪电（Codex 是 `#3941ff`）。**维护者 2026-10-12 看过截图后确认：用 Osuna 的实心品牌色，不取黄色。**
- **冲突之外、为这张工单的验收做的适配（`b9c2bca76`）**：
  - **速度菜单按界面语言显示。** 菜单上的字全部来自 daemon，是英文：功能名 `Speed`、提示 `Select speed`、默认项 `Normal` 写在 `codex-feature-definitions.ts`，其余档位名来自 Codex 的模型目录。应用侧新增 `localizeSpeedFeature()`（`composer/agent-controls/utils.ts`）：`service_tier` 的功能名、提示与名字是 Normal / Fast / Ultrafast 的档位换成翻译键 `agentControls.speed.{label,select,normal,fast,ultrafast}`（九种语言，zh-CN：速度 / 选择速度 / 普通 / 快速 / 超快），模型目录里别的档位名原样显示。英文资源与 daemon 的原文一字不差，上游 `codex-speed.spec.ts` 按英文名定位的写法不受影响。先写的失败用例在 `utils.test.ts`（中文下整个功能对象的期望值、英文下原样、别的功能不动），再写实现。daemon 给的其余功能与模式名（`Plan`、`Full access`、`Medium`）仍是英文，是既有状况，不在本工单范围；设置 → Agent 档案的编辑弹窗里速度那一行也仍显示 daemon 的英文——记给 14。
  - **选项不超过 6 个时不带搜索框。** 上游的选择型功能菜单默认带搜索框，三项的速度菜单上面顶着一个搜索框；Osuna 的模式菜单、提供方菜单都不带，设置页与日程表单的下拉是 `searchable={options.length > 6}`。两处选择型功能的 `Combobox`（桌面与抽屉）按同一条线。
  - **`e2e/browser/codex-speed.spec.ts`（按 Osuna 决定改写的上游测试，给 15）**：上游这一段新加的颜色断言写死上游的黄色 `rgb(251, 191, 36)` 与上游的 `foregroundMuted` `rgb(113, 113, 122)`；改成 Codex 品牌色 `rgb(57, 65, 255)` 与 Osuna 浅色主题的 `foregroundMuted` `rgb(113, 113, 123)`（`#71717b`），并补一条 `fill` 断言：非默认档实心、普通档 `none`。
  - **`e2e/browser/usage-screen.spec.ts`（按 Osuna 决定改写的上游测试，给 15）**：上游这一段新加的「an account with all logins failing shows each harness and remedy, then only usage when one succeeds」经 `openUsage` 进上游占用 `/usage` 的套餐用量独立页面，Osuna 没有接这个页面。没有跳过：改成窄屏下从侧栏底部图标打开套餐用量抽屉（同一张 `UsageCard`），断言内容不变，本机通过。同文件上游把登录过期的文案断言加了 `Claude: ` 前缀的那一条仍在 02 跳过的用例里。
  - **`COMPAT(...)`**：新带进来三个标签名共 4 处——`usageLoginErrors`（`usage/card.tsx`、`plugins/usage-sources/index.ts`）、`usageLoginHarness`（`plugins/usage-sources/index.ts`）、`ompLatePromptRejection`（`omp/rpc-types.ts`），上游写 v0.11.0，改写成 `v0.15.0`（连同同一行的「floor >= v0.11.0」），日期不动。
- **没有报冲突、核对过的自动合并**：`agent-controls/policy.ts`（上游新增 `SPEED_FEATURE_ID`）；九种语言的 `pairing.remoteSsh.fields.password` / `optional` / `passwordVisibility.*`（上游自带 zh-CN 译文：守护进程密码 / 可选 / 显示密码 / 隐藏密码）；`components/add-remote-ssh-host-modal.tsx`（远程 SSH 主机的 daemon 密码框，上游的写法，外观留给 14 一起看）；`usage/card.tsx` 与 `usage/agent-usage.tsx`（登录失败按工具逐条列出、圆环悬浮卡的刷新按智能体取数）；`components/ui/hover-card.tsx`（指针离开被点过的行时悬浮卡收起）；`public/index.html` 与 `agent-stream/strategy-web.tsx`（聊天滚动后标题栏拖动，`data-window-content`；Osuna 的启动底色没有被动到）；`claude/agent.ts`、`omp/agent.ts`、`executable-resolution.ts`、`utils/spawn.ts`（`windows-command.ts` 挪进 `packages/plugin`）；`.oxlintrc.json`、`.github/workflows/nix.yml`、`nix/*`（不追，已知红灯）。
- **Osuna 的断言有没有被悄悄删掉**：对本段新增或改动的 35 个测试与 e2e 辅助文件逐个比对（被删的行里、基点 `6b00310f7` 没有的才算 Osuna 写的）：零条。冲突文件 `utils.test.ts` 里 Osuna 的断言原样。
- **合并后核对**：更新源（`publish: github / LFT-OXY / Osuna`）、桌面身份（`appId com.chinhae.osuna.desktop`、`productName Osuna`）与数据目录（`main.ts` 的 `Paseo`）、签名（`mac-sign.js`、`OSUNA_MAC_SIGNING_SHA1`、`Verify macOS signature` 都在，没有 Apple 公证变量）——上游这一段在 `.github/workflows` 下只改了 `nix.yml`，`electron-builder.yml` 与 `main.ts` 未触及；四个部署工作流的 `on:` 仍只有 `workflow_dispatch`；外链四个数字与基线相同（73 / 1、13 / 3），非测试的四行逐行相同；翻译键：九种语言齐全，`resources.test.ts` 通过，zh-CN 是真实翻译；`COMPAT(...)`：见上。daemon 自更新：见上。
- **协议**：只有一处新增——`UsageReportEntrySchema.loginErrors`，可选数组。上游带来的 `messages.wire-compat.test.ts`「usage login errors are additive and older reports still parse」通过；Osuna 的 Usage 消息与 `features.usage` 原样。
- **速度菜单的行为（以上游为底）**：菜单列出当前模型提供的档位、选中后生效、换到只有 Fast 的模型后 Ultrafast 消失，由上游的 `codex-speed.spec.ts`（桌面 1280 与手机 390 两条）在本机跑通；旧「快速模式」偏好读成对应档位由 `codex-feature-definitions.ts` 的 `readCodexServiceTier` 与 `setFeature("fast_mode", …)` 的兼容分支负责（`COMPAT(codexFastPreference)` 三处都在），`codex-app-server-agent.features.test.ts` 通过。
- **跑过并通过（本机，逐个文件）：** 先 `npm run build:server`（上游把 `windows-command.ts` 挪进 `packages/plugin` 并新增 `spawnProcess` / `execCommand` 导出，不重建 typecheck 用的是旧 dist）；全仓 `npm run typecheck`、`npm run lint`、`npm run format:check`，merge commit 与适配提交都过了提交钩子，没有 `--no-verify`。应用 unit：`composer/agent-controls/` 六个文件（`control`、`layout`、`mode`、`model-loading`、`thinking`、`utils`）、`composer/dock/internal/capacity.test.ts`、`runtime/host-runtime.test.ts`、`api-endpoints/`、`provider-usage/`、`i18n/resources.test.ts`，共 17 个文件 318 条。服务端 10 个文件 422 条通过、7 条自行跳过（本段改动的 8 个，加 `codex-app-server-agent.features.test.ts` 与 `agent/agent-manager.test.ts`——指令目录，断言未动）。协议 `messages.wire-compat.test.ts` 18 条；`packages/plugin` 3 个文件 67 条；CLI `src/run.test.ts` 7 条与 `tests/43-agent-follow-closed-stdout.test.ts`（`tsx` 直跑）；桌面 `cli-install/path.test.ts` 6 条；内置插件 6 个文件 246 条通过、3 条自行跳过、**1 条本机失败**（下一条）。
- **本机失败、不是这次合并带来的一条**：`plugins/antigravity-provider/server/provider.test.ts`「reports startup auth without waiting for init forever」报 `kill EPERM`——假 `agy` 打完一行就退出，随后对它的进程组发 SIGKILL，macOS 对只剩僵尸进程的进程组返回 EPERM（Linux 不会）。把 `internal/process.ts` 与 `signals.ts` 临时换回合并前的版本重跑，同样失败，所以与本段无关；用例本身上游这一段没有动。交 CI（Linux）验，不改上游的代码与用例。
- **本机 Playwright（`--project=browser`）**：`codex-speed`、`usage-screen`、`assistant-selection-copy`、`context-window-meter`、`sidebar-workspace` 五个文件 33 条通过、11 条跳过（都是 02 / 06 标的、要进上游 `/usage` 独立页面的），没有失败。
- **截图（`screenshots/09-composer-codex-speed-*-desktop-1280-{en,zh}.png`，中英文各 5 张；评审后重拍过一次）**：`normal`（普通档，描边闪电）、`menu-open`（菜单展开、普通档有选中标记）、`fast-selected`（选中快速档，实心品牌色闪电）、`fast-selected-tooltip`（悬停提示「速度: 快速」）、`menu-open-fast-checked`（菜单展开、快速档有选中标记）。**来源：** 无头 Chromium 1280×800、2 倍像素，真实应用 + 隔离 daemon，Codex 用上游的夹具 `e2e/fixtures/catalog-codex.mjs`（假的 Codex 命令行，模型目录里 Sol 提供 Fast 与 Ultrafast）；不是 dev 桌面端——那里要真的登录并运行 Codex，本机不测 CLI 认证。图左下角的黑色闪电方块是 Expo 开发模式的热更新提示，不是应用界面。中文图里 `Medium`、`Full access`、`GPT-6.1 Sol`、智能体标题与 `plus` 是 daemon 或夹具给的名字，不属于速度菜单。
- **21 个冲突文件逐个的裁决**：① `CHANGELOG.md`、`package.json` ×13（根、app、cli、client、desktop、expo-two-way-audio、highlight、plugin、protocol、relay、server、website、plugins）、`session/daemon/{daemon-self-updater.test.ts, npm-global-cli.ts, npm-global-cli.test.ts}`（删）、`composer/agent-controls/utils.ts`、`composer/agent-controls/utils.test.ts`；② + ① `composer/agent-controls/index.tsx`；重新生成：`package-lock.json`。规则裁决不了的：没有。

#### 评审（Standards、Spec、Visual 三个维度；评审对象是 `39d411fea..b9c2bca76`）

- **规格里的矛盾，问了维护者（2026-10-12）：** 验收项「界面语言为中文 — 速度菜单里没有残留的英文」与 `docs/i18n.md`「Do not translate … daemon output」相左——速度菜单上的字全是 daemon 给的。Standards 把应用侧的翻译报成硬违规，Spec 报成「没问维护者、也没改文档」。维护者选「保留中文」：翻译留下，`docs/i18n.md`「Translation Scope」写明例外（daemon 给固定应用控件起的名字按编号或已知名字在渲染处换成翻译键，英文资源与 daemon 原文一致；`xhigh` 思考档位是既有的同类做法）。同时问了图标颜色，维护者选「Osuna 的实心品牌色」。
- **Standards 的硬违规（已修，提交见下）：** (1) 上一条；(2) `codex-speed.spec.ts` 辅助函数里的条件式期望（`docs/testing.md`「No conditional assertions or branching paths」）→ `expectSpeedIcon(page, { stroke, fill })`，调用方传 `ACTIVE_SPEED_ICON` / `NORMAL_SPEED_ICON`；(3) `useMemo(() => localizeSpeedFeature(daemonFeature), [daemonFeature])` 用全局 `i18n.t`，切换语言后停在旧语言 → `localizeSpeedFeature(feature, t)`，两个组件各自 `useTranslation()` 并把 `t` 放进依赖。
- **Standards 的判断项：** 已改——默认档按 `option.isDefault` 认，不按英文名 Normal（加了用例「names the default tier by its flag, whatever the daemon calls it」，先红后绿）；`getFeatureIcon` 不再重列 `fast_mode || service_tier`，改问 `getFeatureHighlightColor(id) === "providerBrand"`；桌面触发器的提示由 `${label}: ${value}` 拼接改成翻译键 `agentControls.features.valueTooltip`（zh-CN 与 ja 用全角冒号，fr 用 ` : `，英文仍是 `Speed: Normal`）；`docs/design.md` 与 `styling.md` 补进速度菜单。照原样留下——`searchable={… > 6}` 这条线全仓已有 8 处各写各的，这次又多两处，没有抽公共常量；翻译只接在 Composer 的两个叶子组件上，`index.tsx` 里估算宽度的那一处（图标触发器不显示文字）与 Agent 档案弹窗仍读 daemon 的英文（记给 14）。
- **Spec 报的：** (1) 截图结论待维护者——已问，见上；截图出自无头 Chromium 而不是 Electron，原因写在上面的截图一条，Electron 里的实看记给 14。(2) 速度菜单的验收项没有挪回 02——02 已关闭，留在本工单验，已在上面写明，是实施者的决定。(3) 漏跑的两个测试文件：`assistant-selection-copy/content.browser.test.ts` 已补跑（先挪开 `node_modules/.vite`，45 条通过）；`daemon-e2e/omp.real.e2e.test.ts` 要本机装好并登录真实的 OMP，属于规格「Out of Scope」里的提供方本机实测，**没有跑**。(4) `searchable={… > 6}` 对所有提供方的选择型功能菜单生效、没有用例——留下（与 Osuna 其余下拉同一条线，已告诉维护者），`codex-speed.spec.ts` 的 `openSpeedSelector` 补了「不带搜索框」的断言。(5)(6) 同 Standards (1)(3)。(7) 「给 14 / 给 15」的事项已写进那两张工单的 `## Comments`。
- **Visual：** 四条界面验收标准都满足。它怀疑普通档图里提供方图标发灰是 128 色量化造成的——对照原图核实确是量化，界面本身是彩色；普通档与菜单展开（普通档选中）四张改用 256 色重新导出。它报的三个视觉问题：英文菜单宽度随选中标记所在行变化（共用 `Combobox` 的行为，记给 14）；中文提示的半角冒号（已修并重拍）；触发器只有图标没有下拉箭头（上游 `desktopTrigger: "icon"`，口味项，记给 14）。没有「超快」选中的图：快速与超快在触发器上同为实心品牌色闪电，上游两档也同色。
- **改写过的断言确认仍然咬人**（`.atw/spec/app/frontend/testing.md`）：临时去掉桌面菜单的 `searchable`，`codex-speed.spec.ts` 桌面用例挂在 `getByPlaceholder('Search...')` 期望 0、实得 1；临时让 `getFeatureIcon` 不返回实心图标，挂在 `fill` 期望 `rgb(57, 65, 255)`、实得 `none`。两处都已恢复。
- **复查（只查已修的八条，一次）：** 八条都回「已解决」，没有发现修复引入的错误。复查者补了一句：「不带搜索框」的断言只在桌面有效——窄屏抽屉带 `header`，本来就不渲染搜索框。
- **规范更新（同一提交）：** `docs/i18n.md`（例外）、`docs/design.md`（Composer 一段补速度菜单）、`.atw/spec/app/frontend/styling.md`（速度菜单与快速模式同一样式、选择型功能的搜索框阈值）、`component-guidelines.md`（daemon 给的固定控件名在渲染处按编号本地化、`t` 进依赖、带值提示走翻译键）、`testing.md`（辅助函数的期望值全由调用方给）。
- **评审之后本机重跑：** `composer/agent-controls/` 与 `i18n/resources.test.ts` 8 个文件 101 条；`codex-speed.spec.ts` 桌面与窄屏两条；另外补跑了守着 Composer 上 Osuna 原有东西的 4 个 e2e（`composer-plan-usage-strip`、`composer-control-density`、`composer-provider-selector`、`command-center-agent-controls`）24 条全过，断言未动。全仓 typecheck、lint、format 通过。

#### 推送后的 CI（草稿 PR #16）

- **第一轮（`ed5f82e5e`，run 38212301770）：** 19 项里 18 项通过（format、lint、typecheck、app-tests、server-tests 三个平台、desktop-tests 两个平台、cli-tests 三片、sdk-tests、relay-tests、changes、playwright 第 2、3、4 片）；同一提交上的 Desktop Packages（run 38212301643）通过。`playwright (shard 1/4)` 红：1 条失败——`agent-timeline-scroll-smoothness.spec.ts:137`「varied timeline preserves reading position during slow upward scrolling」，首跑与重试都挂在「可见文字不得反向移动」（图片行加载后高度由 560 变 225，文字位移 -175，共 102 处）。另 4 条重试后过：`agent-consecutive-turns.spec.ts:814`（已知偶发）、`agent-message-submission.spec.ts:1220`、`agent-tab-image-stability.spec.ts:49`、`bottom-sheet-reopen.spec.ts:114`。
- **这条滚动用例不是本段带来的：** 它在前两次 CI（`451670456` 的 run 38203267240、`f8181cc92` 的 run 38199828863）里都是首跑失败、重试通过；本段对聊天滚动相关的代码只在 `agent-stream/strategy-web.tsx` 加了一个 `data-window-content` 属性。本机单独跑一次通过（1.4 分钟）。medium 与 fast 两档这次都过。
- **重跑失败的一片（`gh run rerun 38212301770 --failed`）：** 四片 playwright 全部通过，run 结论 success。第 1 片仍有 2 条重试后过：`agent-consecutive-turns.spec.ts:814` 与那条慢速滚动用例。**这条慢速滚动用例从第四段起连续四次 CI 首跑都失败**（三次重试通过、一次没过），比一般偶发稳定得多；用例与图片预留高度来自上游第四段的 #5945 / #5970，没有在本工单查原因，记给 15 在并入前看一眼（是 runner 慢，还是 Osuna 的图片行高度与上游预留的不一致）。
- 内置插件与官网的用例在 CI 的 server-tests / app-tests 里跑过，本机那条 `kill EPERM` 在 CI（Linux、Windows、macOS-14 三个平台的 server-tests）上没有出现失败。指令目录（ADR 0003）：`command-catalog.ts` 及其调用方本工单没有改动，`agent/agent-manager.test.ts` 本机通过、断言未动。
- **验收项对照：** 全部勾选。其中两条带说明——「上游的速度用例与 Osuna 的用例都通过」：上游 `service_tier → yellow` 那一句按维护者确认的样式改成了 `providerBrand`，其余上游用例原样；「本段新增或改动过的测试文件逐个单独跑过并通过」：`daemon-e2e/omp.real.e2e.test.ts`（要真实的 OMP）与 `packages/desktop/e2e/workspace-restart.spec.ts`（桌面 e2e，本机 macOS 跑不通）没有在本机跑，后者由 CI 的 desktop-tests 覆盖；`antigravity-provider/server/provider.test.ts` 本机 1 条失败（见上），CI 通过。关闭工单的提交只改任务目录，没有另行推送。
