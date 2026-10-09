# Map — Osuna 独立化：全面脱离上游 Paseo

## Destination

一份可直接切票的 `prd.md`：Osuna 不再是 Paseo 的 fork，而是独立产品。到达标志：所有标识命名、数据迁移机制、仓库脱离步骤、远程连接基建（中继 + 网页端）、安卓构建与分发方式、官网范围、Hub 移除边界、改名例外清单、发布节奏都已拍板，没有留给实现阶段的设计问题。iOS 只定身份。

## Notes

- 访谈结论（两轮，全部已定）：`research/interview-decisions.md`。它是需求边界，地图只解决它没覆盖的设计问题，不重开已定项。
- 域名布局：官网 `osuna.chinhae.cc`、网页端 `osuna-app.chinhae.cc`、中继 `osuna-relay.chinhae.cc`，全部一级子域（Cloudflare 免费证书限制）。
- 术语：`docs/glossary.md` 的 **Osuna / Paseo** 条目已按新边界改写；ADR `docs/adr/0006-osuna-full-detach-from-paseo.md` 取代 0002。
- 每个 session 必读：`docs/protocol-compatibility.md`（Hub 移除与 scheme 改名触碰协议）、`docs/data-model.md`（存储目录与原子写）、`docs/release.md`（Fork 分发一节要重写）、`docs/expo-router.md`（渲染层存储迁移触碰启动恢复）。
- 研究票由子代理跑 `atw-research`，结果写 `research/<topic>.md`，票内 `## Answer` 只放结论与指针。
- 工单只做决策；实现全部留给 `/atw-spec` → `/atw-tickets`。改名本身的 2253 个文件是实现工作，不在地图上。

## Decisions so far

<!-- 一行一票：标题链接 + 一句结论 -->

- [安卓构建路径：EAS 云构建 vs GitHub Actions 裸跑 gradle](map-issues/01-android-build-path.md) — **选 B**：公开仓库标准 runner 免费不限分钟；EAS 免费档拿不到 `production-apk` 依赖的 `large` 规格，退回 medium 与 `ubuntu-latest` 同规格却还受 15 次/月、低优先级排队、45 分钟超时约束。B 的坑都是一次性配置：JDK 21、prebuild 前复刻 `eas-build-post-install`、新增 config plugin 注入 release 签名（Expo 模板 release 默认用 debug keystore）、删掉 `owner` / `extra.eas.projectId`、`--max-workers=2` 起步。包名 `com.chinhae.osuna` 与上游无升级路径可接受，`scheme` 必须同票改 `osuna://`。副产品：推送链依赖 Expo 项目 + FCM，两条路都收不到推送，已另开 11 号票。详见 `research/android-build-path.md`。
- [Electron 渲染层存储跨 origin 迁移（paseo://app → osuna://app）](map-issues/02-renderer-storage-migration.md) — **选方案 a**：主进程在首个窗口前开隐藏顶层 `BrowserWindow`，从 `paseo://app` 枚举全部 `localStorage` 键与 `indexedDB.databases()` 导出，`clearStorageData` 清空 `osuna://app` 后整体写入；完成标记在新 userData 的 `desktop-settings.json → migrations`，旧 origin 永不删；失败处理（原"3 次封顶"）已被 08 号票订正为阻止启动 / 对话框二选一。方案 b（直接改 leveldb）不可行：origin 编在键里且块 Snappy 压缩；方案 c（两个 scheme 共享存储）在 Chromium 中不存在。本机实测 Local Storage 548 KB / IndexedDB 15 MB，23 个键 + 4 个库。userData 改名必须在 electron-log 首次写日志前，否则 Windows/Linux 上 `Osuna/logs` 先被建出导致 rename 失败。带出两个待定归 08 号票：与上游 Paseo.app 并存的机器上 move 会掏空上游数据；迁移代码 COMPAT 到期日。详见 `research/renderer-storage-migration.md`。
- [发布节奏：1.0.0 一次切换，还是分阶段](map-issues/05-release-sequencing.md) — **一次切换到 1.0.0**：改名、迁移、远程切域名、Hub 移除同版发布；官网与 APK 可晚几天但发布说明带链接；03、04 两张基建票是发布前置条件、不随版本走；回滚 = 整版退回 0.14.x，可行性靠 08 号票留下的 `~/.paseo → ~/.osuna` 符号链接（目录是 move 不是保留）。
- [GitHub 仓库脱离 fork 网络](map-issues/03-github-leave-fork-network.md) — **已完成（2026-10-09）**：自助 Leave fork network 约 60 秒生效；Releases、资产、Secrets、Actions、PR、标签全部保留，无需重传；本地 remote 不变。备份在 `~/osuna-detach-backup-2026-10-09/`，1.0.0 发布后可删。

- [Cloudflare 基建：三个子域、Pages 项目、中继 Worker、Secrets](map-issues/04-cloudflare-infra.md) — **已完成（2026-10-09）**：中继 `osuna-relay.chinhae.cc` 已部署且 `/health` 200；Pages 项目 `osuna-app` 绑 `osuna-app.chinhae.cc`（CNAME 已建，证书签发中）；官网 KV 已建、`wrangler.toml` 已指向本账号与 `osuna.chinhae.cc`，官网与网页端内容待 1.0.0 首发；GitHub Secret `CLOUDFLARE_API_TOKEN` + Variable `CLOUDFLARE_ACCOUNT_ID` 已写入。免费档够用（DO SQLite 类、10 万请求/天与已有 Worker `oxy-ip` 合计）。daemon 默认域名、cutover 代理删除、architecture/release 文档里"中继是 legacy"的说法留给 spec。
- [Hub 移除边界：daemon 与协议侧删到哪](map-issues/06-hub-removal-boundary.md) — **全删、不打 COMPAT**：协议里 7 对 Hub 消息、2 个事件、`clientType` 的 `"hub"`、`hubAgentRpc / hubRelationship` 特性位与 `hub.execute` 权限直接删除，理由是 1.0.0 后没有需要兼容的旧客户端；`operation-permissions.ts` 约 70 处备选权限只保留原有 workspace/daemon 权限，行为不变；`hub-relationship.json` 残留不碰不提示；`hub-e2e` 合成 provider 随删；文档 `docs/hub.md` 与 `public-docs/hub/` 整删，`permissions.md` / `architecture.md` / `cli.md` / `public-docs/security.md` 删节不删篇；官网 Hub 路由、页脚、CTA、privacy/terms 的 Hub 段删，剩余官网内容归 10 号票；CI `hub` 过滤器与 `test:hub-cli-contract` 随带删。核实：app 无任何 Hub 入口；`SECURITY.md` 无 Hub 内容。
- [改名例外清单：哪些地方保留 paseo 字样](map-issues/07-rename-exception-list.md) — **只做整文件排除，无句级规则**：脚本跳过 `LICENSE`、新建 `NOTICE`、`CHANGELOG.md`、`docs/adr/**`、`.atw/tasks/**`、`.atw/workspace/**`、`**/fixtures/legacy-paseo/**`（迁移测试旧版样本，规则先立）、README ×4 与 `docs/glossary.md`（后两者人工改写：页尾致谢、指上游的句子保留、其余 Paseo → Osuna，术语表其余条目的产品名改 Osuna）。上游 URL 全部替换，`$schema` 改为 `osuna.chinhae.cc/schemas/osuna.config.v1.json` 且官网要实际托管；`@getpaseo/plugin` 是自家包随改；`.atw/spec`、`.github`、Docker/Nix 名字全部随改无例外。附带：`fastlane/metadata/` 整目录删除；例外清单不进 ADR 0006。

- [迁移的用户体验与失败处理](map-issues/08-migration-ux-and-failure.md) — **11 条全按推荐**：`~/.paseo` 搬迁由 daemon 在启动时执行（仅 home 为默认值时；显式 `OSUNA_HOME` 不迁移），rename 后原位留符号链接 `~/.paseo → ~/.osuna`（Windows 用 junction），因为 `worktrees/` 里 6.3 GB 的 git worktree、`workspaces.json` 的 14 处绝对路径与 `agents/` 目录名都指向旧路径，留链接免去改写与 `git worktree repair`，顺带让 0.14.x 回滚可行。成功静默只记日志；目录搬迁硬失败阻止启动（daemon 非零退出带手工命令、Electron 开窗前 `showErrorBox`），每次启动重试无上限、无计数器，替代 02 的"空启动 + 3 次封顶"（已证明失效）；origin 导入失败弹「重试 / 放弃旧数据继续」，后者写 done 标记。目录层不设标记文件；残留 `PASEO_*` 环境变量只 warn 不认；Docker 手工步骤写 `public-docs/docker.md` 升级段、发布说明放链接，CLI 用户卸旧装新只写发布说明；迁移代码 `COMPAT(paseoDataMigration)` 到 2027-10-09 或 2.0.0 先到者；上游 Paseo.app 并存时接受其丢 userData，发布说明让用户卸载。
- [安卓签名 keystore 与仓库 Secrets](map-issues/09-android-keystore-and-secrets.md) — **已完成（2026-10-09）**：PKCS12 keystore `~/.config/osuna/android/osuna-release.keystore`，alias `osuna-release`，RSA 4096、有效期至 2056-10-01，store/key 同口令（PKCS12 限制）；四个 Secrets `ANDROID_KEYSTORE_BASE64 / ANDROID_KEYSTORE_PASSWORD / ANDROID_KEY_ALIAS / ANDROID_KEY_PASSWORD` 已写入 LFT-OXY/Osuna；SHA-256 指纹与校验命令已写进 `docs/release.md`「安卓签名 keystore」一节；用户待办：把该目录同步到云盘备份。

- [安卓包的推送通知去留](map-issues/11-android-push-notifications.md) — **任何端都不提供推送**：1.0.0 安卓包不接 Expo/Firebase，不另开票；daemon 侧 `push/` 与协议消息原样保留（删要动协议，留着是空操作）；App 侧推送代码整删（`expo-notifications` 依赖、plugin、原生实现、通知图标），消掉"答应了也收不到"的权限弹窗与无用的 Firebase Messaging 原生库；F-Droid 构建档随删，Osuna 只剩一个安卓档（相机保留、无推送）；网页端 Web Push 记入范围外；桌面通知与应用内提醒不受影响。术语表已补 Push notification / Desktop notification / In-app attention 三条。文档落点并入"文档体系改写范围"。

- [官网文档页取舍](map-issues/10-website-docs-selection.md) — **8 问全按推荐**：顶层文档只删 `community.md` 与 `hub/`，其余 27 篇保留改写（含 voice、browser×3、schedules×3、agent-profiles、orchestration-workflows、metadata-generation）；`plugins/` 去分版，只留 v0.8 的 index / reference / providers 上提一层，删 v0.7、迁移指南、旧 URL 重定向与双版本导航测试；`sdk/` 整删（`@osuna/client` 不发公网）；安装路径改为桌面端 Release、Docker 镜像、无头走源码构建，不开新分发渠道；官网只留首页、下载、文档、更新日志、隐私、条款，整删约 45 个代理 SEO 页、`/agents`、7 篇替代品对比页、博客、赞助页、推荐语跑马灯，`llms.txt` 保留删 agents / alternatives 节；第一版中文首页 + 下载页、文档区留英文改名版；链接全部改指 `LFT-OXY/Osuna` 与 `*.chinhae.cc`，第三方社区插件链接随删；首页与下载页沿用现有版式换文案换截图，不开原型票，英雄区上游界面图必须换成 Osuna 截图。详见票内 Answer。

## Not yet specified

- **CI 工作流重接线**：`deploy-app.yml` / `deploy-relay.yml` / `deploy-website.yml` 改指向自己的 Cloudflare 账号与项目名，`docker.yml` 镜像名，`android-apk-release.yml` 按安卓研究结论重写（11 号票定了：只有一个安卓档，无 F-Droid 分支、无推送凭据）。04 与 09 都已落地（Cloudflare 账号 Variable + Token Secret、四个安卓签名 Secrets 就绪），没有剩余前置，整体进 spec。
- **桌面端 0.14.x → 1.0.0 的更新路径核验**：appId 与产物名 `Osuna-*` 不变，理论上 electron-updater 直接吃到；但 `paseo://` 协议处理器注册名变了，需要在 spec 里写一条实机验收。
- **文档体系改写范围**：`public-docs/` 的保留 / 删除 / 改写清单与官网页面清单已在 10 号票定稿（含安装路径重写、插件文档去分版、`llms.txt` 改写），整体进 spec。`docs/`、`CLAUDE.md`、`.atw/spec/`、`skills/` 里的 paseo 字样与路径，以及 `docs/release.md` 的"Fork 分发"一节；`docs/architecture.md` 与 `docs/release.md` 里"Cloudflare 中继是 legacy、生产用 Elixir"的说法要改成"Cloudflare Worker 就是生产中继"（04 号票发现）。Hub 相关的删除范围已在 06 号票定稿；改名例外清单已在 07 号票定稿（README ×4 与 `docs/glossary.md` 人工改写），剩下的是改写量与顺序，进 spec。 08 号票新增三处落点：`public-docs/docker.md` 升级段（卷与环境变量改名、首启前 `mv .paseo .osuna`）、`docs/release.md` 的 COMPAT 到期记录与 0.14.x 回滚步骤、1.0.0 发布说明的升级段（CLI 卸旧装新、上游 Paseo 请卸载、Docker 链接）。 11 号票新增三处落点：`docs/android.md` 改写（删 F-Droid 节，注明 APK 无推送但桌面通知与应用内提醒照旧）、`docs/data-model.md` Push Token Store 一节加"当前没有客户端注册令牌"、发布说明升级段加"安卓包无推送通知，需要被动提醒请用桌面端或网页端"。

## Out of scope

- iOS 构建、签名、TestFlight、App Store 上架（Q11：等 Apple 开发者账号到手另起地图）。
- 替代 Hub 的自动化功能（Q8：整体移除，不自建、不重写）。
- 上架 Google Play / F-Droid（Q10：只做 GitHub Release APK 侧载）。
- 官方 Paseo 手机 App 的兼容性（Q6d：不再是受支持客户端）。
- 英文官网（Q9：简体中文为主，英文排后）。
- 继续合并上游（Q2：永久放弃，不留参考分支）。
- 网页端 Web Push（11 号票：要自建 VAPID、daemon 加 web-push 发送器与订阅存储、Service Worker，是独立功能票，不是脱离上游的前置条件；标签页开着时已有浏览器桌面通知）。
- 任何端的推送通知，含将来的 iOS 包（11 号票：不注册 Expo、不建 Firebase）。
- 文档区中文翻译（10 号票：1.0.0 文档区只做英文改名版，首页与下载页才是中文）。
- `sdk/` 文档补回与 `@osuna/client` 的可安装渠道（10 号票：不发公网的包不留公开安装文档）。
- 官网视觉改版（10 号票：1.0.0 沿用现有版式换皮，不比方向）。
