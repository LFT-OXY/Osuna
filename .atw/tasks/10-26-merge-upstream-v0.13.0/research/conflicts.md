# 合并上游 v0.12.0 – v0.13.0：冲突摸底

2026-10-26 在 worktree `pale-manatee`（HEAD = main = origin/main = `b8d4f55e7`，Osuna 0.17.0）上核实。
数据来自 `git merge-tree --write-tree` 的模拟合并与 `git diff`、`git log`、`git grep`，没有改动工作区。
做法沿用 `docs/release.md`「从上游同步」，这里只记这一次特有的事实。

## 同步点与范围

- 当前同步点：上游 v0.11.2（`759532509`），由 `d7800df9a` 并入 main。它在上游的补丁分支上，
  `git merge-base main d34d17a90` = v0.11.1（`ab10a6694`）。
- 目标：上游 v0.13.0（`d34d17a90`，2026-10-24）。`759532509..d34d17a90` 共 328 个上游提交。
- upstream/main 目前在 `902b0c7a1`，v0.13.0 之后的提交不在范围内。

| 段  | 上游发布点     | 提交        | 本段上游提交数 | 本段改动文件数 | 对 main 的累计冲突文件数 | 本段首次出现的冲突文件数 |
| --- | -------------- | ----------- | -------------- | -------------- | ------------------------ | ------------------------ |
| 1   | v0.12.0-beta.1 | `e2f4948f9` | 165            | 827            | 97                       | 97                       |
| 2   | v0.12.0-beta.2 | `c517d07d6` | 27             | 133            | 109                      | 12                       |
| 3   | v0.12.0-beta.3 | `cc748dfe1` | 22             | 125            | 122                      | 13                       |
| 4   | v0.12.0        | `cafe4b01c` | 22             | 96             | 130                      | 8                        |
| 5   | v0.13.0-beta.1 | `3fa625701` | 52             | 946            | 180                      | 51                       |
| 6   | v0.13.0-beta.2 | `30d8cb044` | 27             | 411            | 199                      | 19                       |
| 7   | v0.13.0        | `d34d17a90` | 13             | 73             | 204                      | 5                        |

第 1 段的提交数与改动文件数从 v0.11.2 起算（`759532509..e2f4948f9`），含 v0.11.1 之后主线上的全部提交。
累计冲突数是各发布点分别对当前 main 模拟的结果，逐段实做时会少报（见 `docs/release.md`「踩过的坑」）。
首次出现数之和是 205，比 204 多 1：`file-pane/markdown-preview/index.tsx` 在第 1–4 段冲突，第 5 段上游把
`file-pane/` 改名为 `file-panels/` 后变成 `file-panels/markdown-preview/index.tsx`，按新路径又记一次。

各段冲突类型：

| 段  | content | modify/delete | add/add | file location |
| --- | ------- | ------------- | ------- | ------------- |
| 1   | 92      | 5             | 0       | 0             |
| 2   | 104     | 5             | 0       | 0             |
| 3   | 117     | 5             | 0       | 0             |
| 4   | 121     | 5             | 4       | 0             |
| 5   | 153     | 10            | 4       | 13            |
| 6   | 171     | 11            | 4       | 13            |
| 7   | 172     | 11            | 8       | 13            |

第 2–7 段首次出现的文件（第 1 段 97 个用 `git merge-tree --write-tree --name-only --no-messages main e2f4948f9` 重算）：

- 段 2：`launcher-tab.spec.ts`、`agent-stream/view.tsx`、`sidebar-nav-rows.tsx`、ar/fr/ja/ko/ru 五个语言资源、
  `new-workspace-screen.tsx`、`open-project-screen.tsx`、`opencode/bridge-plugin.mjs`、`agent/tools/paseo-tools.ts`。
- 段 3：`usage-login.ts`（e2e 辅助）、mermaid 的 `host.web.tsx` 与 `presentation.ts`、`composer/draft/workspace-tab.tsx`、
  `usage/` 下 `card.tsx`、`format.ts`、`format.test.ts`、`model.ts`、`window-bar.tsx`、`messages.wire-compat.test.ts`、
  `mcp-server.test.ts`、`plugins/usage-sources/index.ts` 与测试。
- 段 4：`docs/design.md`、安卓商店说明 `120001–120004.txt`（add/add）、`provider-icons.test.ts`、`subagents/select.ts` 与测试。
- 段 5：Explorer 与文件面板一批（见下文）、`usage/` 下 8 个、`adaptive-modal-sheet.tsx`、`add-host-modal.tsx`、
  `status-ring/clock.ts`、`data/push-router.ts` 与测试、`git/use-diff-query.ts`、`keyboard/shift/internal/policy.ts`、
  `plugins/themes/index.ts`、`runtime/host-runtime.ts`、`sidebar-nav-section.tsx`、`use-workspace-tab-layout.ts`、
  `workspace-desktop-tabs-row.tsx`、`panel-store/state.ts`、`workspace-tabs/explorer-sidebar.ts`、
  `test-stubs/react-native-unistyles.ts`、`packages/app/vitest.config.ts`、`client/src/daemon-client.ts`、
  `agent-projections.ts`、`create-agent/create.ts`、`checkout-diff-manager.ts`、`websocket-server.ts`，3 个 e2e。
- 段 6：`docs/glossary.md`、`docs/release.md`、`terminal-emulator.tsx`、`terminal-copy-paste-actions.tsx`、
  `terminal-emulator-webview-html.ts`（modify/delete）、`autocomplete-popover.tsx`、en/es/pt-BR 资源、`panels/file-panel.tsx`、
  `plugins/workspace-panels/panel.tsx`、`workspace-tab-presentation.tsx`、`selectors.test.ts`、`claude/agent.test.ts`、
  `server/bootstrap.ts`、`session-admission-auth.ts`，3 个 e2e 文件。
- 段 7：安卓商店说明 `130001–130004.txt`（add/add）、`settings-toggle-tab-regression.spec.ts`。

上游 beta 里出现、到 v0.13.0 又删掉的文件只有 6 个：`components/markdown/frame.tsx`、`file-panels/choice/switcher*`
（3 个）、`file-panels/source/status.tsx`、`protocol/src/agent-message-display.ts`。没有像 v0.11 `/usage` 页那样
整块的中间设计。

## 补丁分支

- 上游 v0.11.3（`dd25057bb`）、v0.11.4（`dc5b02f7d`）都不在 upstream/main、v0.12.0、v0.13.0、Osuna main 上。
  它们在 v0.11.2 之后的同一条补丁分支上（`759532509 → … → dd25057bb → … → dc5b02f7d`）。
- 补丁分支上的 4 个修复在主线都有 patch-id 相同的提交，全部落在第 1 段（v0.12.0-beta.1 之前）：

  | 补丁分支                                                          | 主线等价提交 |
  | ----------------------------------------------------------------- | ------------ |
  | `cb86d02bd` only offer Remove for providers defined in config.json (#6568) | `e8108d909`  |
  | `5d6a6bda1` add opt-in Hoplite and searchable provider grid (#6953) | `16bb179e6`  |
  | `84c023944` Refine provider catalog buttons…as toasts (#7030)     | `2d86b94b2`  |
  | `4ceebd62f` scope project-dependent model discovery to workspaces | `7aa3fac06`  |

  两个 changelog 提交主线另有对应（`ce0f21e2f` patch-id 相同，`b30302b63` 同名不同内容）。Osuna main 里按标题
  搜不到这 4 个修复，`plugins/hoplite-provider` 也不在 main 上；合主线时一并进来，不用另合 v0.11.3/v0.11.4。
- 按 `docs/release.md` 的命令重算分叉处要重解的文件：
  `git merge-tree --write-tree --name-only --no-messages 759532509 e2f4948f9` 给出 16 个，对 v0.12.0、v0.13.0
  结果相同，上游自己的 v0.11.4 对 v0.12.0-beta.1 也是这 16 个：`CHANGELOG.md`、`package-lock.json`、13 个
  `package.json`（根、app、cli、client、desktop、expo-two-way-audio、highlight、plugin、protocol、relay、server、
  website、plugins）、`scripts/postinstall-patches.mjs`。16 个全在第 1 段对 main 的 97 个里。
  - 前 15 个是版本号，按「版本号与发版元数据」处理。
  - `postinstall-patches.mjs`：v0.11.2 撤掉 `react-native-uitextview` 补丁块，主线 #6445 删了同一块，#6973
    （`eb1a8a2ec`）又把紧挨着的 `react-native-markdown-display` 换成 `react-native-enriched-markdown`、加了
    `@gorhom/bottom-sheet`。Osuna 同步后没改过这个文件，取主线一侧即可。
  - `docs/release.md` 里「截至 2026-10-13 … 合 v0.12 时没有要重解的文件」已不成立，合完这一节要改写。

## 模拟合并的冲突（合到 v0.13.0）

204 个文件。类型：content 172、file location 13、modify/delete 11、add/add 8。冲突块共 426 个。
完整清单用 `git merge-tree --write-tree --name-only --no-messages main d34d17a90` 重算。
Osuna 自同步（`d7800df9a`）以来改过的文件占其中 81 个，其余 123 个是 Osuna 更早改过、上游这期又动了的。

按区域：

| 区域                                                                  | 文件数 |
| --------------------------------------------------------------------- | ------ |
| `packages/app/src` 其余（git、panels、plugins、stores、styles 等）    | 32     |
| `app/src/components`（不含 Markdown）                                 | 28     |
| `server/src/server/agent`                                             | 16     |
| `app/e2e`                                                             | 16     |
| `app/src/file-pane` → `file-panels`                                   | 15     |
| 各 `package.json` 与 `package-lock.json`                              | 14     |
| `app/src/usage`（套餐用量）                                           | 13     |
| `app/src/screens`                                                     | 12     |
| server 其余（bootstrap、session、websocket-server、terminal 等）      | 11     |
| `app/src/i18n/resources`（九种语言全冲突）                            | 9      |
| 安卓商店说明（add/add，`120001–120004`、`130001–130004`）             | 8      |
| `app/src/composer`                                                    | 7      |
| 根目录文档（CHANGELOG、CLAUDE.md、四份 README）                       | 6      |
| `docs`（agent-lifecycle、design、explorer-sidebar、glossary、release）| 5      |
| Markdown 渲染（`components/markdown`、`styles/markdown-styles*`）     | 5      |
| protocol / client                                                     | 4      |
| app 配置（`vitest.config.ts`、`test-stubs`）、`postinstall-patches.mjs` | 3      |

冲突块最多的 15 个文件（首次冲突段）：

| 块  | 文件                                                     | 段  |
| --- | -------------------------------------------------------- | --- |
| 22  | `package-lock.json`（不手工合并）                        | 1   |
| 19  | `app/src/composer/input/input.tsx`                       | 1   |
| 12  | `app/src/screens/workspace/workspace-desktop-tabs-row.tsx` | 5   |
| 12  | `app/src/screens/settings-screen.tsx`                    | 1   |
| 12  | `app/src/components/provider-catalog-list.tsx`           | 1   |
| 10  | `server/src/server/agent/agent-manager.ts`               | 1   |
| 10  | `app/src/components/question-form-card.tsx`              | 1   |
| 8   | `app/src/screens/workspace/workspace-screen.tsx`         | 1   |
| 7   | `app/src/i18n/resources/zh-CN.ts`                        | 1   |
| 7   | `app/src/file-pane/pane.tsx`                             | 1   |
| 6   | `app/src/screens/workspace/scripts/workspace-scripts-button.tsx` | 1 |
| 6   | `app/src/components/sidebar/sidebar-header-row.tsx`      | 1   |
| 6   | `app/src/components/left-sidebar.tsx`                    | 1   |
| 5   | `server/src/server/agent/create-agent/create.ts`         | 5   |
| 5   | `server/src/server/agent/agent-prompt.ts`                | 1   |

其后是 `usage/window-bar.tsx`、`providers-section.tsx`、`panels/agent-tracks.tsx`、`git/use-working-diff.ts` 各 5 块；
`protocol/src/messages.ts`、`client/src/daemon-client.ts`、`workspace-layout-store.ts`、
`sidebar-workspace-row-content.tsx`、`mermaid/host.web.tsx`、`README.zh-CN.md` 各 4 块；其余八种语言资源各 2–3 块。
`server/bootstrap.ts` 在第 6 段冲突：CI 规则要求它不出现提供方名字，解完要过那条检查。

## 一边删一边改的

上游删、Osuna 改（9 个 modify/delete）：

| 文件                                                         | 上游删除（段）                                                                                                          | Osuna 的改动                                                                                 |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `styles/markdown-styles.ts`、`.test.ts`                      | `eb1a8a2ec` #6973（段 1）：iOS、Android、Web 统一用 react-native-enriched-markdown 一个渲染器                             | `dc38236f6` 对话流代码块加语言标签头与复制按钮                                               |
| `components/markdown/fence/language.ts`                      | 同上 #6973（段 1）                                                                                                      | `a1c8b7a1c` Markdown 预览代码块按语法主题着色、语言图标                                      |
| `components/file-pane-render-mode.ts`、`.test.ts`            | `1e0e56c72` #7366（段 5）：内置文件面板的选择收拢到 `file-panels/`                                                       | `05a95f365` 逻辑图：节点文档在预览里定位                                                     |
| `components/compact-explorer-sidebar.tsx`、`-host.tsx`、`stores/explorer-tab-memory.ts` | `adf27de7d` #7424（段 5）：手机、平板、桌面用同一套 Explorer                                       | `8ba86ec6d` 等：会话历史视图、`ec04b11dd` Explorer 新外观、`6bb673f4e` 去分割线               |
| `terminal/webview/terminal-emulator-webview-html.ts`         | `6376f2bf4` #7639（段 6）：去掉 WebView 终端渲染器，Web 用 xterm、移动端用原生网格                                        | `7afe67c1a` 统一默认等宽栈（打包产物，按规矩应重新生成；上游连生成脚本一起删了）            |

Osuna 删、上游改（2 个）：`composer/input/height.native.ts`、`height.web.ts`。Osuna 在 `479448bc5` 把 Web/Electron 的
Composer 输入换成 Tiptap，删了 textarea 测高与整个 `height.*` 模块（原生端也一并删了）；上游在 `750cb82fb` #6531（段 1，
手机端 Composer 全屏编辑）给它加了 `onRenderedLinesChange`、`presentationKey`，v0.13.0 的 `input.tsx` 仍
`import { useComposerHeight } from "./height"`。`input.tsx` 的 19 个冲突块也出自这里。

file location（13 个，段 5）：Osuna 在 `file-pane/markdown-preview/` 新增的 13 个文件（`452fadfcb` 起的 Web DOM 渲染
预览：GFM、提示块、代码块着色、相对路径图片、仓库内链接 chip、行号定位），上游把目录改名为 `file-panels/` 后 git 建议
跟着搬过去。`file-pane/pane.tsx`、`tree-toggle.tsx` 上游没搬，留在 `file-pane/`。

## 两边各做了一套的地方

- **Markdown 文件预览**：上游 #6750（段 1）预览本地图片、#7538（段 5）按文档解析链接、#7614（段 6）给 Markdown/HTML
  标签加回 Preview/Source 切换，都基于 RN 的 `MarkdownRenderer`。Osuna 在 Web 端另做了 DOM 渲染（`index.web.tsx`），
  相对图片（`a0e70b59d`）、仓库内链接（`b537dd2e1`）、行号定位各有一份。Web 端会优先解析 Osuna 的 `index.web.tsx`，
  上游这几项改在 `index.tsx` 上，Web 端不生效。
- **对话流 Markdown**：上游 #6973 换成 enriched-markdown 并删了 `markdown-styles.ts`；Osuna 的代码块标签头、复制按钮、
  语法着色挂在被删的文件上。
- **Explorer**：上游 #7424 重做 Explorer 并删了紧凑布局的侧栏与标签记忆；Osuna 的会话历史标签接在被删的文件里。
- **终端**：上游 #7639 去掉 WebView 渲染器；Osuna 的终端主题派生 ANSI、2031 主题推送、视图属性
  （`terminal/view-attributes.ts`、`terminal-contrast.ts`）在 Web 的 xterm 运行时上还在，移动端原来走 WebView 那条路，
  要看上游的原生网格是否接得上。
- **中继密码**：上游 #7668（`89727f43b`，段 6）要求中继连接也带 daemon 密码，并删掉了 `COMPAT(relayPasswordOptional)`
  分支；Osuna 在 `0cfd79d03` 保留这条免密分支、标签写的是 `v0.15.0`。冲突块是「Osuna 留分支 / 上游删掉」。

## 补丁分支以外的版本元数据

- 安卓商店说明 add/add 8 个：Osuna 自己发过 0.12.0、0.13.0，文件名相同，留 Osuna 的。
- 上游新增 `CHANGELOG.zh-CN.md`（`bd15e40e9` #7373），main 上没有；按规矩 CHANGELOG 归 Osuna，要定是否收下这份新文件。
- `README.md`、`README.ja.md`、`README.ko.md`、`README.zh-CN.md`、`CLAUDE.md`、`docs/release.md` 冲突，按已有规矩取 Osuna 一侧。

## 上游触及的敏感文件

`759532509..d34d17a90` 上游改了：

- `packages/desktop/electron-builder.yml`（+2，`b852ae920` #6645）：Linux `extraResources` 加 `assets/icon.png`。自动合并，
  模拟结果里 `appId: com.chinhae.osuna.desktop`、`productName: Osuna`、`publish` 指向 `LFT-OXY/Osuna` 都在。
- `packages/desktop/src/main.ts`（+6/-2，`14e638451` #6639、`9551b2cc1` #6726）：开头调用 `protectConsoleStreams()`，
  `ready-to-show` 换成 `showWindowWhenReady`（Linux 隐藏渲染卡住时也打开窗口）。自动合并，userData 固定在 `Paseo` 的
  那段不受影响。
- `.github/workflows/ci.yml`（+176/-90，自动合并）：format 与 lint 合成 `quality`；Playwright 从 4 片改 8 片；Windows
  拆出 `server-integration-windows`；去掉 `sdk-tests`、`relay-tests` 单独作业；取消被取代的运行；`pull_request` 去掉
  `branches: [main]`（#7545）。**模拟合并后新增的 `playwright-5`–`playwright-8` 是 `runs-on: ubuntu-latest`**，
  Osuna 在 #24 把 1–4 片、typecheck、app-tests 固定到 `ubuntu-24.04`（ubuntu-latest=26.04 装不上 Playwright），
  新分片要同样固定，否则 CI 必红。
- `.github/workflows/desktop-packages.yml`：`pull_request` 去掉 `branches: [main]`；`.github/ci-paths.yml`：desktop 路径加
  `packages/app/src/**/*.electron.{ts,tsx}`。
- `desktop-release.yml`、`android-apk-release.yml`、`deploy-app.yml`、`deploy-website.yml`、`deploy-relay.yml` 上游没有改，
  也没有新增工作流。

## 展示性外链

按 `docs/release.md`「外链只指向本仓库」的 `PAT`，用 `git grep -P -i -n` 对各提交计数（与工作区 `rg` 对 main 的结果一致）：

| 位置               | main 全部 / 非测试 | v0.11.2 全部 / 非测试 | v0.13.0 全部 / 非测试 | 模拟合并树 全部 / 非测试 |
| ------------------ | ------------------ | --------------------- | --------------------- | ------------------------ |
| `packages/app/src` | 73 / 1             | 95 / 22               | 97 / 22               | 75 / 1                   |
| `packages/cli/src` | 13 / 3             | 20 / 9                | 20 / 9                | 13 / 3                   |

上游这期非测试外链的行与文件分布与 v0.11.2 完全相同，没有新增；全部数多的 2 处在
`components/markdown/renderer.test.ts`（测试样例，不改）。

## `COMPAT(...)` 标签

v0.13.0 有、v0.11.2 与 main 都没有的标签 22 个（括号内是上游写的版本，空表示没写 added in）：

`agentMessageToolEnvelope`(v0.11.1)、`backgroundRunFlag`()、`checkoutDiffAll`(v0.12.0)、`dictationCapture`()、
`fileByteWrites`×5(v0.13.0)、`fileVersionKind`×2(v0.13.0)、`hopliteProvider`×2()、`internalAgents`(v0.9.0)、
`internalWorkspaces`(v0.9.0)、`legacySystemEnvelope`(v0.11.1)、`paseoToolCallDetail`(v0.12.0)、
`pluginAgentPanelAlias`×2(v0.13.0)、`pluginPanelFlatProps`×8(v0.13.0)、`pluginReactNativeEntrypoint`×4(v0.13.0)、
`pluginSettingsGroup`×2(v0.13.0)、`relayProtectedSecurity`×4(v0.13.0)、`usageLastSuccessful`(v0.12.0)、
`usageSuccessfulAt`×2(v0.12.0)、`workspace-open-url`(v0.12.0)、`workspaceSetupCombinedLog`(v0.12.0)、
`workspaceSetupObservation`×4(v0.12.0)、`workspaceSortTimes`(v0.13.0)。

上游这期删掉的标签：`createAgentWorktree`、`relayPasswordOptional`；两者 main 上都还在（后者见上文中继密码）。
标签逐段进来，逐段改版本号；`git diff main d34d17a90 | grep '^+.*COMPAT('` 会把 Osuna 删过的行也算成新增，用两边
`git grep` 的差集更准。

## i18n

- #7410（`fc775b6db`，段 5）：`i18n/i18next.ts` 只静态引入 `en`，其余八种语言改成按选中语言 `require` 的同步 backend，
  新增 `i18next.startup.test.ts`，改 `packages/app/vitest.config.ts`（段 5 冲突）。资源文件的位置与导出名不变，
  Osuna 的 `resources/plugin-settings.ts` 仍由各语言文件 import。`i18next.ts` Osuna 没改过，自动合并。
- #7376（`eda3e4318`，段 5）：`resources.test.ts` 的键一致性改成 `canonicalKeys`（忽略复数后缀），加阿拉伯语
  套餐用量复数形式的用例，删掉 `legacyTerminalRenderer` 的断言（#7639）。自动合并，Osuna 的「已迁移英文字面量」守卫与
  `zhCNEnglishAllowlist` 不受结构影响；放宽的只是「各语言键与 en 一致」那条对复数键的比较。
- #7478（`30464cf23`，段 5）：插件内容翻译在 `packages/plugin/src/client/translations.tsx` 与 `text.ts`，插件自带
  `locales/*.json`（`plugin-examples/translations` 有 zh-CN 样例）。app 侧改的是 `plugins/` 下的按钮、附件、
  注册表，不改 `i18n/resources/`。
- 上游九种语言资源每份 +150 行左右，zh-CN 是上游自己的译文（21 个提交动过）；Osuna 的 zh-CN 同步后 253 个提交、
  3805 行改动。九份全冲突，zh-CN 7 块。上游的新键进来后照例逐键核对 zh-CN 译文与英文白名单，每段单独跑
  `resources.test.ts`。

## Osuna 侧的改动热点

- `759532509..main` 的 1128 个非合并提交是 Osuna 自分叉以来的全部提交（Osuna 早于同步点的提交也不是 v0.11.2 的祖先）。
  自同步合并 `d7800df9a` 以来是 660 个非合并提交、20 个 PR 合并。
- 自同步以来（`git diff d7800df9a main`，去掉 `.atw`、`.claude`、`.agents`）：1075 个文件，+230917/-7864。热点：
  `server/src/server/api-endpoints` 207（中转站 gateway 为主）、`app/src/assets` 136（接口模板图标）、
  `app/src/api-endpoints` 131、`app/e2e` 48、`app/src/components` 47、`server/daemon-e2e` 39、`protocol/src` 37、
  `server/usage` 33、`app/src/git` 25、`server/agent` 20、`app/src/usage-stats` 18、`app/src/logic-map` 18、
  `server/provider-accounts` 15、`app/src/usage` 14。这些大多是 Osuna 独有的新目录，上游这期新增的目录
  （`agent-presentation`、`file-panels`、`notification-open`、`watchdog`、`workspace-status`、`paseo-tool-presentation`、
  `connected-hosts`、`workspace-runtime-store`、`plugins/hoplite-provider`）与 Osuna 的目录不撞名。
- 与 v0.11.2 的全部差异（`git diff 759532509 main`，去掉上面三个目录）：3103 个文件；`packages/` 下 1906 个
  （新增 1086、修改 803、删除 16）。

## 官网与 public-docs

- `packages/website`：上游这期 197 个文件、+9356/-4469（新增 53、修改 75、改名 61、删除 8），#7373（段 5）加了简中站点。
  Osuna 对网站只改过版本号（14 个提交全是 `chore(release): cut`），冲突只有 `packages/website/package.json`。
  `deploy-website.yml` 在 Osuna 是只手动触发。
- `public-docs/`：上游 89 个文件、+12365/-388，新增 68 个（几乎都是 `*.zh-CN.md`，含 `hub/`、`sdk/`、`plugins/`）。
  没有冲突。Osuna 同步后改过 `configuration.md`（`PASEO_NO_CLI_SIGN_INS`）、`custom-providers.md`（提供方默认开关）、
  `plugins/reference.md`（`consumeReset`、`UsageResets`），自动合并；上游的 `*.zh-CN.md` 不含这三处，中文文档会落后于
  英文。

## 没查完的

- 冲突块内容逐个没看：`input.tsx`（Tiptap 对全屏编辑）、`workspace-desktop-tabs-row.tsx`、`provider-catalog-list.tsx`
  （Hoplite 与可搜索提供方网格）、`question-form-card.tsx`、`agent-manager.ts` 的具体裁决。
- 协议层的撞名（RPC 名、`server_info.features.*`、侧栏条目编号）没有逐项比对。
- 上游的原生网格终端能否承接 Osuna 的终端主题与 2031 推送没有核实。
- `CHANGELOG.zh-CN.md` 是否被官网读取没有核实。
