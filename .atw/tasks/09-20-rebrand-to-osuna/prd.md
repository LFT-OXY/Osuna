# 从 Paseo 改名为 Osuna

## 背景

这个 checkout 是 `getpaseo/paseo` 的 fork，远端已指向 `github.com/LFT-OXY/Osuna`
（PUBLIC，GitHub 标记 isFork）。但改名只改了本地目录名和远端地址：全仓 `paseo`
字面量 **17739 处、分布在 2135 个文件**；`osuna` 只有 2 处命中，且都是 usage 测试
里的假路径（`packages/app/src/usage/merge.test.ts:75` 的 `/work/osuna`），与品牌无关。

四轮需求访谈定下的前提：

- **目的是对外发布**，不是个人自用 fork。
- **不再跟上游同步**，后续个人维护。因此不必为「合并上游时少冲突」而收敛改动半径，
  也不保留任何读取旧名的兼容路径。
- **图标单独一轮**，不在本任务内。

## 许可证约束

`LICENSE` 是 211 行的纯 Apache-2.0，无 Commons Clause 等附加限制，fork 改名发布
被允许。两条直接约束本任务：

- **第 4 条**：必须保留原版权声明与许可证副本，并标注修改。`Copyright (c)
  2025-present Mohamed Boudra` 不得删除，只能在其上追加自己的版权行。
- **第 6 条不授予商标权**。名称 "Paseo" 与蝴蝶 logo
  （`packages/website/src/components/butterfly.tsx`）不在许可范围内。本任务负责名称；
  **logo 必须在首次对外发布前由后续的图标任务解决**，发布物不得带蝴蝶。

## 不可逆项（落地前最后核对）

应用 ID 一旦随发布物流出即永久占用、不可更改，且访谈中出现过一次拼写漂移
（`chinha` / `chinhae`）。批次 1 完成后必须在真实构建产物里肉眼核对这三个串：

- `com.chinhae.osuna.desktop`
- `com.chinhae.osuna` / `com.chinhae.osuna.debug`
- `chinhae <autuhae@gmail.com>`

## 改名映射表

### 身份与打包面

| 位置 | 现值 | 新值 |
| --- | --- | --- |
| `packages/desktop/electron-builder.yml` | `productName` / `executableName: Paseo` | `Osuna` |
| 同上 | `appId: sh.paseo.desktop` | `com.chinhae.osuna.desktop` |
| 同上 | protocols scheme `paseo` | `osuna` |
| 同上 | `Paseo-${version}-${arch}.${ext}`（mac/linux/win/appImage 四处） | `Osuna-...` |
| 同上 | `executableArgs: ["--class=Paseo"]` | `--class=Osuna` |
| 同上 | `publish: github getpaseo/paseo` | `LFT-OXY/Osuna` |
| 同上 | `vendor: Paseo`、`maintainer: Mohamed Boudra <hello@moboudra.com>` | `Osuna`、`chinhae <autuhae@gmail.com>` |
| 同上 | `extraResources: bin/paseo`、`bin/paseo.cmd` | `bin/osuna`、`bin/osuna.cmd` |
| `packages/app/app.config.js` | `name: Paseo` / `Paseo Debug` | `Osuna` / `Osuna Debug` |
| 同上 | `packageId: sh.paseo` / `sh.paseo.debug` | `com.chinhae.osuna` / `com.chinhae.osuna.debug` |
| 同上 | `scheme: paseo` | `osuna` |
| 同上 | `owner: getpaseo`、`eas.projectId: 0e7f65ce-...` | **两个字段都删除**（见下） |
| `packages/app/eas.json` | `ascAppId: 6758887924` | 移除（上游的 App Store 应用，无权使用） |
| `packages/cli/package.json` | bin `paseo` | `osuna` |
| 11 个 workspace | `@getpaseo/*` | `@osuna/*`（registry 已确认 404，可用） |
| 根 `package.json` | `name: paseo`、`author`、`homepage: paseo.sh`、`repository` | `osuna`、`chinhae`、留空、`LFT-OXY/Osuna` |

EAS 身份：本任务**删除** `owner` 与 `extra.eas.projectId`，不填替代值。prd 已把
「EAS project、开发者账号、商店元数据」列为后续独立任务，本批次无法创建 EAS project；
删掉后 `eas build` 会明确报错要求配置，与「relay/Hub 默认地址留空并要求显式配置，
指向一个不存在的地址比报错更难排查」同一条原则。`expo export`、桌面构建、CI 都不读
这两个字段。代码里没有任何位置读 `extra.eas.projectId`（已 grep 确认）。

`homepage` 的「留空」按删除键处理 —— package.json 里留空字符串会让 npm 页面显示一个
空链接，不如没有这个字段。

README 外链策略：Osuna 没有域名、社群、ghcr 镜像与 skills 源，因此
`paseo.sh/docs/*` 一律改指仓内 `public-docs/*`（用户文档）与 `docs/*`（开发文档），
上游社群徽章（Discord / Reddit / X）与 Related projects 段删除，stars/release 徽章指
`LFT-OXY/Osuna`，docker 段改 `ghcr.io/lft-oxy/osuna`（`docker.yml` 的镜像名按
`github.repository_owner` 推导，本批次一并改掉写死的 `paseo` 后缀），skills 源改
`LFT-OXY/Osuna`，顶部加 fork 溯源段。同一条规则也适用于 CLI 的 onboarding 文案：
`osuna` 的下一步提示不再指向上游专属的 `app.paseo.sh`，文档指向仓内 `public-docs`。

### 运行时标识（与上游同机共存）

本机 `~/.paseo` 已有 1.0G 并正被 6767 上的生产 daemon 占用，两个 daemon 共用目录和
端口会直接互踩，因此运行时标识全改。

| 位置 | 现值 | 新值 |
| --- | --- | --- |
| 环境变量（100+ 个，`PASEO_HOME` 单独 330 处） | `PASEO_*` | `OSUNA_*` |
| 数据目录 | `~/.paseo` / `PASEO_HOME` | `~/.osuna` / `OSUNA_HOME` |
| 工作区目录（Hub triggers / workflows） | `.paseo/` | `.osuna/` |
| 默认端口 `packages/protocol/src/ssh-transport.ts:1` 等 | `6767` | `6777` |
| dev 端口（`package.json:39,42,93`、`scripts/dev-daemon.sh:9`） | `6768` | `6778`（同时避开本机 Orca 占用） |
| dev home | `.dev/paseo-home` | `.dev/osuna-home` |
| nix 打包（`nix/package.nix`、`nix/module.nix`、`flake.nix`） | `pname: paseo`、`bin/paseo`、`bin/paseo-server`、`bin/paseo-desktop`、`mainProgram`、`homepage`、flake 输出名、`services.paseo`、service user/group | 对应 `osuna*`、`services.osuna`、`LFT-OXY/Osuna` |
| 项目配置文件（用户仓库根目录） | `paseo.json` | `osuna.json`（含 9 个语言文件里约 56 条提示这个文件名的 UI 文案，以及本仓库自己的那份） |
| docker 容器身份 | user/group `paseo`、`/home/paseo`、`paseo-docker-entrypoint`、compose 服务名与镜像名 | 对应 `osuna*`、`ghcr.io/lft-oxy/osuna` |
| app 持久化键 | `@paseo:*`（`daemon-registry`、`settings`、`app-settings`、`create-agent-preferences`、`review-draft-store` 等 21 个） | `@osuna:*` |
| git 自动 stash 前缀 | `paseo-auto-stash:` | `osuna-auto-stash:`（代价见「不改」一节） |
| wire schema 标识符 | 消息 `type`（`paseo_worktree_*_request/response`、`create_paseo_worktree_*`）、字段名（`isPaseoOwnedWorktree`、`paseoTools`）、WS 子协议 `paseo.bearer.*` | 对应 `osuna*`（见下方规则） |

**wire 标识符的批次归属规则**：wire schema 标识符（消息 `type` 字面量、序列化后的字段名、
WebSocket 子协议）归本批次；TypeScript 导出名（`PaseoWorktreeListRequestSchema` 这类
schema/type/函数名）与 agent 可见的 MCP 工具名（`paseo_list_worktrees` 等）归批次 4。
理由：前者是跨版本契约，`docs/protocol-compatibility.md` 新增的「首发前唯一窗口」一节
说明了为什么必须在首个 tag 之前一次改完；后者只是本地标识符，晚改不产生协议锁定。
`paseoTools` 同时也是持久化的 daemon provider 配置键，同一个窗口一起改。

nix 归到本批次而非批次 1：待改内容大半是运行时标识（service user/group、
StateDirectory、源过滤里的 `.paseo`、端口、`PASEO_*`），CLI wrapper 名与 flake 输出名
跟着一起改最省事。批次 1 只改了被 `productName` 连带打断的部分（`Osuna.app`、
`MacOS/Osuna`、desktop item 名、`nix.yml` 的 bundle 断言），其余留给这里。
nix 无法本地验证，验收靠推 CI 跑 `nix.yml`。

### 插件契约（不留兼容读取）

`paseo-plugin.json` → `osuna-plugin.json`；`requirements.paseo` → `requirements.osuna`；
`skills/paseo-plugin`、`skills/paseo-help` → `osuna-*`；`plugin-examples/` 下 10 个示例
同步。后果已知并接受：为上游写的第三方插件不再能装到 Osuna 上，反之亦然。

### 公开 API 与文档

- 导出的函数名与类型名改（`createPaseoClient`、`PaseoClient` 等）。**内部私有变量名
  不专门改** —— 只有维护者看得见，不值得为它承担一次巨大的无意义 diff。
- `packages/app/modules/paseo-{word-stream,native-trace,diff-prototype}` 的原生命名归本
  批次：Kotlin 包名 `sh.paseo.*`、`build.gradle` 的 group/namespace、
  `expo-module.config.json`、podspec、以及模块目录名。它们与 app 的 `applicationId`
  无关（Android 允许两者不同），所以没有被批次 1 的应用 ID 改动连带。改动要 `git mv`
  Kotlin 源树，验收需真跑一次安卓构建，不能只靠 typecheck。
- `docs/` 26 篇 + `CLAUDE.md` + `CONTRIBUTING.md` + `SECURITY.md` 全改。它们是后续 AI
  的工作依据，名字不一致会持续误导。
- `README.md` 改，并在顶部加 fork 溯源段：本项目 fork 自 Paseo
  (github.com/getpaseo/paseo)，基于 Apache-2.0。

### 签名

无 Apple 开发者账号，因此 `electron-builder.yml` 去掉 `notarize: true`、
`hardenedRuntime: true` 与两行 entitlements；`.github/workflows/desktop-release.yml`
去掉四个 Apple secrets 引用（`CSC_LINK` / `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` /
`APPLE_TEAM_ID`，:157-161）。README 写明 macOS 首次打开需右键→打开。

不选「有 secrets 才签名」的条件化方案：那会让同一条发布流程在有无 secret 时产出行为
不同的包，差异只在用户装不上时才暴露。

### 删

- `README.ja.md` / `README.ko.md` / `README.zh-CN.md` —— 个人维护，翻译会立刻腐化成
  错误信息。
- `packages/website` 移出 workspace —— 无域名、不建站，留着会让每次全仓改动多扛一个包。
- `fastlane/metadata/` —— 上游的 F-Droid 商店文案，留到真要上架时重写。

### 不改

- `LICENSE` 原版权行保留，其上追加 `Copyright (c) 2026-present chinhae`。
- `CHANGELOG.md` 历史条目 —— 那是已发生的事实，改了等于伪造历史，保留来源痕迹对
  Apache-2.0 合规有利。新名从本 fork 的第一个版本起用。
- 内部私有变量名，以及内部 IPC 通道名（`paseo:invoke` 等）、DOM 属性名
  （`data-paseo-browser-id` 等）、测试临时目录前缀、e2e 里的假 git 邮箱
  （`test@getpaseo.local`）。
- `packages/desktop/bin/osuna`（POSIX shim）**不设** `PASEO_DESKTOP_MANAGED=1`，
  Windows 的 `.cmd` 设。这是上游 commit `0110302b6` 造成的既有不对称（已安装的 0.8.0
  产物里 POSIX shim 还带着它，说明是上游发版后的回归）。重命名如实保留 HEAD 状态；
  要不要补回来是独立的 daemon 行为问题，不在本改名任务内。
- **旧的 `paseo-auto-stash:` stash 条目不再在 Osuna 界面里可见。** 批次 2 把前缀改成
  `osuna-auto-stash:`，而 `WorkspaceGitService.listStashes` 默认只列前缀匹配的条目
  （`paseoOnly` 默认 true）。6767 上那个上游 daemon 过去自动 stash 出来的条目写在**用户
  真实 git 仓库**里，改名后 Osuna 不显示、也不提供一键恢复。它们没有丢：`git stash list`
  仍能看到，`git stash apply` 仍能取回。选择保持改名而不是双前缀读取，是为了守住「不保留
  任何读取旧名的兼容路径」这条前提；代价记在这里，不是默默接受。
- scheme 字面量没有单一 owner（`agent-deep-link.ts` / desktop `APP_SCHEME` /
  server CORS / `app.config.js` / `electron-builder.yml` 各自硬编码）、app 与 server
  诊断脱敏链重复、`cli-install/paths.ts` 的重复三元表达式 —— 都是改名前就存在的结构，
  改名让它们更显眼但没有引入它们。抽常量属于独立重构，不搭本任务的车。
- 本机 `~/.paseo`：**不迁移、不自动搬运、不重启 6767 daemon**（那会杀掉正在运行的
  agent）。新 daemon 在 `~/.osuna` 从零起、重新配对，仅 `models/` 值得手动 `cp`。
  旧目录由本人在确认新环境可用后自行删除。

## 分批与验收

按「可独立验证」切五批，顺序不可调换：批次 1 含唯一不可逆项，必须最先落地并肉眼
验证；批次 5 要拿前四批成果做真实发布演练。

1. **身份与打包面** — desktop/app/cli 配置、publish、署名、LICENSE、README 溯源。
   验收：本地出一个桌面包，产物里确认应用名、appId、安装包文件名三项拼写。
   已完成（2026-09-20）。产物核对：`CFBundleIdentifier=com.chinhae.osuna.desktop`、
   `CFBundleName`/`CFBundleExecutable=Osuna`、URL scheme `osuna`、
   `Osuna-0.8.0-arm64.dmg`/`.zip`、`Contents/Frameworks/Osuna Helper.app`、
   `Contents/Resources/bin/osuna`。
   **`maintainer` 这一项验不到**：它是 electron-builder 的 Linux-only 字段，macOS 产物
   里不存在，本机也无法产出 deb/rpm（要 fpm 或 docker）。只在 `electron-builder.yml`
   里核对了 `chinhae <autuhae@gmail.com>`，实际产物验证顺延到批次 5 的发布演练。
2. **运行时标识** — `OSUNA_*`、`~/.osuna`、`.osuna/`、端口、dev home、nix 打包。
   验收：起 dev daemon，CLI 连通，跑 server 受影响的测试文件（单文件 `--bail=1`）；
   nix 部分推 CI 跑 `nix.yml`。
3. **插件契约** — 清单文件名、`requirements` 字段、示例、skills。
   验收：`plugin scaffold` 与 plugin-lifecycle e2e。
4. **公开 API 与文档清理** — 导出名、docs、删多语言 README、移出 website、
   `packages/app/modules/paseo-*` 的原生命名。
   验收：`npm run typecheck` + `npm run lint` + 构建通过；原生命名改动要真跑安卓构建。
   **批次 1 已让下列文档事实失效，本批次必须一并改正**（不是单纯改名，是错误指令）：
   - `docs/testing.md`、`docs/development.md` 里的 `paseo://` 深链 → `osuna://`
   - `docs/mobile-testing.md`、`docs/android.md` 里的 `sh.paseo` / `sh.paseo.debug`
     → `com.chinhae.osuna` / `com.chinhae.osuna.debug`
   - `skills/paseo-help/SKILL.md` 里的 `/Applications/Paseo.app/.../bin/paseo` 安装路径
   - `docs/development.md` 的 `Applications/Paseo.app` 与 `paseo-desktop` 启动器
   - `CONTRIBUTING.md`、`SECURITY.md`、`CLAUDE.md` 的投稿/安全/仓库指向，以及
     `.github/ISSUE_TEMPLATE/*`（批次 1 曾改过后回退，就是为了与 CONTRIBUTING.md
     一起改，避免两处投稿目的地互相矛盾）
   - `packages/website/src/latest-release.ts`、`downloads.tsx` 里的 `Paseo-Setup-*`
     产物名正则与 `sh.paseo`（website 本批次移出 workspace，一并处理）
   - `fastlane/metadata/` 按「删」处理
   **批次 2 又让下列文档事实失效**：
   - `SECURITY.md` 的 `PASEO_PASSWORD` 与 `Sec-WebSocket-Protocol: paseo.bearer.<password>`
     —— 后者是 daemon 现在会直接拒绝的子协议，安全文档描述了一个不存在的认证机制
   - `docs/` 各篇里的 `PASEO_*` 环境变量、`~/.paseo`、`.dev/paseo-home`、`.paseo/`、
     6767/6768、`paseo.json`、`isPaseoOwnedWorktree`
   - `public-docs/` 同上（`docker.md`、`configuration.md`、`cli.md`、`web-ui.md`、
     `troubleshooting.md`、`hub/**`、`worktrees.md`、`voice.md` 等）
   - `skills/paseo-help/SKILL.md` 与 `skills/paseo/SKILL.md` 的 `PASEO_HOME`、`~/.paseo`、
     安装路径（这两个目录本身由批次 3 改名）
   - `docs/development.md` 指向 `packages/server/src/server/paseo-home.ts`，该文件已改名
     `osuna-home.ts`
   - i18n 的产品名文案：`appName: "Paseo"`、`paseo: "Paseo"`（作为 StatusBadge 渲染）等
     与批次 2 已改的 `osuna.json` 文案同处一文件，现在互相矛盾
   - `docs/data-model.md` 的 `isPaseoOwnedWorktree` 字段表、`@paseo:review-draft-store` 键名
   注：`.atw/spec/**` 与 `CLAUDE.md` 里的同类事实不归本批次 —— 它们是各批次 spec 回写
   环节自己的责任，批次 1 与 2 已各自更新过。
5. **签名配置与发布演练** — 关公证、改 workflow、推测试 tag 走一遍 GitHub Release。
   验收：Release 产出可下载、可安装、能被 electron-updater 识别；顺带在 Linux 产物里
   核对批次 1 的 `maintainer: chinhae <autuhae@gmail.com>`。

## 完成的标准

- `rg -i paseo` 在排除下列各项后无命中：`CHANGELOG.md` 历史条目、`LICENSE` 的原版权行
  与 fork 溯源段、README 的 fork 溯源段、`不改` 一节列出的内部标识（IPC 通道名、DOM
  属性名、测试临时目录前缀、e2e 假 git 邮箱）。
- 桌面包以 Osuna 之名构建、安装、启动，appId 为 `com.chinhae.osuna.desktop`。
- daemon 在 `~/.osuna` + 6777 上运行，与本机 6767 的上游 daemon 互不干扰。
- `npm run typecheck`、`npm run lint` 全绿。
- 后续独立任务：图标与 logo（发布前必须完成）、移动端上架身份（EAS project、开发者
  账号、商店元数据）、域名与 relay/Hub 线上服务。

## 范围外

- 图标、logo、splash、favicon 的替换。
- iOS / Android 上架与 F-Droid 元数据重写。
- 域名购买、官网部署、relay 与 Hub 的线上服务。relay/Hub 默认地址本任务只留空并要求
  显式配置 —— 指向一个不存在的 `osuna.sh` 比报错更难排查。
