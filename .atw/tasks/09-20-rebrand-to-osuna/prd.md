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
| 同上 | `owner: getpaseo`、`eas.projectId: 0e7f65ce-...` | 本人 EAS 账号与新建 project |
| `packages/app/eas.json` | `ascAppId: 6758887924` | 移除（上游的 App Store 应用，无权使用） |
| `packages/cli/package.json` | bin `paseo` | `osuna` |
| 11 个 workspace | `@getpaseo/*` | `@osuna/*`（registry 已确认 404，可用） |
| 根 `package.json` | `name: paseo`、`author`、`homepage: paseo.sh`、`repository` | `osuna`、`chinhae`、留空、`LFT-OXY/Osuna` |

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

### 插件契约（不留兼容读取）

`paseo-plugin.json` → `osuna-plugin.json`；`requirements.paseo` → `requirements.osuna`；
`skills/paseo-plugin`、`skills/paseo-help` → `osuna-*`；`plugin-examples/` 下 10 个示例
同步。后果已知并接受：为上游写的第三方插件不再能装到 Osuna 上，反之亦然。

### 公开 API 与文档

- 导出的函数名与类型名改（`createPaseoClient`、`PaseoClient` 等）。**内部私有变量名
  不专门改** —— 只有维护者看得见，不值得为它承担一次巨大的无意义 diff。
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
- 内部私有变量名。
- 本机 `~/.paseo`：**不迁移、不自动搬运、不重启 6767 daemon**（那会杀掉正在运行的
  agent）。新 daemon 在 `~/.osuna` 从零起、重新配对，仅 `models/` 值得手动 `cp`。
  旧目录由本人在确认新环境可用后自行删除。

## 分批与验收

按「可独立验证」切五批，顺序不可调换：批次 1 含唯一不可逆项，必须最先落地并肉眼
验证；批次 5 要拿前四批成果做真实发布演练。

1. **身份与打包面** — desktop/app/cli 配置、publish、署名、LICENSE、README 溯源。
   验收：本地出一个桌面包，产物里确认应用名、appId、安装包文件名三项拼写。
2. **运行时标识** — `OSUNA_*`、`~/.osuna`、`.osuna/`、端口、dev home。
   验收：起 dev daemon，CLI 连通，跑 server 受影响的测试文件（单文件 `--bail=1`）。
3. **插件契约** — 清单文件名、`requirements` 字段、示例、skills。
   验收：`plugin scaffold` 与 plugin-lifecycle e2e。
4. **公开 API 与文档清理** — 导出名、docs、删多语言 README、移出 website。
   验收：`npm run typecheck` + `npm run lint` + 构建通过。
5. **签名配置与发布演练** — 关公证、改 workflow、推测试 tag 走一遍 GitHub Release。
   验收：Release 产出可下载、可安装、能被 electron-updater 识别。

## 完成的标准

- `rg -i paseo` 在排除 `CHANGELOG.md` 历史条目与 `LICENSE` 原版权行后无命中。
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
