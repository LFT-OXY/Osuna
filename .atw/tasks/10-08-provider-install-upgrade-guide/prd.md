# 提供方常驻安装与升级指引

**Status:** ready-for-agent

依据：`research/interview-decisions.md`（Q1–Q21 的决定）、`research/official-commands.md`（2026-10-08 逐字核实的官方命令）。术语见 `docs/glossary.md` 的 **Install and upgrade** 词条。

## Problem Statement

用户在设置里点一键升级，一旦失败，界面只给出失败原因和命令输出。只有"判断不出安装方式"这一种失败会附上一句手动提示和文档链接；最常见的"命令执行失败"和"超时"什么都不给。提供方装好以后，原来的安装指引就消失了，用户得自己去官方网站找升级命令。Copilot 和 OpenCode 从来没有指引，连文档链接都没有。

还有一种失败用户完全察觉不到。用 Homebrew、WinGet、apk 装的 Claude Code，`claude update` 不会升级，只打印一句"由包管理器管理"，然后正常退出。daemon 只看退出码，于是界面显示升级成功，版本没变，升级按钮也还在，用户再点几次结果都一样。开发机上的 Claude Code 正是 Homebrew 的 `claude-code@latest` cask。

## Solution

- 内置提供方的详情页常驻一个"安装与升级"区块，提供方装没装都显示。区块按官方文档的分法分成若干标签，每个标签下列出这种安装方式的安装命令和升级命令，都能复制。区块底部写明"在运行 Osuna 守护进程的机器上执行"，旁边是官方文档链接。六家内置提供方都有这个区块。
- 一键升级失败时（"正在升级"除外），详情页的失败块里加一句引导，让用户去看"安装与升级"区块。
- 升级命令正常退出、但版本没变时，daemon 判为失败，带上命令输出，用户能看到 CLI 实际说了什么。
- 在 macOS 上用 Homebrew 装的 Claude Code，一键升级直接执行 `brew upgrade --cask`，不再调用不起作用的 `claude update`。

## User Stories

1. As a 用户, I want 在提供方详情页始终能看到安装命令和升级命令, so that 一键升级失败时，我不用离开应用就能手动升级。
2. As a 用户, I want 提供方装好以后这个区块仍然在, so that 以后升级出问题时还能找到它。
3. As a 用户, I want 还没安装的提供方也显示同一个区块，位置不变, so that 我能按它装好这个 CLI。
4. As a 用户, I want 标签和官方文档的分法一致（比如 Codex 分 macOS/Linux、Windows、npm、Homebrew）, so that 我点开官方文档时，看到的是同一套分法。
5. As a 用户, I want 每个标签下分别有"安装"和"升级"两条命令, so that 我能找到和当初装法对应的升级命令，不会用另一个包管理器装出第二份。
6. As a 用户, I want 每条命令都能一键复制, so that 不用手动选中长命令。
7. As a 用户, I want 默认选中主机系统对应的标签, so that 大多数时候不用自己切换。
8. As a 用户, I want 能切换到其他标签, so that 我当初用 npm 或 Homebrew 装的，也能找到对应的命令。
9. As a 用户, I want 区块里写明命令要在运行守护进程的机器上执行, so that 我在手机上查看时，不会去手机或当前这台电脑上执行。
10. As a 用户, I want 每个提供方都有一个官方文档链接, so that 区块里的命令不够用时，我能直接看官方说明。
11. As a Pi 用户, I want 文档链接能找到 Windows 的安装方法, so that Windows 主机也能按官方方式安装。
12. As a Oh My Pi 用户, I want 文档链接里列出 Homebrew、Bun、mise 等所有装法, so that 不是用脚本装的也能找到升级方法。
13. As a Copilot 用户, I want Copilot 也有安装与升级区块, so that 它的一键升级失败时我也有办法处理。
14. As a OpenCode 用户, I want OpenCode 也有安装与升级区块, so that 理由同上。
15. As a 继承了 Claude Code 的自定义提供方的用户, I want 看到 Claude Code 的区块，标题用 Claude Code 的名字, so that 我知道要装、要升级的是哪个 CLI。
16. As a 用户, I want 被关闭的提供方仍然只显示"已关闭"卡片, so that 关闭的提供方不会占满详情页。
17. As a ACP 提供方的用户, I want 不出现内容残缺的区块, so that 不会误以为 Osuna 知道它的安装命令（ACP 目录本身有安装链接）。
18. As a 用户, I want 一键升级失败时，详情页的失败块提示我去看"安装与升级"区块, so that 我知道下一步该做什么。
19. As a 用户, I want 失败块里仍然能看到命令输出原文, so that 我能看到 CLI 自己给出的原因和建议。
20. As a 用 Homebrew 装 Claude Code 的 macOS 用户, I want 点"升级"后真的升级, so that 一键升级不会对我无效。
21. As a 装的是 `claude-code@latest` cask 的用户, I want 升级的就是这个 cask, so that 不会另外装一份 `claude-code`。
22. As a 用户, I want 升级命令正常退出、但版本没有变化时，界面告诉我升级没有生效, so that 我不会误以为已经升级，一遍遍重复点。
23. As a 用户, I want 这类失败的提示说明原因可能是包管理器在管理安装，或者包管理器还没收到新版本, so that 我能判断是该手动升级，还是过一会儿再试。
24. As a 用户, I want 升级前或升级后读不出版本时，仍然只按退出码判断成败, so that 读不出版本不会被误报成失败。
25. As a 用户, I want 失败可以关闭或重试，和现在一样, so that 现有的操作习惯不变。
26. As a 手机端用户, I want 区块在窄屏上也能看到所有标签和完整命令, so that 在手机上也能复制命令。
27. As a 使用非中英文界面的用户, I want 新增的文案有我的语言, so that 界面不会混进别的语言。
28. As a 旧版 App 的用户, I want 连接新版 daemon 时，"版本没变"这类失败显示为"升级失败"并附上原因原文, so that 旧版 App 也能正常显示，不会出错。
29. As a 维护者, I want 官方命令集中写在一张表里，命令照录官方原文, so that 官方改了命令时只需要改这一处。
30. As a 维护者, I want `docs/providers.md` 写明新增内置提供方时要补安装与升级数据，并说明 CLI 自带的升级子命令可能不升级包管理器装的版本, so that 以后接入新提供方时不会漏掉。

## Implementation Decisions

### 安装与升级数据（App）

- 用一张按内置提供方分的静态表，替换现在"按系统列首推命令"的安装指引数据。每个提供方包含：官方文档链接，以及按官方顺序排列的若干**安装方式**。每种安装方式包含：标签名（照搬官方，不翻译）、适用的主机系统（macOS / Linux / Windows 的子集）、一条或多条安装命令、一条或多条升级命令。命令有多种写法时，可以带一个简短的说明（终端名或包管理器名），说明不翻译。
- 命令照录 `research/official-commands.md` 里标"已核实"的原文。取舍规则：安装只需一条命令、并且官方写了升级命令的才收录；装起来要好几步的、没有命令可复制的、官方没写升级命令的、升级会失败的、预发布版本，都不收录，留给文档链接。各家收录的安装方式如下：

| 提供方 | 安装方式（官方顺序） | 升级命令 | 文档链接 |
|---|---|---|---|
| Claude Code | macOS/Linux、Windows（PowerShell 和 CMD 两行安装命令）、Homebrew、WinGet、npm | 前两种是 `claude update`；Homebrew 是 `brew upgrade claude-code`；WinGet 是 `winget upgrade Anthropic.ClaudeCode`；npm 是 `npm install -g @anthropic-ai/claude-code@latest` | code.claude.com/docs/en/setup |
| Codex | macOS/Linux、Windows、npm、Homebrew | 照抄官方的 Update 写法（重跑安装脚本、`npm install -g @openai/codex`、`brew upgrade --cask codex`），不带 `CODEX_NON_INTERACTIVE` | learn.chatgpt.com/docs/codex/cli |
| Copilot | npm、WinGet、Homebrew、安装脚本（标签写作 Install script，列官方给的 curl 和 wget 两行） | 都是 `copilot update` | docs.github.com 上的 Copilot CLI 安装页 |
| OpenCode | 安装脚本（标签写作 Install script）、npm、Bun、pnpm、Homebrew、Chocolatey、Scoop | 都是 `opencode upgrade` | opencode.ai/docs/#install |
| Pi | curl、PowerShell、npm、pnpm、bun、Nix | Nix 是 `nix profile upgrade pi`，其余都是 `pi update` | github.com/earendil-works/pi 的 README |
| Oh My Pi | macOS · Linux、Windows (PowerShell)、Homebrew、Bun、mise（顺序按本表，README 里 Windows 排在 Bun 之后；README 的 "Bun (recommended)" "Pinned versions (mise)" 简写成 Bun、mise） | 都是 `omp update` | github.com/can1357/oh-my-pi 的 README（`#install` 一节） |

- 默认标签取"官方顺序里第一个适用于主机系统的安装方式"。主机系统未知（旧 daemon 不上报）时选第一个标签。主机系统沿用 `server_info` 里已有的字段，不改协议。主机系统可能晚于首次渲染才到：用户还没点过标签时，选中的标签跟着默认标签变；点过以后不再变。
- 解析函数的输入和现在一样：提供方 id、配置里的 `extends`、主机系统。输出：所属的内置提供方、是不是沿用所继承提供方的区块、文档链接、安装方式列表、默认安装方式。内置提供方忽略 `extends`；自定义提供方使用它所继承的内置提供方的数据；继承的不是内置提供方（比如 `acp`），或者是未知 id，都返回"没有区块"。

### 详情页（App）

- 区块放在版本一节下面，也就是现在安装指引的位置。装没装都显示；"版本和安装指引二选一"的规则取消。整体顺序：错误卡片 → 继承接口的警告 → 版本 → 安装与升级 → 第三方接口 → 模型 → 诊断。
- 提供方被关闭时只显示"已关闭"卡片，和现在一样。
- 区块标题是"安装与升级"（en："Install and upgrade"）。自定义提供方的标题带上它所继承 CLI 的名字："安装与升级 {CLI 名}"（en："Install and upgrade {name}"）。每个标签下的两组命令分别标"安装"和"升级"（en：Install / Upgrade）。
- 区块底部一行：左边是"在运行 Osuna 守护进程的机器上执行"，右边是"官方文档"链接，沿用现有文案。
- "选择主机的操作系统"这个占位已经用不到了，连同相关文案一起删掉。

### 升级失败块（App）

- 去掉只在 `install_method_unknown` 时出现的手动升级提示，以及它附带的文档链接。
- 除 `in_progress` 外，所有失败（包括 `unsupported`、请求没送达、错误码不认识的情况）都在原因下面加一句固定引导："可以按下方「安装与升级」里的命令手动升级，或查看官方文档"。对没有区块的提供方（比如 ACP），不显示这句。引导是一句纯文字，不带链接；文档链接在区块底部。
- 引导只在详情页显示。失败块在提供方列表行里也会出现，但区块不在那一屏，"下方"没有它，所以列表行的失败块不带引导，也不再有 `install_method_unknown` 的手动提示和文档链接（Q21）。点进详情能看到同一个失败块加引导。
- 新错误码 `version_unchanged` 要有自己的标题文案，说明：命令已经执行完，但版本没有变化；可能是由包管理器管理的安装，也可能是包管理器还没收到新版本。按 `docs/design.md` 行内错误是单句的规则，各语言都写成一句（zh-CN："升级命令已执行完，但版本没有变化：可能是包管理器管理的安装，或包管理器还没有新版本"）。
- 关闭、重试、输出展示的行为不变。

### daemon：升级结果判定

- 升级管理器在执行命令前读一次已装版本（取快照里这一项的版本，不额外探测），执行后按现有流程刷新，再读一次。快照过期（比如在 Osuna 之外手动升级过）时，只会把本该报"版本没变"的情况判成成功，不会反过来误报失败。退出码为 0、前后版本都读得出并且相同时，结果是 `ok: false`、`errorCode: "version_unchanged"`，带上输出和刷新后的版本。前后任一版本读不出时，仍然只按退出码判断。
- 协议：在升级错误码常量里加上 `version_unchanged`，并在常量上方的说明注释里补一行。`errorCode` 在协议里一直是 `z.string()`，所以消息结构不变，生成的校验代码也不用改，不需要 COMPAT 标记。旧版 App 收到不认识的错误码时，显示"升级失败"加上原因原文。

### daemon：Claude Code 的 Homebrew 升级

- 把 Codex 现在的 Homebrew cask 判断规则改成通用的，Codex 和 Claude Code 共用：只在 macOS 上判断，目录前缀只认 `/opt/homebrew` 和 `/usr/local`，路径必须落在 `<前缀>/Caskroom/<cask 名>/` 下面。
- Claude Code 认 `claude-code` 和 `claude-code@latest` 两个 cask 名。可执行文件的真实路径在其中一个下面时，升级命令是 `<前缀>/bin/brew upgrade --cask <从路径里取出的 cask 名>`；否则仍然是 `claude update`（加上 replace 模式的前缀参数，和现在一样）。
- 用 replace 模式换成解释器来启动（比如 `node cli.js`）时，真实路径不是 claude 本身，所以继续走 `claude update`。
- WinGet、apk 不做自动识别，交给"版本没变"失败和常驻区块处理。

### 文档

- `docs/providers.md` 里"Upgrade command"那一段要补两点：CLI 自带的升级子命令可能只打印提示、不升级包管理器装的版本，Claude Code 的 Homebrew 判断就是为此加的，"版本没变"失败也会兜住这种情况；新增内置提供方时，要在 App 的安装与升级表里补上它的数据。

## UI and Design

- 视觉上沿用现在的安装指引：设置卡片里放等宽的命令行，右侧是幽灵按钮"复制"，底部一行是主机提示和文档链接。遵循 `docs/design.md`、`docs/unistyles.md` 和 `.atw/spec/app/frontend/component-guidelines.md`。
- 标签数量会达到 7 个（OpenCode），放不进区块标题右侧那个位置。标签条移到卡片顶部单独占一行；宽度不够时横向滚动（实现选了滚动，没选换行），不截断标签文字，也不撑破卡片。滚动视口收在卡片左右内边距以内，滚出去的标签在内容对齐线上被裁掉。
- 一个标签下的内容：先是"安装"小标题，下面是一行或多行命令；再是"升级"小标题，下面是一行或多行命令。命令放不下时折行，不横向滚动；"复制"按钮和它那条命令垂直居中，按钮的字落在卡片的右对齐线上。
- 需要的状态：已安装、未安装（两者内容相同）、主机系统未知（选中第一个标签）、复制失败（沿用现有的提示）。
- 目标视口：桌面 Electron 1280，以及 Web 窄屏 390。原生端按约定不做实机验收。
- 截图验收：
  - 桌面 1280：已安装的 Claude Code 详情页，版本一节下面能看到"安装与升级"区块，默认选中 macOS/Linux 标签，"安装"和"升级"两组命令都能看到。
  - 桌面 1280：OpenCode 的 7 个标签全部可见或可以滚动到，没有文字被截断。
  - Web 390：最长的那条命令（Claude 的 CMD 安装命令）可以完整看到或横向滚动，复制按钮没有被挤出卡片。
  - 升级失败块：原因下面有指向区块的引导；`version_unchanged` 显示自己的标题和命令输出。

## Testing Decisions

好的测试只从外部观察行为：给定提供方、配置和主机系统，看用户能看到哪些标签和命令；给定 CLI 的行为，看升级请求返回什么结果。不对内部结构和私有函数做断言。

测试切入点，都放在已有的测试文件里：

1. **daemon 端到端测试**（`provider-upgrade.e2e.test.ts`，用假 CLI 跑真实 daemon）：
   - 假 claude 的 `update` 只打印 "Claude is managed by Homebrew" 并以 0 退出 → 返回 `ok: false`、`errorCode: "version_unchanged"`，带输出和版本。
   - 假 CLI 的 `--version` 读不出版本、`update` 以 0 退出 → 仍然 `ok: true`。
   - 现有的"升级后报告新版本"用例继续通过。
2. **升级命令纯函数测试**（`provider-upgrade-command.test.ts`）：
   - Claude 的真实路径在 `/opt/homebrew/Caskroom/claude-code@latest/<ver>/claude` 下 → 执行 `/opt/homebrew/bin/brew upgrade --cask claude-code@latest`。`/usr/local` 前缀和 `claude-code` cask 名也各测一条。
   - 不在 macOS 上、路径不在 Caskroom 下、replace 模式换成解释器启动 → 仍然是 `claude update`。
   - Codex 现有的 Homebrew 用例继续通过（共用判断规则之后）。
3. **安装与升级数据解析测试**（安装指引模块现有的 `model.test.ts`）：六家提供方都有数据；默认标签按"第一个适用于主机系统的安装方式"选出（Copilot 在 Windows 上选 npm，OpenCode 在 Windows 上选 npm，Pi 在 Windows 上选 PowerShell）；主机未知时选第一个标签；自定义提供方使用所继承的提供方的数据；继承 `acp` 或未知 id 时没有区块；Pi 的 Windows 安装命令是官方的 PowerShell 脚本。
4. **详情页组件测试**（`provider-detail/index.test.tsx`）：
   - 已安装、未安装都显示区块，位置在版本一节和第三方接口之间。改写现有的"版本和安装指引二选一""已安装不显示指引"两个用例，以及排序用例。
   - 被关闭的提供方不显示区块。
   - 切换标签后显示对应的安装命令和升级命令；点复制会带上那条命令。
   - 失败块：`command_failed`、`timeout`、`version_unchanged`、`not_installed`、`unsupported`、请求没送达、不认识的错误码，都显示指向区块的引导；没有区块的提供方不显示；`in_progress` 不显示；`install_method_unknown` 不再显示单独的手动提示。改写现有的"手动升级提示"用例。列表行的失败块不带引导，在列表的组件测试（`providers-section.test.tsx`）里断言。
5. **i18n**：现有的 `resources.test.ts` 会检查各语言的文案键是否齐全，新文案要补齐 9 种语言。

参照的已有测试：`provider-upgrade.e2e.test.ts` 里 Codex 走 npm 升级的用例（假包管理器加路径判断），`provider-upgrade-command.test.ts` 里 `detectCodexInstallMethod` 的 Homebrew 用例，`provider-detail/index.test.tsx` 里的安装指引和升级失败用例。

真实验收：开发机上的 Claude Code 是 `claude-code@latest` cask。等 npm 和这个 cask 都有比已装版本更新的版本时，在 dev 桌面端点一次"升级"，确认 daemon 执行的是 `brew upgrade --cask claude-code@latest`，并且版本变了。**执行前要再问一次用户。** 按约定只跑改动涉及的测试文件，再加上 typecheck 和 lint。

## Out of Scope

- Claude Code 用 WinGet、apk、mise 装的版本做自动识别和一键升级；Linux 上 Homebrew 装的 Claude Code 和 Codex。
- 给 Copilot、OpenCode、Pi、OMP 加安装方式识别（它们自带的升级子命令本身就会沿用原来的安装方式）。
- 根据 daemon 识别出的安装方式自动选中对应标签（这需要改协议）。
- 由 daemon 代为执行安装命令。
- 提供方列表里的行（唯一的例外是它的升级失败块去掉了手动提示，见"升级失败块"一节）、ACP 目录、没有继承内置提供方的自定义提供方。
- 被关闭的提供方显示区块。
- 每个提供方给多个文档链接。
- 判断有没有新版本的数据源（仍然查 npm）。

## Further Notes

- 官方命令以 `research/official-commands.md` 为准；实现前如果距离核实已经很久，抽查一下各家文档有没有变化。
- Copilot 的 `copilot update` 推测会把新版下载到 `~/.copilot/pkg`，而不是升级包管理器里的那份，这一点没法从源码证实。如果它导致"版本没变"，新的失败判定会把这个情况暴露出来。
- Homebrew 的 cask 通常比 npm 晚几个小时更新。在这段时间里，Claude Code 一键升级会得到 `version_unchanged`，这是预期行为，文案里已经写了原因。
