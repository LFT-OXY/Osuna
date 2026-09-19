# 分支 e2e 漂移收口

## Problem Statement

`feat/usage-stats` 推上 CI 后有六个 job 红。fork 的 Actions 今天才打开，而本地 `main`
领先 `origin/main` 55 个 commit 且从未推送 —— 会话历史面板、13 套 UI 主题、终端主题桥接、
未安装 Provider 过滤这四批功能都是验收完直接进本地 main 的，从没单独过过 CI。
六条失败于是一次性堆在这条分支上，看起来像是 usage 任务弄坏的，实际只有一条是。

对开发者来说，现在的问题是：CI 是红的，而红的原因跨四个互不相关的功能，
不逐条归因就没法判断「测试过时」还是「功能改错」，也就没法安全地把分支合掉。

`cli-tests (shard 3/3)` 不在此列 —— 它在上游基线上红、在本分支重跑绿，是上游自己的 flaky。

## Solution

逐条归因已完成，记录在 `research/failure-attribution.md`。六条里五条是测试断言跟不上
有意的行为变更，一条是功能本身判断错了人群：

- Explorer rail 菜单多了 `Session history`，测试把菜单项列表钉死了。
- 外观设置在选 System 时多出深色 / 浅色配对两行，三行共用同一条 `Theme: {{value}}`
  无障碍标签，正则选择器命中三个。
- 插件主题 e2e 的夹具贡献了名叫 Catppuccin Mocha / Latte 的主题，而这两个现在是内置主题，
  文字选择器命中两个。
- 终端主题桥接让 daemon 按 app 上报的真实主题回答 OSC 11；e2e 浏览器跟随系统是浅色，
  底色合法地就是白，而这条测试正是用「白 = 浏览器泄漏」来表达它的断言。
- 桌面端 settings 内存回归把主机设置页的栏目名硬写成 `Usage`，usage 任务把它改叫
  `Price table`。
- Import session 面板不再为「配置过但起不来」的 Provider 报错。这一条是功能该修。

最后一条的判断是：`listImportableSessions` 的可用性探测本意是放过**用户从没要过**的
Provider，不要为没装 Codex 的人刷一条错误。但用户在 daemon config 里亲手声明的自定义
Provider 是他要的 —— `command` 打错一个字母就静默返回空列表、界面上什么都不说，
比多一条可见的错误糟得多。所以探测只对内置 Provider 生效。

## User Stories

1. 作为维护者，我希望分支上的六个红 job 都变绿，这样我能判断分支可以合。
2. 作为维护者，我希望每条失败都有归因记录，这样下次同样的漂移我不用重查一遍。
3. 作为维护者，我希望被判定为「测试过时」的改动只动测试、不动产品行为，这样功能的意图不被测试倒推着改掉。
4. 作为维护者，我希望被判定为「功能该修」的那条真的改功能，这样 CI 变绿不是靠删掉覆盖换来的。
5. 作为在 daemon config 里声明了自定义 ACP Provider 的用户，我希望它的 `command` 写错时 Import session 面板明确告诉我这个 Provider 起不来，这样我知道去改配置而不是以为自己没有历史会话。
6. 作为同一个用户，我希望那条错误旁边有 Retry，这样我改完配置不用重开面板。
7. 作为没有安装 Codex 的用户，我希望 Import session 面板不为 Codex 报错，这样列表里只有跟我有关的东西。
8. 作为没有安装任何可选 Provider 的用户，我希望面板不是一屏错误，这样它仍然可用。
9. 作为在 Explorer 侧栏用 rail 菜单的用户，我希望 `Session history` 出现在内置视图里，这样我能像 Changes / Files 一样开关它。
10. 作为维护者，我希望 Explorer rail 菜单的测试在下次新增内置视图时仍然表达「插件面板排在内置视图之后」，而不是每加一个视图就改一次字符串列表。
11. 作为选择「跟随系统」的用户，我希望外观设置能分别配对深色与浅色主题，这样我的日夜两套配色都是我选的。
12. 作为维护者，我希望设置页 e2e 在定位主题下拉时指明是哪一行，这样再加配对行也不会撞上。
13. 作为装了贡献主题的插件的用户，我希望它在主题选择器里能被选中并生效，这样插件主题是可用的。
14. 作为同一个用户，我希望插件被移除后 app 回落到默认主题而不是卡在失效配色上。
15. 作为维护者，我希望插件主题 e2e 的夹具用不会和内置主题撞名的名字，这样这条测试验的是「插件贡献的主题能生效」而不是「恰好叫这个名字」。
16. 作为在终端里跑 TUI 的用户，我希望 TUI 查询背景色时拿到的是我当前主题的真实底色，这样它的配色和 app 一致。
17. 作为维护者，我希望 OSC 11 那条 e2e 在一个确定的主题下运行，这样「白色只可能来自浏览器泄漏」这个判断重新成立。
18. 作为维护者，我希望那条测试继续能抓住「浏览器的颜色查询回复被送回 PTY」这个真实缺陷，而不是被改成一条恒真断言。
19. 作为桌面端用户，我希望设置页能轮转到每一个栏目而不泄漏已关闭的视图，这样长时间使用不涨内存。
20. 作为维护者，我希望桌面端那份栏目清单和 app 的实际栏目名一致，这样改名会在改名那次就被发现。
21. 作为维护者，我希望这次不顺手修「插件主题与内置主题重名」，这样本任务的验收边界是清楚的。
22. 作为维护者，我希望重名这件事被记下来，这样它不会因为这次绕开而丢掉。

## Implementation Decisions

### 功能改动（唯一一处）

- `AgentManager.listImportableSessions` 的可用性预探测**静默跳过只对内置 Provider 生效**。
  不是内置的（即 daemon config 声明出来的自定义 Provider，无论 `extends` 的是
  `acp` 还是别的已注册 Provider）探测失败时进 `providerErrors`。
- 实现落定：预探测对所有候选 Provider 照跑，结果分三路 —— 可用的进扇出；不可用且内置的
  静默丢弃；不可用且非内置的直接成为一条 `providerErrors`，不再尝试列出。
  最后一路不依赖「列出时会抛错」：`isAvailable` 返回 false 而不抛错时也必须报出来，
  否则 ACP 客户端只要在二进制缺失时返回空列表，错误就又被吞掉了。
  探测返回 false 且没有错误文本时，合成一条 `Provider '<id>' is not available`。
- 判定信号是 **Provider id 是否属于内置集合**，不是 `derivedFromProviderId`。
  后者对内置 Provider 和泛型 ACP 自定义 Provider 都是 `null`
  （`provider-registry.ts` 的定义注释写明了这一点），分不出这两类。
- 实现落定：`AgentManager` 直接查 protocol 侧 provider manifest 导出的内置集合，
  不在 `providerDefinitions` 上加标志位 —— server 里已有同样的写法可以对齐。
- 协议不动，客户端不动。`providerErrors` 的形状和语义不变，变的只是哪些 Provider 会进去。
- 这条改动同时影响 Import session 面板和会话历史列表 —— 它们走同一个 RPC。

### 测试改动

- Explorer rail 菜单：期望列表补入 `Session history`，位置在 `Files` 之后、插件面板之前。
  顺带让这条断言表达「内置视图在前、插件面板在后」的分组意图，而不是纯字符串清单。
- 设置页 Escape：主题下拉的定位改成指明行的精确标签，与同目录既有 e2e 的写法一致。
- 插件主题夹具：两套贡献主题改用不会和内置主题撞名的名字，随之更新文字选择器与
  `Theme: {{name}}` 断言。夹具的配色值不用改 —— 这条测试验的是贡献的语义 token
  有没有真的传到界面上。
- OSC 11：测试自己把主题钉死成深色（沿用同仓 e2e 已有的 `localStorage` 种设置写法），
  断言深色主题的真实终端底色；「不得出现纯白」这条保留，此时它重新只可能意味着
  浏览器的回复漏回了 PTY。
- 桌面端设置栏目清单：`Usage` 改成 `Price table`。

## Testing Decisions

好的测试只验外部可观察的行为。这次五条测试改动全部是让断言重新对准原本要验的行为 ——
不允许出现「把断言删掉」或「改成恒真」来换绿灯，OSC 11 那条尤其要留住它原本抓的缺陷。

- **`AgentManager` 单元测试**（`agent-manager.test.ts`）是功能改动的主验收层，也是最高的可用接缝。
  `1bad014d6` 已经在这里留了同族的一条（内置 Provider 探测失败被跳过、列出失败仍报错），
  新增的一条挨着它写：自定义 Provider 探测失败时**进** `providerErrors`，
  且内置 Provider 的既有行为不变。
- **`import-session-flow.spec.ts`** 是端到端确认，已经存在，改功能后应自行变绿，不新增断言。
- 其余四条各自在原文件原位置改，不新增测试文件、不新增 npm script、不新增 CI job。
- 不引入新接缝。

本地只跑改到的单个文件；全量由 CI 验证。

## Out of Scope

- **插件贡献的主题与内置主题重名时的消歧。** 真实用户也会撞上（选择器里两条一模一样的
  文字），但它能独立验收、独立上线，属于另一个任务。本任务只把夹具改名绕开。
- `cli-tests (shard 3/3)` 的 flaky —— 上游代码自己的问题，基线红、本分支绿。
- 把本地 `main` 的 55 个 commit 推上去各自过一遍 CI。
- usage 任务遗留的三项：iOS / Android 真机 `Intl` 冒烟、turn footer 与环形表的
  zh-CN 截图、daemon/protocol 侧是否剥掉已无人使用的 `trend` 聚合。

## Acceptance Criteria

- [ ] `playwright (shard 2/4)`、`playwright (shard 3/4)`、`playwright (shard 4/4)` 在分支上绿。
- [ ] `desktop-tests (ubuntu-latest)` 在分支上绿。
- [ ] 六条失败没有一条是靠删除或弱化断言变绿的。
- [ ] `import-session-flow.spec.ts` 里那个故意配坏的 ACP Provider 仍然在界面上报错并能 Retry，
      测试文件本身未改。
- [ ] 新增一条 `AgentManager` 单元测试：config 声明的自定义 Provider 探测失败时进
      `providerErrors`；`1bad014d6` 那条内置 Provider 的断言保持通过。
- [ ] OSC 11 那条测试在去掉终端主题桥接后会失败（即它仍在验真实行为）。
- [ ] `typecheck` 与 `lint` 通过。
- [ ] 「插件主题与内置主题重名」作为后续记录在案。

## Further Notes

- 归因证据、每条的实际报错原文与本地复跑结果在 `research/failure-attribution.md`。
- 本任务开始时，本地领先 `origin/feat/usage-stats` 三笔任务记录 commit，未推送。
