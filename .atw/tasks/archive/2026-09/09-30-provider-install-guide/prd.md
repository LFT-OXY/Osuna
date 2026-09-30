# 提供方安装指引

父任务：`09-30-provider-install-and-api-endpoint`。决策来源见父任务的 `prd.md`（「A 安装指引」一节），命令原文见父任务的 `research/install-commands.md`。

## Problem Statement

Osuna 靠主机上安装的 CLI 提供方干活。新手打开设置里的提供方列表，只会看到 Claude Code、Codex、Pi 或 Oh My Pi 那一行亮着黄点、写着「未安装」，点进详情面板，也只有空的模型列表和一个诊断按钮。界面没有告诉用户该在哪台机器上、用什么命令安装，也没有官方文档可以查。用户只能离开 Osuna 自己去搜，而搜到的命令还分 macOS、Linux 和 Windows 三种写法。

更容易出错的是用手机或另一台电脑连接主机的情况。这时 CLI 要装在**主机**上，但用户很可能按自己手上设备的系统去找命令，结果装错了地方，或者用了错误的写法。

## Solution

当 Claude Code、Codex、Pi 或 Oh My Pi 的状态为「未安装」时：

- 提供方列表的这一行给出明显的「如何安装」入口，点击后打开该提供方的详情面板。
- 详情面板顶部显示安装指引：
  - macOS、Linux、Windows 三个标签，每个标签下是该系统的官方安装命令，每条命令都有复制按钮；
  - 一个「官方文档」链接。
- 默认选中**主机**的系统。daemon 通过一个新的可选字段上报主机系统。连接的是不上报该字段的老 daemon 时，三个标签照常显示，不默认选中任何一个。
- 继承这四个内置提供方之一的自定义提供方，显示所继承提供方的指引，标题也用所继承提供方的名称（如「安装 Claude」），因为装的是同一个 CLI。

Osuna 只展示命令，不替用户执行。

## User Stories

1. 作为没装过 CLI 的新手，我想在「未安装」的提供方那一行看到「如何安装」入口，以便知道从哪里开始。
2. 作为新手，我想点这个入口后直接看到安装命令，以便不用离开 Osuna 去搜索。
3. 作为新手，我想每条命令旁边都有复制按钮，以便原样粘贴到终端，不会抄错。
4. 作为新手，我想看到「官方文档」链接，以便命令出问题时能查官方的完整说明。
5. 作为用 Mac 连接本机 daemon 的用户，我想默认看到 macOS 的命令，以便不用自己判断该选哪个系统。
6. 作为用手机连接 Windows 主机的用户，我想默认看到 Windows 的命令，而不是手机系统的命令，以便把 CLI 装在正确的机器上、用正确的写法。
7. 作为 WSL 或 Linux 服务器上的 daemon 的用户，我想默认看到 Linux 的命令，以便命令能在 daemon 所在的环境里运行。
8. 作为用户，我想在三个系统的标签之间自由切换，以便给另一台机器准备命令，或者对照着看。
9. 作为连接老版本 daemon 的用户，我想仍然看到三个系统的命令，只是没有默认选中项，以便指引在老主机上也能用。
10. 作为 Claude Code 用户，我想看到官方安装脚本的命令，Windows 下同时有 PowerShell 和 CMD 两种写法，以便用我熟悉的终端。
11. 作为 Codex 用户，我想看到官方安装脚本的命令，以便按 OpenAI 推荐的方式安装。
12. 作为 Windows 上的 Pi 用户，我想看到 npm 安装命令，而不是一条在 Windows 上跑不了的脚本，以便真的装得上。
13. 作为 Pi 用户，我想看到新的包名 `@earendil-works/pi-coding-agent`，以便不装到已经废弃的旧包。
14. 作为 Oh My Pi 用户，我想看到三个系统各自的官方安装命令，以便和其他提供方一样一步装好。
15. 作为使用继承 Claude Code 的自定义提供方的用户，我想在它「未安装」时看到 Claude Code 的安装指引，以便知道要装的是哪个 CLI。
16. 作为用户，我想在提供方已经安装后不再看到安装指引，以便详情面板照旧只显示模型和诊断信息。
17. 作为 OpenCode 或 Copilot 用户，我想让这两个提供方的界面保持原样，以便不出现不完整的指引。
18. 作为用户，我想看到界面文案（标签名、按钮、提示）使用我设置的语言，而命令和链接保持原文，以便命令可以直接复制运行。
19. 作为手机端用户，我想在手机上的提供方详情里同样看到并复制这些命令，以便在手机上查好命令，再到主机上执行。
20. 作为用户，我想在指引里看到一句提示「在运行 Osuna daemon 的那台机器上执行」，以便不会误装到正在操作的设备上。
21. 作为装完 CLI 的用户，我想在详情面板里点「刷新」后看到状态变为可用，以便确认安装成功。这里沿用现有的刷新按钮。

## Implementation Decisions

- **协议**：`server_info` 新增可选字段 `hostPlatform`。
  - 类型是字符串，不用枚举，保证以后 daemon 上报新值时，老客户端也能正常解析。
  - daemon 填入它运行时的平台标识（Node 的 `process.platform`，如 `darwin`、`linux`、`win32`）。
  - 这个字段按 `docs/protocol-compatibility.md` 处理：新字段可选，不做 feature 门控，因为缺失时有明确的降级行为（见下一条）。
- **App 会话信息**：`DaemonServerInfo` 增加 `hostPlatform`（类型取 `ServerInfoStatusPayload["hostPlatform"]`），从 `server_info` 原样透传过来。
- **特性目录**：全部放在 `packages/app/src/provider-install-guide/`，按 `session-history/` 的分法：
  - `index.tsx`：入口，导出纯函数和 `ProviderInstallGuideSurface`（纯 props：`guide`、`cliLabel`、`onCopyCommand`、`onOpenDocs`）；
  - `view.tsx`：`ProviderInstallGuideView`，接剪贴板、toast 和外链。剪贴板模块在单测运行器里无法解析，所以不放进入口；
  - `internal/model.ts`：解析逻辑；`internal/commands.ts`：静态命令表。
- **安装指引解析模块**（`internal/model.ts`），这是本任务唯一的逻辑中心：
  - `resolveProviderInstallGuide({ provider, extendsProvider?, hostPlatform })`，其中 `extendsProvider` 是 daemon 配置里该提供方的 `extends` 原值（类型为 `unknown`，由模块自己收窄）。
  - 输出：两种结果之一：
    - `null`，即「无指引」；
    - 指引对象：官方文档 URL、三个系统的命令列表（每个系统一条或多条，可带简短说明，比如 Windows 下的「PowerShell」和「CMD」）、指引所属的内置提供方 `provider`（自定义提供方取它继承的那个），以及默认选中的系统（可能为 `null`）。
  - `hasProviderInstallGuide({ provider, extendsProvider? })`：列表只需要知道有没有指引，不需要主机平台。
  - 平台映射：`darwin` 对应 macOS，`linux` 对应 Linux，`win32` 对应 Windows。其他值或字段缺失时，默认选中为空。
  - 只有 `claude`、`codex`、`pi`、`omp` 有指引。内置提供方忽略 `extends`；其余 id 看 `extends`，`extends` 是 `acp`、其他内置提供方、缺失或原型链上的键名（如 `constructor`）时都返回「无指引」。
- **安装数据**（`internal/commands.ts`）：按内置提供方 id 索引的静态表。
  - 每个系统的命令以官方文档原文为准。第一版内容取自父任务的 `research/install-commands.md`，2026-09-30 实现时已对照官方页面核对：三个提供方的命令一致；Codex 文档地址 `developers.openai.com/codex/cli` 已 308 跳到 `https://learn.chatgpt.com/docs/codex/cli`，表里用跳转后的地址。
  - 每个系统只列官方首推的写法。npm、brew 这类备选写法不列，免得新手面对一堆选项不知道选哪个。
  - Pi 的 Windows 标签用 npm 命令 `npm install -g --ignore-scripts @earendil-works/pi-coding-agent`。Pi 的 quickstart 只给 macOS / Linux 的安装脚本，npm 是它列出的全平台备选写法，需要 Node 22.19 及以上。Pi 首页另有 PowerShell 安装器 `powershell -c "irm https://pi.dev/install.ps1 | iex"`，但文档页里没有，所以暂不采用（见 Further Notes）。
- **自定义提供方**：App 从 daemon 配置里读取该提供方的 `extends`，交给解析模块。详情面板标题用 `resolveProviderLabel(guide.provider, …)` 拿到所继承提供方的名称。
- **提供方列表**：已启用、状态为「未安装」（`unavailable`）且有指引的行，把状态文字换成带下划线、可点击的「如何安装」链接（黄点保留），点击后打开现有的提供方详情面板，并拦住冒泡，避免整行再打开一次。已停用的行照旧显示「已停用」。其余行不变。整行点击本来就会打开详情面板，这个行为保持不变。
- **详情面板**：状态为「未安装」且有指引时，在模型区之上显示安装指引区。版式受 `docs/design.md` §7 约束：节标题和卡片之间不能夹说明段落，所以布局是：
  - 节标题「安装 {CLI 名称}」，系统标签放在节标题右侧；
  - 卡片里是当前标签下的命令，每行一条，带复制按钮；主机系统未知且还没选标签时，这里显示「选择 Host 的操作系统」；
  - 卡片最后一行左侧是提示「在运行 Osuna daemon 的机器上执行」，右侧是「官方文档」链接。

  状态为其他值时不显示这个区。
- **复制与外链**：复用 App 已有的剪贴板封装（`utils/copy-to-clipboard`）和打开外部链接的工具（`openExternalUrl`），和 ACP 目录的「Install instructions」链接走同一条路径。复制成功弹「已复制 命令」，失败弹「复制命令失败」。打开链接和 ACP 目录一样，不单独提示失败。
- **视觉**：遵循 `docs/design.md`。文字用 `components/ui/text.tsx`，命令用等宽字体，链接用 `<Text accessibilityRole="link" onPress>`，标签用现有的分段控件（主机系统未知时传一个不对应任何选项的哨兵值 `"none"`）；不引入新的设计 token。
- **i18n**：新增文案键写在 `en.ts`，其余 8 种语言同步补齐。命令文本、URL、提供方名称不翻译（`docs/i18n.md`）。

## Testing Decisions

- 好的测试只断言外部行为，也就是给定输入得到什么输出、界面出现什么入口，不断言内部结构或样式细节。
- **安装指引解析模块**（主测试层）：用单元测试覆盖全部规则。
  - 四个提供方都返回指引，且三个系统的命令都不为空。
  - `opencode`、`copilot` 和未知 id 都返回「无指引」。
  - `darwin`、`linux`、`win32` 分别映射到对应的默认系统；未知值和字段缺失时，默认系统为空。
  - Pi 的 Windows 命令是 npm 命令，并且使用新包名。
  - 文档 URL 都是 https。
  - 参照现有的纯逻辑测试，例如提供方诊断模型列表的测试。
- **协议契约**：在现有的 `messages` 协议测试里增加两条：带 `hostPlatform` 的 `server_info` 能解析并保留该值；不带这个字段的老 daemon 消息也能解析。参照技能管理功能里「老 daemon 省略 features」的用例。
- **指引区组件**（`provider-install-guide/index.test.tsx`，jsdom + fake 回调）：默认选中主机系统并能切换标签；主机系统未知时不选中、不显示命令；复制按钮回调收到的命令和显示的文本一致；「官方文档」回调收到文档 URL。
- **提供方列表**：在现有的提供方列表组件测试里增加三条：「未安装」且有指引的行显示「如何安装」入口，点击后只打开一次详情面板；已安装的行和 OpenCode 不显示这个入口；继承 Claude Code 的自定义提供方显示这个入口。
- **i18n**：跑现有的多语言键一致性测试。
- 详情面板的排版按 `docs/qa.md` 截图验收，覆盖桌面端的浅色和深色主题。原生端按项目惯例免做实机验收。
- daemon 组装 `server_info` 时只多填一个平台值，不单独写测试。
- 只运行改动涉及的测试文件，不跑整个测试套件。

## Out of Scope

- 一键安装，或由 daemon 代为执行任何安装命令。
- OpenCode、Copilot，以及 ACP 目录里的提供方（ACP 目录已经有自己的安装链接）。
- 已安装的提供方显示文档链接，或者提示有更新、一键升级。
- 检测 Node 或 npm 等前置依赖是否已安装。
- 首次启动时的新手引导流程。
- 按客户端设备的系统推断默认标签。默认值只看主机，没有主机信息时不默认选中。
- 第三方接口的配置，这部分由兄弟子任务 `09-30-api-endpoint` 负责。

## Acceptance Criteria

- [x] 连接新 daemon 时，Claude Code、Codex、Pi、Oh My Pi 显示「未安装」的行都有「如何安装」入口，点击后打开详情面板，顶部显示安装指引。
- [x] 指引默认选中主机系统的标签：macOS 主机选 macOS，Linux 主机（包括 WSL）选 Linux，Windows 主机选 Windows。三个标签可以自由切换。
- [x] 连接不上报 `hostPlatform` 的老 daemon 时，三个标签都显示，没有默认选中项，界面不报错。
- [x] 每条命令都能一键复制，复制的内容和显示的文本完全一致。「官方文档」链接在外部浏览器打开对应的官方页面。
- [x] 命令内容和官方文档一致。Pi 的 Windows 标签是使用新包名的 npm 命令。
- [x] 继承上述四个提供方之一的自定义提供方，在「未安装」时显示所继承提供方的指引。
- [x] 已安装的提供方，以及 OpenCode、Copilot，界面与改动前一致。
- [x] 界面文案 9 种语言齐全，命令和 URL 不翻译。
- [x] 解析模块的单元测试、协议契约测试、提供方列表组件测试、i18n 一致性测试都通过。`npm run typecheck` 和 `npm run lint` 通过。
- [x] 桌面端浅色和深色主题下，都有详情面板中安装指引的截图。

## Further Notes

- 「指引只在未安装时出现」这一点是写规格时和用户确认的默认做法，决策访谈里没有讨论过。
- Pi 的 Windows 写法仍待用户确认：目前按本规格用 npm（文档页有原文，需要 Node 22.19+）；备选是首页的 PowerShell 安装器（明确面向 Windows，但只在首页出现）。改的话只动 `internal/commands.ts` 和 `internal/model.test.ts` 里的 Pi 用例。
- 命令会随上游变化。静态表里集中存放命令和文档 URL，更新时只改这一处。
- `hostPlatform` 以后也可以给别的功能用（比如按主机系统显示路径格式）。本任务只用它来决定默认标签。
