# 访谈决定（2026-10-08）

## 起因

现在的安装指引只在提供方"未安装"时显示；一键升级失败时，只有"判断不出安装方式"这一种失败会给手动提示和文档链接。Copilot、OpenCode 没有安装指引，也没有文档链接。升级出错后，用户只能自己去官方文档查命令。

## 第一轮

- **Q1**：只放详情页，做成常驻的"安装与升级"区块，提供方装没装都显示。列表行不变。
- **Q2**：仿照 Codex 官方 quickstart 的结构：每个标签下分别给出"安装"和"升级"两条命令，可以复制；标签区分系统和安装方式（Codex 是 macOS/Linux、Windows、npm、Homebrew）。推翻旧任务"每个系统只列官方首推写法"的约定。
- **Q3**：同 Q2，Codex 的每种安装方式都列出来。
- **Q4**：纳入 Copilot 和 OpenCode。
- **Q5**：每个提供方只给一个官方文档链接。
- **Q6**：继承内置提供方的自定义提供方显示所继承 CLI 的指引，标题用所继承 CLI 的名字。
- **Q7**：所有类型的升级失败都加一句引导，指向常驻区块；去掉只在 install_method_unknown 时出现的 ManualUpgradeHint。
- **Q8**：建任务。

## 安装方式检测（事实）

一键升级时只有 Codex 会按可执行文件的真实路径判断安装方式（`provider-upgrade-command.ts`）。其他五家直接调用 CLI 自带的升级子命令，由 CLI 自己沿用原安装方式；这一点由 `official-commands.md` 核实。

## 第二轮

- **Q9**：标签逐家照搬官方文档，名称和顺序都按官方。
- **Q10**：默认标签按主机系统选，不改协议；不根据 Codex 判断出的安装方式选标签。
- **Q11**：区块放在版本一节下面，也就是现在安装指引的位置；装没装都在同一处。
- **Q12**：提供方被关闭时不显示，保持现状。
- **Q13**：没有继承内置提供方的自定义提供方和 ACP 目录里的提供方不显示区块。

## 第三轮（依据 official-commands.md）

- **Q14**：区块标题"安装与升级"；每个标签下两条命令分别标"安装""升级"（en: Install / Upgrade），与升级按钮用词一致。
- **Q15**：保留"在运行 Osuna 守护进程的机器上执行"，放区块底部，与官方文档链接同一行。
- **Q16**：daemon 比较升级前后的版本，退出码为 0 但版本没变时判为失败，新增错误码（命令跑完但版本没变），带上输出，失败块引导到常驻区块。前后任一版本读不出时仍只按退出码判断。`errorCode` 在协议里是字符串，旧 App 显示"升级失败"加原因原文。
- **Q17**：标签取舍规则：安装是一条命令、并且官方写了升级命令的才放进区块，其余留给文档链接。各家标签：
  - Claude Code：macOS/Linux、Windows（PowerShell、CMD 两行）、Homebrew、WinGet、npm
  - Codex：macOS/Linux、Windows、npm、Homebrew（升级照抄官方 Update，不带 CODEX_NON_INTERACTIVE）
  - Copilot：npm、WinGet、Homebrew、安装脚本（升级都是 `copilot update`）
  - OpenCode：安装脚本、npm、Bun、pnpm、Homebrew、Chocolatey、Scoop（升级都是 `opencode upgrade`）
  - Pi：curl、PowerShell、npm、pnpm、bun、Nix（Nix 升级 `nix profile upgrade pi`，其余 `pi update`）
  - Oh My Pi：macOS·Linux、Windows (PowerShell)、Homebrew、Bun、mise（升级都是 `omp update`）
- **Q18**：Pi 和 OMP 的文档链接换成各自的 GitHub README。

## 本机事实

开发机上的 Claude Code 是 Homebrew cask `claude-code@latest`（`/opt/homebrew/bin/claude` → `Caskroom/claude-code@latest/2.1.280/claude`，`~/.local/bin/claude` 链到 `/opt/homebrew/bin/claude`），正好是 `claude update` 不执行升级的情况。

## 第四轮

- **Q19**：Claude 一键升级加 Homebrew：只在 macOS 上认，按真实路径匹配 `<前缀>/Caskroom/claude-code/` 或 `claude-code@latest/`，执行 `<前缀>/bin/brew upgrade --cask <从路径取出的 cask 名>`。WinGet、apk 不做，交给 Q16 的"版本没变"失败和常驻区块。cask 比 npm 晚更新时会报"版本没变"，文案提示包管理器可能还没收到新版本。
- 术语"安装与升级"已写入 `docs/glossary.md`。
- **Q20**：验收时允许在开发机上真实执行一次 Claude 的 Homebrew 一键升级（需 npm 和 cask 都有比已装更新的版本；执行前再向用户确认一次）。同时写单元测试，覆盖路径识别和命令拼接。
