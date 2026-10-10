# 06 — 整体验收并入 main

**What to build:** 维护者拿到一份凭证据就能做决定的验收结果：硬指标逐条核对过，Osuna 的九项功能和上游的三项新功能在 dev 桌面端实测并有截图，草稿 PR 的正文按证据要求写好。维护者确认后，合并分支以 merge commit 并入 main，main 从此包含上游 v0.9.0 的历史。这是唯一会改变 main 的一张工单。规格见 `prd.md` 的「UI and Design」「Testing Decisions」里的验收清单；PR 证据要求见 `docs/qa.md`。

**Blocked by:** 04, 05
**Status:** ready-for-agent
**Impl:** done

- [x] 合并分支已吸收 main 在此期间的新提交（用 merge，不用 rebase），并且包含上游 `7f7e60bcb`。
- [x] 所有工作区版本号为 `0.14.2`；`CHANGELOG.md` 不含上游的 0.9.0 系列条目。
- [x] 更新源配置指向 `LFT-OXY/Osuna`；桌面发版工作流保留签名与签名断言；只手动触发的部署工作流触发条件未变。
- [x] 应用与 CLI 源码中的上游站点链接数不多于 01 记下的基线。
- [x] 上游新增的 `COMPAT(...)` 标签全部是 Osuna 版本号。
- [x] 上游新增翻译键九种语言齐全，zh-CN 为真实翻译。
- [x] Osuna 原有的测试没有被删除、跳过或放宽断言：对比 main 与合并分支，Osuna 侧测试的删改逐条有说明。
- [x] PR 上 CI 全绿，Nix 与 Nix Update Hash 除外；已知偶发失败重跑后通过。
- [x] 手动派发一次桌面发版工作流（不发布），macOS 两个架构通过签名断言，Windows 通过打包冒烟。
- [x] 实测并截图，Osuna 功能：提供方版本显示与一键升级。
- [x] 实测并截图，Osuna 功能：输入框 @ 提及智能体与 Routing block。
- [x] 实测并截图，Osuna 功能：第三方接口切换与确认。
- [x] 实测并截图，Osuna 功能：侧栏会话历史，仍是默认标签。
- [x] 实测并截图，Osuna 功能：Pi 思考档位，含切换模型后对齐。
- [x] 实测并截图，上游新功能：聊天内查找——Command+F 打开、流式回复可搜。
- [x] 实测并截图，上游新功能：附件上传显示。
- [x] 实测并截图，上游新功能：检测到 PR 时自动打开一次 PR 标签页。
- [x] UI：设置页各分区 / 中文界面 / 桌面 1280——任一分区的卡片圆角与行高和其他分区一致。
- [x] UI：设置页插件分区 / 中文界面 / 桌面 1280——没有英文句子（专有名词、命令、包名除外）。
- [x] UI：侧栏帮助菜单、欢迎页、更新分区 / 桌面 1280——没有上游文档站、Sponsor、Discord 入口。
- [x] UI：聊天 / 查找条打开且有匹配 / 桌面 1280——显示匹配总数，匹配项高亮可见。
- [x] UI：聊天与草稿标签页 / 输入框 / 桌面 1280——输入框旁的套餐用量栏与 Skill block 都在。
- [x] UI：终端 / 桌面 1280——内容四边留有对称内边距，字体是 Osuna 的等宽栈。
- [x] 截图存入任务目录的 `screenshots/`。
- [x] PR 正文按 `docs/qa.md` 的证据要求写好，含三段的冲突裁决摘要、Osuna 测试改动说明、平台矩阵；原生端标注免验收。
- [x] 原生端（iOS / Android）免验收。
- [x] 维护者看过截图并明确同意并入。
- [x] PR 以 merge commit 并入 main；并入后 `7f7e60bcb` 是 main 的祖先。

## Comments

### 范围

本工单不改产品代码，只做核对、实测、写 PR 正文。验收对象是 `484971027`（`identify-fork-base` 的头，含工单 05 的文档与 arm64 堆上限两个提交；开工时这两个提交还没推送，已推送）。并入 main 等维护者确认，本工单提交时尚未并入。

### 硬指标（2026-10-10，本机，对 `484971027`）

| 项 | 结果 | 怎么核对的 |
| --- | --- | --- |
| 吸收 main、含上游 `7f7e60bcb` | 通过 | `git fetch origin` 后 `origin/main` 仍是 `d38d186bd`，是分支的祖先（main 期间没有新提交，无需再 merge）。`7c1958f5b`、`e9d32a17d`、`7f7e60bcb` 都是祖先，各对应 merge commit `503a3e7cb`、`0798c61c8`、`e0373b2ff`。`git merge-base HEAD upstream/main` = `7f7e60bcb` |
| 版本号与 CHANGELOG | 通过 | 12 个 `package.json` 都是 `0.14.2`，`@getpaseo/*` 内部依赖没有别的版本。`CHANGELOG.md`、`fastlane/` 相对 main 零差异；文件里的 `## 0.9.0 - 2026-09-27` 是 Osuna 自己那一版 |
| 更新源、签名、部署工作流 | 通过 | `electron-builder.yml`：`owner: LFT-OXY` / `repo: Osuna` / `appId: com.chinhae.osuna.desktop`。`desktop-release.yml` 相对 main 只有三处差异：matrix 加 `node_heap_mb`（arm64 4096、x64 8192）、`NODE_OPTIONS` 引用它、两处上传换成 `upload-release-assets.mjs`；`mac-sign.js`、`OSUNA_MAC_SIGNING_SHA1`、`Verify macOS signature` 都在，没有 `APPLE_ID`。`android-apk-release`、`deploy-app`、`deploy-relay`、`deploy-website` 四个工作流的 `on:` 仍只有 `workflow_dispatch`，相对 main 没有改动 |
| 上游站点链接 | 通过 | 01 的口径重跑：`packages/app/src` 70 / 1，`packages/cli/src` 13 / 3（全部 / 非测试），基线 71 / 1、13 / 3。非测试 4 处与基线是同样的 4 处 |
| `COMPAT(...)` 标签 | 通过 | `git diff origin/main HEAD -- packages` 的新增行里有 13 处 `COMPAT(`，没有一处写 `v0.8.x` / `v0.9.x`：12 处是 `v0.15.0`，1 处本来就不带版本号（`chat-find/model.test.ts` 里 `timelineSearchCount` 的一句说明，工单 04 已记） |
| 翻译键 | 通过 | `npx vitest run src/i18n/resources.test.ts`：38 条通过（各语言键同步、zh-CN 允许清单、已迁移英文不回到源码） |
| Osuna 测试未被删改放宽 | 通过 | 见下一节 |

### Osuna 侧测试的删改

做法：Osuna 自基点 `0f20e6dfe` 以来改过或新增的测试文件（`git diff --name-only 0f20e6dfe origin/main`），与合并分支相对 main 删、改、改名的测试文件取交集；再把"Osuna 加的行"与"分支相对 main 删掉的行"逐行取交集。

- **被删除或改名的测试文件 8 个，Osuna 一个都没碰过**（`git log 0f20e6dfe..origin/main -- <文件>` 都是 0 个提交），全是上游自己删的：`word-stream` 的 5 个测试文件与 `e2e/browser/word-stream-fade.spec.ts`（上游 #5013 把逐词淡入换回逐字输出）、`composer/viewport/capacity.test.ts`（改名到 `composer/dock/internal/`）、`hooks/use-keyboard-shift-style.test.ts`（改名到 `keyboard/shift/internal/policy.test.ts`）。
- **两边都改过的测试文件 18 个，Osuna 写的行只被删了 1 行**：

| 文件 | 相对 main | Osuna 写的行被删 | 说明 |
| --- | --- | --- | --- |
| `app/src/i18n/resources.test.ts` | +0 −1 | 1 | zh-CN 允许清单里的 `settings.plugins.directoryPlaceholder`：上游删了这个键，清单测试不允许留失效项，是收紧（工单 01） |
| `server/.../providers/pi/agent.test.ts` | +304 −6 | 0 | Osuna 的 11 条用例逐字节未改；删掉的是基点之前 3 条上游旧用例里的 `--thinking medium`，维护者同意跟上游（工单 04 的对应表） |
| `server/.../plugins/index.posix.test.ts`、`requirements.posix.test.ts`、`app/src/plugins/registry-requirements.test.ts` | +547 −14、+8 −4、+11 −1 | 0 | 报错文案的断言取 Osuna 的（不带上游迁移指南网址，工单 01）；删掉的是上游改自己的行 |
| `server/.../agent/plugin-provider.test.ts` | +103 −1 | 0 | 自动合并出的重复 `emit` 删掉一行（工单 01） |
| `app/e2e/browser/agent-stream-ui.spec.ts` | +31 −70 | 0 | 上游删了自己的逐词淡入用例（#5013） |
| `app/e2e/browser/assistant-selection-copy.spec.ts`、`viewed-agent-timelines.spec.ts`、`agent-message-submission.spec.ts` | +41 −25、+88 −1、+4 −0 | 0 | 上游改自己的行并新增用例，自动合上 |
| `app/src/agent-stream/presentation.test.ts`、`composer/actions.test.ts`、`stores/workspace-layout-store.test.ts` | +103 −5、+84 −0、+79 −0 | 0 | 同上 |
| `client/src/daemon-client.test.ts`、`cli/.../plugin/scaffold.test.ts`、`server/.../agent/agent-manager.test.ts` | +145 −4、+12 −0、+87 −0 | 0 | 同上 |
| `cli/.../daemon/lifecycle.e2e.test.ts`、`desktop/src/daemon/daemon-manager.test.ts` | +1 −1、+1 −1 | 0 | 各改一行导入路径：`@getpaseo/server` → `@getpaseo/server/daemon-control`（上游新增的导出子路径），断言没动 |

- 测试文件的新增行里没有 `.skip` / `.only` / `.todo` / `.fixme`。
- 因 Osuna 的决定而改动的**上游**测试（不属于 Osuna 原有测试）：`open-supporting-view.test.ts` 两条预期加上 `session_history`（工单 01）；`plugin-management.spec.ts` 四处断言（工单 02）；`pi/agent.test.ts` 上游新增 10 组里 4 组改、1 组没留（工单 04）。PR 正文里逐条列出。

### CI 与发版演练

- 推送 `74d571a25`、`484971027` 到 `identify-fork-base`（只推这一条分支，没有推 tag）。依据是 PRD「每段推送后看 CI」与本工单的 CI 验收项。
- **桌面发版工作流，手动派发，不发布**：run [38032422607](https://github.com/LFT-OXY/Osuna/actions/runs/38032422607)，`--ref identify-fork-base`，`tag=v0.14.2`、`platform=all`、`checkout_ref=identify-fork-base`、`publish=false`。结果全部成功：
  - `publish-macos (macos-14, arm64, 4096)`：`Build desktop release` 成功，`Verify macOS signature` 成功（日志 `ok  packages/desktop/release/mac-arm64/Osuna.app`、`ok  …/Osuna-0.14.2-arm64.zip`）。**arm64 的 4096 堆上限在 Osuna 的包上第一次实际构建，够用。**
  - `publish-macos (macos-15-intel, x64, 8192)`：构建与签名断言成功。
  - `publish-windows`：构建成功，日志 `Packaged desktop smoke passed: real renderer and preload loaded; renderer-started desktop daemon …`。
  - `create-release`、`finalize-rollout` 被跳过，三个作业的 `Upload desktop artifacts to release` 被跳过，产物只存为这次运行的附件。没有创建或改动任何 Release。
- CI 结果见文末「推送与 CI」。

### dev 桌面端实测（2026-10-10）

环境：`env -u PASEO_HOME … FORCE_COLOR=3 PASEO_LISTEN=127.0.0.1:6769 npm run dev --workspace=@getpaseo/desktop`，启动日志 `Home:` 是本工作树的 `.dev/paseo-home`；启动前重跑了 `npm run build:server`。窗口内容区 1280×832，中文界面。截图用 Playwright 经 CDP 取，原生确认框那一张用 `screencapture -l <窗口>` 取。入库前统一缩到 1920 宽并做调色板压缩（52 张共 11MB）。

Osuna 功能：

| 项 | 结果 | 截图（`screenshots/` 下，前缀 `06-`，后缀 `-zh-desktop-1280.png`） | 说明 |
| --- | --- | --- | --- |
| 提供方版本显示与一键升级 | 通过 | `providers-list-versions`、`provider-claude-upgrade-available`、`provider-claude-upgrading`、`provider-claude-upgraded` | 列表每行显示已装版本与"升级到 vX"；详情页"已安装 v2.0.0 → v2.1.296"，点"升级"后按钮转圈，结束后已装版本刷新。**升级对象是 `/tmp` 下的假 claude 脚本**（`--version` 报 2.0.0，`update` 只做标记），daemon 日志里执行的命令是 `/tmp/osuna06-fake-claude/claude update`，没有碰真实的 Claude Code |
| @ 提及 Agent（Agent mention）与 Routing block | 界面部分通过；**Routing block 没有屏幕证据，待维护者定** | `composer-agent-mention-list`、`composer-agent-mention-blocks`、`chat-agent-mention-sent`、`draft-tab-skill-block-mention-plan-usage` | 输入 `@` 列出 Agent 分组，点选后成为提及块，发送后消息里仍是两个提及块、不出现 `<paseo-system>` 文字。Routing block 只附在发给提供方的那一份上，界面上按设计看不到；模拟提供方不留存收到的提示词，所以**没有屏幕证据**。自动化依据：`routing-block.test.ts`、`trailing-routing-block.test.ts` 在 CI 的 server-tests 里通过；`agent-create-agents-capability.e2e.test.ts` **不在 PR 的 CI 里**（`test:unit` 排除 `*.e2e.test.ts`，`test:integration` 的固定清单里没有它），2026-10-10 在本机单独跑通过。dev 主机的"启用 Osuna 工具"原本是关的（此时 Agent 分组置灰并提示去开启，行为正确），实测时临时打开，结束后还原 |
| 第三方接口切换与确认 | **只走到确认框，没有真的切换，待维护者定** | `api-endpoint-form-filled`、`api-endpoints-list-official-active`、`api-endpoint-switch-confirm-dialog` | 新建一个演示接口（只写进 dev 数据目录），点"使用"弹出原生确认框"这会改写 Claude 自身的配置文件。当前没有正在运行的 Claude 会话。终端里的 Claude 也会跟着切换。"，按钮"取消 / 切换"。**点了取消，没有真的切换**：切换会改写本机 `~/.claude/settings.json`。`~/.claude/settings.json`、`~/.codex/config.toml`、`~/.codex/auth.json` 的修改时间实测前后相同。真正切换的行为只有 `api-endpoint-claude.e2e.test.ts` 的依据：它用临时目录和假提供方，**不在 PR 的 CI 里**，2026-10-10 在本机单独跑通过。`.atw/spec/server/backend/quality-guidelines.md` 写了这类界面可以在临时 `CLAUDE_CONFIG_DIR`、假 CLI、本地假上游下实测；没有照做，是因为维护者 2026-09-30 要求做会改写 CLI 配置的界面实测前先说明隔离方式并得到同意 |
| 侧栏会话历史，仍是默认标签 | 通过 | `explorer-session-history-default-tab` | 新工作区第一次打开 Explorer sidebar，标签是"文件 / 更改 / 会话历史"，会话历史不用手动添加；点开后列出该项目的提供方会话 |
| Pi 思考档位，含切换模型后对齐 | 按模型给档位通过；**"切换模型后对齐"没有实测到，待维护者定** | `pi-thinking-gpt6astra-xhigh`、`pi-thinking-draft-switch-to-deepseek-model-default`、`pi-thinking-draft-switch-to-o3-model-default`、`pi-thinking-non-reasoning-no-control` | 77 个 Pi 模型按模型给档位：14 个非推理模型没有档位控件；`xhigh` / `max` 只出现在映射了的模型上。在新建草稿里：GPT-6 Astra 手动选"超高"（5 档里的第 4 档）→ 切到 deepseek-flash（只有 off / high / max）落到 High → 切到 o3（low / medium / high）落到 Medium → 切到 GPT-4.1 档位控件消失。**草稿里换模型落到的是新模型的默认档，不是 PRD 说的"先往更高档、再往更低档"**（超高切到只有 off / high / max 的模型，按 PRD 该是 max，草稿里是 High）。这是合并前就有的草稿行为：`packages/app/src/provider-selection/`、`composer/agent-controls/`、`agent-controls/` 三个目录相对 main 零差异，`composer/draft/workspace-tab.tsx` 的改动行里没有档位逻辑。PRD 的那条规则是 daemon 对**运行中**的 Pi 会话做的，由 `pi/agent.test.ts` 的六条切模型用例守着（CI 通过）。没有在真实 Pi 会话上实测：Pi 的 `setModel` 会把所选模型写成本机 Pi 的默认模型（`pi-coding-agent/dist/core/agent-session.js` 调 `settingsManager.setDefaultModelAndProvider`），等于改写维护者的 Pi 设置 |

上游新功能：

| 项 | 结果 | 截图 | 说明 |
| --- | --- | --- | --- |
| 聊天内查找 | 通过 | `chat-find-open-with-matches`、`chat-find-next-match`、`chat-find-while-streaming`、`chat-find-after-stream` | 点一下消息区按 Command+F，焦点进入"在窗格中查找"；输入 `scroll` 显示"1 / 25"，当前匹配高亮（只高亮当前这一处，其余匹配不标记，这是上游的做法），回车走到"3 / 25"。光标在输入框里按 Command+F 同样打开。回复还在流式输出（停止按钮在）时搜到"1 / 35"，比上一轮多出的 10 处在正在输出的回复里 |
| 附件上传显示 | 通过 | `composer-attachment-pending-upload`、`composer-attachment-uploaded` | 往输入框拖入 8MB 文件，Attachment tray 里先出现带进度圈的待上传项（约 0.3 秒），确认后变成文件附件 |
| 检测到 PR 时自动打开一次 PR 标签页 | 通过 | `pr-tab-auto-opened` | 把本工作树作为工作区打开（分支有 PR #13）：Explorer sidebar 的标签里自动多出"13"，排在"更改"之后；点开是 PR #13 的检查列表。上游的设计是后台加标签、不自动展开 Explorer sidebar。`pullRequestTabAutoOpenedByWorkspace` 里记下了这个工作区，刷新页面后仍只有 1 个 PR 标签 |

UI 验收点：

| 项 | 结果 | 截图 | 说明 |
| --- | --- | --- | --- |
| 设置页各分区卡片圆角与行高一致 | 通过 | `settings-*`（21 个分区各一张） | 逐分区量了计算样式：所有卡片圆角都是 14px；标准设置行都是最小高 56px、内边距 8 / 16。插件分区里量到的 8px 是输入框和按钮，不是卡片 |
| 插件分区中文界面没有英文句子 | 通过 | `settings-host-plugins`（空）、`settings-plugins-installed-row`、`settings-plugins-row-menu-open` | 装了仓库自带的 `plugin-examples/catppuccin`（拷到 `/tmp` 后按目录安装）：提示、开关、来源、"已安装 catppuccin"、"运行中"、菜单"日志 / 重新加载 / 移除"都是中文；英文只有插件 id 和路径。安装失败时显示 daemon 报错原文这一点是合并前就有的行为（工单 02 已说明），这次没有复现失败 |
| 帮助菜单、欢迎页、更新分区没有上游入口 | 通过 | `sidebar-help-menu-open`、`open-project`、`settings-about` | 帮助菜单：键盘快捷键 / 新功能 / 运行诊断 / 创建 GitHub 议题 / 版本号。欢迎页与"关于"页（应用更新在这里）只有一个 GitHub Star，代码里指向 `github.com/LFT-OXY/Osuna`。没有文档站、Sponsor、Discord |
| 查找条显示匹配总数、高亮可见 | 通过 | `chat-find-open-with-matches` | "1 / 25"，当前匹配深色底高亮 |
| 聊天与草稿标签页的套餐用量栏与 Skill block | 通过 | `composer-skill-menu-draft-tab`、`draft-tab-skill-block-mention-plan-usage`、`chat-tab-skill-block-plan-usage-claude` | 草稿：从 `/` 菜单点选 `find-skills` 后输入框里是 Skill block，旁边是 Codex 的提及块；输入框下方的 Composer context strip 显示套餐用量"Max 20x / 5h / 周 / Fable"。聊天：已发送消息里的 Skill block 与同样的套餐用量 |
| 终端四边对称内边距、Osuna 等宽栈 | 设定值对称；**画面上右侧比左侧宽，待维护者定** | `terminal-padding-filled`、`terminal-font` | 把整屏涂满颜色后四边都留白。设定的内边距四边都是 8px；实测涂色区到窗格边：左 8、上 8、右 21、下 10。右侧的 21 = 8 内边距 + 8 滚动条（`scrollbar.width: 8`）+ 约 5 不满一格的余量；下方多出的 2 是不满一行的余量。`fontFamily` 以 `SFMono-Regular, Menlo, Monaco, Consolas, …` 开头，后接 Nerd Font 回退。`packages/app/src/terminal/runtime` 与两个终端组件相对 main 的改动行里没有内边距、滚动条、字体相关的内容，所以这个左右差在合并前就有 |

原生端（iOS / Android）免验收。

### 实测中的一次失误

在 Claude 草稿里试 `@` 提及时，提及分组因为"Osuna 工具未启用"是置灰的，我按回车想选中条目，结果把草稿发了出去：dev daemon 用真实的 Claude（Opus 5.5、Auto 模式）在 `/tmp/osuna06-qa-repo` 里起了一个会话。约 15 秒后发现并停掉。它做了三件事：加载 `codexhost-delegation` 技能、执行 `codex-connect delegate --help`、列了一次 `~/.claude/skills/codexhost-delegation/` 目录并查了几个命令是否存在。没有改任何文件（演示仓库 `git status` 干净），没有委派出任何任务。代价是消耗了一小段 Claude 订阅用量（上下文显示 35.4K）。之后凡是可能触发发送的操作都改成只用鼠标点选，并只在模拟提供方上按回车。那个会话的聊天页后来被用作"聊天标签页的 Skill block 与用量栏"的截图。

### 实测中看到、不是这次合并带来的

- 中文文件名的附件上传后名字变成下划线（`验收-附件-演示数据.json` → `__-__-____.json`）。`packages/server/src/server/file-upload/index.ts:225` 只保留英文字母、数字和少数符号，这一行在 main 和基点 `0f20e6dfe` 上都一样。
- 查找条开着、关键词不变时，回复继续流式输出，匹配总数不会跟着涨（停在 35，重新输入后是 49）。`agent-stream/chat-find` 与 `pane-find` 相对上游 `7f7e60bcb` 只差一行 `COMPAT` 版本号和一处样式写法，这是上游的行为。

Visual 评审另外指出的几处，逐条查了来源，都不是这次合并带来的：

- 中文界面里的英文：主机概览的状态 `Online`（`packages/app/src/utils/daemons.ts` 里写死，相对 main 无改动）；PR 检查行的 `running`（`git/pull-request-panel/data.ts`，相对 main 无改动）；思考档位的 `High` / `Medium` 与"超高"并存（档位名来自提供方，只有 `xhigh` 在 `agent-controls/labels.ts` 里有中文名，该目录相对 main 零差异）；相对时间 `3m ago`（`docs/i18n.md` 列为不译）；`Star`。
- 提供方详情页点"升级"后按钮变宽，版本号左移约 28px；诊断分区两行之间没有分隔线。这两页是 Osuna 自己的界面，本次合并没有碰 `provider-detail/`。
- 插件行的操作菜单只有"移除"带图标、三项文字起点不齐：工单 02 的评审已记，沿用上游原样。

按 PRD 的 Out of Scope（不修上游自己的缺陷），以上都没有动，留给维护者决定是否另开任务。

### 清理

已做（2026-10-10，评审之后、提交之前）：停掉 dev 桌面端，6769 与 8082 不再监听，正式版的 6767 仍在；`.dev/paseo-home/config.json` 拷回实测前的备份（去掉假 claude 的命令覆盖、Osuna 工具开关、插件开关与插件条目）；删掉实测新建的 `.dev/paseo-home/api-endpoints/`（里面只有那一个演示接口）；删掉 `/tmp/osuna06-*` 与 `packages/app/.qa06/` 下的临时脚本。实测创建的 4 个会话（3 个模拟、1 个 Claude）留在 dev 数据目录里，不影响正式版。

### 运行记录（2026-10-10，本机）

```bash
git fetch origin && git rev-list --left-right --count origin/main...HEAD      # 0  44
git merge-base HEAD upstream/main                                              # 7f7e60bcb…
git log --merges --format='%h %p' d38d186bd..HEAD                              # 三个 merge commit 与双亲
for f in package.json packages/*/package.json; do node -p "require('./$f').version"; done   # 12 行 0.14.2
git diff --stat origin/main HEAD -- CHANGELOG.md README.md fastlane            # 只有 README.md 1 行
git diff origin/main HEAD -- .github/workflows                                 # 只有 ci.yml 与 desktop-release.yml
rg -n -i "$PAT" packages/app/src | wc -l                                       # 70；加 -g '!*.test.*' -g '!*.spec.*' 为 1（PAT 见工单 01）
rg -n -i "$PAT" packages/cli/src | wc -l                                       # 13；非测试 3
git diff origin/main HEAD -- packages | rg '^\+.*COMPAT\('                     # 13 行，其中 12 行含 v0.15.0，0 行含 v0.8 / v0.9
git diff --diff-filter=DR --name-status origin/main HEAD -- '*.test.*' '*.spec.*'   # 6 个 D、2 个 R
git diff origin/main HEAD -- '*.test.*' '*.spec.*' | rg '^\+.*\.(skip|only|todo|fixme)\('   # 无输出
```

- `npm run build:server`：通过（实测前重建 daemon）。
- app：`npx vitest run src/i18n/resources.test.ts --bail=1` —— 38 条通过。
- server（评审后补跑）：`npx vitest run src/server/daemon-e2e/api-endpoint-claude.e2e.test.ts src/server/daemon-e2e/agent-create-agents-capability.e2e.test.ts src/server/agent/routing-block.test.ts src/server/agent/trailing-routing-block.test.ts --bail=1` —— 4 个文件 53 条通过。跑完后 `~/.claude/settings.json`、`~/.codex/config.toml`、`~/.codex/auth.json` 的修改时间仍与实测前相同。
- 本工单没有改产品代码，没有走 TDD，没有跑 typecheck / lint；整套测试在 CI。

### 评审（`atw-code-review`，Standards、Spec、Visual 三轴）

评审在提交之前、对工作区做的。

- Standards，已修并复查：
  - "第三方接口切换""Routing block"引用的两个 e2e 测试不在 PR 的 CI 里。核对属实，改为如实写明，并在本机补跑（见运行记录）。
  - 引用了还没写的「推送与 CI」一节；「清理」写成已完成但当时还没做。两处都已补上、做完。
  - 用词：记录里的"智能体"改为 Agent（验收项原文未动）；"附件胶囊""用量窄条""右侧栏"改用 `docs/glossary.md` 的 Attachment tray、Composer context strip、Explorer sidebar。
  - 两个只改一行的测试文件套不上"同上"，改为单独说明；没被引用的 `composer-skill-menu-draft-tab` 已引用；硬指标补了命令（运行记录）。
  - 判断题，原样上报：截图文件名里的 `1280` 指逻辑视口宽，文件实际 1920 像素宽（记录里已说明）。
- Spec，已处理：
  - 三项"只做到一半"不能算满足：第三方接口应在隔离环境里补做；Pi 的截图是草稿落到默认档，不是"切换模型后对齐"，文件名里的 `aligned` 有误导；Routing block 按设计截不到。**三项都没有勾，列在下面交维护者定**；两张 Pi 截图已改名。
  - "Pi 草稿逻辑与合并前一致"漏查了 `composer/agent-controls/`。补查：该目录相对 main 零差异。
  - 终端右侧 21px 里有 8px 是滚动条，已改写。
  - 前序工单留给 06 的事项：README 英文版与三份译文的一行不一致、04 的「问过维护者的三件事」写进 PR 正文；`creation-idempotency` 见「推送与 CI」；02 留的插件页视觉问题见上一节。
- Visual：
  - 终端左右留白不对称（左 8、右 21）。核对代码后归因于滚动条与不满一格的余量，合并前就有；**是否算满足"对称内边距"交维护者定，没有勾**。
  - 查找只高亮当前匹配：上游的做法，`chat-find` 与上游一致，已在记录里写明。
  - 混入的英文与其余视觉问题：逐条查了来源，都不是这次合并带来的，见上一节。
- 修正后的复查：只对改过的句子通读了一次，并核对了改名后的截图文件名与记录一致。没有做第二轮完整评审。

### 待维护者决定

| # | 事项 | 现状 | 可选做法 |
| --- | --- | --- | --- |
| 1 | 第三方接口：真的点"切换" | 只截到确认框，点了取消；e2e 测试本机通过 | A. 接受现有证据。B. 同意我在隔离环境里补做：dev daemon 用临时 `CLAUDE_CONFIG_DIR`、假 claude、本地假上游，全程不碰 `~/.claude` / `~/.codex`，前后用修改时间证明 |
| 2 | Pi：运行中会话切模型后"先高后低"对齐 | 只有 `pi/agent.test.ts` 六条用例的依据；草稿里换模型落到默认档（合并前就这样） | A. 接受测试依据。B. 同意我在真实 Pi 会话上实测：会把本机 Pi 的默认模型改掉，我先备份、测完还原 Pi 的设置文件 |
| 3 | Routing block 的屏幕证据 | 按设计只在发给提供方的那一份里，界面上看不到 | A. 接受测试依据。B. 用一个真实提供方发一条带提及的消息，从它的会话文件里取证（会消耗少量订阅用量） |
| 4 | 终端右侧留白比左侧宽 13px | 滚动条 8px 加不满一格的余量，合并前就有 | A. 视为满足。B. 另开任务调整 |
| 5 | 实测中看到的老问题（中文文件名变下划线、流式输出时匹配总数不刷新、几处英文） | 都不是合并带来的，没有动 | 是否另开任务 |

### 推送与 CI

- 推送 `74d571a25`、`484971027` 到 `identify-fork-base`（草稿 PR #13）。
- `484971027` 上 CI 工作流 18 项全部通过，整轮没有重跑：changes、format、lint、typecheck、app-tests、sdk-tests、relay-tests、server-tests（ubuntu / windows）、desktop-tests（ubuntu / windows）、cli-tests 三片、playwright 四片。Desktop Packages 的 `linux` 也通过。Nix 与 Nix Update Hash 没有被触发（它们只在推 main 时跑）。
- playwright 有 2 条用例第一次失败、由 Playwright 自己重试后通过（计为 flaky）：`settings-providers-list-detail.spec.ts`「pushes the detail and returns through the breadcrumb on a wide window」（工单 03、04 那两轮也出现过）、`workspace-scripts-menu-resize.spec.ts`「scripts menu resizes when a service row grows after launch」（第一次出现）。工单 04 提醒留意的 `creation-idempotency` 这一轮没有出现。
- 桌面发版工作流的不发布演练：见「CI 与发版演练」。
- 本工单的提交（记录与截图）推送后 CI 会再跑一轮，结果补在 PR 上。

### 验收项说明

- 评审之后没有勾的 6 条：`@ 提及智能体与 Routing block`、`第三方接口切换与确认`、`Pi 思考档位，含切换模型后对齐`、`终端 / 桌面 1280`——见「待维护者决定」；`维护者看过截图并明确同意并入`、`PR 以 merge commit 并入 main`——等维护者。前五条在维护者确认后勾上，见「维护者的确认」；最后一条在并入后勾。
- `PR 上 CI 全绿`：勾的是 `484971027` 这一轮。
- 第 1 条"已吸收 main 在此期间的新提交"：main 期间没有新提交，没有需要吸收的。并入前若 main 有变化，要再 merge 一次并重看 CI。

### 规范补充

- `.atw/spec/server/backend/testing.md`「Running」：PR 的 CI 不跑大多数 `*.e2e.test.ts`（`test:unit` 排除、`test:integration` 是固定清单），引用前先查清单、本机单独跑并写明是本机结果。
- `.atw/spec/app/frontend/testing.md`「Running」：桌面端的 `confirmDialog` 是原生确认框，CDP 截不到，用 `screencapture -l` 截、用 System Events 按名字点取消；dev 桌面端实测时，真实提供方的草稿里不按回车选自动补全项。

### 维护者的确认（2026-10-10）

- 维护者在 dev 桌面端按清单亲手测了一遍（清单 19 项：Osuna 原有功能 8 项、上游新功能 7 项、外观与文案 4 项），答复"没什么问题"。
- 随后明确选择：**并入 main，「待维护者决定」里的第 1–4 项按现状接受**（第三方接口只走到确认框、Pi 运行中会话的切模型对齐只有测试依据、Routing block 没有屏幕证据、终端右侧留白偏宽）。这四条验收项据此勾上，依据是维护者的手测与接受，不是新增的证据。
- 截图里的主机名、项目名、Claude 套餐档位与用量：维护者选择保留现状。
- 第 5 项（实测中看到的老问题是否另开任务）没有答复，不挡并入。

### 并入结果（2026-10-10）

- 并入前：`730cb0522`（本工单的记录与截图提交）上 CI 18 项加 Desktop Packages `linux` 共 19 项全部通过，没有重跑；`origin/main` 仍是 `d38d186bd`；PR 状态 `MERGEABLE` / `CLEAN`。
- `gh pr ready 13` 后 `gh pr merge 13 --merge`：PR #13 于 2026-10-10T07:59:48Z 并入。merge commit 是 `0cb350cb5`，双亲 `d38d186bd`（并入前的 main）与 `730cb0522`。远端分支 `identify-fork-base` 没有删。
- 并入后核对：`7c1958f5b`、`e9d32a17d`、`7f7e60bcb` 都是 `origin/main` 的祖先；`git merge-base origin/main upstream/main` = `7f7e60bcb`，与 `docs/release.md` 写的当前同步点一致；main 上根 `package.json` 的版本号仍是 `0.14.2`。
- 推 main 触发了 CI、Desktop Packages、Docker、Nix、Nix Update Hash。Nix Update Hash 当即失败、Nix 预期失败，都是已知红灯（PRD：Nix 依赖哈希不追）。
- 本节与「维护者的确认」是并入之后才提交的，在 `identify-fork-base` 上、比 main 多一个提交，随任务归档进入 main。
