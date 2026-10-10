# 合并上游 v0.9.0：现状摸底

调查日期 2026-10-10，基于 main `d38d186bd`。数字来自 `git merge-tree` 模拟合并，未改动仓库。

## 基点与范围

- fork 基点：`0f20e6dfe4c2573e203dea2aae00aa5983ce4d62`（上游 main，2026-09-16，#4945）。比上游 `v0.8.0` 多 48 个提交，比 `v0.9.0-beta.1` 少 15 个。
- 上游仓库：`https://github.com/getpaseo/paseo.git`。本仓库没有 `upstream` remote。
- 目标：上游 `v0.9.0` = `7f7e60bcb`（2026-09-22 发布），基点之后共 29 个提交，353 个文件（50 新增、42 删除、246 修改、15 改名）。
- 基点之后 main 上的 375 个提交全部来自 oxy / LFT-OXY，没有合入过上游，merge base 即基点。
- 本地 tag `v0.8.1`…`v0.14.2` 是 Osuna 自己的版本，与上游同名不同物（本地 `v0.9.0` = `5b28df1db`，上游 = `7f7e60bcb`）。抓上游必须 `--no-tags`，上游 tag 用 SHA 或单独命名空间引用。
- Osuna 当前版本 `0.14.2`。

## 上游 29 个提交的内容

| 类别 | 提交 |
| --- | --- |
| 聊天内查找 | #4991 #5129 #5146 #5167 |
| 插件 | #4942 #4971 #4970 #4972 #4975 |
| 输入框与附件 | #4958 #4973 #5168 |
| PR 标签页自动打开 | #4956 |
| 性能 | #5007（桌面 daemon 管理内存）#5040（只订阅本会话打开的聊天）#5013（逐字流式） |
| Pi | #4413（按模型的 thinking 配置） |
| 官网 | #4990 |
| 发版与 CI | 3 次 cut、3 次 changelog、3 次 lockfile/Nix hash、2 次 desktop CI |

## 冲突规模

两边都动过的文件 108 个，实际冲突 46 个。

| 合并到 | 冲突文件 | 机械性 | 代码 |
| --- | --- | --- | --- |
| `v0.9.0-beta.1`（15 个提交） | 33 | 15 | 18 |
| `v0.9.0-beta.2`（21 个提交） | 36 | 15 | 21 |
| `v0.9.0`（29 个提交） | 46 | 19 | 27 |

机械性 = 12 个 `package.json`、`package-lock.json`、`CHANGELOG.md`、`README.md`、4 个 fastlane changelog。

beta.1 之后才出现的冲突：Pi 四个文件、`agent-manager.ts`、`agent-projections.ts`、终端两个文件、`desktop-release.yml`、fastlane 四个。

### 代码冲突清单（冲突处数 / 涉及行数）

| 文件 | 规模 | Osuna 侧的改动来源 |
| --- | --- | --- |
| `packages/server/src/server/agent/providers/pi/agent.test.ts` | 2 / 423 | `c1c21c76d` Pi 思考档位 |
| `packages/server/src/server/agent/providers/pi/agent.ts` | 3 / 86 | 同上 |
| `packages/server/src/server/agent/providers/pi/rpc-types.ts` | 1 / 6 | 同上 |
| `packages/server/src/server/agent/providers/pi/test-utils/fake-pi.ts` | 1 / 9 | 同上 |
| `packages/server/src/server/agent/agent-manager.ts` | 3 / 23 | 多智能体协作、第三方接口 |
| `packages/server/src/server/agent/agent-projections.ts` | 1 / 10 | 同上 |
| `packages/server/src/server/persisted-config.ts` | 1 / 14 | 第三方接口 |
| `packages/server/src/server/plugins/runtime.ts` | 1 / 5 | `584c270bb` 删外链 |
| `packages/server/src/server/plugins/*.posix.test.ts`（3 个） | 5 / 25 | 同上 |
| `packages/protocol/src/messages.ts` | 1 / 59 | provider 版本与升级、agentMentions |
| `packages/protocol/src/plugin-requirements.ts` + test | 2 / 10 | `584c270bb` |
| `packages/app/src/screens/settings/plugins-page.tsx` | 3 / 82 | 设置页新外观、i18n 迁移 |
| `packages/app/src/composer/draft/workspace-tab.tsx` | 1 / 78 | 套餐用量窄栏、@ 提及 |
| `packages/app/src/composer/index.tsx` | 3 / 29 | 同上、Skill block |
| `packages/app/src/components/settings/index.tsx` | 1 / 12 | `f8e980a85` 设置页新外观 |
| `packages/app/src/stores/workspace-layout-store.ts` + storage | 2 / 19 | 会话历史侧栏 |
| `packages/app/src/terminal/runtime/terminal-emulator-runtime.ts` | 1 / 7 | 终端内边距、等宽字体栈 |
| `packages/app/src/terminal/webview/terminal-emulator-webview-html.ts` | 1 / 5 | 同上 |
| `packages/app/src/plugins/registry-requirements.test.ts` | 1 / 7 | `584c270bb` |
| `packages/app/vitest.config.ts` | 1 / 11 | — |
| `packages/app/src/components/ui/external-link.tsx` | 删除 vs 修改 | `584c270bb` 已删，上游 #4972 改了它 |
| `.github/workflows/desktop-release.yml` | 2 / 128 | Osuna 桌面身份与自签名 |
| `docs/data-model.md` | 1 / 20 | — |

## 已知的重复实现

Pi 按模型的 thinking 配置两边各做了一遍：

- Osuna `c1c21c76d`（2026-09-29）：`getSupportedPiThinkingLevels` 按 `thinkingLevelMap` 过滤，`clampPiThinkingLevel` 切模型后对齐，`readAppliedThinkingLevel` 设置后回读。
- 上游 #4413 `ee7949ae2`（2026-09-21）：模型定义直接带 `thinkingOptions` / `defaultThinkingOptionId`，同时改了 `agent-manager.ts`、`composer/agent-controls/index.tsx` 和一条 e2e。

## 版本号与发版元数据相撞

- Osuna 自己发过 `0.9.0`（`5b28df1db`，2026-09-27），fastlane `90001.txt`–`90004.txt` 与上游同名同路径，add/add 冲突。
- `CHANGELOG.md` 冲突 350 行：两边各自的 0.9.0 条目。

## Osuna 侧需要守住的既有决定

- `584c270bb`：应用与 CLI 的更新、外链只指向本仓库；删除上游文档站、Sponsor、Discord 入口；`ExternalLink` 组件随之删除。
- `703d0f48c`：桌面 App 身份为 Osuna，userData 与日志目录固定在 Paseo。
- `ff37392c9`：macOS 包用固定自签证书签名。
- `ab6d41176`：设置界面文案走翻译键，`packages/app/src/i18n/resources.test.ts` 有源码扫描清单。

## 访谈定下的决定（2026-10-10，用户逐条确认）

1. 目标分支是 main。独立化分支 `osuna-decouple-standalone` 与 PR #12 已由用户关闭并删除，不在范围内，也不再作为约束。
2. 整版合并上游 `v0.9.0`，用真正的 git merge，保留上游历史，使后续版本从 `v0.9.0` 接着合。
3. 本次只做 `v0.9.0`，做完再决定 `v0.10`–`v0.11.2` 的节奏。
4. 冲突原则：Osuna 有意做的产品决定优先（桌面身份 Osuna、外链只指向本仓库、设置页外观、界面中文）；其余两边改动都保留。
5. 两边重复实现时以上游写法为底，补回 Osuna 多出的行为，并用测试证明行为未丢。目前只有 Pi thinking 一处。
6. 版本号、`CHANGELOG.md`、fastlane changelog 沿用 Osuna 自己的，不搬上游条目；上游带来的内容在 Osuna 下次发版的更新日志里说明。
7. 分三段：`v0.9.0-beta.1` → `v0.9.0-beta.2` → `v0.9.0`，每段检查通过再做下一段，同一条分支，main 只在最后变一次。
8. 验收：GitHub 检查全绿（Nix / Nix Update Hash 除外）；dev 桌面端逐项实测并截图——provider 版本显示与一键升级、@ 提及智能体、第三方接口切换、会话历史侧栏、输入框套餐用量与 Skill block、终端内边距与字体、设置页新外观、Pi 思考档位、外链只指向本仓库；上游新功能冒烟——聊天内查找、附件上传显示、PR 标签页自动打开；用户最终确认后才并入。原生端免验收。

按常规默认、已告知用户且未被否决：

- 在单独分支上做，经 PR 并入，PR 必须用 merge commit，不能 squash（squash 会丢掉上游历史，第 2 条即失效）。
- 任务止于并入 main，不含发版。
- 上游新带进来的界面文案要有 zh-CN，缺的补上。
- 上游新增的 `COMPAT(...)` 标签版本号改写为 Osuna 的下一个版本。
- 把合并上游的步骤与坑写进 `docs/release.md` 的「Fork 分发」一节，供后续版本照做。

## 其他工作线

`multi-provider-accounts`（worktree `vengeful-goat`）目前落后 main 13 个提交、没有自己的提交和未提交改动。它若在本任务期间开工，改动面（provider、protocol、设置页）与本次冲突区重叠。

## 复现

```bash
git clone --filter=blob:none --no-checkout --no-tags https://github.com/getpaseo/paseo.git <tmp>
git -C <tmp> fetch --no-tags origin refs/tags/v0.9.0:refs/tags/v0.9.0
git -C <tmp> fetch --no-tags <本仓库路径> HEAD:refs/osuna/main
git -C <tmp> merge-tree --write-tree --name-only --no-messages refs/osuna/main v0.9.0
```
