# Osuna 独立化：全面脱离上游 Paseo

来源：`map.md` 的 11 张决策票（全部 resolved）、`research/interview-decisions.md`（Q2–Q13）、ADR 0006。本文件只写需求、约束与验收，不写执行清单；每条实现决策后面括号里的票号指向持有细节的地图票。

## Problem Statement

Osuna 是 Paseo 的 fork，但对外仍处处是 Paseo：CLI 叫 `paseo`，数据在 `~/.paseo`，配对二维码打开的是上游的 `app.paseo.sh`，远程连接走上游的 `relay.paseo.sh`，手机端包名、Expo 项目、文档、官网全是上游的。用户装了 Osuna 却要靠上游的基础设施才能远程使用；上游一旦改动或下线，Osuna 的远程链路就断。维护者无法合并上游（ADR 0002 把改名止于桌面身份，每次合并都要重新处理冲突），仓库在 GitHub 上仍标记为 fork，Hub 功能依赖本仓库没有的上游服务端。

## Solution

1.0.0 一次切换：Osuna 成为独立产品，代码与标识全量改名，自建中继与网页端跑在 `*.chinhae.cc`，安卓 APK 在自己的 CI 构建并挂 GitHub Release，官网与 Public docs 改为 Osuna，Hub 整体移除。已装 0.14.x 的用户首次启动 1.0.0 时数据无感自动迁移，旧数据永不删除。GitHub 仓库脱离 fork 网络与 Cloudflare 基建已在决策阶段完成，是发布前置条件而非本 spec 的实现内容。

## User Stories

### 已装 0.14.x 的桌面端用户

1. As a 0.14.x 桌面端用户, I want 自动更新到 1.0.0 后直接看到我原来的主机列表、设置、草稿和面板布局, so that 升级对我是无感的。
2. As a 0.14.x 桌面端用户, I want 我的 Agent 历史、工作区、worktree 在升级后原样可用, so that 不用重建任何东西。
3. As a 0.14.x 桌面端用户, I want 迁移失败时看到一个带手工修复命令的明确错误, so that 不会以空数据启动然后以为历史丢了。
4. As a 0.14.x 桌面端用户, I want 升级后仍能通过 `osuna://` 深链打开 App, so that 配对与外部跳转继续工作。
5. As a 0.14.x 桌面端用户, I want 1.0.0 出问题时能退回 0.14.x 并找到我的数据, so that 升级有退路。
6. As a 0.14.x 桌面端用户, I want 迁移成功时不被弹窗打扰, so that 升级就是升级。

### 远程使用者

7. As a 远程使用者, I want 配对二维码打开 Osuna 自己的网页端, so that 不依赖上游站点。
8. As a 远程使用者, I want 中继默认走 Osuna 自己的 Worker 并自动启用 TLS, so that 无需手工配置就能远程连接。
9. As a 远程使用者, I want 1.0.0 发布说明明确告诉我上游 Paseo 手机 App 不再受支持, so that 不会在配对失败时摸不着头脑。
10. As a 安卓用户, I want 从 GitHub Release 下载一个签名过的 APK 侧载, so that 不依赖商店。
11. As a 安卓用户, I want 校验 APK 签名指纹与文档一致, so that 确认不是假包。
12. As a 安卓用户, I want 首次连主机时不弹"允许通知"的权限请求, so that 不被一个答应了也没用的弹窗骚扰。
13. As a 安卓用户, I want 扫码配对的相机功能照常可用, so that 配对流程不变。

### 服务器 / Docker / 无头用户

14. As a Docker 用户, I want 一份升级段说明卷名、环境变量与首启前的目录搬迁命令, so that 手工升级有据可循。
15. As a 无头 CLI 用户, I want 发布说明告诉我卸旧装新的步骤, so that 升级后 `osuna` 命令能接管原有数据。
16. As a 无头 CLI 用户, I want daemon 启动时检测到残留的 `PASEO_*` 环境变量并逐个提示对应的 `OSUNA_*` 名, so that 配置不会静默失效。
17. As a 显式设置了 `OSUNA_HOME` 的用户, I want daemon 不去碰 `~/.paseo`, so that 自定义布局不被迁移逻辑干扰。
18. As a Docker 镜像用户, I want 镜像名、容器内用户目录、环境变量全部是 Osuna 拼写, so that 与文档一致。

### 官网访客与文档读者

19. As a 官网访客, I want 在 `osuna.chinhae.cc` 看到中文首页与下载页, so that 知道这是什么、去哪下载。
20. As a 官网访客, I want 下载页列出桌面端各平台安装包与安卓 APK，并指向 Osuna 自己的 GitHub Release, so that 下载的是对的东西。
21. As a 文档读者, I want Public docs 里没有 Hub、没有上游社区项目、没有指向上游的链接, so that 不会被不存在的功能误导。
22. As a 文档读者, I want 安装说明只列实际可用的方式（桌面端、Docker、源码构建）, so that 不会去 npm 找一个不存在的包。
23. As a 文档读者, I want 插件文档只有一套当前 API，不分版本, so that 不用猜哪个版本对应 Osuna。
24. As a 文档读者, I want 配置文件的 `$schema` 链接真的能打开, so that 编辑器补全可用。
25. As a 文档读者, I want 更新日志页继续从仓库 CHANGELOG 生成, so that 历史版本记录仍可查。

### 插件作者

26. As a 插件作者, I want 插件清单文件名、requirements 键、SDK 包名全部是 Osuna 拼写, so that 清楚知道这是 Osuna 的插件 API。
27. As a 插件作者, I want 文档明确写出上游 Paseo 插件与 Osuna 不兼容, so that 不会白费力气。

### 维护者与贡献者

28. As a 维护者, I want 仓库里除例外清单外没有任何 `paseo` 字样，且 CI 能自动守住这条线, so that 改名不会被后续 PR 悄悄破坏。
29. As a 维护者, I want 安卓 APK 在 GitHub Actions 上零成本构建并自动挂到 Release, so that 不依赖 EAS 额度。
30. As a 维护者, I want 三个 Cloudflare 部署工作流指向我自己的账号与项目, so that 推 main 就能上线。
31. As a 维护者, I want 迁移代码都打上统一的 COMPAT 标签与到期日, so that 以后能一次清掉。
32. As a 维护者, I want 协议里不再有 Hub 消息、特性位与权限, so that 不用再维护一个没有服务端的功能。
33. As a 维护者, I want `LICENSE`、`NOTICE`、README 致谢保留上游署名, so that 符合 Apache-2.0。
34. As a 维护者, I want 1.0.0 发布说明包含升级段（CLI、Docker、上游 App 卸载、安卓无推送）与官网 / APK 链接, so that 用户不用翻文档就知道要做什么。
35. As a 贡献者或 AI agent, I want `docs/`、`CLAUDE.md`、`.atw/spec/`、skills 里的路径、命令、术语全部是 Osuna 拼写, so that 照文档操作不会碰到不存在的命令。
36. As a 贡献者, I want 架构与发布文档说明 Cloudflare Worker 就是生产中继, so that 不会去找不存在的 Elixir 中继。
37. As a 贡献者, I want 发布文档记录安卓 keystore 位置、指纹与 COMPAT 到期清单, so that 发版与清理有据可查。

## Implementation Decisions

### A. 标识全量改名（Q4、Q5、07）

- 无一例外的标识：CLI `osuna`；home `~/.osuna`；环境变量 `OSUNA_*`；配置文件 `osuna.json`；URL scheme `osuna://`；MCP server 名 `osuna`（工具前缀 `mcp__osuna__*`）；插件清单 `osuna-plugin.json` 与 requirements 键 `osuna`；Electron userData 目录 `Osuna`；Docker 镜像 `ghcr.io/lft-oxy/osuna` 与容器内用户目录 `/home/osuna`；skills `/osuna-*`；npm 作用域 `@osuna/*`（不发公网）；nix 包名与桌面启动器名。默认端口 6767 不是品牌，保留。
- 安卓包名 `com.chinhae.osuna`，调试版 `com.chinhae.osuna.debug`；iOS bundle id 同名，本次只定身份（Q11）。桌面 appId 维持 `com.chinhae.osuna.desktop`，产物名 `Osuna-*` 不变，所以 electron-updater 升级链不受影响。package.json 作者 `LFT-OXY <autuhae@gmail.com>`。
- 渲染层存储键与 IndexedDB 库名随改名（`@paseo:` → `@osuna:`、`paseo-` → `osuna-` 等前缀）；改名发生在桌面端迁移的导入端映射表里（见 C），渲染器只认新名。
- 改名脚本整文件跳过的例外清单（07）：`LICENSE`；新建的 `NOTICE`（写明源自 Paseo，Apache-2.0，保留上游仓库链接）；`CHANGELOG.md` 已发布条目；`docs/adr/**`；`.atw/tasks/**`；`.atw/workspace/**`；`**/fixtures/legacy-paseo/**`（迁移测试旧版样本，文件名与内容保持旧拼写）；四份 README 与 `docs/glossary.md` 由人工改写。例外清单不进 ADR 0006。
- 人工改写要求：README 页尾一行致谢含上游链接，明确指上游的句子（如"不要从 npm 装 `@getpaseo/cli`，那是上游"）保留，其余 Paseo → Osuna；术语表 **Paseo** 条目保留为上游项目，其余条目的产品名改 Osuna，**Product discussion** 改指本仓库 Discussions。
- 上游 URL 全部替换：`github.com/getpaseo/paseo` → `github.com/LFT-OXY/Osuna`；`app.paseo.sh` → `osuna-app.chinhae.cc`；`relay.paseo.sh` → `osuna-relay.chinhae.cc`；`paseo.sh/...` → `osuna.chinhae.cc/...`；配置 `$schema` → `https://osuna.chinhae.cc/schemas/osuna.config.v1.json`，官网必须实际托管该文件；文档示例域名改为 osuna 示例。
- 随改名删除：`fastlane/metadata/` 整目录（以后上 F-Droid 从 git 历史取回）。
- 改名的守线：仓库新增一条脚本级检查，扫描整棵树（含隐藏目录，不含 node_modules / dist / 锁文件）中的 `paseo` 字样，只允许例外清单与带 COMPAT 标签的代码处出现；该检查跟随仓库脚本在每个 PR 上跑。标签的适用范围是"为 0.14.x 而存在、必须写出旧名字的代码"：读旧布局的迁移代码，以及握手里给 0.14.x daemon 的旧密码子协议名、喂入 0.14.x 旧消息名的测试（2026-10-09 随 15 号票确认，到期日相同、一起删）。

- 协议下限（15 号票，2026-10-09 确认）：1.0.0 与 0.14.x 不互通，干净切断，不加双向别名。判定只在 `@osuna/client` 握手处，依据 `server_info` 的版本，对桌面端、网页端、CLI 统一生效；低于 1.0.0 的主机一条后续请求都不发，App 把它标为"需要更新"，升级后自动恢复。握手本身要能过：`server_info` 里保留已删除的权限值（`COMPAT(hubExecutePermission)`），密码子协议同时提供新旧两个前缀。握手之后不加任何别名或回退。为此分支上各包版本先升到 `1.0.0-beta.1`（不打 tag）：daemon 上报的版本读自包版本，不升则分支自己的 daemon 也会被拒。

### B. Daemon 侧数据迁移（Q6、Q6c、08）

- 触发点：daemon 启动时、读任何文件之前，紧跟 home 解析。仅当 home 解析为默认 `~/.osuna` 时才迁移；显式 `OSUNA_HOME` 一律不迁移。
- 条件：旧 `~/.paseo` 是真实目录且新 `~/.osuna` 不存在才搬；旧是符号链接或新已存在则跳过。目录层不设任何标记文件。
- 动作：rename；跨分区 rename 失败退回复制；复制成功后旧目录原封不动。搬完在原位留符号链接 `~/.paseo → ~/.osuna`（Windows 用 junction，免管理员权限）。留链接的原因：`worktrees/` 下是用户仓库的 git worktree，主仓库的 `gitdir` 指针、`workspaces.json` 的绝对路径、`agents/` 目录名都编码了旧路径，链接让它们免改写，同时让 0.14.x 回滚找得到数据。链接是用户数据不是代码，COMPAT 到期删代码不碰链接。
- 已持久化的绝对路径不改写；新建 worktree 落 `~/.osuna/worktrees`。老条目 UI 显示 `~/.paseo/...` 是接受的副作用。
- 硬失败（rename 与 copy 都失败）阻止启动：daemon 非零退出，错误信息含旧路径、新路径、手工命令 `mv ~/.paseo ~/.osuna && ln -s ~/.osuna ~/.paseo`；桌面端走现有"daemon errored"状态面，实现时要核实 daemon 的退出信息能到达该状态面。每次启动重试，不设上限、不记计数。
- 旧目录比新目录新（用户删了链接后跑过 0.14.x）：以新为准不动旧的，记一条 warn "检测到未迁移的 `~/.paseo`"，不做 UI。
- 残留 `PASEO_*` 环境变量：不认、不做别名。daemon 与 CLI 启动时检测到任一 `PASEO_*` 变量，打 warn 逐个列出并给出 `OSUNA_*` 对应名。
- 成功静默：不弹提示，`daemon.log` 一条 info。
- Docker（镜像显式设 home）与手装 CLI 不走自动迁移：Docker 手工步骤（卷挂 `/home/osuna`、环境变量改名、首启前在卷里 `mv .paseo .osuna`）写进 Public docs 的 docker 页升级段；CLI 卸旧装新只写发布说明。
- 迁移代码统一标 `COMPAT(paseoDataMigration): added in v1.0.0, remove after 2027-10-09 or in 2.0.0, whichever first`，三层（daemon home、Electron userData、origin 导入）同一标签。

### C. 桌面端迁移（Q6、02、08）

- 层 1，userData 目录 `Paseo` → `Osuna`：在 Electron `ready` 前、electron-log 第一次写日志之前完成，否则 Windows/Linux 上 `Osuna/logs` 先被建出导致 rename 失败。macOS 旧日志目录 `~/Library/Logs/Paseo` 不动。失败时主进程开窗前 `showErrorBox` 后退出，每次启动重试。与上游 Paseo.app 并存的机器上接受上游 App 丢主机列表与设置，不给它留链接（两个 Electron 共用 userData 会抢 leveldb 锁）；发布说明写明请卸载上游 App。
- 层 2，渲染层存储跨 origin 迁移 `paseo://app` → `osuna://app`：Chromium 的 storage key 由 origin 决定，无别名机制，直接改 leveldb 也不可行（origin 编在键里且块经 Snappy 压缩），所以只能主进程在首个窗口创建前开一个隐藏顶层 `BrowserWindow`，从 `paseo://app` 枚举全部 `localStorage` 键与 `indexedDB.databases()` 导出，`clearStorageData` 清空 `osuna://app` 后整体写入。两个 scheme 同时登记为 privileged；`paseo` 处理器只服务内联导出页，标 COMPAT。
- 导出端不依赖键名（枚举全部）；改名只在导入端的映射表完成，不匹配任何前缀的键原样保留。导出窗口必须是顶层窗口（第三方存储分区会让 iframe 看到空存储）；Blob 值过 IPC 要转 ArrayBuffer。
- 幂等与标记：导入前整体清空新 origin；完成标记写在新 userData 的桌面设置文档的 `migrations` 字段（该字段已存在，承载其他一次性迁移标记），不设失败计数字段。旧 origin 数据永不删除。
- 导入失败弹对话框二选一：「重试」= 退出，下次启动再跑；「放弃旧数据继续」= 写完成标记后正常启动，之后不再清空新 origin。不设自动重试上限。
- 成功静默：Electron 主进程日志各一条 info（userData 搬迁、origin 导入）。
- `osuna://` 协议处理器注册名变了，spec 要求实机验收 0.14.x → 1.0.0 自动更新后深链可用。

### D. 远程连接基建（Q7、04）

- 已完成且不在本 spec 实现范围：中继 Worker `osuna-relay` 部署在 `osuna-relay.chinhae.cc`（`/health` 已 200）；Pages 项目 `osuna-app` 绑 `osuna-app.chinhae.cc`；官网 Worker 配置指向 `osuna.chinhae.cc`，KV 已建；GitHub Secret `CLOUDFLARE_API_TOKEN` 与 Variable `CLOUDFLARE_ACCOUNT_ID` 已写入。三个域名都是一级子域，免费证书覆盖。
- 本 spec 要做：daemon 默认中继端点改 `osuna-relay.chinhae.cc:443`、默认网页端基址改 `https://osuna-app.chinhae.cc`，TLS 判定随默认端点生效；配对 offer URL 指向新网页端；删除中继的 cutover 代理分支及其测试（Osuna 没有上游要代理）；官网站点主机改 `https://osuna.chinhae.cc`。
- 三个部署工作流改为读本账号 Variable 与新项目名；`--workspace` 名随改名走。网页端与官网内容在 1.0.0 实现阶段随改名首发。
- Cloudflare 中继就是生产中继：架构与发布文档里"Cloudflare 中继是 legacy、生产用 Elixir"的说法改写。

### E. Hub 整体移除（Q8、06）

- 协议层直接删除，不打 COMPAT：Hub 管理与执行相关的 7 对请求/响应与错误 schema、会话事件订阅里的两个 Hub 事件、`clientType` 的 `"hub"`、`server_info.features` 的 `hubAgentRpc` / `hubRelationship`、Hub 关系状态 schema；AOT 校验重生成。client 侧对应方法与 `clientType` 同删。理由：0.14.x 桌面端自带 daemon、升级即整体替换；网页端与安卓包从 1.0.0 起步；`hub.*` 消息唯一发送方是已被移除的 Hub 服务。
- `hub.execute` 权限整体删除：daemon 权限集去掉该值；操作权限表约 70 处备选权限只保留原有 workspace/daemon 权限，行为不变；创建 agent 处的 `hub.execute` 判断删；旧 Hub scope 的兼容映射删。唯一带持久化权限的主体是 owner（拿全量），无持久化风险。
- `$OSUNA_HOME/hub-relationship.json`（含 `.invalid-*` 变体）不碰、不删、不提示。
- daemon 的 Hub 模块、Hub 专用 agent 生命周期分发实例、`hub-e2e` 合成 provider 及其测试、CLI `hub` 子命令及其测试、CI 的 `hub` 路由过滤器与 `test:hub-cli-contract` 步骤随删。
- 文档：`docs/hub.md`、`public-docs/hub/` 整删；permissions / architecture / providers / testing / cli / security / connectivity / schedules / why 等页删节不删篇；`CLAUDE.md` 文档表删 Hub 行并改 permissions 描述。
- 官网：Hub 路由、预渲染路由、重定向、页脚链接、首页 CTA、llms 条目、privacy / terms 的 Hub 段全删。
- app 没有任何 Hub 入口，`SECURITY.md` 没有 Hub 内容，两处不改。

### F. 推送通知与安卓档（11）

- Osuna 任何端都不提供推送通知。1.0.0 安卓包不接 Expo / Firebase。
- daemon 侧 push 服务、`register_push_token` / `push.unregister.*` 协议消息、`features.pushTokenRevocation`、push token 存储只随改名，不删不加 COMPAT（删要动协议，留着零令牌时是空操作、无外呼）。
- App 侧推送代码整删：`expo-notifications` 依赖与 config plugin、原生订阅实现、原生通知处理器、通知图标；原生入口与 web 一样空操作；通知点击路由只留桌面 / 网页端。效果：首次连主机不再弹权限请求，APK 不再打包 Firebase Messaging。
- F-Droid 构建档整删：对应环境变量、autolinking 插件、相机与通知桩、`extra.fdroidBuild`。Osuna 只剩一个安卓档：相机保留（QR 配对）、无推送。
- 桌面通知与应用内提醒不受影响。

### G. 安卓构建与签名（Q10、01、09）

- GitHub Actions 裸跑 `expo prebuild --platform android --clean --no-install` + gradle `assembleRelease`，公开仓库标准 runner 免费不限分钟。不用 EAS：免费档拿不到现有工作流依赖的 large 规格，还受次数、排队、超时约束。
- 一次性配置：JDK 21；prebuild 前复刻原 `eas-build-post-install`（构建 app 依赖与终端 WebView）；gradle 起步 `--no-daemon --max-workers=2`；跳过 lint 任务；磁盘不够时先清 runner 预装大件。
- 签名：Expo 模板 release 默认用 debug keystore，新增 config plugin 从 `OSUNA_ANDROID_KEYSTORE_PATH / _PASSWORD / KEY_ALIAS / KEY_PASSWORD` 读取并注入 `signingConfigs.release`，缺任一变量则不动（本地 debug 流程不受影响）。keystore 由工作流从 Secret `ANDROID_KEYSTORE_BASE64` 解码到 `$RUNNER_TEMP`；四个 Secrets 已在仓库。PKCS12 限制 store/key 同口令，gradle 两个字段都要填。
- 应用配置：删 `owner` 与 `extra.eas`，`slug` 改 `osuna`，`scheme` 改 `osuna://`（与包名同票改，否则两 App 共存抢深链）；删 `eas.json`、`eas-cli` 依赖与 post-install 脚本。
- 产物命名 `osuna-<tag>-android.apk`，上传到对应 GitHub Release。工作流的 `ensure-release` job 保留只改字样；`timeout-minutes` 首次落地后按实测收紧。
- 包名 `com.chinhae.osuna` 与上游 `sh.paseo` 是两个独立应用、无升级路径，Osuna 未发过安卓包，可接受。
- keystore 指纹（SHA-256 `39:16:AF:…:4E:A9`）与用户校验命令已在 `docs/release.md`；用户待办：把本机 keystore 目录同步到云盘。

### H. 官网与 Public docs（Q9、10）

- Website 第一版只有：首页、下载页、Public docs、更新日志（从 CHANGELOG 生成）、隐私、条款。整删：约 45 个按代理名的 SEO 落地页与 `/agents` 索引、7 篇替代品对比页、博客与 posts、赞助页、首页推荐语跑马灯与头像、`/hub`。页眉页脚对应链接随删。`llms.txt` 保留，前言改 Osuna，删 agents 与 alternatives 两节。
- 首页与下载页沿用现有版式换皮，不开原型票：首页文案中文、英雄区截图换成 Osuna 自己的（现有全是上游界面图）、删推荐语与上游专属段落；下载页中文、Release 源改 `LFT-OXY/Osuna`。
- Public docs 顶层只删 `community.md` 与 `hub/`，其余 27 篇保留改写（含 voice、browser×3、schedules×3、agent-profiles、orchestration-workflows、metadata-generation，这些功能本仓库都有）。
- 插件文档去分版：删 v0.7 整目录与 v0.8 迁移指南；v0.8 的 index / reference / providers 上提一层为 `plugins/` 下三篇；删版本选择页、旧 URL 重定向表与双版本导航测试的断言；内部 `docs/plugins.md` 的链接随改。
- `sdk/` 整删：`@osuna/client` 不发公网，不留公开安装文档。
- 安装路径重写：桌面端（GitHub Releases）、Docker（`ghcr.io/lft-oxy/osuna`）、服务器 / 无头（克隆仓库 → `npm ci` → 构建 server 栈 → 运行 CLI）。web-ui、updates、docker 页的 npm 安装语句同改。不开新分发渠道。
- 语言：首页与下载页中文；Public docs 保留英文，只做改名与内容订正；导航分类名保留英文。
- 链接与命令：上游仓库链接改 `LFT-OXY/Osuna`（`plugin-examples/`、`skills/` 目录本仓库都有）；`npx skills add getpaseo/paseo` → `npx skills add LFT-OXY/Osuna`；4 个第三方社区插件仓库、`paseo.cafe`、`labels/plugins` 链接随上游社区内容删；官网代码三处硬编码仓库地址（文档页脚"在 GitHub 上编辑"、下载链接、Release API）改 `LFT-OXY/Osuna`。
- 官网托管 `/schemas/osuna.config.v1.json`，内容与 daemon 的配置 schema 一致。
- Public docs 新增三处落点：docker 页升级段（B）；android 相关说明不进 Public docs（内部文档）；发布说明不属于 Public docs。

### I. 内部文档体系（07、04、08、11、06）

- `docs/`、`CLAUDE.md`、`.atw/spec/`（15 个文件，在用的编码规范）、skills 里的 paseo 字样、路径与命令全部随改。
- `docs/release.md`：「Fork 分发」一节重写为 Osuna 的正式发布路径（不再是"fork 内部分发"），删上游 npm 发布路径；记 COMPAT 到期清单与 0.14.x 回滚步骤；安卓 keystore 一节已在。
- `docs/architecture.md` 与 `docs/release.md`：Cloudflare Worker 就是生产中继。
- `docs/android.md`：删 F-Droid 节，"Cloud build + submit (EAS)" 改写为 GitHub Actions 流程，注明 APK 无推送但桌面通知与应用内提醒照旧。
- `docs/data-model.md` Push Token Store 一节加"当前没有客户端注册令牌"。
- `docs/glossary.md`：按 07 人工改写；Website / Public docs / Web app / Push notification / Desktop notification / In-app attention 条目已加。
- ADR 0002 保留 superseded 头；ADR 0006 已写，例外清单不进 ADR。
- 1.0.0 发布说明升级段：CLI 卸旧装新；上游 Paseo App 请卸载；Docker 链接到 Public docs 升级段；安卓包无推送通知，需要被动提醒请用桌面端或网页端；官网与 APK 链接（或"即将上线"的明确说明）。

### J. 发布节奏与 CI 重接线（Q12、05）

- 下一版 1.0.0，一次切换：改名、迁移、远程切域名、Hub 移除同版发布；一个大 PR；发布前完整走 `docs/qa.md` 的 QA 矩阵。官网与 APK 可晚几天，但发布说明带链接。
- 回滚 = 整版退回 0.14.x，靠 `~/.paseo` 符号链接与永不删旧数据保证可行。
- 发布前置条件（已完成）：GitHub 脱离 fork 网络（03，2026-10-09，Releases / Secrets / Actions 全部保留）；Cloudflare 基建（04）；安卓 keystore 与 Secrets（09）。
- CI：`deploy-app` / `deploy-relay` / `deploy-website` 改读 `vars.CLOUDFLARE_ACCOUNT_ID` 与 Secret token、新项目名与工作区名；`docker.yml` 镜像名；`android-apk-release.yml` 按 G 重写，只有一个安卓档；`ci-paths.yml` 与 `ci.yml` 删 Hub 路由；仓库脚本检查新增改名守线。

## UI and Design

只有三处用户可见的界面变化，其余是改名与删除。

- **Website 首页与下载页**：沿用 `packages/website` 现有版式，不改布局与配色。首页：Osuna 名称与 logo、中文标语与段落、Osuna 自己的桌面 / 手机截图、删推荐语跑马灯与 Hub CTA；页眉页脚只留 文档 / 更新日志 / 下载 / 隐私 / 条款。下载页：中文，列桌面端各平台包（稳定 / Beta 切换保留）与安卓 APK，全部指向 `LFT-OXY/Osuna` 的 Release。目标视口：桌面 1280、手机 390。截图验收：首页与下载页任一视口不出现 Paseo 字样、上游截图、推荐语、Hub 入口；下载按钮在 390 宽下不被裁切。
- **桌面端迁移失败对话框**（Electron 原生 `showErrorBox` / 对话框，不是渲染层 UI）：userData 搬迁失败时一个只有确认的错误框，含旧路径、新路径、手工命令；origin 导入失败时两个按钮「重试」「放弃旧数据继续」。文案中文，与现有 daemon 错误状态面一致。
- **Daemon 硬失败状态面**：复用现有"daemon errored"状态面，显示 daemon 的退出信息（含手工命令）。无新界面。

成功路径无任何新界面；安卓端唯一可见变化是首次连主机不再弹通知权限请求。

## Testing Decisions

好的测试只断言外部行为：目录在哪、链接在哪、daemon 启不启、offer URL 是什么、页面上有没有某个字样；不断言内部状态。按 `docs/testing.md` 的两类：带端口与适配器的单元测试，或真 daemon / 真 Electron / 真浏览器的端到端。

接缝（从高到低，优先复用）：

1. **改名守线（唯一新接缝）**：仓库脚本级检查，输入整棵树与例外清单，输出违规文件列表。测试用临时目录造几个文件验证例外与非例外。先例：仓库脚本在每个 PR 跑的现有检查。
2. **Daemon home 迁移**：home 解析模块已有测试（用真实临时目录）。迁移逻辑作为纯函数接收旧路径、新路径与文件系统操作，在临时目录里测：真实目录→搬迁并留链接；旧是链接→跳过；新已存在→跳过并 warn；rename 失败→退回 copy；两者都失败→抛带手工命令的错误。`OSUNA_HOME` 显式设置→不迁移。`PASEO_*` 残留→warn 列表。整条链路用 ad-hoc 进程内 daemon 从带旧目录的临时 home 启动，断言启动后数据可读。先例：`paseo-home.test`、bootstrap 系列测试、`docs/ad-hoc-daemon-testing.md`。
3. **CLI**：现有 CLI 测试套件（`packages/cli/tests`）改为 `osuna` 命令名；新增一条启动时 `PASEO_*` 警告的断言；删 Hub 子命令测试。
4. **桌面端 userData 与 origin 迁移**：键名 / 库名映射表对 02 研究列出的全部 23 个键与 4 个库做单测；导出 / 导入脚本在 Node + `fake-indexeddb` 下做往返（含 Blob）。userData 目录搬迁同 2 的方式在临时目录测。端到端复用现有 `*.electron.mjs` 的隔离 userData 机制：把一份 0.14.x 的 `Paseo` userData 固定为 `fixtures/legacy-paseo/` 样本（约 1 MB 以内），以副本启动 1.0.0，断言主机列表、草稿、面板布局出现，完成标记已写，旧 origin 数据仍在；失败注入（导出页 404、导入抛错）断言不写标记且下次启动成功。先例：`desktop-settings.test`、`daemon-lifecycle.e2e.mjs`、`docs/browser-capture-harness.md`。
5. **远程默认值**：现有 config 与 relay 配置测试断言默认端点与网页端基址；现有 `pair-device-relay` e2e 断言 offer URL 落在 `osuna-app.chinhae.cc`。中继 cutover 代理测试随代码删。
6. **协议与 Hub 删除**：typecheck 与现有协议测试即是接缝；Hub 相关测试文件随删，不替换。
7. **Website**：现有 vitest（插件文档导航测试改为单套树；`llms` 输出不含 agents / alternatives；Release URL 指向 `LFT-OXY/Osuna`）；新增一条断言 `public/schemas/osuna.config.v1.json` 存在且能解析为 JSON Schema。首页与下载页用现有 Playwright 浏览器项目截图验收。
8. **安卓构建**：只在 CI 验证——工作流产出签名 APK 并挂到 Release，`apksigner` 校验指纹等于文档值。本机不做原生实机验收（无模拟环境），运行时行为在验收项里标明免验收。
9. **App 推送删除**：typecheck + 现有 app 测试；无推送相关测试需要新增。

不做：JSDOM 组件测试、mock 模块下的"迁移"测试、对 leveldb 文件内容的断言。

## Acceptance Criteria

### 改名
- [ ] 仓库内 `paseo` 字样只出现在例外清单与带 `COMPAT(paseoDataMigration)` 标签的代码处；守线检查在 CI 通过。
- [ ] `osuna` CLI、`~/.osuna`、`OSUNA_*`、`osuna.json`、`osuna://`、MCP server `osuna`、`osuna-plugin.json`、Electron userData `Osuna`、镜像 `ghcr.io/lft-oxy/osuna`、`/home/osuna`、`@osuna/*`、skills `/osuna-*` 全部生效。
- [ ] `NOTICE` 存在；`LICENSE` 保留上游版权行；四份 README 页尾致谢；术语表按 07 改写；`fastlane/metadata/` 已删。
- [ ] 安卓 `com.chinhae.osuna` / `.debug`，iOS bundle id 同名；桌面 appId 与产物名不变。
- [ ] `npm run typecheck`、`npm run lint`、`npm run format:check` 全绿。

### Daemon 迁移
- [ ] 默认 home 下有真实 `~/.paseo` 且无 `~/.osuna` 时，启动后 `~/.osuna` 是原目录，`~/.paseo` 是指向它的符号链接（Windows junction），`daemon.log` 一条 info，无 UI 提示。
- [ ] 旧是链接、新已存在、显式 `OSUNA_HOME` 三种情况不迁移；"旧比新新"记 warn。
- [ ] rename 与 copy 都失败时 daemon 非零退出，错误含两条路径与手工命令；桌面端显示在 daemon 错误状态面；下次启动重试。
- [ ] 任一 `PASEO_*` 变量存在时 daemon 与 CLI 启动各打一条 warn，逐个列出 `OSUNA_*` 对应名。
- [ ] 迁移后原有工作区、worktree、Agent 历史可用，无需 `git worktree repair`。
- [ ] 三层迁移代码均带 `COMPAT(paseoDataMigration): added in v1.0.0, remove after 2027-10-09 or in 2.0.0, whichever first`。

### 桌面端迁移
- [ ] 0.14.x 的 `Paseo` userData 在首次启动 1.0.0 后出现在 `Osuna` 目录，主机列表、设置、草稿、面板布局原样；完成标记写在桌面设置文档 `migrations`；`paseo://app` 旧数据未被清空。
- [ ] userData 搬迁失败：开窗前错误框，退出，下次重试。origin 导入失败：「重试」退出，「放弃旧数据继续」写标记后正常启动。
- [ ] 日志目录在搬迁之后才创建（Windows/Linux 无 `Osuna/logs` 抢先问题）。
- [ ] 实机验收：0.14.x 自动更新到 1.0.0 后 `osuna://` 深链可打开 App（macOS 本机）。

### 远程连接
- [ ] daemon 默认中继 `osuna-relay.chinhae.cc:443`（TLS）、默认网页端 `https://osuna-app.chinhae.cc`；配对 offer URL 指向新网页端。
- [ ] 中继 cutover 代理代码与测试已删。
- [ ] `deploy-app` / `deploy-relay` / `deploy-website` 推 main 后网页端与官网可访问，中继 `/health` 200。
- [ ] 上游 Paseo 手机 App 不再受支持，发布说明写明。

### Hub
- [ ] 协议、client、daemon、CLI、文档、官网、CI 中 Hub 相关内容按 06 边界删除；`hub-relationship.json` 不被读写；`grep -ri hub` 剩余命中仅为无关词义。
- [ ] 操作权限表删 `hub.execute` 后现有权限测试全绿，行为不变。

### 推送与安卓档
- [ ] App 不再依赖 `expo-notifications`；原生入口为空操作；F-Droid 构建档全部删除；只剩一个安卓档。
- [ ] daemon push 服务与协议消息保留，仅改名。
- [ ] 安卓首次连主机不弹通知权限请求：免验收（无实机环境），以依赖与 plugin 删除为准。

### 安卓构建
- [ ] `android-apk-release.yml` 在 GitHub Actions 上产出 `osuna-<tag>-android.apk` 并挂到对应 Release。
- [ ] `apksigner verify --print-certs` 的 SHA-256 等于 `docs/release.md` 记录值。
- [ ] 应用配置无 `owner` / `extra.eas`；`eas.json` 与 `eas-cli` 已删；签名 config plugin 缺变量时不改 gradle。

### 官网与 Public docs
- [ ] `osuna.chinhae.cc` 首页与下载页为中文，1280 与 390 视口截图无 Paseo 字样、上游截图、推荐语、Hub 入口；下载链接指向 `LFT-OXY/Osuna` Release。
- [ ] 路由只剩 `/`、`/download`、`/docs/*`、`/changelog`、`/privacy`、`/terms`（含 llms.txt 与 docs 的 `.md` 直出）。
- [ ] Public docs 目录：无 `community.md`、`hub/`、`sdk/`、`plugins/v0.7`、`plugins/v0.8`；`plugins/` 下 index / reference / providers 三篇；27 篇顶层保留且无上游链接、无 npm 安装语句。
- [ ] `https://osuna.chinhae.cc/schemas/osuna.config.v1.json` 可访问且与 daemon 配置 schema 一致。
- [ ] docker 页有升级段（卷、环境变量、`mv .paseo .osuna`）。

### 内部文档与发布
- [ ] `docs/`、`CLAUDE.md`、`.atw/spec/`、skills 无 paseo 字样（例外清单除外）；`docs/release.md` 的 Osuna 发布路径、COMPAT 到期清单、0.14.x 回滚步骤、安卓 keystore 节齐全；架构与发布文档说 Cloudflare Worker 是生产中继；`docs/android.md` 为 GitHub Actions 流程且无 F-Droid 节；`docs/data-model.md` Push Token Store 加注。
- [ ] 1.0.0 发布说明含升级段（CLI、上游 App 卸载、Docker 链接、安卓无推送）与官网 / APK 链接或"即将上线"说明。
- [ ] 发布前完整走 `docs/qa.md` 矩阵；原生端条目注明免验收。

## Out of Scope

- iOS 构建、签名、TestFlight、上架（等 Apple 开发者账号，另起地图）。
- 替代 Hub 的自动化功能（不自建、不重写）。
- 上架 Google Play / F-Droid。
- 上游 Paseo 手机 App 的兼容性。
- 英文官网；Public docs 中文翻译（1.0.0 文档区只做英文改名版）。
- 继续合并上游（永久放弃，不留参考分支）。
- 任何端的推送通知，含网页端 Web Push 与将来的 iOS 包。
- `sdk/` 文档补回与 `@osuna/client` 的可安装渠道。
- 官网视觉改版（1.0.0 换皮不比方向）。
- 改写已持久化的绝对路径、`gitdir` 指针与 `agents/` 目录名（靠符号链接兼容）。
- 删除 `~/.paseo` 符号链接或任何旧数据（永不自动删除）。
- CLI 发布包等新分发渠道（无头安装走源码构建）。

## Further Notes

- 规模：含 `paseo` 的文件约 2253 个（app 910、server 653、cli 163、desktop 95、website 56、protocol 45、client 31）。切票时改名脚本是一张票，其余按本文件 A–J 分组；改名票必须最先合，因为后续所有票的验收都以新拼写为准。
- 改名脚本统计隐藏目录（`.atw`、`.github`）要加 `--hidden`；`CHANGELOG.md` 有 792 处上游 PR 链接，整文件跳过。
- 迁移测试样本 `fixtures/legacy-paseo/` 由本机 0.14.x 的 `Paseo` userData 去掉 `Partitions`、`Cookies` 等无关目录后固定，文件名与内容保持旧拼写。
- 02 号票原先的"空启动 + 3 次封顶"失败策略已被 08 号票作废，以本文件 B / C 为准。
- 05 号票的回滚可行性依赖 08 号票的符号链接；两者合在一起才成立。
- Cloudflare 免费档：Workers 与 DO 各 10 万请求/天（账号级，与已有 Worker 合计），每条入站 WebSocket 消息计一次 DO 请求。1.0.0 后看一周用量再定是否升 Paid。
- 用户待办（不进票）：把 `~/.config/osuna/android/` 同步到云盘；1.0.0 发布后删除 `~/osuna-detach-backup-2026-10-09/`。
