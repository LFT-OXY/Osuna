# 六个提供方的官方安装与升级命令（2026-10-08 核实）

## 取证方式

- 联网：`mcp__grok-search-rs__web_fetch` 抓了 Claude setup 页和 Codex 页；Codex 页 HTML 全是导航，改用 curl 直接取官方页面的 `.md` 版本（`https://learn.chatgpt.com/docs/codex/cli.md`，页面自己声明"Markdown versions … by appending `.md`"）。GitHub Docs 用官方的 `docs.github.com/api/article/body` 取正文；GitHub 仓库的 README、docs、源码用 `gh api` 取。`mcp__grok-search-rs__web_search` 用过一次（Copilot），Grok 返回 provider 错误，退化成只给来源列表，所以只拿它找来源，结论都回原页核对过。全程没用 WebFetch / WebSearch。
- 标注：**已核实** = 命令在所列官方页面或官方源码里逐字出现；**源码** = 官方仓库源码里能看到，但文档没写；**推测** = 官方文档和源码里都没有这条命令，按包管理器的通用写法推出来。
- 本机证据：Claude Code 不开源，"升级子命令是否沿用安装方式"一节用的是本机 Homebrew 装的 `claude` 2.1.280 二进制里的字符串（`strings` 提取，只读）。

---

## 1. Claude Code

**官方文档入口**：https://code.claude.com/docs/en/setup
理由：一页里有全部安装方式（原生脚本三种 shell、Homebrew、WinGet、apt/dnf/apk、npm），还有 "Update Claude Code" 一节，给了每种方式的升级写法。

页面顶部的标签是 `Native Install (Recommended)` / `Homebrew` / `WinGet`。原生安装标签下再按 shell 分三条。npm 和 Linux 包管理器放在 "Advanced installation options" 里。

| 标签 / 安装方式（适用系统） | 安装命令 | 升级命令 | 来源 / 状态 |
|---|---|---|---|
| Native Install → macOS, Linux, WSL | `curl -fsSL https://claude.ai/install.sh \| bash` | 自动后台更新；手动：`claude update` | setup#install-claude-code、#update-manually；已核实 |
| Native Install → Windows PowerShell | `irm https://claude.ai/install.ps1 \| iex` | 同上：`claude update` | 同上；已核实 |
| Native Install → Windows CMD | `curl -fsSL https://claude.ai/install.cmd -o install.cmd && install.cmd && del install.cmd` | 同上：`claude update` | 同上；已核实 |
| Homebrew（macOS/Linux） | `brew install --cask claude-code`（另有 `claude-code@latest` cask） | `brew upgrade claude-code` 或 `brew upgrade claude-code@latest` | setup Homebrew 标签与 #auto-updates；已核实 |
| WinGet（Windows） | `winget install Anthropic.ClaudeCode` | `winget upgrade Anthropic.ClaudeCode` | setup WinGet 标签；已核实 |
| npm（全平台，Node.js 22+） | `npm install -g @anthropic-ai/claude-code` | `npm install -g @anthropic-ai/claude-code@latest`（文档明确说别用 `npm update -g`） | setup#install-with-npm；已核实 |
| apt（Debian/Ubuntu） | 先配置签名密钥和仓库（多步，见文档），最后执行 `sudo apt install claude-code` | `sudo apt update && sudo apt upgrade claude-code` | setup#install-with-linux-package-managers；已核实 |
| dnf（Fedora/RHEL） | 先写 `/etc/yum.repos.d/claude-code.repo`，再执行 `sudo dnf install claude-code` | `sudo dnf upgrade claude-code` | 同上；已核实 |
| apk（Alpine） | 先加密钥和仓库，再执行 `apk add claude-code` | `apk update && apk upgrade claude-code` | 同上；已核实 |

补充（已核实，出处同页）：原生安装会在后台自动更新。Homebrew、WinGet、apt、dnf、apk 默认不自动更新。设 `CLAUDE_CODE_PACKAGE_MANAGER_AUTO_UPDATE=1` 后，Claude Code 会在后台替你跑 Homebrew 和 WinGet 的升级命令。

---

## 2. Codex CLI

**官方文档入口**：https://learn.chatgpt.com/docs/codex/cli
- 这是现行地址。`https://developers.openai.com/codex/cli` 返回 **HTTP 308**，跳到 `https://learn.chatgpt.com/docs/codex/cli`（curl 实测）。旧调研里的地址还能用，只是会跳转。
- `https://developers.openai.com/codex/quickstart` 跳到 `https://learn.chatgpt.com/docs/quickstart`。那一页现在讲的是 ChatGPT 桌面端和 Web，**没有** CLI 安装标签。`https://learn.chatgpt.com/docs/codex/quickstart` 返回 404。
- 所以带 "Install Codex / Update Codex" 四个标签的页面是 **`/docs/codex/cli` 的 "Getting started → 1. Install Codex" 一节**（锚点 `#getting-started`），不是 quickstart。

| 标签（适用系统） | 安装命令（Install） | 升级命令（Update） | 来源 / 状态 |
|---|---|---|---|
| macOS/Linux | `curl -fsSL https://chatgpt.com/codex/install.sh \| sh` | `curl -fsSL https://chatgpt.com/codex/install.sh \| sh` | learn.chatgpt.com/docs/codex/cli；已核实 |
| Windows（"Start these from a new PowerShell window."） | `powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 \| iex"` | `powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 \| iex"` | 同上；已核实 |
| npm | `npm install -g @openai/codex` | `npm install -g @openai/codex` | 同上；已核实 |
| Homebrew | `brew install --cask codex` | `brew upgrade --cask codex` | 同上；已核实 |

注意：官方 npm 标签的升级命令就是 `npm install -g @openai/codex`，没有加 `@latest`，这里照录原文。

---

## 3. GitHub Copilot CLI

**官方文档入口**：https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli
理由：这一节标题就叫 "Installing or updating Copilot CLI"，四种方式都在。页尾链到命令参考，说明那里有升级命令。命令参考（https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference）只多一行 `copilot update`，不适合当入口。

文档按小节分组："Installing with npm (all platforms)"、"Installing with WinGet (Windows)"、"Installing with Homebrew (macOS and Linux)"、"Installing with the install script (macOS and Linux)"、"Download from GitHub.com"。

| 小节（适用系统） | 安装命令 | 升级命令 | 来源 / 状态 |
|---|---|---|---|
| npm（全平台，Node.js 22+） | `npm install -g @github/copilot`（`~/.npmrc` 设了 `ignore-scripts=true` 时用 `npm_config_ignore_scripts=false npm install -g @github/copilot`；预发布版用 `npm install -g @github/copilot@prerelease`） | `copilot update`；或重跑安装命令 | 安装：install 页，已核实。`copilot update`：命令参考 "Download and install the latest version."，已核实。"重跑安装命令即升级"是从小节标题 "Installing or updating" 推出来的，推测 |
| WinGet（Windows） | `winget install GitHub.Copilot`（预发布：`winget install GitHub.Copilot.Prerelease`） | `copilot update`；包管理器写法 `winget upgrade GitHub.Copilot` | 安装：已核实。`copilot update`：已核实。`winget upgrade GitHub.Copilot` 文档没写，推测 |
| Homebrew（macOS、Linux） | `brew install --cask copilot-cli`（预发布：`brew install --cask copilot-cli@prerelease`） | `copilot update`；包管理器写法 `brew upgrade --cask copilot-cli` | 安装：已核实。`brew upgrade --cask copilot-cli` 文档没写，推测 |
| 安装脚本（macOS、Linux） | `curl -fsSL https://gh.io/copilot-install \| bash`，或 `wget -qO- https://gh.io/copilot-install \| bash` | `copilot update`；或重跑安装脚本 | 安装：已核实。重跑脚本：推测 |
| 从 GitHub.com 下载 | https://github.com/github/copilot-cli/releases/ 下载对应平台可执行文件 | `copilot update` | 已核实（install 页） |

补充：
- GA 公告（https://github.blog/changelog/2026-02-25-github-copilot-cli-is-now-generally-available）原文："Homebrew, WinGet, and install script installations automatically update."，没提 npm。已核实。
- 官方 README（https://github.com/github/copilot-cli）写的 Homebrew 安装命令是 `brew install copilot-cli`，**没有 `--cask`**，跟 docs.github.com 的 `brew install --cask copilot-cli` 对不上。建议以 docs 为准。

---

## 4. OpenCode

**官方文档入口**：https://opencode.ai/docs/#install
理由：全部安装方式都在 Intro 页的 Install 一节（含 Windows 子节）。升级只有一条 `opencode upgrade`，在 https://opencode.ai/docs/cli/#upgrade。只给一个链接的话选安装页。两页渲染结果和官方源码 `anomalyco/opencode` 的 `packages/web/src/content/docs/index.mdx`、`cli.mdx` 一致。

文档分组：先是 install 脚本（"The easiest way"），然后是 "Using Node.js"（标签：npm / Bun / pnpm / Yarn）、"Using Homebrew on macOS and Linux"、"Installing on Arch Linux"，最后是 "Windows" 子节（Chocolatey / Scoop / NPM / Mise / Docker）。

| 分组 / 标签（适用系统） | 安装命令 | 升级命令 | 来源 / 状态 |
|---|---|---|---|
| install 脚本（macOS/Linux，文档没写系统，从 bash 推出来） | `curl -fsSL https://opencode.ai/install \| bash` | `opencode upgrade`（自动判断安装方式，此时 method=curl，会重新下载执行 install 脚本） | 安装：docs#install，已核实。升级：docs/cli#upgrade，已核实。执行细节：`packages/opencode/src/installation/index.ts`，源码 |
| Node.js → npm | `npm install -g opencode-ai` | `opencode upgrade`（源码里实际执行 `npm install -g opencode-ai@<版本>`） | 已核实 + 源码 |
| Node.js → Bun | `bun install -g opencode-ai` | `opencode upgrade`（执行 `bun install -g opencode-ai@<版本>`） | 已核实 + 源码 |
| Node.js → pnpm | `pnpm install -g opencode-ai` | `opencode upgrade`（执行 `pnpm install -g opencode-ai@<版本>`） | 已核实 + 源码 |
| Node.js → Yarn | `yarn global add opencode-ai` | `opencode upgrade` 能认出 yarn，但 upgrade 的 switch 里没有 yarn 分支，会报 `Unknown installation method: yarn`。只能手动 `yarn global add opencode-ai`（推测） | 安装：已核实。升级失败：源码 |
| Homebrew（macOS、Linux） | `brew install anomalyco/tap/opencode`（官方推荐 tap；也提到 Homebrew 官方 formula `brew install opencode`，更新较慢） | `opencode upgrade`（执行 `brew upgrade anomalyco/tap/opencode` 或 `brew upgrade opencode`，取决于装的是哪个） | 已核实 + 源码 |
| Arch Linux | `sudo pacman -S opencode` / `paru -S opencode-bin` | 文档没写；`opencode upgrade` 认不出 pacman，会报 unknown。推测走 `sudo pacman -Syu` / `paru -Syu` | 安装：已核实。升级：推测 |
| Windows → Chocolatey | `choco install opencode` | `opencode upgrade`（执行 `choco upgrade opencode --version=<版本> -y`，需要管理员终端） | 已核实 + 源码 |
| Windows → Scoop | `scoop install opencode` | `opencode upgrade`（执行 `scoop install opencode@<版本>`） | 已核实 + 源码 |
| Windows → NPM | `npm install -g opencode-ai` | `opencode upgrade` | 已核实 |
| Windows → Mise | `mise use -g github:anomalyco/opencode` | 文档没写；`opencode upgrade` 不支持 mise。推测 `mise upgrade github:anomalyco/opencode` | 安装：已核实。升级：推测 |
| Windows → Docker | `docker run -it --rm ghcr.io/anomalyco/opencode` | 不适用（每次拉镜像） | 已核实 |

文档原文：`opencode upgrade [target]`，带 `--method` / `-m` 参数，"The installation method that was used; curl, npm, pnpm, bun, brew"。源码的 choices 还多了 `choco`、`scoop`。Windows 官方推荐用 WSL。

---

## 5. Pi（@earendil-works/pi-coding-agent）

**官方文档入口**：https://pi.dev/docs/latest/quickstart（锚点 `#1-install-pi`）
理由与取舍：quickstart 写了安装脚本、npm、Nix 三种方式，也写了 "The installer … updates Pi with `pi update`" 和 "Nix 装的不能用 `pi update`"，是文档站里最全的"安装 + 升级"页面。**但它没有 Windows 安装命令**，只说 "For native Windows setup, read Windows Setup"，而 https://pi.dev/docs/latest/windows 讲的是 Git Bash 和 PowerShell 工具配置，**也没有安装命令**。Windows 安装器只出现在官网首页 https://pi.dev/ 的安装标签和 GitHub README https://github.com/earendil-works/pi 里。如果更在意 Windows 用户点进去能找到命令，可以改用 README，它有安装脚本、Windows、npm、Nix 四种和 `pi update` 说明，但没有 pnpm/bun。

官网首页的安装标签：`curl` / `PowerShell` / `npm` / `pnpm` / `bun`。quickstart 还多了 Nix。

| 标签（适用系统） | 安装命令 | 升级命令 | 来源 / 状态 |
|---|---|---|---|
| curl（macOS/Linux） | `curl -fsSL https://pi.dev/install.sh \| sh` | `pi update` | pi.dev 首页、quickstart、README；已核实 |
| PowerShell（Windows） | `powershell -c "irm https://pi.dev/install.ps1 \| iex"` | `pi update` | pi.dev 首页、README（"On Windows:"，以及 "The macOS, Linux, and Windows installers can install it [Node] if needed"）；已核实。`https://pi.dev/install.ps1` 返回真实的 pwsh 脚本，写的也是 `managed-install.json` 托管安装 |
| npm（全平台，Node.js 22.19+） | `npm install -g --ignore-scripts @earendil-works/pi-coding-agent` | `pi update`（源码实际执行 `npm install -g --ignore-scripts --min-release-age=0 @earendil-works/pi-coding-agent`） | 安装：已核实。`pi update` 升级本体：cli.md 已核实。实际命令：源码 `packages/coding-agent/src/config.ts` |
| pnpm | `pnpm add -g --ignore-scripts @earendil-works/pi-coding-agent` | `pi update`（执行 `pnpm install -g --ignore-scripts --config.minimumReleaseAge=0 …`） | 安装：pi.dev 首页，已核实。升级：源码 |
| bun | `bun add -g --ignore-scripts @earendil-works/pi-coding-agent` | `pi update`（执行 `bun install -g --ignore-scripts …`）；**Windows 上 bun 装的不支持自升级** | 安装：pi.dev 首页，已核实。升级：源码 |
| Nix（macOS/Linux） | `nix profile add github:earendil-works/pi/stable`（旧版 Nix 用 `nix profile install`） | `nix profile upgrade pi`（`pi update` 不能升级 Nix 安装） | quickstart、cli.md；已核实 |

**`pi update` 升级的是 CLI 本体，不只是扩展**（已核实）：https://pi.dev/docs/latest/cli（源文件 `packages/coding-agent/docs/cli.md`）"Update Pi or packages" 一节原文：
- "Running `pi update` without a target updates Pi itself."
- `pi update --extensions` 更新全部包；`pi update <source>` 更新单个包；`pi update --models` 刷新模型目录；`pi update --all` 同时更新本体和全部包。
- "`pi update --self`, `pi update self`, and `pi update pi` are aliases for `pi update`."
- "`pi update` cannot update Pi when another package manager provides it, such as Nix."

---

## 6. Oh My Pi（omp）

**官方文档入口**：https://omp.sh/docs/quickstart
理由与取舍：文档站 quickstart 只列了 macOS/Linux 脚本和 Windows PowerShell 两种。Homebrew、Bun、Nix、mise 只在 GitHub README（https://github.com/can1357/oh-my-pi#install）里有。`omp update` 写在 https://omp.sh/docs/cli。如果要和"按标签列全部安装方式"对齐，README 的 Install 一节更全，可以考虑用它当入口。

README 的分组：**macOS · Linux** / **Homebrew** / **Bun (recommended)** / **Nix** / **Windows (PowerShell)** / **Pinned versions (mise)**。

| 分组（适用系统） | 安装命令 | 升级命令 | 来源 / 状态 |
|---|---|---|---|
| macOS · Linux 脚本 | `curl -fsSL https://omp.sh/install \| sh` | `omp update` | quickstart、README；已核实。`omp update` 见 docs/cli："Installs the current channel's update."，已核实 |
| Windows (PowerShell) | `irm https://omp.sh/install.ps1 \| iex` | `omp update` | quickstart、README；已核实 |
| Homebrew | `brew install can1357/tap/omp` | `omp update`（源码实际执行 `brew upgrade can1357/tap/omp`） | 安装：README，已核实。升级：源码 `packages/coding-agent/src/cli/update-cli.ts` |
| Bun（README 标为推荐） | `bun install -g @oh-my-pi/pi-coding-agent` | `omp update`（执行 `bun install -g --no-cache --registry=… <固定版本的包和 natives 包>`） | 安装：已核实。升级：源码 |
| Nix | `nix profile install github:can1357/oh-my-pi`（或 `nix run github:can1357/oh-my-pi` 免安装运行） | `omp update` 会拒绝，提示 "managed by Nix and cannot update itself"。推测走 `nix profile upgrade`，文档没写具体命令 | 安装：已核实。拒绝：源码。升级写法：推测 |
| mise（固定版本） | `mise use -g github:can1357/oh-my-pi` | `omp update`（执行 `mise upgrade github:can1357/oh-my-pi --bump [--before 0s]`） | 安装：已核实。升级：源码 |

补充（源码）：`omp.sh/install` 默认**本机有 bun 就走 bun 安装**，没有才装预编译二进制（脚本注释：`--source` 走 bun，`--binary` 强制二进制）。所以同一条安装命令在不同机器上可能是 bun 安装，也可能是二进制安装，后续 `omp update` 会按实际情况走对应分支。

---

## CLI 自带的升级子命令会不会沿用原安装方式

| 子命令 | 能识别安装方式吗 | 各安装方式下的行为 | 证据 |
|---|---|---|---|
| `claude update` | **能** | 原生安装：用原生更新器。npm 全局安装：调用 npm 执行 `install -g`。Homebrew / WinGet / apk / mise 等包管理器安装：**不执行升级**，只打印 "Claude is managed by Homebrew/winget/apk" 和对应命令（如 `brew upgrade claude-code`、`winget upgrade Anthropic.ClaudeCode`、`apk upgrade claude-code`、`mise upgrade claude`），已是最新时打印 "Claude is up to date!" | 文档：setup#update-manually "Installs managed by Homebrew, WinGet, or apk report `Claude is up to date!` instead"；env-vars `CLAUDE_CODE_PACKAGE_MANAGER_AUTO_UPDATE` "Other package managers continue to show the upgrade command without running it"；setup#auto-updates 提到 npm 全局目录不可写时没法自动更新（说明 npm 安装会走 npm 升级）。二进制字符串（本机 2.1.280）：`installationType` 分为 `native` / `npm-global` / `npm-local` / `package-manager`；"update: Calling installGlobalPackage() for global update"，`We(s,["install","-g",u])`；"Claude is managed by a package manager. Please use your package manager to update." 文档部分已核实，二进制部分是源码级证据 |
| `copilot update` | **不按包管理器走**（推测） | 从 GitHub Release 下载最新包放到 `~/.copilot/pkg`，启动时加载这个新版本。npm / brew / winget 记录的版本不会变 | 命令参考："Download and install the latest version."（已核实）。官方 changelog：0.0.421 "Use consistent ~/.copilot/pkg path for auto-update"、0.0.420 "Auto-update now also updates the binary executable, not just the JS package"、1.0.85 "--no-auto-update says it runs the version bundled in the binary"。CLI 主体闭源，npm 包只是一个调用平台二进制的 loader，二进制里的主逻辑没能提取，所以"不调用包管理器"这一点是推测 |
| `opencode upgrade` | **能** | 按 `process.execPath` 和各包管理器的全局列表判断：curl → 重新下载执行 install 脚本；npm/pnpm/bun → `<pm> install -g opencode-ai@<版本>`；brew → `brew upgrade <tap 或核心 formula>`；choco → `choco upgrade opencode --version=… -y`；scoop → `scoop install opencode@…`。yarn 能认出但不支持（报错）；识别不了时提示 "may be managed by a package manager" 并询问是否继续；也可以用 `--method` 手动指定 | 文档 docs/cli#upgrade 的 `--method` 说明（已核实）；源码 `packages/opencode/src/installation/index.ts`、`src/cli/cmd/upgrade.ts`（dev 分支） |
| `pi update` | **能** | 安装器（`install.sh` / `install.ps1`）装的是托管安装，走托管更新（`npm ci` 到 releases 目录后切换版本）。npm/pnpm/yarn/bun 全局安装：调用同一个包管理器 `install -g`。Windows 上只支持 npm 和 pnpm（另有托管安装）。Nix 和识别不了的安装：不执行，提示用原包管理器更新 | 文档：quickstart、cli.md "cannot update Pi when another package manager provides it, such as Nix"（已核实）。源码：`packages/coding-agent/src/config.ts`（`detectInstallMethod`、`getSelfUpdateCommandForMethod`）、`src/package-manager-cli.ts`（托管安装分支，以及 "self-update on Windows is only supported for npm and pnpm installs"） |
| `omp update` | **能** | 按 PATH 里排在最前的 `omp` 判断：brew → `brew upgrade can1357/tap/omp`；mise → `mise upgrade github:can1357/oh-my-pi --bump`；bun/npm → 用同一个包管理器 `install -g` 固定版本；Nix → 拒绝；二进制 → 原地替换。发布方标记为 binary-only 的版本，即使是 bun/npm 安装也会被换成独立二进制 | 文档 docs/cli 只写了 "Installs the current channel's update."（已核实）；分支逻辑来自源码 `packages/coding-agent/src/cli/update-cli.ts` 的 `runUpdateCommand` |

---

## 和现有代码不一致的地方

对照的文件：`/Users/oxy/Documents/code/My/Osuna/packages/app/src/provider-install-guide/internal/commands.ts`

1. **Pi 的 Windows 命令不是官方首推写法**：代码用的是 `npm install -g --ignore-scripts @earendil-works/pi-coding-agent`，注释说"quickstart 只给 macOS / Linux 安装脚本"。quickstart 确实没有 Windows 命令，但官网首页的 PowerShell 标签和 GitHub README 都给了官方 Windows 安装器 `powershell -c "irm https://pi.dev/install.ps1 | iex"`，README 也说这个安装器装出来的 Pi 用 `pi update` 升级。npm 写法本身逐字正确，只是不再是唯一的官方 Windows 写法，标签也该叫 npm 而不是 Windows 默认。
2. **Pi 的文档链接 `https://pi.dev/docs/latest/quickstart` 里没有 Windows 安装命令**（Windows Setup 页也没有）。如果保留这个链接，Windows 用户点进去找不到安装命令。取舍见第 5 节。
3. **OMP 的文档链接 `https://omp.sh/docs/quickstart` 只覆盖两种安装方式**，Homebrew / Bun / Nix / mise 只在 GitHub README 里。
4. **Claude、Codex、OMP 现有的 mac 和 Windows 安装命令都和官方逐字一致**，这一项没有不一致：
   - Claude 三条命令和 setup 页原文完全一致。
   - Codex 两条和 learn.chatgpt.com 原文完全一致。Codex 文档链接 `https://learn.chatgpt.com/docs/codex/cli` 是现行地址，`developers.openai.com/codex/cli` 308 跳转到它。
   - OMP `curl -fsSL https://omp.sh/install | sh` 和 `irm https://omp.sh/install.ps1 | iex` 都和 quickstart、README 一致。
5. **覆盖面缺口**（按访谈 Q2–Q4 的新要求）：代码没有 Copilot、OpenCode；也没有任何升级命令；Claude 少了 Homebrew / WinGet / npm / apt / dnf / apk，Codex 少了 npm / Homebrew 标签，Pi 少了 PowerShell / pnpm / bun / Nix，OMP 少了 Homebrew / Bun / Nix / mise。文件开头注释"每个系统只列官方首推写法，不列 npm / brew 等备选"和新需求冲突。
6. 顺带说明（不在要求对照的列表里）：`packages/server/src/server/agent/provider-upgrade-command.ts` 里 Codex 一键升级用的是 `curl -fsSL https://chatgpt.com/codex/install.sh | CODEX_NON_INTERACTIVE=1 sh` 和 `$env:CODEX_NON_INTERACTIVE=1; irm https://chatgpt.com/codex/install.ps1 | iex`。注释说这是照录 codex-rs `update_action.rs` 的写法，和文档 Update 标签里给用户复制的命令（不带 `CODEX_NON_INTERACTIVE`）不同。用途不一样，两者都对，但常驻区块展示时应该用文档版。
