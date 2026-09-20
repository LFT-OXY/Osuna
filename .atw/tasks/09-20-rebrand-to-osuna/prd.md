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

**落地时的归属调整（批次 3 实施后补记）：**

- **插件 SDK 的 API 名从批次 4 提前到本批次**：`PaseoApi` → `OsunaApi`、`usePaseo` →
  `useOsuna`、`ctx.paseo` → `ctx.osuna`、`PluginHandlerContext.paseo` → `.osuna`，以及
  `paseo-context.tsx` → `osuna-context.tsx`。理由：它们与 `requirements.osuna` 是同一份
  对插件作者的契约，分两批改等于发一版「清单叫 Osuna、代码里却是 `ctx.paseo`」的半改名
  契约，比一次改完更糟。批次 4 仍拥有 `createPaseoClient` 等**宿主**导出名 —— 那些面向
  SDK 使用者，不是插件契约。
- **6 个 skills 目录全部改名，不是票里写的 2 个**：`skills/paseo{,-advisor,-committee,-handoff,-help,-plugin}`
  → `osuna-*`。只改 2 个会让 `/paseo-handoff` 这类命令名与目录名对不上。
- `plugin-examples/` 实际是 **14 个**清单文件（含 e2e 夹具），不是 10 个。

### 公开 API 与文档

- 导出的函数名与类型名改（`createPaseoClient`、`PaseoClient` 等）。
  ~~**内部私有变量名不专门改**~~ —— 这条在批次 4 落地时与它自己的验收
  （`rg -i paseo` 归零）互相矛盾，**已由票 07 推翻**：内部私有名、入参名、文件名、
  测试临时目录前缀与 fixture 字符串一并扫掉。理由见票 07：半改的标识符比两端都糟，
  而「谁碰到谁顺手改」会把品牌改动混进每一个功能 diff。
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
- ~~内部私有变量名，以及内部 IPC 通道名（`paseo:invoke` 等）、DOM 属性名
  （`data-paseo-browser-id` 等）、测试临时目录前缀、e2e 里的假 git 邮箱
  （`test@getpaseo.local`）。~~ **票 07 已全部改掉**（`osuna:invoke`、
  `data-osuna-browser-id`、`createTempDir("osuna-…")`、`test@osuna.local`）。
  这些标识两端都在本仓库内，没有外部消费方，改名不产生契约风险。
  真正保留旧名的那份清单见票 07「落地时确认下来的排除清单」，其判据是
  **谁拥有这个标识**（上游 / Hub 服务端 / 主语就是旧名 / 金标输入），不是它是否私有。
- `packages/desktop/bin/osuna`（POSIX shim）**不设** `PASEO_DESKTOP_MANAGED=1`，
  Windows 的 `.cmd` 设。这是上游 commit `0110302b6` 造成的既有不对称（已安装的 0.8.0
  产物里 POSIX shim 还带着它，说明是上游发版后的回归）。重命名如实保留 HEAD 状态；
  要不要补回来是独立的 daemon 行为问题，不在本改名任务内。
- **旧的 `paseo-auto-stash:` stash 条目不再在 Osuna 界面里可见。** 批次 2 把前缀改成
  `osuna-auto-stash:`，而 `WorkspaceGitService.listStashes` 默认只列前缀匹配的条目
  （`osunaOnly` 默认 true）。6767 上那个上游 daemon 过去自动 stash 出来的条目写在**用户
  真实 git 仓库**里，改名后 Osuna 不显示、也不提供一键恢复。它们没有丢：`git stash list`
  仍能看到，`git stash apply` 仍能取回。选择保持改名而不是双前缀读取，是为了守住「不保留
  任何读取旧名的兼容路径」这条前提；代价记在这里，不是默默接受。
- **`paseo.pid` 是「不保留任何读取旧名的兼容路径」这条前提的唯一例外**（批次 8）。
  `packages/server/src/server/pid-lock.ts` 里有一条 tagged 的 `COMPAT(pid-lock-paseo-name)`
  只读 shim：启动前读一次旧文件名，发现旧锁且进程还活着就按「已有实例在跑」拒绝启动。
  为什么这里破例而 stash 前缀不破例 —— 两者的失效代价不同量级：stash 是用户数据，改名后
  Osuna 不显示，但 `git stash list` / `git stash apply` 仍能取回，损失可逆；pid 锁是**互锁**，
  漏检的后果是同一个 home 起出两个 daemon，抢同一个端口与同一份 agent 存储，损失不可逆。
  触发条件只有一个：`OSUNA_HOME` 被指向上游的 `~/.paseo`（默认 `~/.osuna`，两边互不相干）。
  shim 只读不写、不迁移、不删除旧文件，且读不出来（权限/损坏）时按失败处理而不是放行。
- **Hub workflow 的表达式命名空间** `paseo.prompt` / `paseo.inputs` / `paseo.context` /
  `paseo.execution.id`（文档 52 处，代码生产点一处：`packages/cli/src/commands/hub/init-plan.ts`）。
  这个命名空间由 **Hub 服务端**拥有，而 Hub 不在本仓库里（`packages/` 下没有 hub 包，
  `public-docs/hub/index.md` 写明本 fork 不运营自己的 Hub）。全仓没有任何 `${{ }}` 求值器 ——
  CLI 只生成 YAML，求值在 Hub 那边。改名只会让生成的 workflow 在 Hub 的 bundle activation
  阶段被拒，因此**不改**，与「wire 标识符归首发前窗口一次改完」不是一回事：那条规则的前提是
  两端都在本仓库。批次 4 的文档扫描曾把 7 处 `paseo.inputs` 误改成 `osuna.inputs`（同族 41 处
  未动，`hub-yml.md:83` 一句话里自相矛盾），已在批次 8 回滚，并在生产点留注释。
- scheme 字面量没有单一 owner（`agent-deep-link.ts` / desktop `APP_SCHEME` /
  server CORS / `app.config.js` / `electron-builder.yml` 各自硬编码）、app 与 server
  诊断脱敏链重复、`cli-install/paths.ts` 的重复三元表达式 —— 都是改名前就存在的结构，
  改名让它们更显眼但没有引入它们。抽常量属于独立重构，不搭本任务的车。
- 本机 `~/.paseo`：**不迁移、不自动搬运、不重启 6767 daemon**（那会杀掉正在运行的
  agent）。新 daemon 在 `~/.osuna` 从零起、重新配对，仅 `models/` 值得手动 `cp`。
  旧目录由本人在确认新环境可用后自行删除。

## 分批与验收

按「可独立验证」切批，顺序不可调换：批次 1 含唯一不可逆项，必须最先落地并肉眼
验证；最后一批要拿前面的成果做真实发布演练。

**批次 6 是落地过程中补开的**，排在 03 之后、04 之前（依赖链 01→02→03→06→04→05）。
它收拾批次 1 的一个漏项：CLI 二进制已改名 `osuna`，但 agent hooks 与 shim 解析三处
消费方仍在找 `paseo`，其中 opencode 的 hook 现在是坏的。没有重开票 01 —— 01 的验收
（桌面包构建/安装/启动）是真过了的，重开会搅浑记录；这三处自成一个有独立验收方式的
切片。发现于批次 3 的收尾残留自检，不是审查意见。

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
   - ~~`skills/paseo-help/SKILL.md` 与 `skills/paseo/SKILL.md` 的 `PASEO_HOME`、`~/.paseo`、
     安装路径~~ —— 批次 3 改名这两个目录时一并做完了（`PASEO_HOME`/`PASEO_HOST` 已无读取方，
     且 `osuna-help` 里探测端口仍写 6767 会把 agent 指向**上游** daemon，不能留到下一批）
   - `docs/development.md` 指向 `packages/server/src/server/paseo-home.ts`，该文件已改名
     `osuna-home.ts`
   - i18n 的产品名文案：`appName: "Paseo"`、`paseo: "Paseo"`（作为 StatusBadge 渲染）等
     与批次 2 已改的 `osuna.json` 文案同处一文件，现在互相矛盾
   - `docs/data-model.md` 的 `isPaseoOwnedWorktree` 字段表、`@paseo:review-draft-store` 键名
   **批次 3 又让下列事实失效**：
   - `skills/osuna-plugin/SKILL.md` 里 14 处 `@getpaseo/plugin` 导入 —— 包名在批次 1 已改
     `@osuna/plugin`，这些 import 解析不到任何东西，而该文件会打进 `dist/server/skills`，
     agent 照抄就写出坏代码。同类问题遍布 `docs/plugins.md`、`public-docs/plugins/v0.8/**`
     （几十处），一并归本批次
   - `skills/` 下 11 处 `paseo.sh` 文档 URL，与 `public-docs/skills.md` 的 15 处
     （`/paseo`、`/paseo-handoff` 等命令名 + `npx skills add getpaseo/paseo`）—— 目录名已由
     批次 3 改成 `osuna-*`，这些命令名现在指向不存在的 skill
   - `CONTRIBUTING.md` 的「Build a plugin」把插件作者指向 `paseo.sh/docs/plugins` 与
     `getpaseo/paseo` Discussions，而代码里的报错已指向 `LFT-OXY/Osuna`，同一条作者路径
     两个目的地
   - `ProviderPaseoToolsPolicySchema` 类型名 —— 它的 wire 字段已在批次 2 改成 `osunaTools`，
     只剩类型名没动（导出名归本批次）
   **需要先做决定、不能机械改的两项（本批次刻意没动）**：
   - `packages/plugin/src/server/acp-internal/connection.ts:410` 的
     `clientInfo: { name: "paseo", version: "1" }` 与 `:476` 的 `_paseo` 元数据命名空间。
     两者都是**只有产出方、全仓无读取方**的标识：它们发给外部 ACP agent 进程
     （Claude Code、Codex 等）。如果某个 agent 对 `paseo` 有特判行为，改名就是行为变更而非
     改名。落地前需确认：我们是否在意外部 agent 看到的自我标识。
   - `packages/server/src/server/worktree-session.ts:402` 的 `_paseoHome` 形参名（内部私有名，
     按 prd「内部私有变量名不专门改」本可不动，列出仅为免得下次搜索时以为是漏项）
   注：`.atw/spec/**` 与 `CLAUDE.md` 里的同类事实不归本批次 —— 它们是各批次 spec 回写
   环节自己的责任，批次 1 与 2 已各自更新过。
5. **签名配置与发布演练** — 关公证、改 workflow、推测试 tag 走一遍 GitHub Release。
   验收：Release 产出可下载、可安装、能被 electron-updater 识别；顺带在 Linux 产物里
   核对批次 1 的 `maintainer: chinhae <autuhae@gmail.com>`。

## 完成的标准

- `rg -i paseo` 在排除票 07「落地时确认下来的排除清单」后无命中。该清单取代了本 prd
  原先按「是否私有」划的那条线：保留的是上游拥有的资产、Hub 服务端拥有的标识、
  主语就是旧名的文字、金标值的输入，以及票 09 的原生模块。
  正向（查残留）、反向（查造出来的错名）、第三向（查被折叠的刻意对比）三种探针都要归零 ——
  第三向的判据见票 07，前两向查不出它。
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

### 地址留空的下游收尾（票 10 决定）

`appBaseUrl` 与 relay endpoint 一起留空，让配对链接从「总是有」变成「可能没有」。
唯一的消费方是 `osuna daemon pair`，决定取 **A：承认「没有链接」是正常状态**，
由 CLI 承接，而不是报错（B）或给一个本仓库默认地址（C）。

- `generateLocalPairingOffer` 的返回值带上 `unavailableReason`，区分
  `relay_disabled` / `relay_endpoint_unset` / `app_base_url_unset`，
  把「为什么没有链接」从三选一的猜测变成事实。CLI 侧再加两种它自己能判出的状态：
  `config_not_applied`（配置已配齐但 daemon 还没吃到 —— `daemon.relay.endpoint`
  要求重启而不是 reload，daemon 自己会这么警告）与 `unknown`（远端 daemon）。
- 文案一律先给 `osuna daemon config set <path> <value>`。离线配对解析配置时显式屏蔽
  进程环境（`resolveLocalPairingOffer` 传 `env: {}`），只说「设置 `OSUNA_APP_BASE_URL`」
  在这条路径上照做无效，环境变量只作为「起 daemon 前设置」的补充提到。
- daemon RPC 不扩协议：`daemon.get_pairing_offer.response` 只有 `url` 与 `relayEnabled`。
  daemon 已在跑是装完后的默认状态，`osuna daemon pair` 与 `osuna onboard` 都走 RPC，
  所以不能让这条路径一律退到兜底——本机 daemon 读的是同一个 home，CLI 按它的持久化配置
  自行判定缺哪一项。只有真正的远端 daemon（以及配置已改但 daemon 未重载）才退到
  `PAIRING_LINK_UNAVAILABLE`。换协议字段不值得，等有域名后这条路径自然消失。
