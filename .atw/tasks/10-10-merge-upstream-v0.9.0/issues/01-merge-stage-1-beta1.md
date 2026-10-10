# 01 — 第一段：合并到上游 v0.9.0-beta.1

**What to build:** 一条从 main 开出的合并分支，上面有一个把上游 `7c1958f5b`（v0.9.0-beta.1，基点之后的前 15 个提交）合进来的 merge commit。合完之后 Osuna 多出上游这一段的功能——PR 标签页自动打开、待上传附件显示、插件的跨主机与 npm 安装能力、输入框布局稳定、从输入框打开聊天查找、桌面端 daemon 管理省内存、逐字流式输出——而 Osuna 自己的功能和有意做的决定都在。这一张只负责"合进来并且能编译、冲突文件的测试能过"；上游新界面的中文、外观、外链等适配在 02。规格见 `prd.md` 的「合并方式」「冲突裁决规则」「版本号与发版元数据」「外链与 `ExternalLink` 组件」「协议」；冲突清单见 `research/discovery.md`。

**Blocked by:** None — can start immediately
**Status:** ready-for-agent
**Impl:** done

- [x] 新增名为 `upstream` 的 remote 指向上游仓库，并配置为不抓取 tag；合并前后本地 tag 列表不变，没有混入上游 tag。
- [x] 合并前统计一次应用与 CLI 源码中指向上游站点的链接数，记在本工单的 `## Comments` 下，作为 02 与 06 的基线。
- [x] 合并分支从当前 main 开出，包含一个以 main 与 `7c1958f5b` 为双亲的 merge commit。
- [x] 所有冲突按 `prd.md` 的三条裁决规则处理。每个代码冲突文件怎么裁的、依据哪条规则，逐个记在 `## Comments` 下，供 05 写文档和 06 写 PR 正文用。
- [x] 规则裁决不了的冲突没有自行取舍：已停下来问过维护者，问答记在 `## Comments` 下。
- [x] 所有工作区版本号仍是 `0.14.2`；上游对依赖项的改动已收进各 `package.json`；`package-lock.json` 是重新生成的，不是手工合并的。
- [x] `CHANGELOG.md` 不含上游的 0.9.0 系列条目；`README.md` 是 Osuna 的版本。
- [x] 更新源配置仍指向 `LFT-OXY/Osuna`；只在 fork 下手动触发的部署工作流触发条件未变。
- [x] 协议里两边新增的消息与字段都在，新字段都是可选的，没有收窄、删除或改成必填；`server_info.features` 里两边新增的能力开关都在。
- [x] 通用外链组件按规格处理：上游代码需要它才恢复，恢复后没有带回已删除的上游文档站、Sponsor、Discord 入口。
- [x] Osuna 原有的测试没有被删除、跳过或放宽断言。
- [x] typecheck 和 lint 通过。
- [x] 本段每个代码冲突文件对应的测试文件单独跑过并通过。
- [x] 合并分支已推到 `origin`，并开出指向 main 的草稿 PR（推送与开 PR 前先向维护者说明并取得同意）。

## Comments

### 准备

- `upstream` remote：`https://github.com/getpaseo/paseo.git`，`remote.upstream.tagOpt = --no-tags`。抓取前后 `git tag` 输出逐行相同（14 个，全是 Osuna 自己的）。
- 合并分支就是任务登记的 `identify-fork-base`，开工时与 main 同在 `d38d186bd`。merge commit 是 `503a3e7cb`，双亲 `d38d186bd`（main）与 `7c1958f5b`。

### 上游站点链接基线（合并前，main `d38d186bd`）

口径：只数网址，不数 `@getpaseo/*` 包名和 `getPaseo…` 这类标识符。

```bash
PAT='(https?://|www\.)[^"'"'"'`\s)]*(paseo\.sh|getpaseo|discord\.gg|discord\.com|github\.com/sponsors|opencollective)|(^|[^@/\w.-])(app\.|docs\.)?paseo\.sh'
rg -n -i "$PAT" packages/app/src            # 全部
rg -n -i "$PAT" packages/app/src -g '!*.test.*' -g '!*.spec.*'   # 非测试
```

| 范围 | 全部命中行 | 非测试命中行 |
| --- | --- | --- |
| `packages/app/src` | 71 | 1 |
| `packages/cli/src` | 13 | 3 |

非测试的 4 处：`pair-link-modal.tsx` 的占位符 `https://app.paseo.sh/#offer=...`、CLI `onboard.ts` 的 Web app 地址、CLI `hub/authority.ts` 与 `hub/help.ts` 的 `https://hub.paseo.sh`。

第一段合并后：app 非测试 2（多出下面这一处），其余三个数字不变。

- **留给 02**：`packages/app/src/screens/settings/plugins-page.tsx` 的 `PLUGIN_SOURCE_DOCS_URL = "https://paseo.sh/docs/plugins/reference#plugin-sources"`，由插件安装表单旁的 `ExternalLink`（`testID="plugin-source-docs-link"`）承载。这是上游新代码里的新链接，不是 Osuna 删过的入口。

### 冲突裁决（33 个文件）

机械性 15 个：

| 文件 | 裁决 | 规则 |
| --- | --- | --- |
| 12 个 `package.json` | 冲突块全是版本号，取 Osuna 的 `0.14.2`；冲突块之外上游的依赖改动照收（server 新增 `semver`、一批 `exports` 子路径；app 去掉 `unicode-segmenter`；website 新增 `test:e2e`） | 版本号与发版元数据 |
| `package-lock.json` | 冲突块取 Osuna 一侧后跑 `npm install --package-lock-only` 重新生成；相对 main 只多出 `semver@7.8.5`、少了 `unicode-segmenter` | 同上 |
| `CHANGELOG.md` | 与 main 逐字节相同 | 同上 |
| `README.md` | 冲突块取 Osuna。冲突块之外上游改了一行（插件安装命令写成 `paseo plugin install`，并提到 npm），保留了：合并后 `install` 是主命令、`add` 是别名，这一行与代码一致 | 同上；那一行按规则 3 |

代码与文档 18 个：

| 文件 | 裁决 | 规则 |
| --- | --- | --- |
| `packages/protocol/src/plugin-requirements.ts` + `.test.ts` | 取 Osuna：报错文案不带上游迁移指南网址 | 1（外链只指向本仓库，`584c270bb`） |
| `packages/server/src/server/plugins/runtime.ts` | 同上 | 1 |
| `packages/server/src/server/plugins/{index,requirements,runtime}.posix.test.ts` | 同上，断言跟着 Osuna 的文案 | 1 |
| `packages/app/src/plugins/registry-requirements.test.ts` | 同上 | 1 |
| `packages/protocol/src/messages.ts` | 上游把插件、技能选择、Agent profile、终端 profile 的 schema 挪到独立模块并从 `messages.ts` 重新导出，照收；Osuna 夹在同一段里的用量配置 schema（`MutableUsage*`）留在原处 | 3 |
| `packages/server/src/server/persisted-config.ts` | 用上游的新导入路径，补回 Osuna 的 `UsagePricingOverrideSchema` 导入 | 3 |
| `packages/app/src/stores/workspace-layout-storage.ts`、`workspace-layout-store.ts` | 两边各加一个持久化字段，都留：Osuna 的 `explorerSidebarSeededTabKindsByWorkspace`、上游的 `pullRequestTabAutoOpenedByWorkspace` | 3 |
| `packages/app/src/components/settings/index.tsx` | 取上游新增的 `labelRow` / `accessoryLabel` 样式；Osuna 的 `typeScale` 字号已自动合上 | 3 |
| `packages/app/src/screens/settings/plugins-page.tsx` | 取上游的新结构（`SettingsCard` / `SettingsRow` / 开关 / 操作菜单）。这两个原语建在 Osuna 的 `settingsStyles` 上，卡片圆角、行高、行分隔自动是 Osuna 的外观；Osuna 为行分隔加的 `isFirst` 因此不再需要，已去掉。Osuna 的 `t("settings.plugins.states.offlineTitle")` 保留 | 3（外观由共享样式保住；逐项对齐在 02） |
| `packages/app/src/composer/index.tsx` | 上游去掉 `KeyboardTranslateView` / `externalKeyboardShift`，照收；Osuna 的上下文窄条相关导入保留。附件托盘：保留 Osuna 的 `ComposerAttachmentTray`，把上游的"待上传文件"胶囊放进去，有已选附件或待上传文件时都显示 | 3 |
| `packages/app/src/composer/draft/workspace-tab.tsx` | 取上游的 `ComposerDock` 结构，补回 Osuna 的 `showContextStrip` | 3 |
| `packages/app/vitest.config.ts` | `exclude` 合并两边：上游的 `react-native-keyboard-controller` 与 Osuna 的 `expo-file-system` | 3 |
| `packages/app/src/components/ui/external-link.tsx` | Osuna 删、上游改 → 恢复为上游版本。两处上游代码需要它：`plugins/react-native/ui.ts` 把它导出给插件；`plugins-page.tsx` 的文档链接（见上，留给 02）。没有恢复 `584c270bb` 删掉的任何入口 | 外链与 `ExternalLink` 组件 |
| `docs/data-model.md` | `plugins/` 两行用上游的新描述，Osuna 新增的 `api-endpoints/`、`usage/` 等目录保留 | 3 |

没有遇到规则裁决不了的冲突，没有需要问维护者的取舍。

### 冲突之外的三处手工改动

git 没报冲突，但自动合并的结果不对或与 Osuna 的决定相撞：

- `packages/server/src/server/agent/plugin-provider.test.ts`：两边都给测试辅助对象加了 `emit`，自动合并后重复一份，lint 报 `no-dupe-keys`。删掉重复的那一行。
- `packages/app/src/i18n/resources/plugin-settings.ts` + `resources.test.ts`：上游把 `settings.plugins.directoryPlaceholder` 换成 `sourcePlaceholder` 并从各语言删掉旧键；Osuna 的 zh-CN 区块是展开写的（`7bee6ed1b`），旧键被留了下来。删掉 zh-CN 的旧键和允许清单里对应的一条（清单测试要求不留失效项，是收紧不是放宽）。上游这一段新增的翻译键九种语言都已自带，zh-CN 是真实翻译。
- `packages/app/src/workspace-tabs/open-supporting-view.test.ts`（上游新测试，改了两条预期）：上游断言 Explorer 的标签列表时没有 `session_history`。Osuna 的会话历史是 Explorer 默认标签（PRD 用户故事 22），所以预期改为包含它：`[files, changes_tree, pull_request, session_history, terminal]` 与 `[files, session_history, pull_request]`。被测行为没变——PR 仍插在 Changes 之后、Changes 关掉时追加在末尾。**06 写 PR 正文时要列这一条。**

### 核对

- 版本号：12 个 `package.json` 全是 `0.14.2`；暂存区新增行里出现 `0.9.0` 的只有一条上游测试的断言文本。
- 更新源：`packages/desktop/electron-builder.yml` 的 `owner: LFT-OXY` 未变。`.github/workflows/` 下只有 `ci.yml` 变了（上游新增官网样机检查两步），部署与发版工作流没有改动。
- 协议：加进既有 schema 的字段全是 `.optional()`；必填字段只出现在全新的消息与 schema 里。`server_info.features` 里上游的 `pluginSourceInstallation`、`pluginSourceUpdates` 与 Osuna 的 `agentMentions`、`providerVersions` 都在。
- 测试没有被删或跳过：合并删除的 41 个文件与 Osuna 自基点以来改过或新增的文件没有交集；测试文件的新增行里没有 `.skip` / `.only` / `.todo`。
- `nix/npm-deps.hash` 自动合成了上游的值，没有追（PRD：Nix 哈希不追）。

### 运行记录（2026-10-10，本机，合并提交之前）

本工作树没有 `packages/app/.expo`，也没有任何 `.vite` 预构建缓存，PRD 提到的两种本机掩盖不存在。

- `npm run build:server`：通过（protocol、client、server、CLI 的声明已按合并后的源码重建）。
- `npm run typecheck`：通过，0 个错误。三处手工改动之后重跑过一次。
- `npm run lint`：0 警告 0 错误（第一次报 `plugin-provider.test.ts` 的重复键，见上）。`npm run format:check`：通过。
- 冲突文件对应的测试，逐个文件跑：
  - protocol（先 `generate:validators`）：`messages.test.ts`、`messages.plugins.test.ts`、`messages.wire-compat.test.ts`、`messages.usage.test.ts`、`messages.agent-skills.test.ts`、`messages.providers-snapshot.test.ts`、`plugin-requirements.test.ts`、`plugin-source-reference.test.ts` —— 8 个文件 152 条通过。
  - server：`persisted-config.test.ts`、`persisted-config-edit.test.ts`、`plugins/index.posix.test.ts`、`plugins/requirements.posix.test.ts`、`plugins/runtime.posix.test.ts`、`agent/plugin-provider.test.ts` —— 6 个文件 119 条通过。
  - app：`plugins/registry-requirements.test.ts`、`screens/settings/plugins-page.test.tsx`、`plugins-page-state.test.ts`、`plugin-install-form-model.test.ts`、`composer/draft/workspace-tab.test.ts`、`stores/workspace-layout-store.test.ts`、`workspace-tabs/open-supporting-view.test.ts`、`i18n/resources.test.ts`、`composer/forge-auto-attach.test.tsx`、`composer/submit.test.ts`、`composer/actions.test.ts` —— 全部通过（`open-supporting-view` 与 `resources` 是在上面三处手工改动之后通过的）。
  - app 浏览器 e2e：`e2e/browser/composer-attachments.spec.ts` —— 10 条通过，1 条是基点起就标着 `test.fixme` 的。覆盖手工合并的附件托盘，含上游新增的"上传确认前显示待上传附件"。
- 两边都改过、git 自动合上的文件，补跑了对应测试：CLI `plugin/scaffold.test.ts`、`plugin/index.test.ts`（34 条）；client `daemon-client.test.ts`（142 条）；desktop `daemon/daemon-manager.test.ts`（4 条）；server `authorization/index.test.ts`、`config.test.ts`、`config-plugins.test.ts`、`websocket-server.notifications.test.ts`、`websocket-server.origin.test.ts`、`plugins/managed-source.posix.test.ts`、`plugins/manifest.test.ts`（52 条）。全部通过。
- 整套测试没有在本机跑（仓库规则与 PRD：整套交给 CI）。草稿 PR 开出后看 CI。

### 评审（`atw-code-review`，Standards 与 Spec 两轴；无截图，Visual 轴未跑）

- Standards：没有硬违规。判断题两条，照规则原样提交并上报：`composer/index.tsx` 里上游的 `ThemedAttachmentSpinner` 与 Osuna 的 `ThemedLoadingSpinner` 是同一个 `withUnistyles(LoadingSpinner)`（合并成一个要改上游的行，会给以后的合并多一处冲突面）；`ComposerAttachmentTray` 的 `hasAttachments` 现在也涵盖待上传文件，注释没提。
- Spec：没有实质偏离。两条已处理：本节之上的运行记录是评审后补的；验收项在关票时逐条勾。一条留给 06：`README.md` 多留的那行上游改动让英文版与 `README.zh-CN.md` / `README.ja.md` / `README.ko.md` 第 36 行（仍写 `plugin add`、"本地目录或 Git"）不一致，PR 正文里列出。

### 给后续工单

- 02：上游这一段带进来的 `COMPAT(...)` 标签写的是上游版本号，例如 `messages.ts` 里的 `COMPAT(pluginSourceInstallation): added in v0.8.0`、`COMPAT(pluginSourceUpdates): added in v0.8.0`。用 `git diff d38d186bd 503a3e7cb | rg '^\+.*COMPAT\('` 列全。
- 05：值得写进文档的坑——上游 tag 与本地同名；`package.json` 冲突只取版本号那一块、别整文件取 Osuna（会丢上游的依赖改动）；自动合并不报冲突但会出错的三类（两边加同名字段、展开写的 zh-CN 区块留下上游已删的键、上游新测试不知道 Osuna 的默认标签）。

### 推送与草稿 PR

- 维护者 2026-10-10 同意后推送 `identify-fork-base`，开出草稿 PR：https://github.com/LFT-OXY/Osuna/pull/13 （base `main`）。只推了这一条分支，没有推 tag。
- 坑：加了 `upstream` remote 之后，`gh` 会把默认仓库解析成 `getpaseo/paseo`，`gh pr create` 第一次因此失败（没有建出任何东西）。已执行 `gh repo set-default LFT-OXY/Osuna`；之后的 `gh` 命令仍建议显式带 `--repo LFT-OXY/Osuna`。05 写文档时收进去。
