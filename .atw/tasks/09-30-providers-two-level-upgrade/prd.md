# Providers 设置改为两级结构，显示版本并支持一键升级

决策来源：`research/interview-decisions.md`（访谈 Q1–Q21）。各 CLI 的版本和升级事实：`research/provider-cli-version-update.md`。术语：`docs/glossary.md` 的 **Provider**、**Custom provider**、**API endpoint**、**Add provider**。

## Problem Statement

设置 → 主机 → Providers 在宽屏上是"左列表 + 右详情"两列：一进页面，右边就摊开第一个提供方的全部详情。列表把 6 个内置提供方全部列出，不管装没装、开没开。没装的 Codex、Pi 和真正在用的 Claude Code 挤在一起，每行都有开关，用户分不清哪些是自己在用的。

用户也看不到自己装的 CLI 是哪个版本，更不知道有没有新版本。想升级，只能自己去终端，还得记住每家的升级命令：`claude update`、`opencode upgrade`、`pi update`……Codex 甚至要看当初是怎么装的。

默认启用的提供方也不合用户习惯。Copilot 和 OpenCode 默认开启，一直占在列表和新建会话的提供方选择里；用户主力用的 Oh My Pi 反而默认关闭。

## Solution

- **两级结构**：所有宽度都是先显示列表，点一行推入该提供方的详情页。宽屏页头显示「Providers / {名称}」面包屑，手机上用返回键。左右两列布局去掉。
- **列表只放在用的**：只显示**已启用并且 CLI 已找到**的提供方；启动出错的和还在探测的也在列表里。每行有开关，关掉后这一行马上移出列表，进入「添加提供方」。
- **添加提供方**：列表标题上的「+」打开「添加提供方」弹窗，分两组：
  - "未启用"：没开或没装的内置提供方，以及之前添加过、后来关掉的提供方，每项标"已停用"或"未安装"。点一项就启用它并进入详情页：装了就回到列表；没装就在详情页看安装指引，装好后刷新即可。
  - "ACP 目录"：现有目录，点击后添加为新的自定义提供方。
- **版本与一键升级**（只针对 6 个内置提供方）：
  - 列表行的状态行显示已装版本号。有新版本时，开关旁边出现"升级"按钮，悬停提示"vX → vY"。
  - 点击后 daemon 在主机上执行该 CLI 的官方升级命令，按钮转圈。成功后版本号刷新；失败时在这一行下面显示命令输出的原文。
  - 详情页新增"版本"一节，放同样的信息和按钮。
  - 只在打开 Providers 页面或点刷新时联网检查新版本，不在后台轮询。
- **详情页版块顺序**：错误类提示 → 版本 → 安装指引（仅未安装时）→ 第三方接口（官方 + 已保存的接口）→ Models → 诊断。
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

8. As a 用户, I want 列表只显示已启用并且已安装的提供方, so that 看到的都是我能直接用的。
9. As a 用户, I want 启动出错的提供方也留在列表里并显示错误状态, so that 我知道它装了但出了问题。
10. As a 用户, I want 刚启用、还在探测的提供方显示为"加载中"留在列表里, so that 启用之后不会看起来什么都没发生。
11. As a 用户, I want 每行保留启用开关, so that 不用进详情页就能关掉一个提供方。
12. As a 用户, I want 关掉开关后这一行移进「添加提供方」, so that 列表始终只有在用的提供方。
13. As a 用户, I want 开关失败时，错误显示在列表卡片顶部，那一行也不消失, so that 我知道操作没成功。
14. As a 用户, I want 一个提供方都没有时看到提示"点 + 添加", so that 知道下一步做什么。
15. As a 用户, I want 主机未连接或列表加载中时看到对应的提示, so that 不会误以为自己一个提供方都没有。

### 添加提供方

16. As a 用户, I want 列表标题上的「+」打开「添加提供方」弹窗, so that 所有没在用的提供方都在一个地方。
17. As a 用户, I want 弹窗上面的"未启用"一组列出关掉的和没装的提供方, so that 我能把它们找回来。
18. As a 用户, I want 每一项标"已停用"或"未安装", so that 点之前就知道会发生什么。
19. As a 用户, I want 点一个"已停用"的提供方后，它被启用并进入它的详情页, so that 一步就能重新用上。
20. As a 用户, I want 点一个"未安装"的提供方后进入它的详情页，看到当前主机系统对应的安装命令, so that 我可以复制到终端去装。
21. As a 用户, I want 在终端装好后，在详情页点刷新，它就进入列表, so that 不需要额外的"启用"步骤。
22. As a 用户, I want 之前从 ACP 目录添加、后来关掉的提供方也出现在"未启用"组里，并保留原来的配置, so that 重新打开时不用重新配置。
23. As a 用户, I want 下面的"ACP 目录"一组保持现有的搜索和添加行为, so that 添加第三方 agent 的方式不变。
24. As a 用户, I want 弹窗顶部的搜索框同时过滤两组, so that 输入名字就能找到任意提供方。
25. As a 用户, I want 启用或添加失败时，错误显示在弹窗里, so that 我知道失败了、为什么失败。

### 版本与升级

26. As a 用户, I want 列表里每个已安装的内置提供方都显示已装版本号, so that 一眼知道自己用的是哪个版本。
27. As a 用户, I want 打开 Providers 页面时自动检查有没有新版本, so that 不用自己去官网查。
28. As a 用户, I want 有新版本时，这一行开关旁边出现"升级"按钮, so that 一键就能升级。
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
43. As a 用户, I want 已安装的提供方不显示安装指引，未安装的不显示版本一节, so that 两者不同时出现。
44. As a Claude Code / Codex 用户, I want 第三方接口一节保持现在的"官方"和已保存接口列表, so that 切换接口的方式不变。
45. As a 用户, I want 自定义提供方的 ⋯ 菜单仍然有"删除", so that 我能彻底删掉一个提供方。

### 默认启用

46. As a 新用户, I want 默认只启用 Claude Code、Codex、Pi、Oh My Pi, so that 列表和新建会话里只有主力提供方。
47. As a 想用 Copilot 或 OpenCode 的用户, I want 在「添加提供方」里点它就能启用, so that 默认关闭不妨碍我用它。
48. As a 从旧版本升级上来的用户, I want CHANGELOG 里说明 Copilot 和 OpenCode 改为默认关闭，以及怎么重新打开, so that 发现它们不见时知道原因。

### 兼容

49. As a 连着旧版本 daemon 的用户, I want 看不到版本号和升级按钮，其余功能照常, so that App 不会因为 daemon 旧而出错。
50. As a 只有只读权限的客户端, I want 能看到版本号和有没有新版本，但点不了升级, so that 权限边界清楚。

## Implementation Decisions

### 协议（protocol）

- `ProviderSnapshotEntry` 新增可选字段 `version: string`，表示 daemon 探测到的已装 CLI 版本（纯版本号，例如 `2.1.285`）。只有内置提供方会填写。旧客户端会忽略它。
- 新增两个 RPC，命名遵循 `docs/rpc-namespacing.md`，和现有的 `provider.api_endpoint.*` 放在同一个 `provider.*` 命名空间下：
  - `provider.version.check.request` / `.response`：请求可选带 `providers`（只查这几个）和 `force`（跳过缓存）。响应是一个数组，每项为 `{ provider, installedVersion?, latestVersion?, updateAvailable, error? }`。
  - `provider.upgrade.request` / `.response`：请求带 `provider`。响应为 `{ provider, ok, version?, output?, errorCode?, error? }`，其中 `output` 是命令输出的原文，失败时一定会带上。`errorCode` 至少要区分这几种：不支持、判断不出安装方式、已有升级在进行、命令失败、超时。
- `server_info.features` 新增一个可选开关 `providerVersions`，同时覆盖快照里的 `version` 字段和上面两个 RPC。App 只在这个开关打开时显示版本和升级功能，门控处加 `COMPAT(providerVersions)` 标签。
- 权限：`provider.version.check.request` 需要 `daemon.read`；`provider.upgrade.request` 需要 `daemon.manage`，因为它会在主机上执行命令，性质和 plugin 安装、更新一样。

### daemon（server）

- **取已装版本**：对启用的内置提供方，在确认 CLI 可用之后执行一次 `--version`，从输出里取第一个形如 `x.y.z` 的版本号，写进快照的 `version`。执行的是这个提供方实际使用的命令，也就是会带上用户在 config 里改过的 command。Claude 已经会取版本，直接复用那次的结果，不再跑第二遍。取不到版本不算错误，快照状态不受影响。
- **最新版本**：6 家统一查 npm registry 的 `latest`，不引入第二个联网目标。

  | 提供方 | npm 包名 |
  |---|---|
  | claude | `@anthropic-ai/claude-code` |
  | codex | `@openai/codex` |
  | copilot | `@github/copilot` |
  | opencode | `opencode-ai` |
  | pi | `@earendil-works/pi-coding-agent` |
  | omp | `@oh-my-pi/pi-coding-agent` |

  包名和升级命令一样，放在每个提供方的 manifest 或定义里，统一维护在一处。
- **版本检查服务**：新建一个模块，负责查询最新版本、缓存结果和比较版本。
  - 结果在 daemon 内存里缓存 1 小时，`force` 跳过缓存。同一个提供方同时发起的多次查询合并成一次。
  - 只在收到 `provider.version.check.request` 时才联网，不在启动时查，也不定时查。
  - 版本比较按 semver，解析不了就视为"没有更新"。
  - 联网失败只写进这一项的 `error`，其他提供方照常返回。
  - 联网函数通过依赖注入传入，测试时替换成桩。
- **升级服务**：新建一个模块，负责选定升级命令、执行命令、执行后重新探测。
  - 升级命令：claude 用 `update`，copilot 用 `update`，opencode 用 `upgrade`，pi 用 `update`，omp 用 `update`，都用这个提供方实际使用的可执行文件来执行。
  - Codex 按可执行文件的真实路径判断安装方式：
    - 路径在官方独立安装目录下：重跑官方安装脚本，并设 `CODEX_NON_INTERACTIVE=1`；Windows 用官方的 PowerShell 安装脚本
    - 路径在 Homebrew 前缀下：`brew upgrade --cask codex`
    - 路径在 npm 全局目录下：`npm install -g @openai/codex@latest`
    - 其他情况（包括 Microsoft Store 版）：返回"判断不出安装方式"
  - 同一个提供方同时只允许一次升级，第二次请求直接返回"已有升级在进行"。
  - 超时 10 分钟。stdout 和 stderr 合在一起保留，截断到一个合理的长度。
  - 升级结束后，不论成功还是失败，都刷新这个提供方的快照（会重新取 `version`），并清掉这个提供方的最新版本缓存。
  - 正在跑的 agent 会话不受影响，不做拦截。
  - 升级命令表和版本解析都是纯函数，单独放，方便以后新增提供方。
- **默认启用**：提供方 manifest 里，copilot 和 opencode 设 `enabledByDefault: false`，omp 去掉 `false`（回到默认开启）。不做配置迁移，已经在 config 里显式写了 `enabled` 的用户不受影响。
- 已停用的提供方仍然不探测、不取版本，保持现状。

### App

- **Providers 页布局**：删掉 `split` 布局、选中项修正地址的逻辑，以及 `resolveProvidersLayout` 和 `resolveSelectedProvider`。所有宽度都走栈式："Providers 分区地址"显示列表，"带提供方的地址"显示详情。现有的面包屑和返回键页头直接沿用。列表在宽屏上设最大宽度，和详情页保持一致。
- **列表的判断规则**：提供方要出现在列表里，需要 `enabled` 为真且 `status !== "unavailable"`（快照里的 `enabled` 是必填布尔值）。其余提供方都进「添加提供方」的"未启用"组：停用的标"已停用"，启用了但 `unavailable` 的标"未安装"。这个判断是纯函数 `resolveProviderPlacement`（`screens/settings/provider-placement.ts`），列表和弹窗共用。
- **列表行**：图标、名称，状态行（状态文字，已安装的内置提供方后面加 " · v{version}"），右侧依次是"升级"按钮（有新版本时才出现）、开关、›。升级失败时，在这一行下面显示可以关掉的错误块，里面是命令输出原文，等宽字体、可选中。
- **添加提供方弹窗**：在现有目录弹窗的基础上，在 ACP 目录上面加"未启用"一组。
  - 点"未启用"里的一项：标"已停用"的写入 `enabled: true`；标"未安装"的本来就是启用的，不写配置。然后关闭弹窗，推入该提供方的详情页。
  - "未启用"组没有可列出的项（包括被搜索过滤光）时，整组连标题一起不显示。
  - 写入失败时，错误留在弹窗里显示，标题沿用添加失败的"无法添加提供方"。
  - 搜索框同时过滤两组。
  - 弹窗标题改为"添加提供方"。
- **版本数据**：Providers 页挂载时发一次 `provider.version.check.request`。页头或详情页的刷新按钮会带 `force` 再发一次。结果按提供方存在 App 的状态里，列表和详情页共用。连着旧版本 daemon（`providerVersions` 没打开）时不发请求。
- **升级动作**：一个 hook 负责发 `provider.upgrade.request`，并记录"正在升级的提供方"和"每个提供方的失败输出"，列表行和详情页的版本一节共用。升级成功后，用返回的版本更新本地显示；快照随后也会推来新的 `version`。
- **详情页**：`ProviderDetailSurface` 的版块顺序改为：删除失败 → 启动错误 → 继承接口提示 → **版本**（新增）→ 安装指引（仅未安装时）→ 第三方接口 → Models → 诊断。版本一节只在内置提供方已安装、并且 daemon 支持时出现。它和安装指引一样，由调用方通过 render 插槽注入。组件顶部的顺序注释同步更新。
- **i18n**：新增的文案（"未启用""已停用""未安装""升级""v{from} → v{to}"、各种升级错误、空列表提示、"添加提供方"等）9 个语言文件都要补上，zh-CN 用 glossary 里定下的词。

### 文档

- `docs/usage.md` 的「The one outbound request」一节：写明查询 npm registry 最新版本属于"用户要求的请求"，只在打开 Providers 页面或点刷新时发生，并说明发往哪里、带什么。
- `docs/providers.md`：新增提供方的清单里补上"npm 包名、升级命令、版本解析"三项。
- `CHANGELOG.md`：写明 Copilot 和 OpenCode 改为默认关闭，以及怎么重新启用。
- `docs/glossary.md`：**Add provider** 条目已经在访谈时写好。

## Testing Decisions

好的测试只看外部行为：daemon 端从客户端 RPC 进、快照出；App 端从渲染出的界面和用户操作进。不断言内部状态，也不断言调用次数。

测试分三层，从上往下只在必要时往下走：

1. **daemon e2e（主力层）**：放在现有的 `daemon-e2e/` 下，沿用 `api-endpoint-codex.e2e.test.ts` 的做法，用 `providerOverrides.<id>.command` 指向临时目录里的假 CLI 脚本。脚本按参数返回版本号，或者模拟升级：记下参数，把版本文件改成新版本号，也可以按设定失败。最新版本的查询通过测试 daemon 注入桩函数，不真的联网。要覆盖的场景：
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
     - 列表只出现启用且已安装的提供方
     - 关掉开关后，这一行出现在弹窗的"未启用"组里
     - 标"已停用"和"未安装"
     - 点"已停用"的一项会写入 `enabled: true` 并导航到详情页；点"未安装"的一项不写配置、直接导航
     - 有新版本时出现"升级"按钮，点击后转圈；失败时显示输出原文
     - daemon 不支持 `providerVersions` 时不显示版本
   - `provider-detail/index.test.tsx`：测试详情页的版块顺序，以及版本和安装指引互斥
   - `providers-view.test.ts`（原 `providers-layout.test.ts`）：跟着删掉的函数一起修改
   - 列表 → 详情 → 返回的导航不做 jsdom 页面测试（需要 mock 路由，违反 `docs/testing.md`），由 Playwright 规格 `e2e/browser/settings-providers-list-detail.spec.ts` 覆盖：宽屏、窄桌面、手机三种宽度用同样的栈式断言

原生端不做实机验收（见项目约定）。Web 和 Electron 用截图验收：列表、弹窗两组、升级转圈和失败状态、详情页顺序。

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
- composer 模型选择器里齿轮打开的提供方详情弹窗：只随详情页组件一起更新版块顺序，不做别的改动。

## Further Notes

- Claude Code 原生安装和 Copilot 默认会自动更新，"有新版本"的提示可能过一会儿就没了。这符合预期（Q16）。
- 如果用户 Claude Code 用的是 stable 更新通道，和 npm `latest` 比较时可能一直显示"有新版本"，而 `claude update` 只会升到 stable 版本。升级后版本号没变的话，按钮会一直在。先接受这个问题，有反馈再支持更新通道。
- 启用了但没装的提供方（标"未安装"）在新建会话的提供方选择器里仍然显示为"不可用"，和现在一样。
- Pi 的 npm 包名换过：旧包 `@mariozechner/pi-coding-agent` 已停更。用旧包装的 Pi 执行 `pi update` 会怎样，未核实，实现时要确认。
- 升级执行的是主机上的真实命令，e2e 只用假 CLI 验证。真实升级留给人工验收：在自己机器上实际升级一个过时的 CLI，比如 Pi 或 OMP。

## Acceptance Criteria

- [ ] 所有宽度下，Providers 分区都先显示列表，点一行推入详情页；宽屏页头是面包屑，手机是返回键；左右两列布局已删除
- [ ] 列表只显示 `enabled` 并且状态不是 `unavailable` 的提供方；关掉开关后，这一行立即出现在「添加提供方」的"未启用"组里
- [ ] 「添加提供方」弹窗分"未启用"和"ACP 目录"两组，搜索框同时过滤两组；"未启用"里每项标"已停用"或"未安装"
- [ ] 点"未启用"里的一项会启用它并进入详情页；已安装的随后出现在列表里，未安装的在详情页显示安装指引
- [ ] 已安装的内置提供方在列表行和详情页都显示版本号；自定义提供方和 ACP 提供方不显示
- [ ] 打开 Providers 页面时检查新版本，1 小时内再打开不重复联网，刷新会强制重新检查；联网失败不影响页面
- [ ] 有新版本时，列表行和详情页都出现"升级"按钮；点击后转圈，成功后版本号更新、按钮消失，失败时显示命令输出原文、可以关掉
- [ ] Codex 按独立安装、Homebrew、npm 选择升级命令；判断不出安装方式时，提示无法自动升级
- [ ] 同一个提供方并发升级时，第二次被拒；升级需要 `daemon.manage`，版本检查需要 `daemon.read`
- [ ] 详情页的版块顺序为：错误 → 版本 → 安装指引 → 第三方接口 → Models → 诊断；版本和安装指引不同时出现
- [ ] 全新配置下，Claude Code、Codex、Pi、Oh My Pi 默认启用，Copilot、OpenCode 默认停用
- [ ] 连着旧版本 daemon 时，不显示版本号和升级按钮，其余功能正常；门控处带 `COMPAT(providerVersions)` 标签
- [ ] daemon e2e、纯函数单测和 App 组件测试都覆盖了 Testing Decisions 里列出的场景
- [ ] `docs/usage.md`、`docs/providers.md`、`CHANGELOG.md` 已更新；9 个语言文件的文案已补全
- [ ] 人工在本机实际升级一个过时的内置 CLI 成功，并且 Web 和 Electron 都有截图
- [ ] `npm run typecheck` 和 `npm run lint` 都通过
