# 03 — 整体验收并入 main

**What to build:** 维护者拿到一份凭证据就能做决定的验收结果：硬指标逐条核对过，冲突涉及的四处功能在 dev 桌面端实测并有截图，`docs/release.md` 里的同步点更新到 v0.9.2，草稿 PR 的正文按证据要求写好。维护者确认后，合并分支以 merge commit 并入 main，main 从此包含上游 v0.9.2 的历史。这是唯一会改变 main 的一张工单。规格见 `prd.md` 的「UI and Design」「Testing Decisions → 验收清单」「文档」；PR 证据要求见 `docs/qa.md`。

**Blocked by:** 02
**Status:** ready-for-agent
**Impl:** done

- [x] 合并分支已吸收 main 在此期间的新提交（用 merge，不用 rebase）；`818658520`、`c67b7158b` 各对应一个 merge commit；抓取上游后分支与上游 main 的共同祖先是 `c67b7158b`。
- [x] 所有工作区版本号为 `0.14.2`；`package-lock.json` 与 main 逐字节相同；`CHANGELOG.md` 不含上游的 0.9.1、0.9.2 条目。
- [x] `docs/release.md`「合并后核对」对分支头再逐项过一遍：更新源、桌面身份与数据目录、签名与签名断言、只手动触发的部署工作流、上游站点链接数不多于 01 的基线、翻译键、`COMPAT(...)` 标签。
- [x] 对比 main 与合并分支，Osuna 侧测试的删改逐条有说明；除 Opus 5.5 默认思考档位与问题卡片「多选题互相替换」这两条外（后一条是工单 02 中维护者 2026-10-10 确认后加的）没有断言被删除、跳过或放宽。
- [x] PR 上 CI 全绿，Nix 与 Nix Update Hash 除外；已知偶发失败重跑后通过。上游新增的 macOS 文件观察作业若因环境原因稳定失败，已停下来问维护者，没有自行删掉或跳过。
- [x] 实测并截图：Claude 模型列表里有 Opus 5.5；新建一个未手动选过档位的 Opus 5.5 对话，思考档位显示「中」，档位列表里没有关闭思考。
- [x] 实测并截图：Claude 回退对话——回退锚点不落在子智能体消息上；能回退到一个没得到回复的轮次之前。
- [x] 实测并截图：刷新一个已有多轮对话的智能体后，时间线里没有重复的消息，历史消息末尾没有 Routing block。
- [x] 多选与单选问题卡片的截图已在 02 存入 `screenshots/`；对分支头复看一遍，结果一致。
- [x] dev 桌面端快速冒烟：侧栏、输入框、设置页、终端打开正常，无报错。不逐项截图。
- [x] `prd.md`「UI and Design」的五个截图验收点全部满足，截图存入任务目录的 `screenshots/`。
- [x] `docs/release.md`「从上游同步」里的当前同步点更新为 v0.9.2 及其提交，本次两段的 merge commit 与 PR 编号补在旁边；本次新踩到、下次还会遇到的坑补进「踩过的坑」，没有就不加。
- [x] PR 正文按 `docs/qa.md` 的证据要求写好，含：两段的冲突裁决摘要；Opus 5.5 默认档位的变化与改掉的那条断言；卡片浏览器测试里按 Osuna 决定改写的用例；平台矩阵，原生端标注免验收。
- [x] 原生端（iOS / Android）免验收。
- [x] 维护者看过截图并明确同意并入。
- [x] PR 以 merge commit 并入 main；并入后 `c67b7158b` 是 main 的祖先。

## Comments

### 2026-10-10 整体验收记录

验收对象是分支头 `322d3ed84`（工单 02 关票时的提交）。本工单没有改产品代码：只改了 `docs/release.md` 的同步点，
加了本记录与 14 张截图。没有走 TDD；整套测试在 CI。

**硬指标（命令见「运行记录」）。**

| 项 | 结果 |
| ---- | ---- |
| main 期间的新提交 | 没有。`origin/main` 仍是 `9010d774c`，是分支的祖先（`0 / 69`），不需要再 merge |
| merge commit | `2887a73f6`（双亲 `9010d774c`、`818658520`），`381896b91`（双亲 `43f9827c7`、`c67b7158b`） |
| 与上游的共同祖先 | 重新抓取上游（不抓 tag）后 `git merge-base HEAD upstream/main` = `c67b7158b`；`git tag` 仍是 14 个 |
| 版本号 | 12 个 `package.json` 都是 `0.14.2`，`@getpaseo/*` 内部依赖没有别的版本 |
| `package-lock.json`、`CHANGELOG.md` | 与 main 逐字节相同（`cmp`）；`CHANGELOG.md` 没有 `## 0.9.1` / `## 0.9.2` |
| `package.json` 相对 main | 只有 `packages/server/package.json` 多一行脚本 `analyze:observer-metrics` |
| 四个 README | 相对 main 零差异 |
| 安卓商店说明 | 新增 8 个文件（`90011`–`90014`、`90021`–`90024`），没有改动已有文件 |

**合并后核对（对分支头，`git diff origin/main HEAD`）。** 全部无变化：

- 更新源：`electron-builder.yml` 的 `publish` 是 `github` / `LFT-OXY` / `Osuna`，文件相对 main 零差异。
- 桌面身份与数据目录：`appId: com.chinhae.osuna.desktop`、`productName: Osuna`；`main.ts` 零差异，
  `USER_DATA_DIR_NAME = "Paseo"`。
- 签名与签名断言：`desktop-release.yml`、`mac-sign.js`、`verify-mac-signature.mjs` 零差异；工作流里
  `mac-sign.js` 2 处、`OSUNA_MAC_SIGNING_SHA1` 2 处、`Verify macOS signature` 1 处，Apple 公证变量 0 处。
- 只手动触发的部署工作流：四个文件的 `on:` 都只有 `workflow_dispatch`。`.github/workflows` 相对 main 只有
  `ci.yml` 多 31 行（上游的 `server-tests-macos` 作业）。
- 上游站点链接数：`packages/app/src` 70 / 非测试 1，`packages/cli/src` 13 / 非测试 3，与 01 的基线相同。
- 翻译键：`packages/app/src/i18n` 零差异。设置界面相对 main 只有 `keyboard-shortcuts-section.tsx` 一处按键判断（+1 / −2），
  没有新的用户可见文案，无需新增翻译键。
- `COMPAT(...)` 标签：新增 0。`packages/protocol/src` 零差异。

**Osuna 侧测试的删改（`git diff origin/main HEAD -- '*.test.*' '*.spec.*'`）。**

- 测试文件：改 56 个、新增 12 个、删除 0 个、改名 0 个。新增的 `.skip` / `.only` / `.todo` / `.fixme` 0 处。
- 56 个里有删行的 30 个。其中 24 个 Osuna 自同步点 `7f7e60bcb` 起没碰过（`git diff 7f7e60bcb origin/main`
  为空），删掉的都是上游改自己的用例。
- 剩下 6 个两边都改过，逐行核对被删的行是否在同步点里就有（有 = 上游的行）：

| 文件 | 删掉的非空行 | 其中 Osuna 写的 | 说明 |
| ---- | ---- | ---- | ---- |
| `plugin-provider.test.ts` | 1 | 0 | 上游改自己的 import |
| `acp-agent.test.ts` | 6 | 0 | 上游改自己的 `createSession` 辅助函数 |
| `codex-app-server-agent.test.ts` | 1 | 0 | 上游改自己的 `thread/list` 参数 |
| `opencode-agent.test.ts` | 35 | 0 | 上游重写自己的权限规则用例（#5296） |
| `claude/models.test.ts` | 36 | 23 | 以上游文件为底重做，逐行对应见工单 01 的表。结论改动只有一处：默认思考档位 `high` → `medium`（同一条 `it.each` 的两行参数）；其余是换成上游的等价写法，`us.anthropic.` 的两条断言单独成条保留 |
| `question-form-card-core.test.ts` | 10 | 10 | 见工单 02：`typed other text and preset options replace each other` 由多选题改为单选题（标题、夹具与用例里的两处调用共 4 行），另 4 处 `setQuestionOtherText` 调用补 `questions` 参数（6 行，其中一处换行后占 3 行；断言不变） |

本条验收项的原文写「除 Opus 5.5 默认思考档位那一条外」，写在工单 02 问维护者之前。按 `prd.md` 现在的口径是两条
例外：再加问题卡片那一条用例，维护者 2026-10-10 已确认（工单 02「规则裁决不了、问过维护者的两处」）。除这两条外
没有 Osuna 的断言被删除、跳过或放宽。

**dev 桌面端实测（macOS，Electron，窗口 1280×900，浅色，中文）。** 实测前 `npm run build:server`；启动日志的
`Home:` 是 `.dev/paseo-home`，daemon 在 6769，正式版的 6767 全程在。截图在 `screenshots/`，文件 1920 像素宽
（逻辑视口 1280，2 倍屏缩小后入库）。

Opus 5.5（只看草稿，没有发消息）：

| 截图 | 看到的 |
| ---- | ------ |
| `claude-model-list_opus-5-5-listed` | Claude 模型列表第一项是 Opus 5.5「Latest release」，已选中 |
| `claude-draft_opus-5-5-default-thinking-medium` | 新建草稿：Claude / Opus 5.5 / 档位 `Medium`。截图前清掉了 dev 客户端里记着的档位（`@paseo:create-agent-preferences` 的 `thinkingByModel["claude-opus-5-5"]`，原值 `high`），实测后已还原 |
| `claude-thinking-list_opus-5-5-medium-default-no-off` | 档位滑杆 6 档（`aria-valuemin 0` / `max 5`），当前第 2 档 `Medium` |
| `claude-thinking-list_opus-5-5-lowest-stop-is-low` | 拖到最左一档是 `Low`，没有关闭思考 |

daemon 给的清单一致（`paseo provider models claude --json`）：Opus 5.5 的 `thinkingOptionIds` 是
`low, medium, high, xhigh, max, ultracode`，`defaultThinkingOptionId` 是 `medium`；Opus 5 仍有 `off`、默认 `high`。
界面上档位名是英文 `Medium`，不是「中」：档位名来自提供方，`composer/agent-controls/` 相对 main 零差异，合并前
就这样。验收项写的是「新建…对话」，这里只看了草稿，没有用 Opus 5.5 真的发消息。

客户端会记住档位，这一点影响「默认变为中」的覆盖面：新建 Agent 提交时，客户端把当时的档位写进
`thinkingByModel`（`use-agent-form-state.ts:148`），不管它是手动选的还是默认带出来的。所以合并前在某台客户端上
用 Opus 5.5 建过 Agent 的人，那台客户端记着 `high`，合并后新草稿仍是 High；看到 `Medium` 的是没记过的
客户端，以及不指定档位的 CLI、`create_agent` 与 Agent mention。这段代码相对 main 零差异，上游也是这样。

Claude 回退对话与重新加载。用真实的 Claude（Haiku 4.5、Always ask 模式）在 `/tmp/osuna03-qa-repo` 里建了一个
对话，每轮只让它回一个词：

| 轮 | 内容 |
| ---- | ---- |
| 1 | 回 `ALPHA` |
| 2 | 起一个 Subagent（Haiku 自己放到了后台跑），回 `SUBAGENT SAID BETA` |
| 3 | 回 `GAMMA` |
| 4 | 提及 `@Mock Load Test`，Claude 按 Routing block 调 `create_agent` 起了一个模拟 Agent，回 `DELTA` |
| 5 | 发出后 420 毫秒点停止，没有得到回复 |
| 6 | 起一个前台 Subagent，回 `SUBAGENT SAID ZETA` |
| 7 | 回 `ETA` |

| 截图 | 操作与结果 |
| ---- | ------ |
| `claude-chat_before-reload-agent`、`claude-chat_tab-menu-reload-agent` | 第 4 轮结束后，标签页右键菜单 →「重新加载 Agent」 |
| `claude-chat_after-reload-agent-toast`、`claude-chat_after-reload-agent`、`claude-chat_after-reload-agent-top` | 提示「已重新加载 Agent」。时间线前后都是 13 项，重复 0 项；聊天区文字里没有 `paseo-system`、没有 Routing block 的正文。提供方会话文件里第 4 轮的用户消息长 1591 个字符、以 `</paseo-system>` 结尾，界面上只显示用户写的那一句 |
| `claude-rewind_to-turn-after-subagent-turn-menu-open`、`…-after` | 在第 7 轮上「回退对话」（它前一轮是带前台 Subagent 的第 6 轮）：0.5 秒内完成，无报错，第 7 轮消失、文字回到输入框。回退生成的新会话最后一条是主对话的 `SUBAGENT SAID ZETA`（`isSidechain` 为否），锚点没有落在 Subagent 的消息上 |
| `claude-rewind_to-turn-after-unanswered-turn-menu-open`、`…-after` | 在第 6 轮上「回退对话」（它前一轮是没得到回复的第 5 轮）：无报错，时间线停在第 4 轮的 `DELTA`，第 5、6 轮都撤掉了，回到输入框的是第 6 轮的文字。新会话最后一条是 `DELTA`。没得到回复的第 5 轮一并撤掉是上游的设计（`claude/agent.ts` 的注释：这样的轮次「carries no conversation state worth preserving」，分叉点取它之前最近一个有回复的轮次） |
| `claude-rewind_context-after-rewinds` | 回退后再发一条，让它列出看得到的轮次编号，回答 `1, 2, 3, 4, DONE` |

daemon 日志里没有 `not found in session`、`cannot preserve`。两次 `agent.rewind.request` 耗时 13 / 17 毫秒。

这两次回退证明的是「在真实的 Claude 上回退成功、分叉点在主对话的回复上」。第二次（越过没回复的轮次）正是上游
修的情形：旧代码只看紧邻的前一轮，会报 `cannot preserve turn`。第一次不一定踩中上游修的那个条件
（`agent.rewind-anchors.test.ts` 的用例是「该轮最后一条 assistant 消息来自 Subagent」；实测第 6 轮最后一条
本来就是主对话的回复），那个条件由上游的 4 条单元测试守着（CI 的 server-tests）。

问题卡片复看（对分支头）。工单 02 的四张截图重看过；另在 dev 桌面端重做了一遍：多选题勾 iOS、Web 再在「其他」
里填 watchOS，三者同时可见，提交后回显 `platforms=iOS, Web, watchOS`；单选题底部只有「跳过」，点 Dark 后卡片
消失，回显 `theme=Dark`。与 02 一致，没有另存截图。mock 的多选题没有「其他」行，复看时用了 02 留下的临时补丁
（`allowOther: true`），看完已 `git apply -R` 并重建 server，没有提交。

快速冒烟：侧栏（切工作区、历史页）、输入框（输入再清空）、终端（新开一个，58 行 × 133 列，字体栈以
`SFMono-Regular, Menlo` 开头）、设置页（常规分区与主机下的 11 个分区入口）都正常，渲染进程控制台错误 0 条。

原生端（iOS / Android）免验收。

**实测中看到、不是这次合并带来的两处。** 都没有动，是否另开任务交维护者定。

1. 重新加载或回退之后，Claude 自带 Subagent 的那一行从卡片「派出 1 个 Subagent · general-purpose · Haiku 4.5」
   变成一个普通的工具标记 `Agent`（第 2 轮见 `claude-chat_before-reload-agent` 与
   `claude-chat_after-reload-agent-top`，第 6 轮见 `…after-unanswered-turn-menu-open`）；两次回退后 Subagents
   track 的计数从 3 变成 1。Osuna 用 `create_agent` 派出的那张卡片（第 4 轮）不受影响。
   - 原因：卡片的数据是会话进行中由 `claude/agent.ts` 的 `buildSubagentToolCallCard` 现造的，提供方历史回放里
     没有。这段代码两边一样；卡片的外观是 Osuna 的（`app/src/subagents/dispatch-group.tsx`，上游没有）。
   - 不是合并带来的，依据是代码：合并前的 main 上，「重新加载 Agent」（`session.ts` 的 `refresh_agent_request`，
     处理段相对 main 零差异）就以 `rehydrateFromDisk: true` 调 `reloadAgentSession`，后者先清掉内存里的时间线
     （`timelineStore.delete`）再用提供方历史重放；回退走的「清空再重放」在 main 上也已经有。上游 #5286 这次加的
     是把落盘的旧时间线行也删掉，去的是重复，不改变屏幕上用哪一份。**没有另起一份 main 的构建实测对比。**
2. 重新加载或回退之后，各轮底部的数字跟着回放变了：
   - 回退后留下来的各轮只剩「已工作 Ns」，token 数与费用不见了；耗时也变了（`DELTA` 那一轮 1m 6s → 5m 22s），
     其中一轮一直显示加载占位条（`claude-rewind_context-after-rewinds`）。
   - 重新加载前后最后一轮的页脚不同：`19:29 · ↑10 ↓72 · $0.0040` → `已工作 1m 6s · ↑28 ↓586 · $0.01`
     （`claude-chat_before-reload-agent` 与 `claude-chat_after-reload-agent`）。
   - 这次合并改了 Claude 回退选哪条消息做分叉点（`claude/agent.ts`），没有改用量与页脚：`server/usage`、
     `session/usage`、`app/src/agent-stream`、`components/rewind` 相对 main 零差异，`agent-manager.ts` 与
     `session.ts` 的合并改动里没有用量的行。按 `docs/glossary.md`，Turn usage 以提供方自己的轮次标识为键，回退
     生成新会话、重放重新划分轮次之后对不上是说得通的，但**原因没有查到底，也没有在 main 上实测对比**。

本工单没有新踩到「下次合并还会遇到」的坑，`docs/release.md`「踩过的坑」不加条目。

**对本机的影响与清理。**

- 用了真实的 Claude：Haiku 4.5，8 条短消息加两个只回一个词的 Subagent，界面显示上下文约 32K，每轮费用
  $0.003–$0.04。会话文件写在 `~/.claude/projects/-private-tmp-osuna03-qa-repo/`（3 个会话：原会话与两次回退
  生成的），我只读了它们来核对锚点和 Routing block，没有删。没有改 `~/.claude` 下的任何配置。
- 已做：停掉 dev 桌面端（6769、8082 不再监听，6767 仍在）；`.dev/paseo-home/config.json` 与实测前逐字节相同；
  dev 客户端的草稿偏好还原为实测前的值；删掉 `packages/app/.qa03/` 下的临时脚本；撤销 mock 补丁并重建 server。
- 留着的：dev 数据目录里的 4 个测试对话（1 个 Claude、3 个模拟）与 `/tmp/osuna03-qa-repo`，不影响正式版。
- 截图里有侧栏的项目名和 Claude 套餐档位与用量百分比（`Max 20x`、`5h 3%` 等）。上次合并（PR #13）维护者选择
  保留这类信息，这次照此处理；本仓库是公开的。

**运行记录（2026-10-10，本机）。**

```bash
git fetch origin && git fetch upstream --no-tags
git rev-list --left-right --count origin/main...HEAD                          # 0  69
git merge-base HEAD upstream/main                                              # c67b7158b…
git log --merges --format='%h %p' 9010d774c..HEAD                              # 两个 merge commit 与双亲
for f in package.json packages/*/package.json; do node -p "require('./$f').version"; done   # 12 行 0.14.2
git show origin/main:package-lock.json | cmp - package-lock.json               # 相同
git show origin/main:CHANGELOG.md | cmp - CHANGELOG.md                         # 相同
git diff origin/main HEAD -- package.json 'packages/*/package.json'            # 只多一行脚本
git tag | wc -l                                                                # 14
git diff --stat origin/main HEAD -- README.md README.ja.md README.ko.md README.zh-CN.md   # 无输出
git diff --name-status origin/main HEAD -- fastlane                            # 8 行，全是 A
git diff --stat origin/main HEAD -- packages/desktop/electron-builder.yml packages/desktop/src/main.ts \
  packages/desktop/scripts/mac-sign.js scripts/verify-mac-signature.mjs        # 无输出
grep -c mac-sign.js .github/workflows/desktop-release.yml                      # 2；OSUNA_MAC_SIGNING_SHA1 2；Verify macOS signature 1
grep -c -i -E 'APPLE_ID|APPLE_TEAM_ID|APPLE_APP_SPECIFIC|notariz' .github/workflows/desktop-release.yml   # 0
git diff --stat origin/main HEAD -- .github/workflows                          # 只有 ci.yml +31
rg -n -i "$PAT" packages/app/src | wc -l                                       # 70；非测试 1（PAT 见 docs/release.md）
rg -n -i "$PAT" packages/cli/src | wc -l                                       # 13；非测试 3
git diff origin/main HEAD -- packages | rg '^\+.*COMPAT\('                     # 无输出
git diff --diff-filter=DR --name-status origin/main HEAD -- '*.test.*' '*.spec.*'   # 无输出
git diff origin/main HEAD -- '*.test.*' '*.spec.*' | rg '^\+.*\.(skip|only|todo|fixme)\('   # 无输出
git diff --diff-filter=M --numstat origin/main HEAD -- '*.test.*' '*.spec.*'   # 56 个文件，30 个有删行
git diff --numstat 7f7e60bcb origin/main -- <上面 30 个文件逐个>                 # 24 个无输出（Osuna 没碰过），6 个有
git diff origin/main HEAD -- packages/server/src/server/session.ts | grep -c 'refresh_agent_request\|rehydrateFromDisk'   # 0
npm run build:server                                                           # 通过（实测前、撤销补丁后各一次）
paseo provider models claude --host 127.0.0.1:6769 --json                      # Opus 5.5 默认 medium，无 off
```

**评审（`atw-code-review`，Standards、Spec、Visual 三轴，各一个独立子代理，只读）。** 评审在提交之前、对工作区做的。

- Standards，已修并复查：
  - 「用量与回退相关的代码相对 main 零差异」与「带进了上游的回退修复」矛盾。属实：合并改了 `claude/agent.ts` 的回退
    分叉点。已改写为「改了分叉点、没有改用量与页脚的代码，原因没有查到底」。
  - 术语「子 Agent」改为 `docs/glossary.md` 的 Subagent。
  - 运行记录缺命令：补了 `git tag`、README、`fastlane`、签名计数、公证变量、24 个未碰文件、重新加载处理段的命令。
  - `docs/release.md` 的表：第一行补上上游发布点的提交，「更新这一句」补上「并在下表加一行」，去掉重复的提交号。
  - 被删行的算术（「5 处调用 8 行」）算不拢，按 diff 重数后改写；PR 正文的 skip 清单补 `.fixme`；PR 正文补上
    「截图前清掉了记着的档位」。
  - 判断项，原样上报：`docs/qa.md` 要命令连同原始输出，运行记录与 PR 的「硬指标」仍是命令加结果摘要（PR #13 同样
    写法）；逐次同步的表会越积越长；记录里用「对话」指 Agent session（沿用验收项原文与界面上的「回退对话」）。
- Spec，已处理：
  - **「重新加载后 Subagent 卡片降级应停下来问」**：评审认为卡片是 Osuna 独有的、重新加载的行为是这次合并改的。
    回头读了 main 的代码：重新加载在合并前就先清空内存时间线再重放，处理段零差异。原记录里「合并前的 main 是把
    回放追加在已有时间线后面」写错了，已更正，结论改为「不是这次合并带来的（读代码，未实测）」，仍列出交维护者定。
  - 被清掉的 `high` 不能叫「手动选择」，且提交时客户端会把默认档位也记下来。属实（`use-agent-form-state.ts:148`）。
    记录、PR 正文、`prd.md` 都补上了「默认档位变化对哪些人可见」。
  - 回退实测的第一次不一定踩中上游修的条件。属实，已在记录与 PR 正文写明，那个条件由上游的单元测试守着。
  - 验收项第 4 条的文字只写了一条例外，已按 `prd.md` 改成两条；补写「03 没有新坑」与设置界面的翻译排查；PR 正文
    段 2 的「机械性 18」改成逐项列出。
  - `Medium` 对「中」、只看草稿没有真的新建对话：在记录里注明后勾选，依据是档位 `medium` 与 daemon 的清单。
- Visual：验收点 1、2、3、5 满足；4 的档位名是英文；6 提出没回复的第 5 轮一并消失，已查明是上游的设计并写进记录。
  指出的三处前后不一致（卡片降级与计数、回退后页脚数字、重新加载前后页脚不同）都并进了上面的两处。口味项：
  滑杆在最低档时左侧仍有一段着色轨道，没有动。
- 修正后的复查：只对改过的段落重读了一遍，并用 grep 核对旧说法已不在。没有做第二轮完整评审。

**规范补充。**

- `.atw/spec/app/frontend/testing.md`「Running」：看模型默认思考档位前先清掉客户端记着的 `thinkingByModel`；
  思考档位是滑杆，读 `aria-value*`。
- `.atw/spec/server/backend/testing.md`「Running」新增「Manual QA against a real Claude session」：造未回复轮次、
  前台 Subagent、Routing block 的做法；重新加载与回退是重放，前后不同不等于回归，下结论前先读基线分支的处理代码。
- `prd.md`「Further Notes」补两条：档位名与默认档位变化的可见范围；重放后卡片与用量数字的变化不在本次范围。

**验收项说明。**

- 评审之后没有勾的 3 条：`PR 上 CI 全绿`——本工单的提交推送后看这一轮；`维护者看过截图并明确同意并入`、
  `PR 以 merge commit 并入 main`——等维护者。三条都在并入后勾上，依据见下面三节。
- 第 6 条（Opus 5.5）按「档位为 `medium`、界面显示 `Medium`、只看了草稿」勾的。
- 第 1 条：main 期间没有新提交。并入前若 main 有变化，要再 merge 一次并重看 CI。

### 维护者的确认（2026-10-10）

- 评审之后把验收结果、14 张截图与三件需要知道的事（默认档位变化对哪些人可见、重放后 Subagent 卡片降级、重放后页脚数字
  变化）报给维护者，问是否同意把 PR #14 并入 main，并说明并入后不好撤回。维护者答复「同意」。
- 「实测中看到、不是这次合并带来的两处」是否另开任务没有答复，不挡并入。

### 并入前的 CI（`9eae0db74`，run `38049842750`）

- 第一次：20 项里 19 项通过，`playwright (shard 1/4)` 失败。失败的是 `e2e/browser/agent-message-rewind.spec.ts:48`
  （回退消息，用模拟 Agent），首次与自动重试都没过：后台已报回复完成，界面 10 秒内没显示到结尾。这个提交相对上一轮
  全绿的提交只加了文档和截图。
- 本机对照：在 `/tmp` 建一份合并前 main 的副本，与合并分支交替各跑 3 轮（每轮把这个用例文件连跑 3 遍）。失败的都是
  同一条用例、同一种报错：

  | | 第 1 轮 | 第 2 轮 | 第 3 轮 | 合计 |
  | ---- | ---- | ---- | ---- | ---- |
  | 合并前的 main | 0 | 2 | 3 | 9 次里 5 次 |
  | 合并分支 | 2 | 2 | 2 | 9 次里 6 次 |

  合并前就以差不多的比例失败，判为用例对时间敏感，不是这次合并带来的。逐字显示、模拟 Agent、消息推送的代码与用例
  文件这次合并都没改。它为什么在本机这么容易超时没有查，是上游测试自身的问题，不在本次范围。临时副本已删。
- 重跑失败的分片（attempt 2）：通过，`gh pr checks 14` 的 20 项全部 `pass`。该分片的汇总是 `157 passed`、`1 flaky`，
  回退用例那一行是 `✓`；`1 flaky` 是哪一条没有核对。这条用例按新发现的偶发记。

### 并入结果（2026-10-10）

- 并入前：`origin/main` 仍是 `9010d774c`；PR 状态 `MERGEABLE` / `CLEAN`，分支头 `9eae0db74`。
- `gh pr ready 14` 后 `gh pr merge 14 --merge`：PR #14 于 2026-10-10T12:54:12Z 并入。merge commit 是 `0bfa35fda`，双亲
  `9010d774c`（并入前的 main）与 `9eae0db74`。远端分支 `merge-upstream-v0.9.2` 没有删。
- 并入后核对：`818658520`、`c67b7158b` 都是 `origin/main` 的祖先；`git merge-base origin/main upstream/main` =
  `c67b7158b`，与 `docs/release.md` 写的当前同步点一致；`git tag` 仍是 14 个。
- 并入 15 秒后，正式 daemon 的「合并后自动归档」归档了这个 worktree 并关掉了里面的 Agent，收尾没来得及做。上面
  三节是之后在主工作树里根据那个 Agent 的会话记录补记的。补记时本机连不上 GitHub，PR 与 CI 页面没有重新查；本地
  git 能核对的（merge commit 的双亲、两个提交是 main 的祖先、tag 数）重新核对过。推 main 触发的那一轮 CI 没有看。
