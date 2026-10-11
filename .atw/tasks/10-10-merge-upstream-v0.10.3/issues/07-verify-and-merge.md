# 07 — 整体验收并入 main

**What to build:** 维护者拿到一份凭证据就能做决定的验收结果：硬指标逐条核对过，`docs/release.md` 里的同步点更新到 v0.10.3 并写明补丁分支的后果，草稿 PR 的正文按证据要求写好，收尾在并入之前做完。维护者发话后，合并分支以 merge commit 并入 main，main 从此包含上游 v0.10.3 的历史。这是唯一会改变 main 的一张工单。规格见 `prd.md` 的「UI and Design」「Testing Decisions → 验收清单」「文档」；PR 证据要求见 `docs/qa.md`。

**Blocked by:** 06
**Status:** ready-for-agent
**Impl:** doing

- [x] 合并分支已吸收 main 在此期间的新提交（用 merge，不用 rebase）；五个发布点各对应一个 merge commit；`b4af508e2` 是分支头的祖先，分支与上游 main 的共同祖先是 `c481ecf3e`。
- [x] 所有工作区版本号为 `0.14.2`；`package-lock.json` 相对 main 的差异只有上游新增的那个外部依赖及其传递依赖；`CHANGELOG.md` 不含上游的 0.10.0 – 0.10.3 条目。
- [x] `docs/release.md`「合并后核对」对分支头再逐项过一遍：更新源、桌面身份与数据目录、签名与签名断言、只手动触发的部署工作流、上游站点链接数不多于 01 的基线、翻译键、`COMPAT(...)` 标签。
- [x] 协议新增的字段都是可选的，协议的现有测试无一改动断言。
- [x] 对比 main 与合并分支，Osuna 侧测试的删改逐条有说明；除因分栏变化必须跟着改的断言外，没有断言被删除、跳过或放宽。
- [ ] PR 上 CI 全绿，Nix 与 Nix Update Hash 除外；已知偶发失败重跑后通过。
- [x] 02、04、06 存入 `screenshots/` 的截图对分支头复看一遍，结果一致。
- [x] UI：新会话 / 输入 `/` / 桌面 1280 — 指令菜单立刻出现；在没跑过的目录里列表下方有「列表不全」的提示。截图存入 `screenshots/`。
- [x] dev 桌面端快速冒烟：侧栏、输入框、终端、Providers 页、关于页打开正常，无报错。不逐项截图。
- [x] `prd.md`「UI and Design」的截图验收点全部满足。
- [x] `docs/release.md`「从上游同步」：同步点那一句更新为 v0.10.3 及其提交，表里加一行（五段的发布点、merge commit 与 PR 编号）；自检命令换成对补丁分支也成立的写法；补丁分支的后果、合 v0.11 时要重解的文件与固定裁决已写进去；本次新踩到、下次还会遇到的坑补进「踩过的坑」，没有就不加。
- [ ] PR 正文按 `docs/qa.md` 的证据要求写好，含：各段冲突裁决摘要；没有收的两处上游指令列表改动、原因（ADR 0003）与由此带来的行为差异；05 核实出的 OpenCode 2.x 缺口清单；因分栏变化改动的断言；按 Osuna 决定改写的上游测试；平台矩阵，原生端标注免验收。
- [x] OpenCode 2.x 缺口的后续任务已记下（向维护者说明记在哪里）。
- [ ] 收尾在并入之前做完：各工单的验收项逐条对照后勾上，journal 已记，任务归档的准备已做；已告知维护者并入后这个 worktree 会被自动归档。
- [x] 原生端（iOS / Android）免验收。
- [ ] 维护者看过截图并明确同意并入。
- [ ] PR 以 merge commit 并入 main；并入后 `b4af508e2` 是 main 的祖先。

## Comments

### 2026-10-11 工单 06 留下的口径

验收项里的「上游站点链接数不多于 01 的基线」按非测试数算（维护者 2026-10-11 裁决，见 06 的记录）。06 合完后是 app 73 / 1、cli 13 / 3；01 的基线是 app 70 / 1、cli 13 / 3。全部数多出的 3 处都在上游带来的测试里（`components/pair-link-credentials.test.ts` 2 处、`hosts/pair-scan-model.test.ts` 1 处），是配对链接样例用的假地址。

### 2026-10-11 实施记录

**起点。** 分支头 `71a135257`，草稿 PR #15。`origin/main` 仍是 `56cccc196`，合并期间 main 没有新提交，不需要把 main 合进来。

#### 硬指标（对分支头）

- 五段各一个 merge commit：`52d345db7` → `0535af41b`、`c481ecf3e` → `6cac3ad8b`、`c5236c00d` → `260c79631`、`919c737c1` → `a36ecb8de`、`b4af508e2` → `e8738aa16`。`b4af508e2` 是分支头的祖先；`git merge-base HEAD upstream/main` = `c481ecf3e`（核对前重新抓了一次上游 main）。本地 tag 仍是 14 个，`git tag | shasum` 仍是 `8625da06…`。
- 版本号：根与 11 个工作区都是 `0.14.2`。各 `package.json` 相对 main 只有 `packages/server/package.json` 的两处（`@opencode/client 2.0.10`、`test:integration` 追加一个文件）。
- `package-lock.json` 相对 main：新增 15 个包（`@opencode/client`、`@opencode/protocol`、`@opencode/schema`、`effect`、`fast-check`、`pure-rand`、`msgpackr`、`msgpackr-extract` 及其 6 个平台包、`node-gyp-build-optional-packages`），删除 0，变更 1（`packages/server` 自己的依赖表）。
- `CHANGELOG.md` 与 main 逐字节相同。里面的 `## 0.10.0`、`## 0.10.1` 是 Osuna 自己 2026-09-28 发的那两个版本的条目，不是上游的。

#### 「合并后核对」

- `packages/desktop/electron-builder.yml`、`packages/desktop/src/main.ts`、`.github/`、`packages/desktop/scripts/` 相对 main 没有差异。更新源 `LFT-OXY/Osuna`；`appId` `com.chinhae.osuna.desktop`、`productName` `Osuna`；userData 目录名不变；`mac-sign.js` 钩子、`OSUNA_MAC_SIGNING_SHA1`、`Verify macOS signature` 都在，`notarize: false`；四个部署工作流的 `on:` 只有 `workflow_dispatch`。
- 上游站点链接数：app 73 / 1，cli 13 / 3（全部 / 非测试）。非测试数与 01 的基线相同，按 06 留下的口径通过。
- 翻译键：`packages/app/src/i18n/resources.test.ts` 在分支头上 38 条通过。
- `COMPAT(...)`：相对 main 新增的标签行 6 处。`connectionPassword` 2、`headerAuth` 2、`relayPasswordOptional` 1 都写的是 `v0.15.0`；`oldRelayOfferTls` 1 处是随代码挪动的旧标签，标签名合并前就有，不动。

#### 协议

协议包相对 main 改了 6 个文件。新增的线上内容：`hello` 里可选的 `auth`、`server_info` 里可选的 `protocolVersion`、可选的客户端能力 `helloRejection`、新消息 `hello.rejected`（01 的记录把 `protocolVersion` 写成了 `hello` 里的字段，`hello.protocolVersion` 合并前就有且必填，这次没有动）；另有 `relay://` 连接串的解析与序列化函数、终端配置图标表多一条 `cursor-agent`。没有字段被收窄、删除或改成必填，新 schema 里没有 `.transform()` / `.catch()` / `.preprocess()`。协议的测试文件里被删改的只有一行：`terminal-profiles.test.ts` 的 `it.each` 输入里拿掉 `cursor-agent`，是上游自己改的输入，不是断言。

#### Osuna 侧测试的删改

对 main 与分支头之间变过的测试相关文件（`*.test.*`、`*.spec.*`、`e2e/`、`tests/`、`test-utils`）做了一遍机械比对：新增 35 个、修改 71 个、删除 0 个。修改的文件里被删或被改的 283 行，逐文件减去上游自己在 `c67b7158b..b4af508e2` 里删改的行，剩下 6 行，在 5 个文件里，都已在 01、02、04 记过：

| 文件 | 行 | 说明 |
| --- | --- | --- |
| `hooks/agent-commands-query.test.ts` | 整键断言 | 键的顺序跟了上游，内容未变（01） |
| `utils/test-daemon-connection.test.ts` | vitest 的 import | 多引一个 `beforeAll`，给 02 新增的用例用 |
| `mcp-server.test.ts` | `rmSync(…)` | 换成上游的 `removeAgentStateDir`，断言未动（01） |
| `provider-snapshot-manager.test.ts` | `configDir,` | 换成 `runtimeSettings.env.CLAUDE_CONFIG_DIR`（01） |
| `claude/agent.test.ts` | `configDir,`、假版本号 `2.1.280` | 同上；假版本号取上游的 `2.1.284`（04） |

分支相对 main 新增的 `.skip` / `.todo` / `.fixme` / `skipIf` 行 2 处，都在上游顶端 `b4af508e2` 的同一文件里，没有 Osuna 加的。因分栏变化改动的 Osuna 断言：没有，分栏相关的 e2e 辅助文件是上游自己改的。

#### 截图复看（dev 桌面端，分支头，Electron 1280 × 832，浅色，中文）

先 `npm run build:server`（`packages/server/dist` 比 05 的适配旧），再起 dev 桌面端（`.dev/paseo-home`、`127.0.0.1:6769`）。把 02、04、06 的 21 张截图对应的页面与状态重新走了一遍，新图存在临时目录，不入库；逐张与旧图缩到同尺寸做像素对比（任一通道差超过 48 算不同）。

| 截图 | 不同像素 | 差在哪里 |
| --- | --- | --- |
| 设置的通用、外观、外观（终端预览）、侧边栏、聊天、终端、浏览器、「布局」旧地址 | 0.01% – 0.07% | 左栏的主机显示名 |
| 关于 | 0.25% | 已连接的主机列表（旧图里多一台 `password-host`） |
| Providers 列表、Claude 详情 | 0.08%、0.09% | 可升级到的版本号 |
| 添加主机的方式选择、需要密码、密码不正确 | 0.00% | 密码框里的圆点个数 |
| 主机概览与连接页的「密码不正确」「需要密码」四张 | 0.00% | — |
| 新主机确认框两张 | 0.03% | 密钥指纹（造的公钥不同） |
| 模型列表里的 Sonnet 5.5 | 3.77% | 换了工作区，画面不可逐像素比。对的是列表内容：Sonnet 5.5 在 Opus 4.8 之后、Sonnet 5 之前，说明文字「Sonnet 5.5 · Best for everyday tasks」 |

各页的可见文字另从 DOM 里读了一遍：应用级栏目是通用、外观、侧边栏、聊天、终端、浏览器、编辑器、快捷键、集成、通知、权限、诊断、关于，没有「布局」；`/settings/layout` 落到「通用」。带密码主机仍用隔离的 daemon（临时目录、`127.0.0.1:6781`、关闭中继与语音）：不填密码 →「需要密码」，填错 →「密码不正确」，填对 `correct horse`（带空格）→ 保存成功；daemon 换成带 `/` 与 `@` 的密码后主机页与连接页显示「密码不正确」，去掉应用里存的密码后显示「需要密码」。

#### 新会话的 `/` 菜单

造法：临时目录里新建一个 git 仓库 `fresh-project`，用 mock 提供方跑一个 Agent 让它出现在侧栏，再在这个工作区里新开一个草稿，提供方是 Claude（Claude 没有在这个目录里跑过）。

- `screenshots/new-agent_slash-command-menu_desktop-1280.png`：输入 `/` 后指令菜单出现在输入框上方，分组标题「命令」，第一条 `/compact` 高亮。页面里计时，从 `/` 的 keydown 到第一批选项出现是 88 毫秒，24 条（10 条 Claude 内置指令 + 14 条扫描到的技能）。
- `screenshots/new-agent_slash-command-menu-partial-hint_desktop-1280.png`：把列表滚到底，最后一条选项下面是「发送一条消息后加载全部指令」，不在任何 `role="option"` 里（不可选）。

两张图都用 DOM 把输入框下方的套餐档位与用量读数隐藏了；第二张图里用户自己装的技能行加了模糊（仓库是公开的）。256 色。

顺带看到、不是这次合并带来的：技能说明用 YAML 折叠写法（`description: >`）时，菜单里显示的说明是一个 `>`。解析它的 `front-matter.ts` 相对 main 没有改动。

#### 冒烟（同一个 dev 桌面端）

- 侧栏：历史（`/sessions`）、计划（`/schedules`）、用量（`/usage`）、搜索（命令中心对话框）都打开正常。
- 输入框：在 mock Agent 的标签页里发第二条消息，流式回复照常出现。
- 终端：新开终端执行 `echo smoke-$((40+2))`，输出 `smoke-42`。
- Providers 列表、Codex 详情、关于页打开正常。
- dev daemon 的日志里没有错误级别的记录。浏览器控制台只有一组 React 开发模式的警告：Providers 列表里按钮嵌套按钮。`providers-section.tsx` 相对 main 没有改动，合并前就有。

用完的清理：隔离 daemon 按 `paseo.pid` 停掉；dev 主机列表里造的两台主机删掉、显示名改回；mock Agent 删掉；dev 桌面端停掉。6767 上的正式 daemon 全程没有动。

#### `docs/release.md`

- 同步点改为 v0.10.3（`b4af508e2`），表里加一行；自检换成 `git merge-base --is-ancestor <同步点> main`。
- 新增一小节「上游的补丁分支」：补丁版本不在上游 main 上、`merge-base` 给出的是分叉点、下次合主线版本时分叉处再冲突一次与固定裁决、合 v0.11 时要重解的文件与重算的命令。
- 重解的文件是 10 个，不是 prd 与调研记录里写的 9 个：调研列出的清单本身就是 10 项（`codex-app-server-agent.ts`「及其测试」算两个），数错了。这次用 `git merge-tree --write-tree --name-only --no-messages b4af508e2 22488d450` 重算过，清单一致。prd 与调研记录里的数字已改成 10。
- 「踩过的坑」没有加：这张工单没有新踩到下次还会遇到的坑。

#### OpenCode 2.x 缺口的后续任务

记在 `.atw/tasks/10-11-opencode-v2-osuna-gaps/`（新建的 ATW 任务，阶段 discover，没有设为当前任务）。`prd.md` 里是 05 核实出的缺口表、两条待核实的事与约束，还没有做需求访谈。

#### PR 正文

按 `docs/qa.md` 与 `.claude/skills/pr` 的模板重写。写的时候对着代码改正了一处：设了密码的 daemon 对中继连接是「带了密码就校验，不带任何凭据的暂时仍放行」（`session-admission-auth.ts` 的 `COMPAT(relayPasswordOptional)`），不是一律要求密码。

#### 评审（2026-10-11）

对未提交的改动加 PR 正文草稿做了 Standards、Spec、Visual 三个维度的评审，修一次、只对修过的地方复查一次。这张工单没有产品代码改动，发现都落在文字上。

- Standards：`docs/release.md` 没有硬性违规。硬性的 5 条里 4 条在 PR 正文草稿、1 条在新任务目录，都已改：版本错位只写了一个方向，也没说明 `hello.rejected` 为什么不会发给旧客户端（已按 `websocket-server.ts`、`daemon-client.ts` 写成两个方向）；用了术语表不用的「智能体」「子智能体」（改成 Agent、Subagent）；「12 个工作区与根」应是根与 11 个工作区、「没有新增 `.skip`」应是上游带来 2 处而 Osuna 没有加；新任务的 `prd.md` 带了分诊标签 `needs-triage`（已删，阶段由 `task.json` 的 `discover` 表达）。占位符 `{SHA}`、`{CI}` 推送后填。判断项里处理了一条：`docs/release.md` 新小节里「同步点的自检看祖先关系」与上文重复，已删。没有处理、如实报给维护者的：合 v0.11 要重解的 10 个文件清单合完 v0.11 就过时（工单要求写进去，到时删）；OpenCode 2.x 缺口表在 PR 正文、新任务与 05 里各有一份；PR 正文约 200 行，偏长；截图只有合并后的，没有合并前的对照。
- Spec：`docs/release.md` 的六个子项、PR 正文的必含项、OpenCode 2.x 后续任务都齐。指出并已改的：PR 正文「测试的改动」漏了 `pi/tool-call-mapper.test.ts` 里新加的同名辅助函数（01 记过，这次的机械比对只数删改行）；OpenCode 1.x 上报指令列表的时机是每轮开始后，不是每轮结束（`opencode-agent.ts` 在 `turn_started` 之后调 `reportRunningCommands()`）；第三段的摘要把三个测试文件说成了两个；新任务的 `prd.md` 说 `opencode/v2/` 只有一处与上游不同，漏了 `agent.test.ts` 里守着它的那条用例。没有范围蔓延。
- Visual：两条界面验收都满足，没有残留的英文。指出的三处都在这次合并没有动过的文件里（指令菜单与输入框的组件、相关的 zh-CN 文案相对 main 没有差异），没有处理，报给维护者：分组标题写「命令」而提示行写「指令」，同一个面板里两个叫法；第 7 行的指令名被截成 `/lo…` 而同一行的说明占了大半宽度；输入框左上角露出半个被菜单盖住的按钮。口味一条：提示行只有滚到底才看得到。
- 复查：改过的每一句对回代码或 01 – 06 的记录。复查时另改正一处评审没有提的：`protocolVersion` 是 `server_info` 里新增的可选字段，不是 `hello` 里的。
