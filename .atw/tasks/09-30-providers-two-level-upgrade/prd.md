# Providers 设置改为两级结构，显示版本并支持一键升级

决策来源：`research/interview-decisions.md`（访谈 Q1–Q21）。各 CLI 的版本和升级事实：`research/provider-cli-version-update.md`。术语：`docs/glossary.md` 的 **Provider**、**Custom provider**、**API endpoint**、**Add provider**。启用与停用的列表设计：`design/design-brief.md`（2026-10-01 验收时重新设计，选定方向 01"一张清单"）。

## Problem Statement

设置 → 主机 → Providers 在宽屏上是"左列表 + 右详情"两列：一进页面，右边就摊开第一个提供方的全部详情。列表把 6 个内置提供方全部列出，不管装没装、开没开。没装的 Codex、Pi 和真正在用的 Claude Code 挤在一起，每行都有开关，用户分不清哪些是自己在用的。

用户也看不到自己装的 CLI 是哪个版本，更不知道有没有新版本。想升级，只能自己去终端，还得记住每家的升级命令：`claude update`、`opencode upgrade`、`pi update`……Codex 甚至要看当初是怎么装的。

默认启用的提供方也不合用户习惯。Copilot 和 OpenCode 默认开启，一直占在列表和新建会话的提供方选择里；用户主力用的 Oh My Pi 反而默认关闭。

第一版"列表只放在用的、其余进「添加提供方」"在验收时（2026-10-01）暴露出启停逻辑的问题：列表行的开关只能关，一关这一行就从列表消失，像被删掉了；「添加提供方」的"未启用"组和详情页都没有开关，点一项就被悄悄启用。已停用的提供方 daemon 不检测，详情页却按"未安装"显示安装指引，看起来像没装。

## Solution

- **两级结构**：所有宽度都是先显示列表，点一行推入该提供方的详情页。宽屏页头显示「Providers / {名称}」面包屑，手机上用返回键。左右两列布局去掉。
- **列表分两组**：「已启用」放所有启用的提供方，可用、检测中、出错、未安装的都在这一组，各自显示状态；「已停用」放所有停用的提供方，包括添加过又关掉的。两组每行都有开关，拨一下这一行就移到另一组。已停用的不标"未安装"：daemon 不检测已停用的提供方，App 不知道它装没装，状态行只写"启用后检测是否已安装"。
- **点击只导航**：点任何一行都只进详情页，不改配置。启用和停用只靠开关，列表行和详情页头都有。
- **添加提供方**：列表标题上的「+」打开「添加提供方」弹窗，里面只有 ACP 目录，从中添加新的自定义提供方。
- **版本与一键升级**（只针对 6 个内置提供方）：
  - 列表行的状态行显示已装版本号。有新版本时，状态行里接一个"升级到 vY"小按钮，悬停提示"vX → vY"。行尾只留开关和 ›。
  - 点击后 daemon 在主机上执行该 CLI 的官方升级命令，按钮转圈。成功后版本号刷新；失败时在这一行下面显示命令输出的原文。
  - 详情页新增"版本"一节，放同样的信息和按钮。
  - 只在打开 Providers 页面或点刷新时联网检查新版本，不在后台轮询。
- **详情页版块顺序**：错误类提示 → 版本 → 安装指引（仅启用且未安装时）→ 第三方接口（官方 + 已保存的接口）→ Models → 诊断。页头有启用开关；停用时正文只有一张说明卡。
- **默认启用**：Claude Code、Codex、Pi、Oh My Pi 默认开启；Copilot、OpenCode 默认关闭。

## User Stories

### 两级结构

1. As a 桌面用户, I want 打开 Providers 时先只看到列表, so that 不会被第一个提供方的整页详情淹没。
2. As a 桌面用户, I want 点列表的一行进入该提供方的详情页, so that 一次只看一个提供方。
3. As a 宽屏桌面用户, I want 详情页头显示「Providers / {名称}」面包屑, so that 点「Providers」就能回到列表。
4. As a 手机用户, I want 详情页头有返回键、刷新和 ⋯ 菜单, so that 手机上的操作和现在一样。
5. As a 用户, I want 详情页的地址直接带上提供方, so that 刷新页面或返回后仍然停在同一个提供方。
6. As a 用户, I want 地址里写了一个不存在的提供方时自动回到列表, so that 不会看到空白的详情页。
7. As a 用户, I want 列表在宽屏上有合适的最大宽度, so that 行不会被拉到整个屏幕那么宽。

### 列表

8. As a 用户, I want 列表分"已启用""已停用"两组，所有内置提供方和我添加过的提供方都在这一页, so that 一眼看全，不用去别处找。
9. As a 用户, I want 启动出错的、正在检测的、启用了但没装的提供方都在"已启用"组并显示各自的状态, so that 我知道它开着但还不能用，以及为什么。
10. As a 用户, I want 两组的每一行都有启用开关, so that 不用进详情页就能开关任何提供方。
11. As a 用户, I want 拨开关后这一行移到另一组并短暂高亮, so that 我看清它去了哪里，拨错了可以马上拨回来。
12. As a 用户, I want 已停用的行图标变淡、标题变灰，状态行写"已停用 · 启用后检测是否已安装", so that 不会误以为它没装。
13. As a 用户, I want 打开一个已停用的提供方后，状态行原地显示"正在检测…"，再变成可用或"未安装", so that 启用之后马上知道结果。
14. As a 用户, I want 开关失败时，错误显示在卡片顶部，那一行留在原来的组, so that 我知道操作没成功。
15. As a 用户, I want 主机未连接或列表加载中时看到对应的提示，没有启用的提供方时"已启用"组显示空提示, so that 不会误以为自己一个提供方都没有。

### 添加提供方

16. As a 用户, I want 列表标题上的「+」打开「添加提供方」弹窗，里面只有 ACP 目录, so that "添加"只用来加新的提供方。
17. As a 用户, I want ACP 目录保持现有的搜索和添加行为, so that 添加第三方 agent 的方式不变。
18. As a 用户, I want 目录里每一项的"添加"是描边按钮, so that 弹窗里不会出现一排抢眼的蓝色主按钮。
19. As a 用户, I want 从 ACP 目录添加后，新的提供方出现在"已启用"组，并进入它的详情页, so that 马上能看到它能不能用。
20. As a 用户, I want 之前从 ACP 目录添加、后来关掉的提供方留在"已停用"组，并保留原来的配置, so that 重新打开时不用重新配置。
21. As a 用户, I want 添加失败时，错误显示在弹窗里, so that 我知道失败了、为什么失败。

### 启用与停用

22. As a 用户, I want 点一个已停用的提供方只进入它的详情页，不改变任何配置, so that 只是看看不会误开。
23. As a 用户, I want 详情页的页头有启用开关，宽屏在开关旁写"已启用"或"已停用", so that 在详情页也能开关。
24. As a 用户, I want 已停用的提供方的详情页只显示一张说明卡：已停用的不检测、不出现在新建会话里，打开页头的开关即可启用，启用后会检测是否已安装, so that 不会看到误导人的安装指引或空白区块。
25. As a 用户, I want 在详情页打开开关后，正文原地变成检测结果：可用就出现版本、第三方接口和 Models，没装就出现安装指引；停用时刷新按钮不可用, so that 不用回到列表就能接着操作。

### 版本与升级

26. As a 用户, I want 列表里每个已安装的内置提供方都显示已装版本号, so that 一眼知道自己用的是哪个版本。
27. As a 用户, I want 打开 Providers 页面时自动检查有没有新版本, so that 不用自己去官网查。
28. As a 用户, I want 有新版本时，这一行的状态行里出现"升级到 v{最新}"按钮, so that 一键就能升级，行尾也不会挤。
29. As a 用户, I want 悬停"升级"按钮时看到"当前版本 → 最新版本", so that 知道会升到哪个版本。
30. As a 用户, I want 点"升级"后按钮变成转圈，并且不能重复点, so that 不会重复触发升级。
31. As a 用户, I want 升级成功后版本号自动更新，"升级"按钮消失, so that 知道已经是最新版本。
32. As a 用户, I want 升级失败时，在这一行下面看到命令输出的原文，可以关掉, so that 我能自己排查，或者复制给别人。
33. As a 用户, I want 升级时正在跑的会话不受影响，也不弹确认, so that 真正做到一键。
34. As a 用户, I want 点页面上的刷新时，重新检查新版本, so that 可以手动拿到最新结果。
35. As a 用户, I want 离开页面再回来时，不要每次都重新联网检查, so that 不会频繁发请求。
36. As a 用户, I want 检查新版本失败时（离线、npm registry 超时），只是不显示升级按钮，页面不报错, so that 离线时 Providers 页也能正常用。
37. As a 用户, I want 详情页的"版本"一节显示已装版本、最新版本和同样的升级按钮, so that 在详情页也能升级。
38. As a 用户, I want Codex 按我当初的安装方式升级（npm、Homebrew 或官方安装脚本）, so that 不会装出第二份 Codex。
39. As a 用户, I want daemon 判断不出 Codex 的安装方式时，看到"无法自动升级"的提示和手动升级的指引, so that 知道怎么自己升级。
40. As a 用户, I want 自定义提供方和从 ACP 添加的提供方不显示版本号和升级按钮, so that 不会对同一个 CLI 重复升级，也不会看到没有意义的版本号。
41. As a 用户, I want 版本号读不出来时（CLI 输出格式变了），只是不显示版本号，不报错, so that 列表不会因此出错。

### 详情页

42. As a 用户, I want 详情页从上到下依次是：错误提示、版本、安装指引、第三方接口、Models、诊断, so that 最常看的信息在最上面。
43. As a 用户, I want 已安装的提供方不显示安装指引，未安装的不显示版本一节，已停用的两者都不显示, so that 它们不同时出现，也不会误导。
44. As a Claude Code / Codex 用户, I want 第三方接口一节保持现在的"官方"和已保存接口列表, so that 切换接口的方式不变。
45. As a 用户, I want 自定义提供方的 ⋯ 菜单仍然有"删除", so that 我能彻底删掉一个提供方。

### 默认启用

46. As a 新用户, I want 默认只启用 Claude Code、Codex、Pi、Oh My Pi, so that 列表和新建会话里只有主力提供方。
47. As a 想用 Copilot 或 OpenCode 的用户, I want 在"已停用"组里拨开它的开关就能启用, so that 默认关闭不妨碍我用它。
48. As a 从旧版本升级上来的用户, I want CHANGELOG 里说明 Copilot 和 OpenCode 改为默认关闭，以及怎么重新打开, so that 发现它们不见时知道原因。

### 兼容

49. As a 连着旧版本 daemon 的用户, I want 看不到版本号和升级按钮，其余功能照常, so that App 不会因为 daemon 旧而出错。
50. As a 只有只读权限的客户端, I want 能看到版本号和有没有新版本，但点不了升级, so that 权限边界清楚。

## Implementation Decisions

### 协议（protocol）

- `ProviderSnapshotEntry` 新增可选字段 `version: string`，表示 daemon 探测到的已装 CLI 版本（纯版本号，例如 `2.1.285`）。只有内置提供方会填写。旧客户端会忽略它。
- 新增两个 RPC，命名遵循 `docs/rpc-namespacing.md`，和现有的 `provider.api_endpoint.*` 放在同一个 `provider.*` 命名空间下：
  - `provider.version.check.request` / `.response`：请求可选带 `providers`（只查这几个）和 `force`（跳过缓存）。响应是一个数组，每项为 `{ provider, installedVersion?, latestVersion?, updateAvailable, error? }`。
  - `provider.upgrade.request` / `.response`：请求带 `provider`。响应为 `{ provider, ok, version?, output?, errorCode?, error? }`，其中 `output` 是命令输出的原文，失败时一定会带上。`errorCode` 至少要区分这几种：不支持、判断不出安装方式、已有升级在进行、命令失败、超时。实现另加了"找不到可执行文件"（`not_installed`）；线上是普通字符串，已知取值在 `PROVIDER_UPGRADE_ERROR_CODES`，旧 App 遇到新码按通用失败显示。
- `server_info.features` 新增一个可选开关 `providerVersions`，同时覆盖快照里的 `version` 字段和上面两个 RPC。App 只在这个开关打开时显示版本和升级功能，门控处加 `COMPAT(providerVersions)` 标签。
- 权限：`provider.version.check.request` 需要 `daemon.read`；`provider.upgrade.request` 需要 `daemon.manage`，因为它会在主机上执行命令，性质和 plugin 安装、更新一样。

### daemon（server）

- **取已装版本**：对启用的内置提供方，在目录探测成功之后执行一次 `--version`，从输出里取第一个纯 `x.y.z`（预发布后缀丢掉），写进快照的 `version`。执行的是这个提供方实际使用的命令，也就是会带上用户在 config 里改过的 command 和 env。
  - Claude 在目录探测时已经取过版本，经 `ProviderCatalog.installedVersion` 带出来，快照直接复用，不再跑第二遍。
  - 取不到版本不算错误，快照状态不受影响。为此 `--version` 放在刷新超时之外，有自己的 5 秒超时。
  - 目录探测失败（状态 `error`）的提供方不带版本。
  - daemon 从 04 起就宣告 `providerVersions: true`，而两个 RPC 在 05/06 才实现。04–07 是同一任务的票，一起发版，不单独发 04。
- **最新版本**：6 家统一查 npm registry 的 `latest`，不引入第二个联网目标。

  | 提供方 | npm 包名 |
  |---|---|
  | claude | `@anthropic-ai/claude-code` |
  | codex | `@openai/codex` |
  | copilot | `@github/copilot` |
  | opencode | `opencode-ai` |
  | pi | `@earendil-works/pi-coding-agent` |
  | omp | `@oh-my-pi/pi-coding-agent` |

  包名写在 protocol 的 provider manifest（`npmPackage`），升级命令和包名放在一处维护。
- **版本检查服务**：新建一个模块，负责查询最新版本、缓存结果和比较版本。
  - 结果在 daemon 内存里缓存 1 小时，`force` 跳过缓存；联网失败不缓存。同一个提供方同时发起的多次查询合并成一次，`force` 也加入正在进行的那次。
  - 快照里没有 `version` 的提供方（停用、未安装、读不出版本）不联网，只回 `updateAvailable: false`。
  - 只在收到 `provider.version.check.request` 时才联网，不在启动时查，也不定时查。
  - 版本比较按 semver，解析不了就视为"没有更新"。
  - 联网失败只写进这一项的 `error`，其他提供方照常返回。
  - 联网函数通过依赖注入传入，测试时替换成桩。
- **升级服务**：新建一个模块，负责选定升级命令、执行命令、执行后重新探测。
  - 升级命令：claude 用 `update`，copilot 用 `update`，opencode 用 `upgrade`，pi 用 `update`，omp 用 `update`，都用这个提供方实际使用的可执行文件来执行。
    - 可执行文件由各家 client 的 `resolveCliLaunch` 给出。config 用 replace 模式换掉的命令，前面的 argv 保留；append 模式追加的是会话启动参数，升级时丢掉，否则 CLI 会把子命令当成提示词。
    - 没有升级命令的提供方在找可执行文件之前就返回"不支持"。Codex 有了按安装方式的升级之后，停用或找不到可执行文件时返回"找不到可执行文件"（`not_installed`）。
  - Codex 按可执行文件的真实路径（解析过符号链接）判断安装方式，规则和命令对齐上游 `codex-rs/install-context` 与 `update_action.rs`：
    - 路径在 `$CODEX_HOME/packages/standalone/releases/` 下：重跑官方安装脚本，并设 `CODEX_NON_INTERACTIVE=1`；Windows 用官方的 PowerShell 安装脚本。同时把从路径里取出的 `CODEX_HOME` 传给脚本，否则用户改过 `CODEX_HOME` 时，缺省的 `~/.codex` 会装出第二份。
    - 路径在 npm 全局目录下（POSIX `<前缀>/lib/node_modules/@openai/codex/`，Windows 名为 `npm` 的全局目录，缺省 `%APPDATA%\npm`）：`npm install -g --prefix <前缀> @openai/codex@latest`。带 `--prefix` 是因为 PATH 上先找到的 npm 可能属于另一个 node（nvm、Homebrew），不指定会装到别处。Homebrew 的 node 把全局包放在 `/opt/homebrew/lib/node_modules` 下，这属于 npm 安装，所以 Homebrew 只认 `Caskroom/codex`，不按前缀认。
    - macOS 上路径在 `/opt/homebrew/Caskroom/codex/` 或 `/usr/local/Caskroom/codex/` 下：`<前缀>/bin/brew upgrade --cask codex`。只认 cask：formula 版和手放进 `/usr/local/bin` 的执行 `--cask` 升级会失败，交给用户手动升级。
    - 其他情况：返回"判断不出安装方式"。包括 Microsoft Store 版、bun 和 pnpm 的全局目录（用 npm 升级会装出第二份）、Homebrew formula、手放的二进制，以及 replace 模式配成 `node cli.js` 这类命令（可执行文件是解释器）。
  - 同一个提供方同时只允许一次升级，第二次请求直接返回"已有升级在进行"。
  - 超时 10 分钟，超时或 daemon 关闭时终止整棵进程树。stdout 和 stderr 按到达顺序合在一起，只保留结尾 32000 个字符；stdin 接空。
  - 以 CLI 进程退出为准，不等管道关闭：自更新留下的后台进程会继承 stdout，管道可能一直不关。退出后最多再等 2 秒收尾输出。
  - App 的请求超时 20 分钟，覆盖命令超时加两段快照刷新期限。
  - 升级结束后，不论成功还是失败，都刷新这个提供方的快照（会重新取 `version`），并清掉这个提供方的最新版本缓存。
  - 正在跑的 agent 会话不受影响，不做拦截。
  - 升级命令表和版本解析都是纯函数，单独放，方便以后新增提供方。
- **默认启用**：提供方 manifest 里，copilot 和 opencode 设 `enabledByDefault: false`，omp 去掉 `false`（回到默认开启）。不做配置迁移，已经在 config 里显式写了 `enabled` 的用户不受影响。
- 已停用的提供方仍然不探测、不取版本，保持现状。

### App

- **Providers 页布局**：删掉 `split` 布局、选中项修正地址的逻辑，以及 `resolveProvidersLayout` 和 `resolveSelectedProvider`。所有宽度都走栈式："Providers 分区地址"显示列表，"带提供方的地址"显示详情。现有的面包屑和返回键页头直接沿用。列表在宽屏上设最大宽度，和详情页保持一致。
- **列表的分组规则**：按 `enabled` 分组（快照里的 `enabled` 是必填布尔值）：为真进"已启用"，为假进"已停用"。"已启用"组里照常显示各自的状态：可用、检测中、出错、未安装。这条规则取代原来"列表 / 未启用"的二分（`resolveProviderPlacement`），弹窗不再使用它。两组内部沿用现有提供方定义的顺序。"已停用"组没有项时连标题一起不显示；"已启用"组没有项时，卡片里显示空提示。「+」放在"已启用"组的标题上。
- **列表行**（两组相同）：图标、名称、状态行，行尾依次是开关、›。整行可点，只导航到详情页；开关阻止事件冒泡，不触发导航。
  - 状态行：可用时为"{n} 个 Model · v{version}"（版本只在内置提供方、daemon 支持时显示）；有新版本时后面接一个 xs 尺寸的"升级到 v{latest}"按钮，悬停提示"v{from} → v{to}"，升级中转圈并禁用。检测中、出错、未安装沿用现有状态文字。已停用写"已停用 · 启用后检测是否已安装"。
  - 已停用的行：图标降低不透明度，标题用 muted 色。这是状态，不是禁用，开关和整行仍然可点。
  - 升级失败时，仍在这一行下面显示可以关掉的错误块（命令输出原文，等宽、可选中）。
  - 拨开关写入 `enabled`。快照更新后这一行出现在另一组，背景短暂高亮约 1.5 秒；系统要求减少动态效果时不高亮。开关失败沿用现有做法：错误显示在"已启用"卡片顶部，这一行不移动。
- **添加提供方弹窗**：删掉"未启用"组和"点一项即启用"的逻辑，弹窗只剩头部搜索框和 ACP 目录，标题仍是"添加提供方"。ACP 目录每项的"添加"从 accent 实心改为 outline（`docs/design.md`：一页至多一个 accent 主按钮）。从 ACP 添加成功后的行为不变：关闭弹窗，进入新提供方的详情页。写入失败时，错误留在弹窗里。
- **版本数据**：Providers 页（列表或详情地址）每次挂载都发一次 `provider.version.check.request`，不带 `force`；1 小时内不重复联网靠 daemon 的缓存。详情页的刷新（页头或正文）先刷新快照，再带 `force` 重查这一个提供方。列表页没有刷新按钮，不新增（2026-10-01 用户确认）。结果按提供方存在 App 的查询缓存里，列表和详情页共用；检查结果里的已装版本和快照不一致时视为过期，不显示新版本。composer 弹窗的详情不发检查、刷新时不重查，也不显示新版本。连着旧版本 daemon（`providerVersions` 没打开）时不发请求。
- **升级动作**：一个 hook 负责发 `provider.upgrade.request`，并记录"正在升级的提供方"和"每个提供方的失败输出"，列表行和详情页的版本一节共用。升级成功后，用返回的版本改写本地的检查结果（`applyUpgradedVersion`，不再联网）：升到最新版本时按钮消失，升到别的版本（例如 stable 通道）时按钮保留；新的 `version` 随快照推送在响应之前到达。失败块显示按 `errorCode` 翻译的原因，没有对应文案时附上 `error` 原文；有 `output` 时用等宽、可选中的代码面板显示，可以关掉。"判断不出安装方式"时不显示 `error` 原文，改为"请用当初安装它的方式手动升级，或参照官方文档"的提示，并附该提供方安装指引里的官方文档链接。
- **详情页**：`ProviderDetailSurface` 的版块顺序改为：删除失败 → 启动错误 → 继承接口提示 → **版本**（新增）→ 安装指引（仅启用且未安装时）→ 第三方接口 → Models → 诊断。版本一节只在内置提供方已安装、并且 daemon 支持时出现。它和安装指引一样，由调用方通过 render 插槽注入。组件顶部的顺序注释同步更新。
- **详情页的停用状态**：`enabled` 为假时，正文不再按 `unavailable` 显示安装指引，只显示一张说明卡：标题"{名称} 已停用"，说明"已停用的提供方不检测，也不出现在新建会话里。打开页头的开关即可启用，启用后会检测主机上有没有装 {名称}。"。版本、安装指引、第三方接口、Models、诊断都不显示；删除失败提示和 ⋯ 菜单里的删除（自定义提供方）照常可用。启用后，正文随快照原地变成对应状态的区块。
- **详情页的启用开关**：Providers 设置页的详情页头（宽屏的面包屑页头、手机的返回键页头）在刷新和 ⋯ 之前加启用开关。宽屏在开关左边写"已启用"或"已停用"，手机只放开关，并带可访问名称。开关写入 `enabled`，失败时错误显示在详情顶部，复用删除失败的提示位置。停用时刷新按钮禁用，因为 daemon 不探测已停用的提供方。composer 里打开的提供方详情弹窗不加开关。
- **i18n**：新增的文案（组标题"已启用""已停用"、"启用后检测是否已安装"、"升级到 v{to}"、"v{from} → v{to}"、详情页头的开关文字、停用说明卡、各种升级错误、空列表提示、"添加提供方"等）9 个语言文件都要补上，zh-CN 用 glossary 里定下的词。不再使用的文案（"未启用"组标题、"已停用 / 未安装"标记、"打开 {名称}"）一并删掉。

### 文档

- `docs/usage.md` 的「The one outbound request」一节：写明查询 npm registry 最新版本属于"用户要求的请求"，只在打开 Providers 页面或点刷新时发生，并说明发往哪里、带什么。
- `docs/providers.md`：新增提供方的清单里补上"npm 包名、升级命令、版本解析"三项。
- `CHANGELOG.md`：写明 Copilot 和 OpenCode 改为默认关闭，以及怎么重新启用。
- `docs/glossary.md`：改写 **Add provider** 条目：弹窗只有 ACP 目录；Providers 列表分"已启用""已停用"两组，关掉一个提供方不会把它移出列表。
- `docs/design.md`：同步更新提到 Providers 列表行和目录行版本号的句子。

## Testing Decisions

好的测试只看外部行为：daemon 端从客户端 RPC 进、快照出；App 端从渲染出的界面和用户操作进。不断言内部状态，也不断言调用次数。

测试分三层，从上往下只在必要时往下走：

1. **daemon e2e（主力层）**：放在现有的 `daemon-e2e/` 下，沿用 `api-endpoint-codex.e2e.test.ts` 的做法，用 `providerOverrides.<id>.command` 指向临时目录里的假 CLI 脚本。脚本按参数返回版本号，或者模拟升级：记下参数，把版本文件改成新版本号，也可以按设定失败。最新版本的查询通过测试 daemon 注入桩函数，不真的联网。这是 `docs/testing.md`「End-to-end means end-to-end」的有意例外（2026-10-01 用户确认）：CI 不依赖外网和 npm 的可用性。要覆盖的场景：
   - 快照带上 `version`
   - 检查结果带上 `latestVersion` 和 `updateAvailable`，缓存生效，`force` 跳过缓存
   - 某一家联网失败只影响那一项
   - 升级成功后快照里的版本更新
   - 升级失败时返回输出原文
   - 同一个提供方并发升级时被拒
   - 默认启用：不写任何配置时，copilot 和 opencode 是停用的，omp 是启用的
2. **纯函数单测**，只测 e2e 不方便造出来的分支：
   - Codex 安装方式判断：按路径特征区分独立安装、Homebrew、npm 和无法判断
   - `--version` 输出的解析：各家的真实输出样例
   - semver 比较
3. **App 组件测试（jsdom）**：
   - 沿用 `providers-section.test.tsx` 的做法，测试 Providers 页和添加提供方弹窗：
     - 启用的提供方（含未安装、出错、检测中）在"已启用"组，停用的在"已停用"组；"已停用"组为空时不显示
     - 已停用的行显示"已停用 · 启用后检测是否已安装"，不显示"未安装"
     - 拨"已启用"里的开关写入 `enabled: false`，拨"已停用"里的开关写入 `enabled: true`；快照更新后这一行出现在另一组
     - 点"已停用"的一行只导航到详情页，不写配置
     - 添加提供方弹窗里只有 ACP 目录，"添加"是 outline 按钮
     - 有新版本时状态行出现"升级到 vX"按钮，点击后转圈；失败时显示输出原文
     - daemon 不支持 `providerVersions` 时不显示版本
   - `provider-detail/index.test.tsx`：测试详情页的版块顺序、版本和安装指引互斥，以及 `enabled` 为假时只显示停用说明卡、不显示安装指引
   - 详情页头的启用开关：为页头组件补 jsdom 测试，覆盖开关反映 `enabled`、拨动后调用回调、停用时刷新按钮禁用
   - `provider-placement.test.ts`：随分组规则一起修改
   - `providers-view.test.ts`（原 `providers-layout.test.ts`）：跟着删掉的函数一起修改
   - 列表 → 详情 → 返回的导航不做 jsdom 页面测试（需要 mock 路由，违反 `docs/testing.md`），由 Playwright 规格 `e2e/browser/settings-providers-list-detail.spec.ts` 覆盖：宽屏、窄桌面、手机三种宽度用同样的栈式断言

`e2e/browser/acp-provider-catalog.spec.ts` 和 `settings-providers-list-detail.spec.ts` 里依赖"列表只放在用的"或"未启用"组的断言，跟着新规则修改。

原生端不做实机验收（见项目约定）。Web 和 Electron 用截图验收：列表两组、拨开关前后、已停用的详情页、添加提供方弹窗、升级转圈和失败状态、详情页顺序。

## Out of Scope

- 一键**安装**：未安装的提供方仍然只显示可复制的安装命令。
- "全部升级"。
- 后台定时检查新版本，以及对应的开关。
- 自定义提供方和 ACP 提供方的版本号和升级。
- 给已停用的提供方新增"已安装"检测。
- 在"官方"一行显示订阅、账号或套餐信息。
- Claude Code 的 stable 更新通道：统一和 npm 的 `latest` 比较。
- 对"默认启用变化"做配置迁移。
- 升级时拦截正在跑的会话，或者弹确认。
- composer 模型选择器里齿轮打开的提供方详情弹窗：只随详情页组件一起更新版块顺序和停用说明卡，不加启用开关。
- 开关的乐观更新：这一行等快照更新后才移到另一组，不提前移动。

## Further Notes

- Claude Code 原生安装和 Copilot 默认会自动更新，"有新版本"的提示可能过一会儿就没了。这符合预期（Q16）。
- 如果用户 Claude Code 用的是 stable 更新通道，和 npm `latest` 比较时可能一直显示"有新版本"，而 `claude update` 只会升到 stable 版本。升级后版本号没变的话，按钮会一直在。先接受这个问题，有反馈再支持更新通道。
- 启用了但没装的提供方（标"未安装"）在新建会话的提供方选择器里仍然显示为"不可用"，和现在一样。
- 刚启用的提供方要等下一次版本检查（重新进入 Providers 页，或在详情页点刷新）才会显示"升级到 vX"，启用本身不触发检查。
- Pi 的 npm 包名换过：旧包 `@mariozechner/pi-coding-agent` 停在 0.73.1。2026-10-01 在隔离的 npm 前缀里实测：用旧包 0.73.1 装的 Pi 执行 `pi update`，会卸掉旧包、装上 `@earendil-works/pi-coding-agent`，版本升到 0.99.1，退出码 0，所以一键升级对旧包同样有效。比 0.73.1 更早的旧包未实测。
- User Story 50（只读客户端点不了升级）只做到了 daemon 侧：升级需要 `daemon.manage`，只读客户端发请求会被拒，失败块显示原因。App 不知道自己持有哪些权限，所以按钮照常显示。要做到按钮不可点，得让协议把客户端权限告诉 App，超出本任务，留作后续（2026-10-01 用户确认）。
- 升级执行的是主机上的真实命令，e2e 只用假 CLI 验证。真实升级留给人工验收：在自己机器上实际升级一个过时的 CLI，比如 Pi 或 OMP。

## Acceptance Criteria

- [ ] 所有宽度下，Providers 分区都先显示列表，点一行推入详情页；宽屏页头是面包屑，手机是返回键；左右两列布局已删除
- [ ] Providers 页分"已启用""已停用"两组，所有提供方都在本页；两组每行都有开关，拨动后这一行移到另一组并短暂高亮；已停用的行不标"未安装"
- [ ] 点任何一行都只进入详情页，不改配置；「添加提供方」弹窗只有 ACP 目录，"添加"是 outline 按钮
- [ ] 详情页头有启用开关；已停用时正文只有停用说明卡、刷新不可用；启用后正文原地变成检测结果（可用的区块或安装指引）
- [ ] 已安装的内置提供方在列表行和详情页都显示版本号；自定义提供方和 ACP 提供方不显示
- [ ] 打开 Providers 页面时检查新版本，1 小时内再打开不重复联网，刷新会强制重新检查；联网失败不影响页面
- [ ] 有新版本时，列表行的状态行和详情页都出现升级按钮；点击后转圈，成功后版本号更新、按钮消失，失败时显示命令输出原文、可以关掉
- [ ] Codex 按独立安装、Homebrew、npm 选择升级命令；判断不出安装方式时，提示无法自动升级
- [ ] 同一个提供方并发升级时，第二次被拒；升级需要 `daemon.manage`，版本检查需要 `daemon.read`
- [ ] 详情页的版块顺序为：错误 → 版本 → 安装指引 → 第三方接口 → Models → 诊断；版本和安装指引不同时出现
- [ ] 全新配置下，Claude Code、Codex、Pi、Oh My Pi 默认启用，Copilot、OpenCode 默认停用
- [ ] 连着旧版本 daemon 时，不显示版本号和升级按钮，其余功能正常；门控处带 `COMPAT(providerVersions)` 标签
- [ ] daemon e2e、纯函数单测和 App 组件测试都覆盖了 Testing Decisions 里列出的场景
- [ ] `docs/usage.md`、`docs/providers.md`、`docs/glossary.md`、`docs/design.md`、`CHANGELOG.md` 已更新；9 个语言文件的文案已补全
- [ ] 人工在本机实际升级一个过时的内置 CLI 成功，并且 Web 和 Electron 都有截图
- [ ] `npm run typecheck` 和 `npm run lint` 都通过
