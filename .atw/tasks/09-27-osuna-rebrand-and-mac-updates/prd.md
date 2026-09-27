# Osuna 品牌化与 macOS 自动更新修复

**Triage:** ready-for-agent

## Problem Statement

我在 `getpaseo/paseo` 的基础上二次开发出 `LFT-OXY/Osuna`，已经和上游彻底分开，但分发出去的桌面端还是上游的样子，更新链路也没有真正归我管：

1. **名字和图标还是 Paseo。** 装上后 Dock、菜单栏、窗口标题、界面文案都叫 Paseo，图标是上游的蝴蝶。上游的许可证是 Apache-2.0，它不授予商标权，所以发布物里本来就不该带蝴蝶图标。
2. **还有几条路径会把用户带回上游。** 桌面自动更新源已经指向本仓库，但另外三处没有：
   - Rosetta 提示里的「下载」按钮，拿到的是上游安装包。
   - daemon 自更新执行的是 `npm install -g @getpaseo/cli@latest`，Docker 部署的 daemon 点一下就会被换成上游 npm 版。
   - 应用内的更新日志读的是上游的 CHANGELOG。

   CLI 里的下载提示、反馈与仓库链接、赞助链接、文档链接也都指向上游。每推一个 tag，还会触发四条在 fork 下注定失败的工作流（它们依赖上游的 EAS 和 Cloudflare 账号）。
3. **macOS 自动更新从来没成功过，而且没人知道。** Squirrel.Mac 替换应用前，会检查新包是否满足当前应用的 designated requirement。ad-hoc 签名把这条要求绑在二进制的 cdhash 上，而每次构建的 cdhash 都不一样，所以任何版本都更新不到下一个版本。更糟的是，这个错误没有任何地方能看到：
   - 更新器的报错只写到主进程 console，没有进日志文件。
   - 界面在调用安装之后，立刻就告诉用户「即将重启」。

   CI 出的 x64 包其实连 ad-hoc 签名都没有，electron-builder 找不到签名身份时会直接跳过。

## Solution

桌面端以 Osuna 的身份发布，所有更新和外链只指向本仓库，macOS 自动更新真正能用，失败了也看得见：

- **改名只改到桌面 App 的身份这一层**（ADR 0002）。显示名改为 `Osuna`，`appId` 改为 `com.chinhae.osuna.desktop`，图标换成 Osuna 折纸鸟。用户看不到的内部标识保留 `paseo` 拼写：`paseo://` scheme、userData 目录、`~/.paseo`、`paseo` 命令、`PASEO_*`、`@getpaseo/*`。这样已经添加的 host 和设置都不会丢。
- **手机端用官方 Paseo App**，本仓库不打手机包。共享界面的文案一律改成 Osuna，只有指代手机官方 App 的地方保留 "Paseo"。
- **macOS 改用一张长期固定的自签名证书签名**（ADR 0001）。designated requirement 从绑定 cdhash 改为绑定证书，更新就能通过。这张证书就是更新身份：本地存一份，放进 GitHub Secrets 一份，用户自己再同步一份到云盘。
- **更新失败要可见**：更新器的日志进 main.log；只有真正开始退出安装，界面才说「即将重启」；出错时显示原因。
- **一次性过渡**：`0.10.0` 需要每个人手动下载安装一次，之后再删掉旧的 Paseo.app。从这一版开始，自动更新可用。

## User Stories

1. 作为团队成员，我希望装上后 Dock、菜单栏、窗口标题里显示的是 Osuna，这样我知道自己用的是团队版而不是官方版。
2. 作为团队成员，我希望应用图标是 Osuna 的折纸鸟，这样我在 Dock 和启动台里一眼就能认出它。
3. 作为团队成员，我希望「关于 Osuna」「退出 Osuna」这类菜单项用的是新名字，这样界面前后一致。
4. 作为团队成员，我希望系统通知的标题是 Osuna，这样我知道通知来自哪个应用。
5. 作为团队成员，我希望应用内的欢迎页和启动闪屏显示 Osuna 的图标，这样品牌从外到里是统一的。
6. 作为团队成员，我希望界面文案里提到本产品的地方都叫 Osuna，这样我不会以为自己装错了。
7. 作为团队成员，我希望提示我「用手机扫码」的地方仍然写 Paseo，这样我知道该去应用商店下载哪个 App。
8. 作为团队成员，我希望从 Paseo 换成 Osuna 后，已经添加的 host 仍然在，这样我不用重新配对和设置。
9. 作为团队成员，我希望换成 Osuna 后，我的快捷键覆盖、应用设置和评审草稿都保留，这样升级不会打断手头的工作。
10. 作为团队成员，我希望 Osuna 仍然使用原来的 `~/.paseo` 数据目录，这样我已有的 agent、worktree 和配置都还在。
11. 作为团队成员，我希望手机上的官方 Paseo App 还能照常连接我的 daemon，这样我不用换手机端。
12. 作为 macOS 用户，我希望装上 0.10.0 之后，后续版本都能在应用内自动更新，这样我不用每次手动下载。
13. 作为 macOS 用户，我希望更新失败时能看到失败原因，这样我知道要不要手动重装，或者去找维护者。
14. 作为 macOS 用户，我希望只有安装真的开始了，应用才告诉我「即将重启」，这样我不会被一个没有兑现的提示误导。
15. 作为 macOS 用户，我希望发版说明写清楚 0.10.0 必须手动安装一次，还要删掉旧的 Paseo.app，这样我知道升级该怎么做。
16. 作为 macOS 用户，我希望首次打开时的放行步骤里写的是 Osuna.app，这样我照着文档操作不会出错。
17. 作为 x64 Mac 用户，我希望拿到的包和 Apple Silicon 包一样经过签名，这样我也能自动更新。
18. 作为在 Rosetta 下运行 x64 版的用户，我希望提示里的「下载 Apple Silicon 版」拿到的是 Osuna，这样我不会被换成官方版。
19. 作为团队成员，我希望应用内的更新日志展示的是 Osuna 自己的变更，这样我知道这个版本改了什么。
20. 作为用 Docker 部署 daemon 的用户，我希望设置页里不再出现「更新 daemon」按钮，这样我不会误点之后被换成上游的 npm 版。
21. 作为用 CLI 的用户，我希望 `paseo open` 能找到并打开 Osuna.app，这样命令行和桌面端能配合使用。
22. 作为用 CLI 的用户，我希望找不到桌面端时，提示的下载地址是本仓库的 Releases，这样我装上的是团队版。
23. 作为团队成员，我希望「反馈问题」和「仓库」链接指向 Osuna 的仓库，这样问题能报给真正维护它的人。
24. 作为团队成员，我希望应用里不再出现上游作者的赞助链接和上游文档链接，这样我不会被引到与团队版无关的地方。
25. 作为维护者，我希望 macOS 包用同一张证书签名，这样每一版都满足上一版的 designated requirement。
26. 作为维护者，我希望 CI 在签名退化成 ad-hoc 或未签名时直接失败，这样一个 secret 配错不会悄悄发出一个打断所有人更新链的版本。
27. 作为维护者，我希望证书的 `.p12` 和密码有一份在本机固定位置，这样我能自己同步到云盘做备份。
28. 作为维护者，我希望证书有效期足够长，这样不会因为证书过期而被迫让所有人重装。
29. 作为维护者，我希望本地构建保持现状、不接触证书，这样证书只存在于 CI 和我的备份里。
30. 作为维护者，我希望更新器的报错能进 main.log，这样用户发来日志我就能诊断更新问题。
31. 作为维护者，我希望在改 CI 之前，先在本地证明「同一张自签证书签出的两个包可以互相通过校验」，这样方案的核心假设在上线前就被验证过。
32. 作为维护者，我希望 0.10.0 → 0.10.1 在真机上自动更新成功之后才通知团队，这样团队拿到的是一条确认可用的更新链。
33. 作为维护者，我希望推 tag 时不再触发注定失败的 Android、Web app、网站、relay 工作流，这样发版页面只有真正的信号。
34. 作为维护者，我希望这些工作流文件先保留，这样以后需要自建时有据可依。
35. 作为维护者，我希望有 ADR 解释为什么内部标识还叫 `paseo`，这样后来的人不会去把改名「补完」。
36. 作为维护者，我希望 glossary 区分 Osuna 和 Paseo，这样写文案时知道哪个词指什么。
37. 作为维护者，我希望这次发版用 0.10.0，这样版本号能标记出身份变化，又不动用 major。
38. 作为维护者，我希望旧 Paseo.app 与 Osuna.app 并存的问题靠发版说明解决，这样不会留下只运行一次的死代码。

## Implementation Decisions

### 身份与改名（ADR 0002）

- 桌面端打包配置：`appId` 为 `com.chinhae.osuna.desktop`，`productName` 与 `executableName` 为 `Osuna`，所有产物名以 `Osuna-` 开头，协议显示名改成 Osuna 的说法。scheme 仍为 `paseo`。
- 主进程在应用就绪前，显式把 userData 固定到 appData 下的 `Paseo` 目录。开发时的 worktree 隔离目录和强制 userData 覆盖逻辑保持原有优先级，这条固定只作用于默认路径。
- 日志目录同样固定在 `Paseo`（实施时经用户确认追加）：macOS 的 electron-log 按应用名放在 `~/Library/Logs/<名字>`，不固定就会挪到 `Osuna`，而 Windows、Linux 的日志在 userData 下，本来就随 userData 固定。两处固定都必须早于首次写日志，因为 electron-log 在首次写入时缓存路径。
- 所有依赖可执行文件名或 bundle 名的地方同步改名：打包钩子、随包分发的 CLI shim、更新诊断里的 ShipIt 缓存目录（由 appId 推导）、CLI 查找桌面端的候选路径（macOS、Windows、Linux）、主进程里的应用名常量、Linux 的 desktop 文件名与窗口 class（electron-builder 按 productName 生成 `Osuna.desktop` 与 `StartupWMClass=Osuna`）、打包冒烟脚本。
- 以下几项经用户确认后一并改名：Nix 打包（`nix/desktop-package.nix` 按 `Osuna.app` 取产物，`nix.yml` 断言新 appId）；deb/rpm 的 maintainer 改为 `oxy <oxy.chinhae@gmail.com>`，vendor 改为 `Osuna`；GitHub Release 标题改为 `Osuna <tag>`。
- Windows 使用新 appId 推导出的新 NSIS GUID，不做原地升级（当前没有 Windows 用户）。
- 共享界面（`packages/app`，同时是桌面端的渲染层）：所有语言的翻译文件以及硬编码文案里，指代本产品的 "Paseo" 改成 "Osuna"。指代手机官方 App 的保留 "Paseo"。`paseo` 命令名、`paseo.json`、`~/.paseo` 这类标识照旧。
- 手机端打包配置完全不动：app config 的 name、bundle id、EAS 绑定、手机图标、fastlane。网站包、README、fastlane 元数据也不动。

### 图标

- 源图是用户调整好的 1254² PNG，底板占画布约 80%，符合 Apple 图标栅格。先做清理：底板内部 alpha 补到 255，清除画布边缘的低 alpha 杂点。
- 从清理后的源图派生：macOS icns、Windows ico（16–256）、Linux 各尺寸 png、打包进应用和通知用的 png、开发版图标，以及 Web 的 favicon、PWA、apple-touch 图标。favicon 的状态变体（running / attention）按现有的状态语义重新生成。
- 应用内 logo：欢迎页和启动闪屏使用彩色图标（位图）。16px 的工具调用小图标换成新描的单色鸟形 SVG，随主题着色，替代原来的蝴蝶组件。
- 派生过程写成一个可以重复运行的脚本，源图放进仓库。以后换 logo 只需替换源图再跑一遍。

### 更新与外链只指向本仓库

- Rosetta 提示的下载基址改为本仓库的 Releases，回退地址同样指向本仓库的 Releases 页面。
- 应用内更新日志改为读取本仓库主分支的 `CHANGELOG.md`。
- daemon 自更新：server 不再在 `server_info.features` 中声明 `daemonSelfUpdate`，对应的 RPC 也拒绝执行。官方手机 App 和本仓库的界面都靠这个 capability 判断，所以会一起隐藏入口，这符合 `docs/protocol-compatibility.md` 的 feature contract。桌面托管与否都不声明。拒绝的形式是 `daemon.update.response { success: false, error, previousVersion, newVersion: null }`，客户端沿用已有的失败提示显示原因。npm 自更新实现（updater、session controller、install-origin、npm-global-cli）随之成为孤儿，已删除；protocol 里的 `daemonSelfUpdate` 字段、client 的 `updateDaemon`、app 的更新卡片保留。已知例外：远程的桌面托管 daemon 版本与 app 不一致时，host 页仍显示那张按钮禁用、提示去 host 上更新桌面端的卡片。这是原有的版本不一致提示，不是自更新入口，要隐藏它就得在 app 里另加判断，违反 feature contract。
- CLI 找不到桌面端时的提示、onboard 里的下载链接改为指向本仓库。
- 反馈与 Issue 链接、仓库链接改为指向 `LFT-OXY/Osuna`。删除赞助链接。删除应用和 CLI 里所有指向上游文档站的链接，包括只为承载这些链接而存在的「了解更多」元素。
- 工作流：`android-apk-release`、`deploy-app`、`deploy-website`、`deploy-relay` 只保留 `workflow_dispatch`，文件本身保留。`deploy-website` 的 `release: published` 触发一并去掉（发布 Desktop Release 时同样会必然失败）；`deploy-relay` 原本就只有手动触发。job 里只对 push / release 事件有意义的条件（`deploy-website` 的 `if`、`android-apk-release` 的 `|| github.ref` 兜底）有意保留，把触发加回来时只改 `on:` 一处。fork 发版文档写明这四个工作流在 fork 下停用。

### macOS 签名（ADR 0001）

- 生成一张自签名 code signing 证书，有效期 30 年，CN 为 Osuna 的签名身份名。`.p12` 和导出密码存到本机 `~/.config/osuna/codesign/`：目录权限 700，密码文件权限 600。由用户自行同步到云盘。
- 用 `gh secret set` 把证书（base64）和密码写入仓库 Secrets（`CSC_LINK`、`CSC_KEY_PASSWORD`）。**这一步是写入外部服务，执行前必须单独征得用户确认。**
- CI 的 macOS 作业注入这两个 secret，并通过自定义 `mac.sign` 钩子按证书的 SHA-1 指纹显式签名，不依赖 electron-builder 的身份查找，也不设钥匙串信任。原因（ticket 01 实测）：electron-builder 只从 `security find-identity -v` 列出的受信身份里挑选，自签证书不设信任就一定不在其中，此时即使给了 `identity` / `CSC_NAME`，arm64 也会静默退回 ad-hoc，x64 直接不签名。配了 `sign` 钩子后 electron-builder 不再兜底，把 `CSC_LINK` 导入的临时钥匙串交给钩子，钩子拿不到指纹或签名失败时必须报错。钩子只在 CI 用 `-c.mac.sign=` 注入，`electron-builder.yml` 不引用它。arm64 与 x64 都签名。指纹是公开值，钉在工作流 env 的 `OSUNA_MAC_SIGNING_SHA1`，不从 secret 推导：secret 里换成另一张证书时，钩子在钥匙串里找不到这个指纹，构建直接失败。
- `hardenedRuntime` 保持关闭，不做公证。本地构建不引入证书，维持现状。
- 打包后在 CI 里断言：用 `codesign -d -r-` 读出的 designated requirement 必须钉住这张证书（`certificate root = H"<指纹>"` 或 `certificate leaf = H"<指纹>"`，哈希等于钉住的指纹），且不能是 `cdhash`。证书带 `O=` 字段时 codesign 沿链上溯到锚点，写成 `root`；自签证书的链只有一张，两种写法钉的是同一张证书（正式证书实测为 `root`）。再对产物做一次 `codesign --verify --deep --strict`。打包目录里的 `.app` 和从更新 zip 用 ditto 解出的 `.app` 都要检查。任一不满足就让该架构的作业失败，并且在它上传任何产物之前失败。
- 修正发版文档：首次打开的放行步骤改用 Osuna.app，删除「自动更新装上的新版本也不会再问」这句与事实不符的说法，写明证书的存放位置、备份要求和丢失的后果，并把「afterSign 在未签名时被跳过」的描述更正为事实：electron-builder 26.8.1 在 macOS 上总会执行 afterSign，macOS 没有打包冒烟是因为没设 `PASEO_DESKTOP_SMOKE`（该事实归 `docs/testing.md`）。首次打开步骤里的 Osuna.app 随 04 改名一起改。

### 更新失败可见

- 主进程把 electron-updater 的 logger（info / warn / error）直接设为 electron-log，Squirrel.Mac 的错误会进入 main.log。代价是频道清单未发布（`ERR_UPDATER_CHANNEL_FILE_NOT_FOUND`）时 main.log 也会记一行 error；它仍不会作为检查失败上报给界面。
- app-update-service 的安装流程：调用安装后不再立即返回「已安装、即将重启」。只有收到 `before-quit-for-update` 才进入「正在重启」；如果先收到更新器错误，就把错误原因作为安装失败返回给界面。等待上限 60 秒，超时按失败处理并提示原因。只有需要重启的手动安装等待交接；退出时的静默安装仍由 quit lifecycle 处理，不等这个事件。
- 安装结果是判别联合：`failure` 为 `{ reason: "handoff-timeout" }` 或 `{ reason: "updater-error", message }`，没有失败时为 null。超时原因由界面翻译，更新器报错原文显示。点安装时的复查失败、下载失败也按安装失败返回。
- 界面的更新区域在安装失败时（`install-failed` 状态）展示原因，并给出「前往 Releases 手动下载」的出口，地址指向本仓库。侧栏提示的「重试」重新执行安装；后台静默检查不会覆盖失败状态。
- 安装前主进程会为更新停掉本地 daemon。安装失败时应用不会退出，所以主进程把这个 daemon 重新拉起来。
- 已知边界：超时之后如果 Squirrel 才完成，应用仍会重启（界面此前已显示失败）；等待期间出现的任何更新器 error 都会让这次安装判为失败。

### 发版

- 版本号 `0.10.0`，走现有的 fork 发版路径（minor）。发版说明写明：本版需要手动下载安装；装好后删除旧的 Paseo.app；首次打开需要放行。

## Testing Decisions

好的测试只验证外部可观察的行为，不锁定实现细节。本任务大部分是声明式配置和文案，不为它们新造接缝。

- **app-update-service（现有接缝）**：在 `app-update-service.test.ts` 里用现有的伪更新器驱动，覆盖以下情况：
  - 调用安装后、收到 `before-quit-for-update` 之前，不报告「已安装」。
  - 收到 `before-quit-for-update` 后进入重启状态。
  - 先收到更新器错误时，返回失败并带上原因。
  - 等待超时按失败处理。
  - 并发的多个安装请求都会随交接一起结算。
- **更新区域状态机与侧栏提示（现有接缝，实施时经用户确认追加）**：`desktop-app-updater.test.ts` 断言带 `failure` 的安装结果进入 `install-failed` 并保留可用版本、超时原因按界面语言显示、静默复查不覆盖失败；`resolve-update-callout.test.ts` 断言失败时提供「重试」与「前往 Releases 下载」。
- **desktop-updates（现有接缝）**：`desktop-updates.test.ts` 里原先断言上游下载地址的用例，改为断言本仓库地址。
- **daemon 自更新（现有接缝）**：在 daemon client 的 e2e 测试里断言 `server_info.features` 不含 `daemonSelfUpdate`，并且直接调用自更新 RPC 会被拒绝。
- **CI 签名断言（唯一新增接缝，位于最高层）**：macOS 作业在打包后检查 designated requirement 和签名的完整性，失败即中止。它防的是「签名钩子没注入或失效时 electron-builder 静默退回 ad-hoc / 不签名」这种不会报错的失败。secret 缺失或配错、换了证书则会在构建步骤就报错。判定 DR 的纯函数有单测（`scripts/verify-mac-signature.test.mjs`），查找产物、解 zip 的部分只能在 macOS 上端到端验证。
- **既有测试的跟随修改**：依赖旧产品名的单元测试和 e2e 断言，按新文案更新。修改前后的失败情况要和基线对照（部分 e2e 在 macOS 本机的基线上本来就失败），不把基线失败算到本次改动头上。
- **人工验证**（这些只能人工验）：
  1. **本地两包互验实验**（在改 CI 之前）：在临时钥匙串里用同一张自签证书签两个内容不同的包，确认第二个包能满足第一个包的 designated requirement；再确认一张不同的证书签出的包会被拒绝。
  2. 本地装一个构建（本地不签名，照常出包即可），确认 userData 仍指向 `Paseo` 目录、已加的 host 还在，并确认名字、图标、菜单、通知都已改掉。
  3. 手动触发一次 CI 且不发布，确认 arm64 和 x64 两个包都通过签名断言。
  4. **硬门槛**：发布 `0.10.0` 并在一台真实的 Mac 上手动安装，再发布 `0.10.1`，在同一台机器上通过应用内更新升级成功，main.log 里出现 `before-quit-for-update`，重启后版本为 `0.10.1`。通过之前不通知团队。

## Out of Scope

- 上游运营的运行时服务：relay（`relay.paseo.sh`）、配对 web app（`app.paseo.sh`）、hub（`hub.paseo.sh`）、Expo 推送。要自建、关闭还是继续借用，另行立项。
- 手机端的打包、上架、EAS 迁移，以及手机端图标和名称。
- 内部标识改名：scheme、userData 目录名、`~/.paseo`、`paseo` 命令、`PASEO_*`、`@getpaseo/*`、`paseo.json`、MCP 工具名、IPC 通道名。
- Apple Developer ID、公证、开启 `hardenedRuntime`。
- 绕过 Squirrel.Mac 的自定义安装器，以及把旧 ad-hoc 装机平滑带到新签名的过渡版本。
- 旧 Paseo.app 的自动检测与清理。
- Windows 原地升级与代码签名。
- 网站包、README、fastlane 元数据、Docker 与 Nix 文档里的上游名称。
- 删除 fork 下失败的工作流文件本身。

## Further Notes

- **不可逆的点。** 证书和 `appId` 一起构成更新身份。证书丢失或更换，或者改动 `appId`，都会让所有已安装的副本停止自动更新，只能手动重装。
- **官方手机 App 是个已知风险。** 二次开发里需要新 capability 的功能，在官方 App 上看不到；上游 App 以后怎么演进，本仓库控制不了。App 端不按 semver 比较 daemon 版本（插件需求除外），所以把版本号改到 `0.10.0` 不会导致误判。
- **未验证的推断。** 「自签证书满足 Squirrel.Mac 校验」依据的是 Squirrel.Mac 的源码：它用 `SecStaticCodeCheckValidityWithErrors`，拿当前应用的 designated requirement 去校验新包。ticket 01 已在本地用等价的 `codesign --verify --deep --strict -R` 证实（仅 arm64、最小 Electron 工程）。「CI 的 x64 包没有签名」依据的是 app-builder-lib 的源码，仍由人工验证第 3 项证实。
- 调研的细节和证据（含文件位置）见 `research/discover.md`。
