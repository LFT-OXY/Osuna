# 04 — 第二至四段：合并到 v0.12.0

**What to build:** 合并分支上依次有三个 merge commit，分别合进上游 `c517d07d6`（v0.12.0-beta.2）、`cc748dfe1`（v0.12.0-beta.3）、`cafe4b01c`（v0.12.0），每个 merge commit 之后分支都能通过检查。这三段模拟新增 12、13、8 个冲突文件，带进来新建工作区与打开项目页、套餐用量卡片与格式化、用量来源的快照缓存、设计文档、子 Agent 选择。另有三件事落在这几段：上游把 Playwright 扩到 8 片（第 3 段）、上游新加「不许直接用 Pressable」的检查（第 4 段）、用量来源缓存与 Osuna 的多号轮换并存。规格见 `prd.md`「合并方式」「套餐用量」「代码规范检查」「上游触及、合并后要核对的不变量」。

**Blocked by:** 02, 03
**Status:** ready-for-agent
**Impl:** done

- [x] 三个 merge commit 的双亲分别是合并前的分支头与对应的上游发布点。每段合完都过一遍本清单里的通用项，结果按段记在 `## Comments` 下。
- [x] 上游新增的 Playwright 分片与其他装 Playwright 的新作业都固定到 `ubuntu-24.04`（ubuntu-latest 装不上 Playwright）。
- [x] 「不许直接用 Pressable」检查照收；Osuna 直接用 Pressable 的文件（约 27 个，以实际报错为准）加进它的豁免名单，名单旁注明是 Osuna 合并时加入、待迁移；清单记在 `## Comments` 下。
- [x] 用量来源：上游「最近一次成功的快照」与缓存清理照收，Osuna 的多号轮换、遗忘代数、用掉一次重置保留，有测试证明两者并存（ADR 0015）。
- [x] Refresh all 不换位、刷新失败保留旧值、Cursor 多账号分卡照收；Osuna 的套餐用量入口（用量页卡片、Composer 用量条、上下文圆环悬浮卡）仍有数据。
- [x] 上游 `docs/design.md` 的改动照收；与 Osuna 设置页外观冲突的部分按 Osuna 的。
- [x] 合并前按 `docs/release.md`「合并后核对」的口径统计应用与 CLI 源码中指向上游站点的链接数（全部与非测试），记在 `## Comments` 下；合完后非测试数不多于合并前。
- [x] 每个冲突文件怎么裁的、依据哪条规则，按区域逐个记在 `## Comments` 下，供 14 写 PR 正文用。规则裁决不了、或保留两边会改变用户可见行为的冲突没有自行取舍：已停下来问过维护者，问答记在 `## Comments` 下。
- [x] 所有工作区版本号是 `0.17.0`；各 `package.json` 相对合并前的差异只有上游在版本号之外的改动；`package-lock.json` 是重新生成的，差异能逐项对应到上游新增或升级的依赖。
- [x] `CHANGELOG.md` 与合并前逐字节相同；与 Osuna 同名的安卓商店说明文件留 Osuna 的；README 与 `CLAUDE.md` 的冲突块取 Osuna 的。
- [x] 协议新增的字段都是可选的，协议的现有测试无一改动断言；上游新带进来的 `COMPAT(...)` 标签（合并前 main 上不存在的名字）改写为 `v0.18.0`，清单记在 `## Comments` 下。
- [x] `docs/release.md`「合并后核对」逐项过完，结果记在 `## Comments` 下：更新源、桌面身份与数据目录、签名与签名断言、只手动触发的部署工作流、上游站点链接、翻译键。
- [x] 翻译资源测试单独跑过并通过；上游新增的键九种语言齐全，zh-CN 是真实翻译、符合术语表。
- [x] 对本段冲突涉及的测试文件对比合并前后，没有 Osuna 的断言行被悄悄删掉；必须跟着改的断言逐条记在 `## Comments` 下。
- [x] 指令目录的现有测试全部通过，无一改动断言；取指令列表不启动进程（ADR 0003）。
- [x] typecheck 和 lint 通过；本段冲突文件对应的测试文件、以及本段新增或改动过的测试文件逐个单独跑过并通过（不跑整套）。
- [x] dev 桌面端快速冒烟：侧栏、输入框、新建工作区页、用量页、Providers 页打开正常，无报错。

## Comments

### 三段与双亲
- 第 2 段 v0.12.0-beta.2：merge `16d847b51` = `223d38be0` + `c517d07d6`，适配 `4633a4393`。git 报 31 个冲突文件。
- 第 3 段 v0.12.0-beta.3：merge `a5eb7c89a` = `4633a4393` + `cc748dfe1`，适配 `bba9d2374`。31 个。
- 第 4 段 v0.12.0：merge `80515069f` = `bba9d2374` + `cafe4b01c`，适配 `17dc4c830`。26 个。
- 逐文件裁决、依据的规则、每段的核对与测试结果见 `research/stage2-4-resolutions.md`（按段、按区域）。

### 上游站点链接（全部 / 非测试）
- 合并前（`223d38be0`）：app 74 / 1，cli 13 / 3。
- 第 2、3 段后不变；第 4 段后 app 75 / 1、cli 13 / 3。多的 1 处在上游 #7361 的 `components/markdown/renderer.test.ts` 测试样例，不改。非测试数不变。

### `no-raw-pressable` 豁免（21 个，实际报错数，prd 估计约 27）
`agent-stream/turn-changed-files-card.tsx`、`agent-stream/turn-usage-segment.tsx`、`api-endpoints/{agent-section,connection-form-sheet,host-list-section,models-section,request-extras-fields}.tsx`、`components/branch-switcher.tsx`、`components/provider-catalog-list.tsx`、`components/usage/{usage-details-card,usage-overview-card,usage-requests-table,usage-segmented-control,usage-session-list}.tsx`、`logic-map/canvas.tsx`、`price-table/litellm-price-group.tsx`、`provider-detail/{header,models}.tsx`、`screens/settings/appearance/font-picker-row.tsx`、`screens/settings/mention-defaults-section.tsx`、`subagents/dispatch-group.tsx`（都在 `packages/app/src/` 下）。在 `.oxlintrc.json` 里单独成块，注释写明 Osuna 合并上游 v0.12.0 时加入、待迁移。放进了第 4 段的 merge commit 而不是适配提交：merge commit 改到了其中的 `provider-catalog-list.tsx`，不放进去提交钩子的 lint 过不了。迁移的后续工单留给工单 14 记。

### COMPAT 改写（合并前 main 上不存在的名字 → v0.18.0，日期不动）
`dictationCapture`（expo-two-way-audio/src/core.ts）、`usageLastSuccessful`（app usage/model.ts）、`usageSuccessfulAt`×2（app usage/model.ts、cli commands/usage/presentation.ts）、`paseoToolCallDetail`（protocol/src/paseo-tool-call-detail.ts）。另：随代码从 card.tsx 挪进 model.ts 的 `usageLoginErrors`（合并前就有的名字）写回 Osuna 原来的 v0.15.0。

### 问过维护者的（2026-10-26）
- 聊天 Markdown 块间距：上游 #7298 改成每块后同一个间距（窄 12、宽 16），Osuna 各块有自己的边距。维护者答「用上游的统一间距」。Osuna 的字号、颜色、代码块外框等样式不变。

### 因此改动的 Osuna 断言（PR 正文要列）
- `components/markdown/renderer.test.ts`：段落下边距 `spacing[3]` → `16`；compact 段落下边距 `spacing[2]` → `12`；Web 代码块外框 `marginVertical: spacing[3]` → 断言外框不带 `marginVertical`（间距由渲染库包在外面）。调用跟着新签名改成 `{ blockGap }`。
- 改写的上游测试（断言不变，只改调用）：`usage-sources/index.test.ts` 里上游新用例的位置参数构造函数改成 Osuna 的选项对象（第 3 段 5 处、第 4 段 1 处）；`e2e/browser/provider-catalog-icons.spec.ts` 按 Osuna 的「添加提供方」弹窗结构改写（按行找图标、图标 20px）。
- 底线守卫报的其余 9 条「删掉的断言」（usage-modal.spec、renderer.test 318/575/589、mcp-server.test、acp-agent.test ×2、opencode bridge.test ×2）都是上游在这三段里改自己的用例，合并前就是上游的行。

### 合并后核对（每段都过了，三段结果相同）
更新源 `publish` 仍是 LFT-OXY/Osuna；`appId: com.chinhae.osuna.desktop`、`productName: Osuna`，main.ts 的 userData 固定不变；desktop-release 的签名钩子、`OSUNA_MAC_SIGNING_SHA1`、Verify macOS signature 都在；四个部署工作流只有 `workflow_dispatch`；版本号全 0.17.0；三段的 package.json 相对合并前只多了第 3 段 server 的 `test:integration`（上游合并调用 + 补回 Osuna 两个 e2e）；锁文件三段重新生成都与合并前相同；CHANGELOG 逐字节相同；安卓商店说明 120001–120004 留 Osuna 的；本段没有 README / CLAUDE.md 冲突；协议新增字段（`lastSuccessful`、`successfulAt`）可选，新增的只有一个转出文件；`bootstrap.ts` 本工单未改；第 3 段新加的 Playwright 分片 5–8 改成 `ubuntu-24.04`。翻译键：第 3 段为上游新加的英文硬编码补了三个 `usage.planUsage.*` 键，九种语言齐全，zh-CN 是真实译文；`resources.test.ts` 每段单独跑过并通过。

### 测试
每段新增或改动的测试文件（去掉 `*.real.*`）与冲突文件对应的测试逐个跑过并通过，详见裁决记录各段「核对」。指令目录相关 22 个测试文件通过，现有断言无改动。新增两条用量来源并存用例（关掉读取 CLI 登录凭证后不留快照；CLI 换号后 Agent 启动时的号保留自己的快照）。提供方类 Playwright 用例（含改写的 `provider-catalog-icons.spec.ts`）按约定本机不跑，交 CI。

### dev 桌面端冒烟
侧栏、输入框、新建工作区页、用量页（套餐用量卡片有数据）、Providers 页打开正常。评审后补看套餐用量的另两个入口：Claude 会话的 Composer 用量条有数据（Max 20x、5h、周、Fable 各窗口），上下文圆环悬浮卡里套餐用量一节有数据，控制台无报错。控制台没有新的报错；两条新的 React 开发警告（`accessibilityElementsHidden`、`importantForAccessibility` 落到 DOM）来自上游本期的 `command-center.tsx`、`left-sidebar.tsx`，不是本工单的裁决造成，未改。真实 `~/.codex/config.toml`、`~/.claude/settings.json` 前后逐字节相同。

### 与 prd「合并方式」的两处偏离
- 第 3 段为上游新加的三句英文补的翻译键（`usage/copy.ts` 与九种语言）放在 merge commit `a5eb7c89a` 里，不在适配提交：那三句英文就在冲突块里（`format.ts`、`model.ts`），翻成翻译键是解这几个冲突的一部分。
- 第 4 段的 `no-raw-pressable` 豁免块放在 merge commit `80515069f` 里，原因见上。

### 留给后续工单
- 第 3 段新加的 `usage.planUsage.lastUpdated`、`resetTimePassed`、`noSuccessfulUpdate`：第 5 段上游带进 `providerUsage` 翻译键后可能与之重复，按 prd「套餐用量」删掉重复的那份（工单 06 / 08）。
- `docs/design.md` 写「burn-down 名单只许移出」，Osuna 另加了一块豁免；工单 14 整理文档时在 design.md 补一句并链到 `.oxlintrc.json` 那一块。迁移这 21 个文件的工单也在 14 记下。

### 评审（2026-10-26）
- Standards：无硬性违反。底线守卫报 12 条「删掉的断言」：9 条是上游改自己的用例，3 条是维护者决定的 Markdown 间距断言（第 296 条改成了更强的断言）。判断项：design.md 的「只许移出」与新豁免块不一致（留给 14）；`provider-catalog-icons.spec.ts` 的注释读起来像是测了兜底（已改写注释）；上游新用例每次都要手工改构造写法（已知代价）。
- Spec：主要验收项都落实。已处理：补看 Composer 用量条与圆环悬浮卡；Comments 已写（含翻译键一项）；两处偏离 prd 的提交位置写在上面；第 3 段新键可能与第 5 段重复记为后续。`provider-catalog-icons.spec.ts` 的 20px 断言与上游 24px 是同一件事（提供方图标比兜底图标大一档），没有放宽，本机不跑交 CI。
