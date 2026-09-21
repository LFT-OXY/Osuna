# discover：fork 桌面端分发的耦合点

## 已确认的前提

- 本仓库 `LFT-OXY/Osuna` 是 `getpaseo/paseo` 的 fork，**可见性 PUBLIC**。
  public 意味着 electron-updater 拉 Release 不需要客户端 token，方案 B 可行。
- 无私有包依赖。`@boudra/*` 在所有 package.json 中零命中，CI 里的
  `registry-url: npm.pkg.github.com` + `scope: @boudra` 是空配置。
- 源码中没有指向上游仓库的硬编码，`grep getpaseo/paseo` 在
  `packages/{desktop,server,app}/src` 下只命中测试夹具。

## 三个必须改的点

### 1. 更新源指向上游（最严重）

`packages/desktop/electron-builder.yml` 的 publish 段写死 `getpaseo/paseo`。
electron-builder 把它烘进安装包的 `app-update.yml`。
`packages/desktop/src/features/app-update-service.ts:249` 只判断 `isPackaged()`，
打包版一律开启更新检查——团队装上内部版后会被"升级"回官方 Paseo，
二次开发的功能被覆盖。

### 2. macOS 公证

`electron-builder.yml` 的 `mac.notarize: true` + `hardenedRuntime: true`。
无 Apple Developer 账号时公证必然失败，本地和 CI 都要关掉。
关掉后团队首次打开会被 Gatekeeper 拦，需右键「打开」或
`xattr -dr com.apple.quarantine`。

### 3. Linux job 卡住发布

`desktop-release.yml` 的 `finalize-rollout` 要求 mac/linux/windows 三份 manifest
齐全，缺一份就 `echo "::error::Missing updater manifests"` 并让 Release 停在草稿。
去掉 Linux 构建必须同步改这份清单，否则更新永远发不出去。

## 已排除的改动（决策：不与官方版共存）

以下全部保持不动。记录在此是为了说明为什么不改，避免以后重复调研：

- `appId: sh.paseo.desktop`、`productName: Paseo`、`paseo://` scheme
- 产品名的 6 处硬编码：`src/main.ts:114`（APP_NAME）、`src/main.ts:348`
  （Linux window class）、`src/diagnostics/updater.ts:8`（ShipIt 目录名）、
  `scripts/after-pack.js:8`、`scripts/after-sign.js:5`、
  `scripts/linux-sandbox/index.js:6`
- 数据目录 `~/.paseo`，定义在 `packages/server/src/server/paseo-home.ts:15`

改这些等于重做一遍已废弃的 `chore/rebrand-to-osuna` 分支。
团队成员若装过官方 Paseo 才需要，当前判断为不需要。

## 待定（留给 spec）

- 版本号：当前 `0.8.0`，与上游同号。更新检查只看本仓库 Release，
  技术上不冲突，但同号会让人分不清装的是哪个版本。
