# 13 — 第七、八段：合并到上游 v0.11.1 与 v0.11.2

**What to build:** 合并分支上新增两个 merge commit，依次把上游 `ab10a6694`（v0.11.1，12 个提交）与 `759532509`（v0.11.2，3 个提交）合进来，到达这次的目标版本。合完之后 Claude 模型列表里有 Haiku 5.5，运行超过 30 秒的 Claude 工具调用不再显示成 Subagent，应用断线期间结束的 Subagent 重连后显示为已结束，daemon 重启后会话记录在别的项目目录下的 Claude 智能体仍有历史，iOS 上的文字裁切修复也在。v0.11.1 在上游 main 上，v0.11.2 在上游从 v0.11.1 分出的补丁分支上（原写两个都在从 v0.11.0 分出的补丁分支上，更正见 Comments），照常按 SHA 合并。模拟合并里 v0.11.1 新增 3 个冲突文件（都是 Claude 与 CLI 的测试），v0.11.2 没有新增。规格见 `prd.md` 的「合并方式」「补丁分支」「提供方的冲突」。

**Blocked by:** 12
**Status:** ready-for-agent
**Impl:** done

- [x] 合并分支包含两个 merge commit，第二双亲分别是 `ab10a6694` 与 `759532509`，各自独立通过下面的检查后才做下一个。
- [x] `759532509` 是合并分支的祖先；合并分支与上游 main 的共同祖先是 `ab10a6694`（v0.11.1 在上游 main 上；原写 `22488d450`，更正见 Comments）。
- [x] 每个冲突文件怎么裁的、依据哪条规则，按段记在 `## Comments` 下。规则裁决不了的没有自行取舍。
- [x] Claude：模型列表里有 Haiku 5.5；上游的三处修复对应的测试通过；Osuna 的已装版本、一键升级、CLI 启动解析对应的现有测试通过，无一改动断言。
- [x] 冲突的三个测试文件里两边的用例都在；上游的新用例调用 Osuna 改过签名的函数时，改的是调用方式，不是断言。（实际这三个文件没有冲突、自动合并，见 Comments；两边的用例都在，没有改调用方式也没有改断言。）
- [x] 每段合完：所有工作区版本号是 `0.14.2`；`CHANGELOG.md` 与合并前逐字节相同；上游没有改外部依赖的那一段，`package.json` 与 `package-lock.json` 与合并前逐字节相同。
- [x] 每段合完：`docs/release.md`「合并后核对」逐项过完，结果记在 `## Comments` 下；上游站点链接的非测试数不多于基线；新带进来的 `COMPAT(...)` 标签已改写版本号。
- [x] 每段合完：翻译资源测试通过；指令目录的现有测试通过，无一改动断言。
- [x] 每段合完：对该段冲突涉及的测试文件对比合并前后，没有 Osuna 的断言行被悄悄删掉。
- [x] 每段合完：typecheck 和 lint 通过；该段冲突文件对应的测试文件、该段新增或改动过的测试文件逐个单独跑过并通过。
- [x] 两段都推到 `origin` 后，草稿 PR 上的 CI 结果已看过并记在 `## Comments` 下。
- [x] UI：Composer 的模型选择 / Claude 智能体 / 桌面 1280 — 列表里有 Haiku 5.5。本机 Claude Code 版本不到 2.1.293 而看不到时写明版本，以模型清单的测试为证。

## Comments

### 2026-10-12 实施记录

**基线（合并前 `4c83066ff`，认领提交；代码与 `3a1487739` 相同）。** 13 个工作区版本号 `0.14.2`（含 `plugins/package.json`）；`CHANGELOG.md`、`README.md`、`package-lock.json`、19 个 `package.json`、76 个安卓商店说明共 98 个文件取了指纹；上游站点链接 `packages/app/src` 全部 73、非测试 1，`packages/cli/src` 全部 13、非测试 3（与 10 相同）；`COMPAT(...)` 标签名清单取了快照（236 个）。

#### 第七段：v0.11.1（`ab10a6694`，12 个提交）→ merge commit `9ad8ac890`（双亲 `4c83066ff`、`ab10a6694`）

- **冲突 15 个文件，全部是版本号与发版元数据（①）**：`CHANGELOG.md`、13 个 `package.json`（根、app、cli、client、desktop、expo-two-way-audio、highlight、plugin、protocol、relay、server、website、plugins）、`package-lock.json`。规格与工单预计的「3 个 Claude 与 CLI 的测试文件冲突」没有出现：`claude/agent.test.ts`、`claude/models.test.ts`、`cli/tests/15-provider.test.ts` 都自动合并了（模拟合并是对合并前的 main 做的，前六段解过之后这三处不再相撞）。
- 13 个 `package.json` 的冲突块只有版本号，取 Osuna 一侧，解完与合并前逐字节相同（`cmp`）。`CHANGELOG.md` 的 2 个冲突块取 Osuna 一侧后仍比合并前多 4 行——上游 `a59132040` 给 0.11.0 条目加的两段插件登记处说明自动合并到了冲突块之外；按「只留 Osuna 的条目」整份恢复成合并前的内容。`package-lock.json` 取合并前内容后用 `npm install --package-lock-only --ignore-scripts` 重新生成，与合并前逐字节相同（上游这一段没有改外部依赖：`git diff 22488d450 ab10a6694 -- '*package.json'` 只有版本号行）。98 个指纹全部与基线相同。
- **自动合并进来的上游改动（没有手工改一行）**：
  - Haiku 5.5：`claude/model-manifest.ts` 新增条目（`minimumClaudeCodeVersion: "2.1.293"`、1M 上下文、可关思考、默认思考档 medium），Haiku 4.5 的说明改成「Previous release」。Osuna 的花费估算价格表 `usage/pricing/snapshot.json` 里已有 `claude-haiku-5-5`，不用补。
  - 超过 30 秒的工具调用不再算作 Subagent：`claude/agent.ts` 的 `readClaudeParentToolUseId` 略过 `tool_progress` 的心跳。
  - 记录在别的项目目录下的 Claude 智能体仍有历史：`claude/project-dir.ts` 新增 `claudeTranscriptPathSync`，`agent.ts` 的 `resolveHistoryPath` 改用它。
  - 断线期间结束的 Subagent 重连后刷新：`subagents/provider-store.ts` 记下问过列表的父智能体，`contexts/session-context.tsx` 在更新流重新订阅时补拉一次。
  - 官网（`packages/website`）4 个源文件与 2 个测试；4 个新的安卓商店说明 `110011.txt` – `110014.txt`（Osuna 没有同名文件，按上游原样收下，与之前各段对 `10003x.txt` 的处理相同）；`nix/npm-deps.hash`（不追）。
- **Osuna 的断言有没有被悄悄删掉**：这一段改动的已有测试文件 8 个（另有 1 个是上游新增的 `claude-history-other-project-dir.e2e.test.ts`）。相对合并前被删的行逐行对过基点 `22488d450`——全部是基点里就有、Osuna 没碰过、上游改自己的行：`cli/tests/15-provider.test.ts` 3 行（Haiku 4.5 的说明片段、「日常模型」的断言换成 Haiku 5.5）、`claude/agent.test.ts` 1 行（假版本号 `2.1.284` → `2.1.293`）、`claude/models.test.ts` 1 行（同上）、`claude/agent.history-load.test.ts` 1 行 `import`，共 6 行；官网的两个文件 Osuna 从未改过（与基点逐字节相同），`website/src/plugins/registry.test.ts` 1 行（安装命令 `plugin install` → `plugin add`）、`website/e2e/plugins.spec.ts` 9 行（上游把「导航里还没有 Plugins」的用例改成「有」）。`agent.sub-agent-sidechain.test.ts` 与 `app/src/subagents/provider-store.test.ts` 只有新增。上游的新用例里有一处 `test.skipIf(win32 || root)`，是上游新用例自带的，没有给 Osuna 的用例加跳过。
- **合并后核对**：更新源（`publish: github / LFT-OXY / Osuna`）、桌面身份（`appId com.chinhae.osuna.desktop`、`productName Osuna`）与数据目录、签名（`mac-sign.js`、`OSUNA_MAC_SIGNING_SHA1`、`Verify macOS signature` 都在，`notarize: false`，没有 Apple 公证变量）——上游这一段没有改 `.github/`、`electron-builder.yml`、`main.ts`；四个部署工作流的 `on:` 仍只有 `workflow_dispatch`；外链四个数字与基线相同（73 / 1、13 / 3）；翻译键：这一段上游没有改翻译资源，`resources.test.ts` 通过；`COMPAT(...)`：没有新带进来的标签；daemon 自更新：涉及的文件这一段没有改动。
- **跑过并通过（本机，逐个文件）**：全仓 `npm run typecheck`（另挪开 `packages/app/.expo` 再跑一遍，同样通过，跑完放回）、`npm run lint`，merge commit 过了提交钩子（format、lint、typecheck），没有 `--no-verify`。服务端 32 个文件 677 条：`claude/` 下除 `.real.` 之外的全部 25 个文件（含本段改动的 4 个与 `agent-commands.e2e.test.ts`——取指令列表不启动进程）、上游新增的 `daemon-e2e/claude-history-other-project-dir.e2e.test.ts`、`agent/agent-manager.test.ts`（指令目录）、`agent/provider-upgrade-command.test.ts`、`agent/provider-registry.test.ts`、`session/provider/provider-catalog-session.test.ts`、`daemon-e2e/provider-upgrade.e2e.test.ts`、`daemon-e2e/provider-version.e2e.test.ts`——Claude 的已装版本、一键升级、CLI 启动解析、指令目录的用例断言未动。应用 9 个文件 164 条：`subagents/` 下 8 个（含上游改动的 `provider-store.test.ts`）与 `i18n/resources.test.ts`。官网 `packages/website/src/plugins/registry.test.ts` 13 条（按 CI 的写法从仓库根目录跑）。
- **本机没有跑的**：`packages/cli/tests/15-provider.test.ts`（CLI 的 e2e，会向本机真实的 `claude` 问版本号；沿用之前各次合并的做法交给 CI 的 cli-tests）；`packages/website/e2e/plugins.spec.ts`（官网的 Playwright，CI 的 `typecheck` 作业里「Verify website mockups」一步跑）。

#### 第八段：v0.11.2（`759532509`，3 个提交）→ merge commit `d7800df9a`（双亲 `9ad8ac890`、`759532509`）

- **冲突 15 个文件，与第七段是同一批（①）**，同样的裁法：13 个 `package.json` 取 Osuna 一侧后与合并前逐字节相同；`CHANGELOG.md` 整份恢复成合并前的内容；`package-lock.json` 重新生成后与合并前逐字节相同（上游这一段没有改外部依赖）。98 个指纹全部与基线相同。
- **自动合并进来的上游改动**：上游撤回了 #5716（iPad 聊天文字在面板改宽后重排）——删掉 `patches/react-native-uitextview+2.2.0.patch`，`scripts/postinstall-patches.mjs` 去掉对应的一项，删掉 `packages/app/e2e/mobile/native-text-reflow/` 下 3 个文件；4 个新的安卓商店说明 `110021.txt` – `110024.txt`。仓库里没有别处引用被删的文件（`rg native-text-reflow`、`rg 'react-native-uitextview\+2\.2\.0'` 无结果）。这是原生端（iOS）的修复，按规格原生端免验收。
- **这一段没有新增或改动任何测试文件**，没有 Osuna 的断言可被删。
- **合并后核对**：各项与第七段相同，逐项无变化（上游这一段没有改 `.github/`、`electron-builder.yml`、`main.ts`、翻译资源；外链 73 / 1、13 / 3；没有新的 `COMPAT(...)`）。
- **跑过并通过（本机）**：merge commit 过了提交钩子（format、lint、typecheck）；`scripts/postinstall-patches.mjs` 单独过 lint；`i18n/resources.test.ts` 41 条、`agent/agent-manager.test.ts` 202 条。

#### 两段合完之后

- `759532509` 是合并分支的祖先（`git merge-base --is-ancestor 759532509 HEAD` 成功）。八个发布点各对应一个 merge commit（`git log --merges`：`9c56f066e`、`1fb78eb97`、`64f2b95a3`、`1d1dc7545`、`5e5ea92c6`、`e57639e38`、`9ad8ac890`、`d7800df9a`）。
- **规格里的一处事实写错了：与上游 main 的共同祖先是 `ab10a6694`（v0.11.1），不是 `22488d450`（v0.11.0）。** `git merge-base HEAD upstream/main` 给出 `ab10a6694`；`git merge-base --is-ancestor ab10a6694 upstream/main` 成功，对 `759532509` 失败（对合并前抓到的 `b412374f0` 与今天的 `7321d8a48` 都一样）。也就是 v0.11.1 的发版提交就在上游 main 上，只有 v0.11.2（3 个提交）在补丁分支上。调研时把 v0.11.1 也算进了补丁分支。合并结果不受影响（两个发布点照样按 SHA 合并），受影响的只有文字：本工单的「What to build」与这条验收项、`prd.md` 的七处（问题陈述里的一句、用户故事 76、「补丁分支」、「文档」、验收清单两条、「Further Notes」）、15 的一条验收项与它要写进 `docs/release.md` 的那一节（那一节开头的「上游的补丁版本不在它的 main 上」对 v0.11.1 也不成立）。这些地方本工单都已改成实际情况，原值留在更正说明里；这是对事实的更正，不改变要做的事，已报给维护者。
- **给 15 的交接**：(1) `docs/release.md`「上游的补丁分支」按「v0.11.2 在补丁分支上、v0.11.1 在 main 上，共同祖先 `ab10a6694`」写。(2) 今天用上游自己的 v0.11.2 对上游 main（`7321d8a48`）做模拟合并（`git merge-tree --write-tree --name-only --no-messages 759532509 upstream/main`）：没有冲突文件——合 v0.12 时补丁分支这一头预计没有要重解的文件；15 动笔时按当时的上游 main 重算一次。(3) 规格预计的「3 个冲突的测试文件」实际没有冲突，PR 正文的「各段冲突裁决摘要」里第七、八段只有版本号类文件。(4) 「踩过的坑」候选：`CHANGELOG.md` 冲突块取 Osuna 一侧之后仍会多出上游在冲突块之外改的行，解完要与合并前 `cmp`，不同就整份恢复。
- **冲突文件逐个的裁决（两段相同）**：① `CHANGELOG.md`、`package.json` ×13；重新生成：`package-lock.json`。冲突之外为通过 typecheck 或测试跟着改的：没有。规则裁决不了的：没有。这两段没有适配提交。

#### UI 验收：模型菜单里有 Haiku 5.5

- 截图 `screenshots/13-composer-model-menu-claude-haiku-5-5-desktop-1280-{en,zh}.png`：新建工作区页的 Composer，提供方 Claude，模型菜单展开并滚到底，Haiku 5.5（「Fastest for quick answers」）排在 Haiku 4.5（「Previous release」）之上。
- **来源**：不是 dev 桌面端（本机真实的 Claude Code 是 2.1.296，高于门槛 2.1.293；在 dev 桌面端拍要让 daemon 去问本机真实的 `claude` 的版本与登录状态，按「不在本机动真实的 Claude 登录」的约定没有这么做，Electron 里的实看留给 14）。用 `packages/app` 下的一次性 Playwright 用例（`--project browser`，视口 1280×800，`deviceScaleFactor: 2`）对真实应用 + 隔离 daemon 拍的，拍完脚本已删。daemon 的 Claude 命令换成一个只应答 `--version`（报 `2.1.296`）与 `auth status` 的假脚本，`CLAUDE_CONFIG_DIR` 指向临时空目录，所以没有运行本机真实的 `claude`，也没有读 `~/.claude`；模型列表本身来自真实的服务端清单代码（先 `npm run build:server` 重建了 dist）。图缩到 1600 宽、256 色。模型说明文字是服务端给的英文，中文界面下也是英文，合并前的其他模型同样如此。
- 模型清单的版本门槛由 `claude/models.test.ts`「gates Haiku 5.5 on Claude Code 2.1.293 without changing the default」守着（2.1.292 没有、2.1.293 有，默认模型仍是 Opus 5.5）。

#### 评审（Standards、Spec、Visual 三个维度；评审对象是 `4c83066ff` 之后的两个 merge commit 加未提交的工单记录）

- **Standards 的硬违规（已修）：** (1) 记录写了「已把 `prd.md` 改成实际情况」而 `prd.md` 当时还没改——已改，改了哪几处写在上面。(2) `cli/tests/15-provider.test.ts` 本机没跑、CI 结果还没记——推送后补记，见下。
- **Standards 的判断项（上游原样的代码，照原样留下，不改上游的写法）：** `subagents/provider-store.ts` 的 `resyncProviderSubagents` 用 `.catch(() => undefined)` 吞掉全部错误（`docs/coding-standards.md` 要求按类型分支）；`trackedParents` 把 `serverId\0parentAgentId\0` 拼成字符串再切开；`session-context.tsx` 里这一处订阅绕开 `onFeed` 直接写 `feeds.subscribe`；`claude/agent.history-load.test.ts` 的新用例用 `test.skipIf`；`claude/project-dir.ts` 的 `isMissingDirectoryError` 用了 `as`；官网 `PLUGINS_LINKED = true` 已是恒真开关。评审核对无出入的：发版元数据的处理、ADR 0003（`listCommands` / `discoverCommands` 没有改动）、价格表里已有 `claude-haiku-5-5`、官网的 `paseo plugin add`（CLI 里 `install` 是它的别名）、被删的补丁没有残留引用。
- **Spec 报的：** (c) `prd.md` 未改——同上，已改；断言核对的数字不对（写 5 个文件 5 行，实际改动的已有测试文件 8 个、服务端与 CLI 的 4 个文件共删 6 行，漏了官网两个文件）——记录已重写，结论不变：没有 Osuna 的断言被删或放宽；`plugins.spec.ts` 所在的 CI 作业名写错——已改成 `typecheck`。(a) 「冲突的三个测试文件」那条验收项按原文不适用——验收项后面已注明；截图不是 Electron——来源与原因写在上面，**报给维护者**；CI 结果待推送后记。(b) 范围外的改动：没有。共同祖先那条的改写，评审认为是站得住的事实更正，同时指出它牵连的几处规格文字要一起改并让维护者知道——已一起改，**报给维护者**。
- **Visual：** 唯一的界面验收项通过，新增的 Haiku 5.5 一行与相邻行在图标、字色、行高、对齐上一致，没有可观察到的缺陷。评审另记了三处与本次改动无关、菜单原本就有的现象，交给 14：模型说明以型号名开头（「Haiku 5.5 · Fastest…」）并在弹层右边缘之前约 68 逻辑像素处就截断；列表滚到底时最后一行下方留白约 31、顶部只有约 5；中文界面里 Composer 的「Medium」「Auto mode」与侧栏的「now」是英文。
- **复查（只查已修的三条，一次）：** `prd.md` 与工单 13、15 里说共同祖先与补丁分支的句子逐条 `grep` 过，没有残留的旧说法；断言行数与文件数对照补丁重数过；CI 作业名对照 `.github/workflows/ci.yml` 第 126 – 133 行。
- **规范更新：** `.atw/spec/` 没有要改的——这两段没有手工改代码，没有新的约定；下次合并用得上的两条（`CHANGELOG.md` 冲突块之外的自动合并、模拟合并数字会随前面各段变化）记在给 15 的交接里，由 15 写进 `docs/release.md`。

#### 推送后的 CI（草稿 PR #16）

- **推送的提交 `55f2e92a0`（两个 merge commit 加记录），CI run 38253415392：**
  - 第一轮：21 项里 20 项通过（format、lint、typecheck、app-tests、server-tests 的 ubuntu 与 macos-14、desktop-tests 两个平台、cli-tests 三片、sdk-tests、relay-tests、changes、playwright 四片）；`server-tests (windows-latest)` 红，6628 条里 1 条失败——`src/utils/worktree.test.ts`「branches from the cached ref when the remote accepts but never answers」在 `afterEach` 清理临时目录时报 `EBUSY: resource busy or locked, rmdir …\worktree-manager-test-…\test-repo`。这条用例与 `packages/server/src/utils/` 这两段都没有改动，是上游原样的用例在 Windows 上清理临时目录的时序问题（之前各段没有出现过），记给 15 并入前看。
  - 第二轮（`gh run rerun --failed`，只重跑失败的那一项）：`server-tests (windows-latest)` 通过，整轮结论 success。
  - 同一提交上的 Desktop Packages（run 38253415413）通过。
- **本机没跑、由 CI 覆盖的两个文件：** `packages/cli/tests/15-provider.test.ts` 在 cli-tests 里通过（模型清单里有 Haiku 5.5）；`packages/website/e2e/plugins.spec.ts` 在 `typecheck` 作业的「Verify website mockups」一步里通过。上游新增的 `claude-history-other-project-dir.e2e.test.ts` 与本段改动的其余测试文件在 server-tests、app-tests 里通过。
- **首跑失败、重试后通过的：** playwright 第 1 片 1 条——`agent-timeline-scroll-smoothness.spec.ts:137`（之前各段每轮都是它，09 记给 15 的那条）；第 2、4 片没有重试；第 3 片结论是通过，它的日志用 `gh run view --job … --log` 取了两次都是空内容，重试清单没有取到。之前各段记过的其余几条这一轮在第 1、2、4 片里都是一次通过。
