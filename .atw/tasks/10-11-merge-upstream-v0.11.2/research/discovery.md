# 合并上游 v0.11.0 – v0.11.2：现状摸底

2026-10-11 在 worktree `curvy-gorilla`（HEAD `802b17d8c`，与 origin/main 相同）上核实。数据来自
`git merge-tree` 的模拟合并与 `git diff`、`git grep`，没有改动工作区。做法沿用 `docs/release.md`
「Fork 分发 → 从上游同步」，这里只记这一次特有的事实与访谈确认的决定。

## 同步点与范围

- 当前同步点：上游 v0.10.3（`b4af508e2`），是 HEAD 的祖先。
- 目标：上游 v0.11.2（`759532509`，2026-10-09）。`HEAD..v0.11.2` 共 247 个上游提交。
- 上游 main 在 v0.11.2 之后还有 39 个未发版的提交（main 顶端 `b412374f0`），不在范围内。
- 上游的发布点已抓到 `refs/upstream-tags/*`（不与 Osuna 的同名 tag 相撞）。

| 段  | 上游发布点     | 提交        | 本段上游提交数 | 本段改动文件数 | 对当前 HEAD 的累计冲突文件数 |
| --- | -------------- | ----------- | -------------- | -------------- | ---------------------------- |
| 1   | v0.11.0-beta.1 | `4aa2f2817` | 79             | 919            | 104                          |
| 2   | v0.11.0-beta.2 | `8498c7416` | 6              | 58             | 104                          |
| 3   | v0.11.0-beta.3 | `6166a7aca` | 4              | 86             | 104                          |
| 4   | v0.11.0-beta.4 | `6b00310f7` | 62             | 422            | 125                          |
| 5   | v0.11.0-beta.5 | `15d774d4a` | 23             | 135            | 130                          |
| 6   | v0.11.0        | `22488d450` | 58             | 227            | 147                          |
| 7   | v0.11.1        | `ab10a6694` | 12             | 38             | 150                          |
| 8   | v0.11.2        | `759532509` | 3              | 24             | 150                          |

第 1 段的提交数从 v0.10.0 起算。累计冲突数是各发布点分别对当前 HEAD 模拟的结果，逐段实做时
每段的数字会不同。

## 补丁分支

- `git merge-base HEAD <v0.11.x>` 都是 v0.10.0（`c481ecf3e`）。v0.10.1 – v0.10.3 在上游的补丁分支上，
  与主线分叉处要重解，清单与固定裁决在 `docs/release.md`「上游的补丁分支」。
- v0.11.0 在上游 main 上；v0.11.1、v0.11.2 不在（v0.11.0 → v0.11.1 → v0.11.2 是一条直线）。
  并入后合 v0.12 时会再遇到同样的事，`docs/release.md` 里那一节要按 v0.11.2 重算一遍清单。

## 模拟合并的冲突（合到 v0.11.2）

150 个文件。类型：content 118、modify/delete 17、add/add 8、file location 7、rename/delete 2、
implicit dir rename 1、rename collision 1。完整清单用
`git merge-tree --write-tree --name-only --no-messages HEAD refs/upstream-tags/v0.11.2` 重算。

按区域：`packages/server/src/server` 39，`app/src/components` 16，`app/src/usage` 10，
`app/src/i18n` 10，`app/src/screens` 7，`app/src/provider-usage` 6，`app/src/composer` 6，`docs` 6，
`app/src/git` 5，安卓商店说明 4，各 `package.json` 12，其余零散。

冲突块较多的文件：`context-window-meter.tsx` 8，`left-sidebar.tsx` 7，`composer/index.tsx` 6，
`settings-screen.tsx` 6，`codex-app-server-agent.ts` 6，`session.ts` 5，
`provider-catalog-session.ts` 5，`messages.ts` 4，`zh-CN.ts` 4。

一边删一边改的：

- Osuna 删、上游改：`session/daemon/` 下的 daemon 自更新五个文件（Osuna 在 `5163aad0e` 下线了
  daemon npm 自更新）；`components/sidebar/sidebar-separator.tsx`（Osuna 在 `8377ff61b` 去掉横向分割线）。
- 上游删、Osuna 改：`provider-usage/` 下 6 个文件、`explorer-sidebar-tab-rail.tsx`、三个套餐用量的
  e2e 与辅助文件。

## 用量：两边各做了一套

三方对比（基点 v0.10.0 / Osuna / 上游 v0.11.2）：

- 基点只有 `app/src/provider-usage/`（套餐用量）与 `provider.usage.list.*` 一对 RPC。
- Osuna：
  - 新增用量统计（token 与估算花费）：`app/src/usage/`、`components/usage/`、`/usage` 路由、
    服务端 `server/usage/`、`session/usage/usage-session.ts`、协议 `protocol/src/usage/rpc-schemas.ts`
    （`usage.report.get.*`、`usage.sessions.list.*`、`usage.pricing.*`、`usage.agent.*`、`usage.updated`、
    `usage.backfill.progress`）、`features.usage`。上游没有对应的东西。
  - 重做套餐用量：留在 `app/src/provider-usage/`，新增 `strip*`（Composer 的用量条）、`view*`、
    `use-provider-usage-hosts.ts`；入口是用量页的 `components/usage/usage-plan-card.tsx`、
    `composer/context-strip/`、`components/context-window-meter.tsx`。主机设置页的套餐用量区块在
    `766711263` 搬进用量页，主机设置页改为价格表。
- 上游：
  - 把 `app/src/provider-usage/` 改名为 `app/src/usage/` 并重写（31 个文件）：`usage-modal.tsx`
    （侧栏底部图标打开的弹窗）、`sidebar-item.tsx`（侧栏底部可固定的摘要）、`host-usage-section.tsx`
    （主机设置页）、`agent-usage.tsx`（上下文详情里按智能体所用账号显示）、`preferences.ts`
    （已用/剩余、固定哪些窗口、选哪台主机）。
  - 协议新增 `usage.list_reports.request/response/update` 与 `features.usageSources`，旧的
    `provider.usage.list.*` 保留。
  - 服务端新增 `plugins/usage-sources/`、`session/usage/usage-session.ts`；额度抓取从
    `services/quota-fetcher/` 改成内置插件（`plugins/builtin/index.ts` 列出 `claude-usage-source`、
    `codex-usage-source`、`copilot-`、`cursor-`、`grok-`、`kimi-`、`minimax-`、`opencode-go-`、
    `zai-usage-source`）。Osuna 没有改过 `services/quota-fetcher/`。
  - 读 macOS 钥匙串里的 Claude 登录在基点就有（`quota-fetcher/providers/claude.ts`），不是新行为。

撞名的地方：

- 目录 `packages/app/src/usage/`：Osuna 放用量统计，上游放套餐用量。`format.ts`、`format.test.ts`
  两边同名不同物。
- 文件 `packages/server/src/server/session/usage/usage-session.ts`：两边各加了一个，内容无关。
- 侧栏条目编号 `usage`：Osuna 在顶部条目列表里（`BUILTIN_SIDEBAR_NAV_IDS`，文案键
  `sidebar.sections.usage`，打开用量页）；上游在 `BUILTIN_SIDEBAR_ITEM_IDS.footer` 里（文案键
  `sidebar.footer.usage`，默认隐藏的摘要，另有固定的底部图标打开弹窗）。上游把条目分成 header 与
  footer 两个列表。
- 协议消息名没有相撞：`usage.report.get.*`（Osuna）与 `usage.list_reports.*`（上游）是不同的名字。
- 术语：`docs/glossary.md` 里 Osuna 的 **Usage** 指 token 与花费统计、**Plan usage** 指订阅额度、
  **Usage source** 指用量行来自哪个 CLI；上游的 **Usage (sidebar item)**、**Usage report**、
  **Usage source** 指的都是订阅额度那一套。

## 插件登记处

- 默认地址 `https://plugins.paseo.sh`，写在 `packages/protocol/src/plugin-registry.ts` 的
  `parsePluginRegistryReference`，可用环境变量 `PASEO_PLUGIN_REGISTRY` 覆盖
  （`server/config.ts`、`server/plugins/managed-source.ts`）。
- 它是功能性的服务地址，与 Osuna 已保留的 `relay.paseo.sh`、`hub.paseo.sh`、`app.paseo.sh` 同类，
  不是展示性链接。
- 展示性链接：上游 v0.11.2 的 `packages/app/src` 非测试有 21 处、`packages/cli/src` 有 8 处；Osuna
  分别是 1 处、3 处。哪些是这一段新增的，逐段合并时按 `docs/release.md`「合并后核对」的计数处理。

## 两个新提供方

Muse Code 与 Antigravity 是内置插件（`muse-provider`、`antigravity-provider`），不在
`agent/providers/` 下。内置插件目录在桌面包里是 `builtin-plugins`，上游为此改了
`packages/desktop/electron-builder.yml`（+4 行）。打包后要核对这个目录在包里，否则两个提供方和
全部套餐用量来源都不会出现。

## 上游触及的敏感文件

`packages/desktop/electron-builder.yml`（+4）、`.github/workflows/deploy-website.yml`（冲突）。
`packages/desktop/src/main.ts`、`desktop-release.yml`、其余三个部署工作流上游没有改。

## 访谈确认的决定（2026-10-11）

第一轮：

1. 建任务，按复杂任务走。
2. 范围停在 v0.11.2，整版收下；上游 main 上未发版的 39 个提交不合。
3. 按上游发布点分 8 段，一个 PR，以 merge commit 并入。
4. 套餐用量以上游为底，补回 Osuna 多出的：上游的数据、弹窗、侧栏摘要、悬浮卡都收下；Osuna 的
   Composer 用量条与用量页保留，用量页里的套餐卡片复用上游的卡片。用量统计（token 与花费）是
   Osuna 独有的，原样保留。
5. 叫法以 Osuna 为准：token 与花费统计叫「用量」，订阅额度叫「套餐用量」；上游的弹窗标题与按钮
   改叫「套餐用量」；上游的 Usage source 在术语表里记作「套餐用量来源」。代码里上游的命名不动。
6. 插件登记处的功能收下；展示性链接按老规矩处理。
7. Muse Code、Antigravity 按上游原样收下；Osuna 独有的已装版本、一键升级、安装指引这次不补，
   写进 PR 正文当后续工作。
8. 上游其余看得见的界面变化全收，外观用 Osuna 的：Explorer 标签改成工作区标签的样子（Osuna 的
   会话历史标签保留）、导入会话挪到新建工作区页、内容宽度设置、Codex 速度菜单、新安装默认显示
   最近活动、上下文圆环在首轮前显示。
9. 不含发版；先合并，后做 `10-11-opencode-v2-osuna-gaps`；验收照上次（CI 全绿，Nix 两项除外；
   新界面桌面端截图；原生端不测）。

按已有规则直接定的：daemon npm 自更新保持删除；版本号、CHANGELOG、README、安卓商店说明归 Osuna。

第二轮：

10. 侧栏两个入口并存：顶部条目「用量」不变，打开 Osuna 的用量页；底部图标行新增「套餐用量」图标，
    打开上游的弹窗，「导入会话」图标按第 8 条挪走；上游默认关闭的侧栏摘要收下，开关在
    设置 → 侧边栏，叫「套餐用量摘要」。两个内部编号同为 `usage` 的条目在代码里分开，已保存的
    侧栏顺序不受影响，用测试证明。
11. 主机设置页不放回套餐用量，保持价格表（Osuna 在 `766711263` 的决定）。
12. 上下文圆环的提示取上游的悬浮卡，外观对回 Osuna；Osuna 提示里多出的内容逐条补回。两边互相
    矛盾时停下来问维护者。
13. Composer 用量条改接上游的新数据；显示已用还是剩余跟随上游的偏好开关。
14. 验收加一项：本机打一个 macOS 包，核对包里有内置插件目录，并打开确认套餐用量与两个新提供方
    出现。Windows 包与虚拟机验收由维护者自己做。

实现上直接定的（维护者已知悉）：

- 合并之前先把 Osuna 的用量统计代码从 `packages/app/src/usage/` 搬到新名字，服务端同名的
  `session/usage/usage-session.ts` 同样改名；上游的路径不动。新名字在写 PRD 时定。
- 第 5 条的术语在上游的词进来的那一段写进 `docs/glossary.md`，不提前写，避免给上游也改了的文件
  多添一处冲突。

## 未决

没有等维护者回答的问题。写 PRD 时要补查的事实：

- 上下文圆环提示里 Osuna 多出的内容清单（`context-window-meter.tsx` 对上游的
  `context-window-details.tsx`、`usage/agent-usage.tsx`）。
- 套餐用量的改名与重写落在哪个 beta 段，决定用量相关的工单排在第几段。
- Osuna 的 Explorer 会话历史标签在上游新的标签结构里怎么接（上游删了
  `explorer-sidebar-tab-rail.tsx`）。
- 内置插件在 设置 → 插件 页里是否显示、能否被停用。
- 逐段新增的展示性链接与 `COMPAT` 标签清单。
