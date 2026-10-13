# 15 — 打包核对、文档、PR 正文与并入 main

**What to build:** 维护者拿到并入所需的全部证据并发话，合并分支经 PR 以 merge commit 并入 main。证据包括：本机打出的 macOS 包里带着内置插件，装好的应用里套餐用量有数据、Providers 列表里有 Muse Code 与 Antigravity；草稿 PR 上 CI 全绿；`prd.md` 的验收清单逐项核对过；14 的截图。`docs/release.md` 记录的同步点更新到 v0.11.2，并写明 v0.11.1、v0.11.2 也在补丁分支上、合 v0.12 时要重解哪些文件。PR 正文写清和上游不一样的地方与原因。规格见 `prd.md` 的「文档」「补丁分支」「Testing Decisions」的验收清单，以及 `docs/qa.md`、`docs/release.md`。

**Blocked by:** 14
**Status:** ready-for-agent
**Impl:** doing

- [ ] 本机按 `docs/release.md`「本地出一个 macOS 包」打出一个包（只在本机生成，不发布、不推 tag）。包里有内置插件目录；打开应用后套餐用量有数据，Providers 列表里有 Muse Code 与 Antigravity。包的路径与核对结果记在 `## Comments` 下并交给维护者。
- [ ] 内置插件没有进包时，原因已查清并修好（Osuna 的打包流程与上游不同之处），修法写进 `docs/release.md`「踩过的坑」。
- [ ] `docs/release.md`「从上游同步」：同步点那一句更新为 v0.11.2（`759532509`）；表里加一行，含八段的发布点、各自的 merge commit 与 PR 编号。
- [ ] `docs/release.md`「上游的补丁分支」按 v0.11.2 重写（v0.11.1 在上游 main 上，13 更正）：并入后与上游 main 的共同祖先是 v0.11.1（`ab10a6694`）；用上游自己的 v0.11.2 对上游 main 模拟合并得出的、合 v0.12 时要重解的文件清单。
- [ ] 本次新踩到的、下次还会遇到的坑补进「踩过的坑」，至少包括：上游的 beta 里有它后来删掉的中间设计；上游新增的内置插件要核对进包。没有别的就不加。
- [ ] Osuna 讲 Usage 的文档里，提到上游用量来源的地方用链接，不重述；仓库说明里的文档表与实际一致。
- [ ] ADR 0006（`docs/adr/0006-usage-in-code-is-upstream-plan-usage.md`）已从 `docs/glossary.md` 的套餐用量词条与 `docs/release.md`「从上游同步」链入。01 的评审提出；这两个文件都在冲突清单里，所以没有在 01 里加。
- [ ] 文档改动用项目的格式化脚本只处理改动过的文件。
- [ ] `prd.md`「验收清单」逐项核对并勾选，没满足的写明原因。
- [ ] 草稿 PR 上 CI 全绿，Nix 与 Nix Update Hash 除外；已知偶发失败重跑后通过。CI 的等待放在后台。
- [ ] PR 正文按 `docs/qa.md` 写，含：各段冲突裁决摘要；两个新提供方上经核实缺失的 Osuna 功能与后续任务；因换成上游实现而改动的 Osuna 断言；按 Osuna 决定改写或没收的上游测试；`plugin add 作者/仓库` 含义的变化；daemon 自更新保持下线；平台矩阵里原生端标注免验收，Windows 包与虚拟机验收由维护者自己做。
- [ ] 合并期间 main 有新提交时，已把 main 合进合并分支（不 rebase）并重新看过 CI。
- [ ] 收尾在并入之前做完：各工单的验收项已对照勾选、任务记录与 journal 已提交。并入会让这个 worktree 被 daemon 自动归档，已提前告诉维护者。
- [ ] 维护者看过截图、包的核对结果与 PR 正文并发话后，PR 转为可合并，以 merge commit 并入（不 squash、不 rebase）。并入由维护者操作，或得到维护者明确同意后操作。
- [ ] 并入后：`759532509` 是 main 的祖先；任务在主工作树归档。

## Comments

### 来自 09 的交接（2026-10-12，写 PR 正文与 `docs/release.md` 用）

- **按 Osuna 决定改写的上游测试（第五段）：** `composer/agent-controls/utils.test.ts` 的 `service_tier → yellow` 改成 `providerBrand`；`e2e/browser/codex-speed.spec.ts` 的图标色由上游的黄色改成 Codex 品牌色并补实心断言、补「不带搜索框」；`e2e/browser/usage-screen.spec.ts`「an account with all logins failing…」由 `/usage` 独立页面改到窄屏的套餐用量抽屉。维护者 2026-10-12 确认：速度菜单用 Osuna 的实心品牌色、中文界面下显示中文。
- **与上游不同的行为：** 速度菜单的功能名与普通 / 快速 / 超快按界面语言显示（`docs/i18n.md` 已写明这条例外）；选择型功能的菜单在选项不超过 6 个时不带搜索框。
- **「踩过的坑」候选：** 规格按「标志性文件首次出现在冲突清单里」推断功能落在哪一段会偏——速度菜单在第 1 段就自动合并进来了，到第 5 段才第一次冲突；`plugins/antigravity-provider/server/provider.test.ts`「reports startup auth…」在 macOS 本机报 `kill EPERM`（对只剩僵尸进程的进程组发信号），Linux 不会，合并前就如此，以 CI 为准；截图用 128 色量化时，画面里没有别的蓝色就会把提供方彩色图标压成灰色，这类图用 256 色。
- **并入前看一眼：** `e2e/browser/agent-timeline-scroll-smoothness.spec.ts:137`「…during slow upward scrolling」从第四段起连续四次 CI 首跑失败（三次重试通过，`ed5f82e5e` 那次首跑与重试都挂、`rerun --failed` 后通过），本机单跑通过。失败形状固定：图片行加载后高度 560 → 225，可见文字位移 -175。没有查原因——是 runner 慢，还是 Osuna 的图片行高度与上游 #5970 预留的不一致。

### 来自 10 的交接（2026-10-12，写 PR 正文与 `docs/release.md` 用）

- **按 Osuna 决定改写的上游测试（第六段）、因换成上游实现而改动的 Osuna 断言：** 逐条在 10 的 `## Comments` 里（各 6 条与 4 条）。前面各段为上游的中间页面写的跳过与改写在这一段全部消失：`usage-screen.spec.ts`（已随上游改名 `usage-modal.spec.ts`）与 `usage-sidebar-item.spec.ts` 取上游整份，02、06、09 交接里与这两个文件有关的条目写 PR 正文时以 10 的为准。06 里 `sidebar-help.spec.ts` 的 `Math.round` 改写也被上游自己的修法取代。
- **与上游不同的行为：** PR 面板检查汇总的分隔符随语言变、标题栏无障碍名称走翻译模板（上游写死 `", "` 与 `". "`）；中文界面里检查汇总与「已工作 …」保持 Osuna 的译法。
- **用户看得见、要写进更新日志的：** 侧栏底部的「套餐用量」图标与摘要改成在当前页面上打开弹窗（之前进 Usage 页）；插件登记处安装默认开启，`PASEO_PLUGIN_REGISTRY_ENABLED` 开关取消（上游 #6224）；法文界面整份重译（上游 #6004）；PR 面板、侧栏状态分组在其余七种非英文语言里由英文占位变成译文。
- **`docs/release.md`「上游的补丁分支」要改的事实：** 那一节列的十个文件，分叉在第 1 段就全部过完——6 个在第 1 段报冲突（其中 `codex-app-server-agent.ts` 在第 4 段又冲突一次，`fr.ts` 在第 6 段因上游重译再冲突一次），4 个六段都没有报冲突、git 自己合对了（`host-runtime.test.ts`、`provider-registry.ts`、`opencode/v2/agent.test.ts`、`opencode/v2/turns.ts`）。第 1 段合完后合并基点落到上游主线上，后面各段的基点是上一段的发布点。落点表在 10 的 `## Comments`。
- **「踩过的坑」候选：** 两边原先各写了一模一样的行，上游删掉时不报冲突、Osuna 那一份跟着消失（这次是 `app/_layout.tsx` 与 `utils/host-routes.ts` 里 `/usage` 的路由接线）；上游整份重译某种语言时（`fr.ts` 57 个冲突块），冲突块先取上游、再把基点 / Osuna / 上游三份资源摊平成键值做按键的三方合并并逐键比对，合完查自动合并出来的重复键；上游的新用例拿 `session.listCommands()` 当「确保进程在」用，在 Osuna 里不启动进程，换成 `setModel(null)`；上游按顺序读订阅事件的用例会被 Osuna 在 init 之后发的 `commands_changed` 挤错位；`packages/cli/tests/e2e/plugin-lifecycle.test.ts` 在 macOS 上要 `TMPDIR="$(cd "$TMPDIR" && pwd -P)"`（`/var` 是 `/private/var` 的软链接）；`daemon-client.e2e.test.ts` 会启动本机真实的提供方，而且不在 CI 的测试脚本里，本机不要整份跑。
- **并入前看一眼（第六段新出现的两条 CI 首跑失败、重试通过）：** `usage-sidebar-item.spec.ts:173` 与本机偶发的「Usage Settings cog desktop」是同一个现象——齿轮的选项浮层打开后自己收起，`closeUsageOptions` 读不到它的位置（已记给 11）；`context-window-meter.spec.ts:245`（dark）报「The test scripts every agent usage request」，悬浮卡多取了一次数，本机跑过一次是通过的。按 Osuna 决定改写的上游测试在第六段是 7 条（第 7 条是 CI 报出来的 `packages/desktop/e2e/browser-tabs.e2e.mjs`：Composer 是 contenteditable，不能用 `inputValue()`）。

### 来自 13 的交接（2026-10-12，写 PR 正文与 `docs/release.md` 用）

- **规格里关于补丁分支的事实已更正：** v0.11.1（`ab10a6694`）的发版提交在上游 main 上，只有 v0.11.2（`759532509`，3 个提交）在从 v0.11.1 分出的补丁分支上；合完后 `git merge-base HEAD upstream/main` 是 `ab10a6694`。`prd.md` 与本工单的那条验收项已按此改写。`docs/release.md`「上游的补丁分支」开头那句「上游的补丁版本不在它的 main 上」对 v0.11.1 不成立，重写时一并改。
- **合 v0.12 时要重解的文件：** 2026-10-12 用上游自己的 v0.11.2 对上游 main（`7321d8a48`）模拟合并（`git merge-tree --write-tree --name-only --no-messages 759532509 upstream/main`），没有冲突文件。动笔时按当时的上游 main 重算一次。
- **第七、八段的冲突裁决摘要：** 两段各 15 个文件，全是版本号与发版元数据（`CHANGELOG.md`、13 个 `package.json`、`package-lock.json`），取 Osuna 一侧，解完与合并前逐字节相同；没有适配提交，没有改动任何断言，没有按 Osuna 决定改写的上游测试。规格预计的 3 个冲突的测试文件实际自动合并了。
- **「踩过的坑」候选：** `CHANGELOG.md` 的冲突块取 Osuna 一侧之后，文件仍可能比合并前多出上游在冲突块之外改的行（这次是上游给 0.11.0 条目补的两段说明），解完与合并前 `cmp`，不同就整份恢复；模拟合并的冲突数是对合并前的 main 算的，前面各段解过之后后面的段可能不再冲突（这次第七段少了 3 个）。
- **推送后的 CI** 记在 13 的 Comments 里。

### 实施记录（2026-10-13）

认领时 `tickets.py claim` 把 `task.json` 的 `implementation_base_sha` 改成了当时的 HEAD，已用 `task.py set-meta` 设回 `351fc0655`。认领时 main 仍是 `802b17d8c`，合并分支没有落后。

**本机 macOS 包。** `env -u PASEO_HOME -u PASEO_CLI -u PASEO_AGENT_ID -u PASEO_AGENT_CWD CSC_IDENTITY_AUTO_DISCOVERY=false npm run build:desktop -- --publish never --mac --arm64`，退出码 0。在提交 `0c80ca6d4`（认领工单 15；代码与 `005e6e6c2` 相同）上打的。只在本机生成，没有发布、没有推 tag。

- 产物在这个 worktree 的 `packages/desktop/release/`（被 git 忽略）：`Osuna-0.14.2-arm64.dmg`（188 MB，sha256 开头 `842fd4a3a6da38d2`）、`Osuna-0.14.2-arm64.zip`、`mac-arm64/Osuna.app`。**并入后这个 worktree 会被自动归档，包随之消失**，要留就先拷走。
- 包里有内置插件目录：`Osuna.app/Contents/Resources/builtin-plugins/` 下 11 个插件目录，与仓库 `plugins/` 下的 11 个同名（`antigravity-provider`、`muse-provider`、`claude-` / `codex-` / `copilot-` / `cursor-` / `grok-` / `kimi-` / `minimax-` / `opencode-go-` / `zai-usage-source`），每个都有 `paseo-plugin.json`、`index.server.ts`、`icon.svg`、`server/`；`app.asar` 里没有 `builtin-plugins`（`asar list` 计数 0）。
- 包的身份与更新源：`CFBundleIdentifier` `com.chinhae.osuna.desktop`、`CFBundleName` `Osuna`、版本 `0.14.2`；`app-update.yml` 是 `owner: LFT-OXY / repo: Osuna`；签名 `adhoc`（本机包不碰签名证书）。
- **打开后的核对。** 维护者 2026-10-13 同意隔离启动：应用里的 daemon 会问本机真实的 `claude`、`codex` 等的版本与模型，并只读地读它们的登录去查套餐用量。启动方式与 `packages/desktop/e2e/packaged-app-smoke.js` 相同的一组变量，`HOME` 不换：`PASEO_HOME=/tmp/osuna15-pkg/home`、`PASEO_LISTEN=127.0.0.1:6783`、`PASEO_ELECTRON_USER_DATA_DIR=/tmp/osuna15-pkg/user-data`、`PASEO_ELECTRON_FLAGS` 开 CDP 9347，`config.json` 里关掉 `relay` 与 `mcp`。Playwright 经 CDP 操作。
  - 应用正常打开（`paseo://app/open-project`，窗口 1200×800，界面跟系统是中文），页面没有抛错。侧栏顶部有「用量」，底部图标行是添加项目、套餐用量、主机、帮助与支持、设置，没有「导入会话」图标。
  - `daemon.log`：`Home` 在 `/tmp/osuna15-pkg/home`，监听 6783；11 个内置插件各一行 `Loaded plugin`；全程没有 error，warn 只有 2 条 `ws_slow_request`。
  - **套餐用量有数据：** 点侧栏底部「套餐用量」图标，弹窗标题「套餐用量」，列出 4 张卡片（Claude 1 个账号、Codex 2 个账号、Cursor 1 个），窗口行带百分比与重置时间。画面带真实账号，只看不入库。
  - **Providers 列表里有 Muse Code 与 Antigravity：** 设置 → 提供方，「已启用 6」里依次是 Claude、Codex、Pi、Oh My Pi、Antigravity、Muse Code；两个新提供方带上游的图标，状态是「错误」（本机没装 `agy`、`muse`，04 记过的上游原样表现），没有版本号与升级按钮。截图 `screenshots/15-packaged-app-settings-providers-list-electron-1200-zh.png`（裁掉了左栏，里面有主机名；256 色）。
  - 收尾：对应用主进程发 SIGTERM，应用与它管理的 daemon 一起退出（`paseo.pid` 消失），6783 与 9347 释放，正式版的 6767 全程在监听、进程号没变（78410）。`~/.claude/settings.json`、`~/.codex/auth.json`、`~/.codex/config.toml` 的修改时间启动前后相同；`~/.claude.json` 变了，本会话自己的 Claude Code 也在持续写它，分不出是谁写的；`~/.claude/.credentials.json` 本机不存在；弹窗里有 Claude 的数据，说明 Claude 的登录读到了，有没有弹过钥匙串的授权框我这边看不到。`/tmp/osuna15-pkg` 与 `packages/app/.qa15/` 下的一次性脚本已删。
  - 没料到的一件事：隔离的 daemon 一启动就往 `$PASEO_HOME/models` 下载语音模型，退出前下了约 1 GB；在应用的环境里设 `PASEO_DICTATION_ENABLED=false`、`PASEO_VOICE_MODE_ENABLED=false` 没有拦住。评审查到原因：桌面端以 `mode: "managed"` 启动 daemon（`daemon-manager.ts`），`config-environment.ts` 的 `daemonLaunchEnvironment` 会删掉 `DAEMON_SETTING_ENV_KEYS` 里的全部变量，这两个与 `PASEO_LISTEN` 都在内——所以实际生效的监听地址来自 `config.json`。在 `config.json` 里写 `features.dictation.enabled` / `features.voiceMode.enabled` 能不能拦住下载没有实测（`speech-config-resolver.ts` 会读这两项）。目录已随 `/tmp/osuna15-pkg` 删掉，写进了 `docs/release.md`「本地出一个 macOS 包」。
- 内置插件进了包，第二条验收项（没有进包时查清并修好）不适用：Osuna 的打包流程在这一处与上游相同，没有要修的。

**文档。**

- `docs/release.md`「从上游同步」：同步点改为 v0.11.2（`759532509`）；表里加一行，八段的发布点 → merge commit（每个 merge commit 的第二亲本用 `git rev-parse <merge>^2` 对过）与 PR #16。「分段与并入」加一条「上游要占 Osuna 已有的路径时先单独提交挪开」，链到 ADR 0006。
- 「上游的补丁分支」按 v0.11.2 重写：补丁版本是否在上游 main 上要逐个看（`git merge-base --is-ancestor`：v0.10.1 – v0.10.3 与 v0.11.2 不在，v0.11.0、v0.11.1 在）；并入后与上游 main 的共同祖先是 `ab10a6694`（`git merge-base HEAD upstream/main` 实测）；分叉处的重解都落在第一段、模拟清单是上限（10 的落点表）；合 v0.12 时没有要重解的文件——2026-10-13 `git fetch upstream` 后上游 main 是 `b0f054de9`，`git merge-tree --write-tree --name-only --no-messages 759532509 upstream/main` 退出码 0、没有冲突文件。v0.11.2 比 v0.11.1 多的三个提交里只有撤销 #5716 动了代码（删掉 4 个文件、`scripts/postinstall-patches.mjs` 里的 4 行），上游 main 上的 #6445（`73390346c`）做了同样的删除，这 5 个文件在两边结果相同。
- 「踩过的坑」加了 9 条，新开一组「规划分段时」：beta 里的中间设计（规格要求的）、模拟冲突清单不能用来推断功能落在哪一段；「git 不报冲突」下：两边一模一样的行被上游删掉、上游的新用例拿 `listCommands()` 确保进程在与 `commands_changed` 挤错位；「解冲突时」下：整份重译时按键三方合并；「本机复核时」下：antigravity 的 `kill EPERM` 与 CLI e2e 的 `TMPDIR`、`daemon-client.e2e.test.ts`、官网包的 vitest 从根目录跑（06 的交接）、新增的打包资源要核对进包（规格要求的）。`CHANGELOG.md` 冲突块之外的行（13 的交接）并进了「版本号与发版元数据」表里 `CHANGELOG.md` 那一行。09 交接里「128 色会把彩色图标压灰」没有写进去，它不是合并上游的坑。
- 「本地出一个 macOS 包」加了隔离打开的一组变量与四条注意事项。规格没有要求这一段；加它是因为不带这组变量打开本机包会接管正式版的 daemon。
- `docs/glossary.md` 的 **Plan usage** 词条与 `docs/release.md`「分段与并入」链到 ADR 0006。
- `docs/usage.md` 开头加一段：套餐用量是另一回事，数据来源链到 `plugins.md#usage-sources`，代码命名链到 ADR 0006，不重述。改之前这篇文档没有提到上游的用量来源。
- 仓库说明（`CLAUDE.md`，`AGENTS.md` 是它的软链接）的文档表：表里每一行都指向存在的文档，`docs/usage.md` 那一行（Osuna 加的）与内容相符。`docs/` 下原有 4 篇不在表里（`hub.md`、`i18n.md`、`opencode-global-event-baseline.md`、`timeline-sync.md`），都是上游的文档，上游自己的表（`759532509:CLAUDE.md`）与合并前的 main 同样没有列。评审后补了 `i18n.md`、`hub.md`、`timeline-sync.md` 三行。**`opencode-global-event-baseline.md` 没有加**：它的链接比表的第一列宽，加进去格式化会把整张表 44 行全部重排，以后上游每改一次这张表都会冲突；它是一份带日期的一次性验证记录（2026-05-11）。要不要加由维护者定。
- 改过的文档用 `npm run format:files -- CLAUDE.md docs/release.md docs/glossary.md docs/usage.md` 处理（`docs/release.md` 的两张表被重新对齐）。

**`prd.md` 验收清单的核对（对 `0c80ca6d4`）。** 本工单直接重查的：

| 项 | 结果 |
| --- | --- |
| 八个发布点各一个 merge commit、`759532509` 是祖先、与上游 main 的共同祖先 | 八个 merge commit 的第二亲本依次是八个发布点；`merge-base --is-ancestor 759532509 HEAD` 成功；`merge-base HEAD upstream/main` = `ab10a6694` |
| 版本号、更新日志 | 13 个 `package.json`（根、`packages/*` 11 个、`plugins`）全是 `0.14.2`；`git diff 802b17d8c HEAD -- CHANGELOG.md` 为空 |
| 更新源、桌面身份与数据目录 | `publish: github / LFT-OXY / Osuna`、`appId com.chinhae.osuna.desktop`、`productName Osuna`、`USER_DATA_DIR_NAME = "Paseo"` |
| 签名与签名断言 | `mac-sign.js` 钩子、`OSUNA_MAC_SIGNING_SHA1`、`Verify macOS signature` 都在；工作流里没有 Apple 公证变量 |
| 只手动触发的部署工作流 | 四个工作流的 `on:` 只有 `workflow_dispatch` |
| 上游站点链接（非测试） | `packages/app/src` 1 → 1，`packages/cli/src` 3 → 3 |
| `COMPAT(...)` 标签 | 没有写着 v0.10、v0.11 的标签；上游新带来的标签名各段已改写成 `v0.15.0`（各段工单的「合并后核对」）。`providerUsageList` 是 Osuna 已有的标签名，按规则不动，其中 `session/usage/usage-session.ts` 一处上游写的是 `v0.9.3`、其余写 `v0.1.98` |
| daemon 自更新 | `session/daemon/` 下没有自更新文件；`server_info` 的 `features` 不声明 `daemonSelfUpdate`；应用里读这个特性的代码与合并前相同，走不到 |
| 协议的现有测试 | 6 个协议测试文件有改动，被删的行只有 `plugin-source-reference.test.ts` 的 3 行，是上游自己删的（`plugin add` 含义变化） |
| Osuna 的 Usage 消息与 `features.usage` | `websocket-server.ts` 里 `usage: true` 与 `usageSources: true` 并存 |

其余各项的证据在对应工单的记录里（01：准备提交；02、05、06、09、10、13：各段的检查、`package-lock.json`、冲突文件的测试；03、07、08、11、12、14：界面与截图）。

### 评审与处理（2026-10-13）

Standards 与 Spec 两个维度各一个子代理，对同一份冻结补丁（`0c80ca6d4` 之后的文档与任务记录改动）。本工单不改界面，没有界面验收项，Visual 没有跑；`screenshots/15-*` 那一张是打包核对的证据，实施时自己看过。评审时 PR 正文、推送后的 CI、收尾还没有做，不在评审范围。

**Standards。**

- 硬性违规两条，**已修**：`CHANGELOG.md` 冲突块之外多出行的那条不该追加在「踩过的坑」（"Integrate, don't append"），并进了「版本号与发版元数据」表里 `CHANGELOG.md` 那一行；「`usage` 归上游、Osuna 改叫 `usage-stats`」在术语表、Usage 文档、`docs/release.md` 各复述了一遍（"One fact, one doc"），三处都只留指向 ADR 0006 的链接。
- 判断题，**改了的**：「beta 的中间设计」「模拟冲突清单」讲的是规划分段，从「解冲突时」挪到新开的「规划分段时」；「合 v0.12 时没有要重解的文件」改成「截至 2026-10-13（上游 main 在 `b0f054de9`）…」；收了三条本机测试的坑却排除官网 vitest 那条，标准不一，把它也加进了「本机复核时」。
- 判断题，**没改的**：「模拟清单是上限」在「上游的补丁分支」与「规划分段时」各出现一次——说的是两份不同的清单（补丁分支对主线、各发布点对 main）；「打包资源要核对进包」更像「合并后核对」的一项——规格写的是补进「踩过的坑」，留在「本机复核时」。
- 事实核对：`docs/glossary.md` 里 `messages.ts:6402` 过期（改动之前就有，在被改的那一行上），**已改**成 6414；「设两个语音变量拦不住」原因未明、「变量与冒烟脚本相同」不精确——**已改**，见 Spec 第四条。

**Spec。**

- 「仓库说明里的文档表与实际一致」未满足（4 篇不在表里）——**补了三行**（`i18n.md`、`hub.md`、`timeline-sync.md`），`opencode-global-event-baseline.md` 有意没有加，理由在上面「文档」一段。这条验收项按原文仍差一篇，**交维护者定**。
- `prd.md` 把「除 PR 正文逐条列出的断言外，没有 Osuna 的断言被删除或放宽」勾早了——**已改回未勾**，PR 正文写完后再勾。
- `prd.md` 勾了「协议的现有测试无一改动断言」没有注明例外——**已注明**两处上游自己的改动。
- `docs/release.md` 写「CI 的测试看不出来」不对：Desktop Packages 的 Linux 包冒烟会核对内置插件都启动（`packaged-app-smoke.js` 的 `assertBuiltinPluginsStarted`），看不出来的只有 macOS 包——**已改**。
- 语音开关「拦不住」的原因查得到——**已改**，写进「本地出一个 macOS 包」与上面的实施记录。
- `prd.md`「补丁分支」仍写「十个文件分散在第 1 – 6 段」——**已加**工单 10 核实的更正。
- 范围蔓延两条，**保留**：「本地出一个 macOS 包」新增的隔离打开段落（规格没有要求；不带这组变量打开本机包会接管正式版的 daemon）；「分段与并入」新增的「先单独提交挪开」（ADR 0006 链接的载体，评审认为可以接受）。

**复核（只看已修的十二条，一次）。** 十一条判为已修、说法属实；文档表一条判为「如实处理、验收项仍未满足」。复核另指出一处小瑕疵，没有改：示例命令里仍带 `PASEO_LISTEN`，按同一段的说法它对 daemon 不起作用（冒烟脚本也这样设，实际生效的是 `config.json` 里的 `daemon.listen`）。

**规范更新。** `.atw/spec/` 没有要改的：本工单没有改代码，没有新的接口或约定；下次合并用得上的都在 `docs/release.md`。
