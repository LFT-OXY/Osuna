# 勘图访谈结论（2026-10-09，两轮，全部已定）

本文件是需求边界。地图只处理这里没覆盖的决策，不重开已定项。

## 目的地

一份可直接切票的《Osuna 独立化》`prd.md`：代码与标识全量改名、本机数据无感自动迁移、GitHub 仓库脱离 fork 网络、自建远程连接（中继 + 网页端）、安卓 APK 侧载分发、官网改为 Osuna；iOS 只定身份不做发布。

## 已定决策

| # | 决策 | 结论 |
|---|---|---|
| Q2 | 上游同步 | 永久放弃合并 getpaseo/paseo。**不保留** `upstream-paseo` 参考分支；以后要移植上游改动，直接看上游仓库手工改。 |
| Q3 | 仓库去 fork | 用 GitHub 自助 **Leave fork network**（Settings → Danger Zone），不删除重建、不找 Support。仓库满足条件：公开、约 280 MB、0 个子 fork。脱离前备份 Releases 资产，脱离后核对 Secrets（`CSC_LINK`、`CSC_KEY_PASSWORD`）。 |
| Q4 | 标识全量改名 | 无一例外：CLI `paseo`→`osuna`；`~/.paseo`→`~/.osuna`；`PASEO_*`→`OSUNA_*`；`paseo.json`→`osuna.json`；`paseo://`→`osuna://`；MCP server 名 `paseo`→`osuna`（工具变 `mcp__osuna__*`）；插件清单 `paseo-plugin.json`→`osuna-plugin.json`、requirements 键改名，上游插件不再兼容；Electron userData 目录 `Paseo`→`Osuna`；Docker 镜像 `ghcr.io/lft-oxy/osuna`；skills `/paseo-*`→`/osuna-*`。默认端口 6767 不是品牌，保留。 |
| Q5 | 作用域与标识符 | npm 作用域 `@osuna/*`（不发布公网）。安卓包名与 iOS bundle id `com.chinhae.osuna`，调试版 `com.chinhae.osuna.debug`；桌面 appId 维持 `com.chinhae.osuna.desktop`。package.json 作者 `LFT-OXY <autuhae@gmail.com>`。 |
| Q6 | 数据迁移 | 有其他用户在用，1.0.0 首次启动**无感自动迁移**三块：(1) `~/.paseo`→`~/.osuna`；(2) Electron userData `Paseo`→`Osuna`；(3) 渲染层存储从 `paseo://app` origin 导出再写入 `osuna://app`（Chromium 不允许跨 origin 搬存储，只能主进程开隐藏窗口导出/导入）。Docker（卷 `/home/paseo`）与手装 CLI 用户走文档手工步骤。 |
| Q6c | 迁移策略 | 目录用 **move（重命名）** 而非复制，跨分区失败退回复制。新旧同时存在以新为准、旧目录原封不动，**永不自动删除旧数据**。 |
| Q6d | 现有用户远程 | 1.0.0 发布时远程**只提供网页端**（配对二维码打开你的网页端），安卓 APK 随后补；官方 Paseo 手机 App 不再是受支持客户端，发布说明明确告知。 |
| Q7 | 域名 | `chinhae.cc`，Cloudflare 托管，**与别的东西共用**。Cloudflare 免费证书只覆盖一级子域，故全部一级：官网 `osuna.chinhae.cc`、网页端 `osuna-app.chinhae.cc`、中继 `osuna-relay.chinhae.cc`。 |
| Q8 | Hub | **整体移除**：删 CLI `hub` 子命令、Hub 文档、所有 `hub.paseo.sh` 默认值；daemon 侧 hub 模块单独一票清理（与协议有牵连）。理由：Hub 服务端不在本仓库，自建要靠上游 npm 包 `@getpaseo/hub`。 |
| Q9 | 官网 | `packages/website` 改成 Osuna 官网，第一版三块：首页、下载页（指向 GitHub Releases 的桌面包与 APK）、文档（`public-docs/` 改名重写后挂上）。Cloudflare 托管。**简体中文为主**，英文排后。 |
| Q10 | 安卓构建 | 先研究：EAS 免费额度 vs GitHub Actions 裸跑 Expo prebuild + gradle。判断标准：**零成本优先**，除非 B 的坑多到不可靠。APK 挂 GitHub Release 侧载，不上商店。 |
| Q11 | iOS | 本次只在配置里定 bundle id、显示名、图标；构建 / TestFlight / 上架范围外，等 Apple 开发者账号到手另起地图。 |
| Q12 | 版本号 | 下一版 **1.0.0**（已装桌面端自动更新要求单调递增，也标志独立起点）。 |
| Q13 | 署名 | LICENSE 保留上游版权行；新增 `NOTICE` 写明"源自 Paseo (Apache-2.0)"；README 的 fork 说明改为页尾一行致谢；CHANGELOG 历史条目的 Paseo 字样保留。 |

## 查到的事实（决策依据）

- 含 `paseo` 的文件约 2253 个（排除 node_modules/dist/锁文件）：app 910、server 653、cli 163、desktop 95、fastlane 64、website 56、protocol 45、client 31。
- ADR 0002 曾把改名止于桌面身份；当时全量改名分支 PR #2 触及约 2150 文件，被放弃。本任务推翻该 ADR（见 `docs/adr/0006-osuna-full-detach-from-paseo.md`）。
- 远程链路全在上游：`relay.paseo.sh`（Cloudflare Worker + Durable Object，`packages/relay/wrangler.toml`；`PASEO_RELAY_UPSTREAM` 只是迁移期的 cutover 代理，Osuna 不需要）、`app.paseo.sh`（Cloudflare Pages，`deploy:web` 脚本项目名 `paseo-app`）、`hub.paseo.sh`。配对 offer URL 形如 `https://app.paseo.sh/#offer=…`，默认值在 `packages/server/src/server/config.ts` 与 `pairing-offer.ts`。
- 手机端身份仍是上游：`packages/app/app.config.js` 中 `name: "Paseo"`、`sh.paseo` / `sh.paseo.debug`、`owner: "getpaseo"`、上游 EAS projectId。`android-apk-release.yml` 走 EAS 云构建。
- 桌面端已是 Osuna：appId `com.chinhae.osuna.desktop`，发布源 GitHub Releases `LFT-OXY/Osuna`，产物名 `Osuna-*`。userData 目录名钉死在 `packages/desktop/src/main.ts:117`（`USER_DATA_DIR_NAME = "Paseo"`），渲染器从 `paseo://app` 加载。
- GitHub 官方文档《Detaching a fork》：自助脱离条件为公开、<1 GB、无子 fork；不保留 Issues/PR/Wiki/Stars/评论及"其他元数据"，提交历史保留，不可逆。Releases 与 Secrets 是否保留文档未明说。
- Cloudflare 官方文档《Limitations for Universal SSL》：免费证书只覆盖根域与一级子域，二级子域需 Advanced Certificate Manager。
- 许可证 Apache-2.0：剥离后仍须保留上游版权声明。
