# discover：改名、更新通道、macOS 签名的现状与证据

基线：`main` @ `41de20b88`（2026-09-27）。行号都以这个提交为准，实施时先核对一遍再用。

## 1. 改名的露出点

### 桌面端 `packages/desktop`

- `electron-builder.yml`
  - `:2` appId
  - `:3-4` productName / executableName
  - `:6-8` 协议名和 scheme
  - `:41,64,87,89` 产物名
  - `:65-66` linux maintainer / vendor
  - `:81` `--class=Paseo`
  - `:54-55,68-69,92-93` `bin/paseo(.cmd)`
- `src/main.ts`
  - `:114` `APP_NAME`，`:133` `app.setName`
  - `:297-324` userData 的强制覆盖和 worktree 隔离（固定 userData 时要保住它们的优先级）
  - `:347-348` Linux 的 desktop 文件名和 class
  - `:556` 注册 scheme，`:790` 渲染层从 `paseo://app` 加载
- 菜单 `src/features/menu.ts:78-88`（role about/quit 跟随 `app.name`）；通知 `src/features/notifications.ts:75`。
- 写死可执行名的地方：
  - `scripts/after-pack.js:8`
  - `scripts/after-sign.js:5`
  - `scripts/linux-sandbox/index.js:6`
  - `bin/paseo:24-40`（`Paseo Helper.app` 等）
  - `bin/paseo.cmd:6`
- 文案：
  - `src/integrations/cli-install/install.ts:46`
  - `src/integrations/cli-install/shell-rc.ts:90`（写进用户 rc 的注释 `# Added by Paseo`）
- ShipIt 诊断目录 `src/diagnostics/updater.ts:8`：`sh.paseo.desktop.ShipIt`。

### CLI 查找桌面端

`packages/cli/src/commands/open.ts:10-45`（各平台候选路径），`:73,79`（报错文案，下载地址指向上游）。

### 共享界面 `packages/app`

- i18n 在 `src/i18n/resources/` 下，共 9 个语言文件，大写的 `Paseo` 约 358 处。
  - 指代手机官方 App、必须保留的例子：`en.ts:1798` "Scan this QR code with Paseo on your phone"。其他语言对应的键同理。
- i18n 之外的 tsx/ts 里还有约 28 处硬编码，例如 `screens/settings/host-page.tsx`、`git/use-actions.tsx`。
- logo 组件 `src/components/icons/paseo-logo.tsx`（蝴蝶 SVG），被这些地方引用：
  - `welcome-screen.tsx:289`
  - `startup-splash-screen.tsx:153,163,403`
  - `open-project-screen.tsx:67`
  - `utils/tool-call-icon.ts:29`
- Web：
  - `public/manifest.json:3-4`
  - `public/index.html:9`（`apple-mobile-web-app-title`）
  - `%WEB_TITLE%` 由 `expo.name` 注入。`app.config.js` 属于手机端打包配置，本次不改，所以 Web 标题需要另找注入点，或者单独覆盖。

### 渲染层存储键（scheme / userData 一旦变动就会丢）

`@paseo:daemon-registry`（host 列表）、`@paseo:app-settings`、`@paseo:settings`、`@paseo:keyboard-shortcut-overrides`、`@paseo:review-draft-store`、`@paseo:client-id-v1`，等等，共 16 类。

### daemon 的 CORS 白名单

`packages/server/src/server/bootstrap.ts:728-729` 写死了 `"paseo://app"`。scheme 不变，这里就不用改。

## 2. 图标素材

- 源图：`/Users/oxy/Downloads/图像 2026年9月27日 14_08_07.png`
  - 1254² RGBA，四角透明
  - 不透明底板的包围盒是 `(128,137)-(1126,1123)`，约占画布 79.6%
  - 底板内部 alpha≈253
  - 边缘有约 8.5k 个 alpha 在 1–20 之间的杂点
- 源图的原始候选版：`/Users/oxy/Downloads/Osuna-Logo-10款/osuna-04-origami.png`（底板约占 88%，边缘有锯齿，已弃用）。
- 要替换的桌面端文件：`packages/desktop/assets/`
  - `icon.icns`、`icon.ico`（16–256）、`icon.png`（512）
  - `icon-dev.png`
  - `32x32.png`、`64x64.png`、`128x128.png`、`128x128@2x.png`
- 要替换的 Web 文件：
  - `packages/app/assets/images/favicon.png`
  - `packages/app/assets/images/favicon-{dark,light}{,-running,-attention}.png`，由 `src/hooks/use-favicon-status.ts:15-22` 引用
  - `packages/app/public/pwa-icon-{192,512}.png`
  - `packages/app/public/apple-touch-icon.png`
- 不动的文件：`packages/app/assets/images/{icon,android-icon-foreground,splash-icon,notification-icon}.png`（手机端）、`packages/website/**`、`fastlane/**`。
- 孤立文件：`butterfly-green.svg`、`butterfly-white.svg`，以及 favicon 的同名 `.svg`，都没有被引用。是否清理，看它们是不是本次改动造成的孤儿，不是就不动。

## 3. 更新通道和上游外链

| 项 | 位置 | 处理 |
|---|---|---|
| 桌面自动更新源 | `electron-builder.yml:36-39` 已指向 LFT-OXY/Osuna | 不动 |
| Rosetta 下载 | `app/src/desktop/updates/desktop-updates.ts:41,197`；`rosetta-callout-source.tsx:14,33-36`；测试 `desktop-updates.test.ts:118` | 改为指向 fork |
| 更新日志 | `app/src/changelog/internal/changelog-source.ts:4` | 改为 fork 的 `CHANGELOG.md` |
| daemon 自更新 | `server/src/server/session/daemon/npm-global-cli.ts:5,140`；capability 声明在 `websocket-server.ts:1780`；`daemon-self-updater.ts:55`；界面 `app/src/screens/settings/host-page.tsx:679-730`；Docker 在 `docker/base/Dockerfile:60-61` 满足 `install-origin.ts:18-40` | 禁用 |
| CLI 下载提示 | `cli/src/commands/open.ts:79`；`onboard.ts:121-123` | 改为指向 fork |
| 反馈 / Issue | `app/src/components/sidebar-help-menu.tsx:32`；`startup-splash-screen.tsx:32-33` | 改为指向 fork |
| 仓库 / 赞助 | `community-links.tsx:15`（仓库）、`:19`（sponsors/boudra） | 仓库改为指向 fork，赞助删除 |
| 文档链接（App） | `agent-skills/index.tsx:27`、`changelog-sheet.tsx:28`、`desktop-updates-section.tsx:498`、`integrations-section.tsx:14`、`pair-device-section.tsx:24`、`project-settings-screen.tsx:90`、`schedules-screen.tsx:343`、`metadata-generation-page.tsx:16`、`welcome-screen.tsx:192,295` | 删除 |
| 文档链接（CLI） | `cli/src/commands/daemon/pair.ts:38`；`hub/help.ts:4`；`hub/init.ts:247`；`plugin/scaffold.ts:105-107` | 删除。hub 本身不在范围内，只删链接 |
| 失败的工作流 | `.github/workflows/{android-apk-release,deploy-app,deploy-website,deploy-relay}.yml` | 去掉 tag 与 push 触发 |

以下不在本次范围内：relay、app、hub 的运行时默认值，Expo 推送，网站，Docker 和 Nix 的文档，podspec 和 package.json 里的 homepage / repository。

## 4. macOS 签名和更新器

- `electron-builder.yml:40-60` 的 mac 段：`hardenedRuntime: false`、`notarize: false`，没有 `identity`、`requirements`、`sign`。架构由 CI 用 `--arm64` / `--x64` 决定。
- entitlements：`build/entitlements.mac{,.inherit}.plist` 两份内容相同，都是 allow-jit、allow-unsigned-executable-memory、audio-input，没有 disable-library-validation。
- 版本：electron-builder / app-builder-lib 26.8.1，electron-updater 6.8.3，@electron/osx-sign 1.3.3，electron 44.2.0。
- app-builder-lib 的签名行为（`node_modules/app-builder-lib/out/macPackager.js`）：
  - `identity: null` 时跳过签名。
  - 找不到身份时，只有 arm64 或 universal 会回退到 ad-hoc（`:215,248-251`）；x64 只打 warn，然后不签名（`:252-254`）。
  - 身份只从 `security find-identity -v` 列出的有效身份里选；`identity` / `CSC_NAME` 的优先级见 `codeSign/macCodeSign.js:261`。
  - 设置了 `CSC_LINK` 就会建临时钥匙串并导入证书（`macCodeSign.js:121-176`）。
  - 支持 `mac.requirements` 自定义 DR（`macPackager.js:373`）。
- Squirrel.Mac 的校验：`SQRLCodeSignature.m` 调用 `SecStaticCodeCheckValidityWithErrors(newBundle, kSecCSCheckNestedCode | kSecCSStrictValidate | kSecCSCheckAllArchitectures, <当前应用的 DR>)`。出处是 github.com/Squirrel/Squirrel.Mac 的 master 分支，已读过源码原文。
- MacUpdater（`node_modules/electron-updater/out/MacUpdater.js`）：
  - 自己只做 sha512 校验，签名校验全部交给 Squirrel。
  - 原生报错先走 `_logger.warn`，再 `emit("error")`（`:18-21`）。
- 我们自己的更新器接线：
  - `packages/desktop/src/features/auto-updater.ts`
    - `:152` `autoInstallOnAppQuit = false`
    - `:171-177` `logger.error` 被置成空函数
    - `:189-192` error 事件转交 `onError`
    - `:214-222` quitAndInstall
    - `:233-235` 只写 `console.error`
  - `app-update-service.ts`
    - `:218-227` 只在准备阶段记录错误
    - `:420-431,445-455` 调用安装后立刻返回 `installed: true`
  - 退出流程：`quit-lifecycle.ts:138-158` 等 `before-quit-for-update`，超时 5 秒（`main.ts:120`）；`main.ts:1057-1060` 记日志。
  - `main.ts:3-5` 只调了 `log.initialize({ spyRendererConsole: true })`，主进程的 console 没有接到 electron-log。
- CI（`.github/workflows/desktop-release.yml`）
  - publish-macos 在 `:96-205`：arm64 用 `macos-14`，x64 用 `macos-15-intel`。
  - env 只有 `CSC_IDENTITY_AUTO_DISCOVERY: "false"`（`:154-164`），没有 CSC_LINK 等变量。
  - 构建命令在 `:167-170`。
  - 清单合并与校验在 `:420-446`。
- 本机现状：
  - `security find-identity -v -p codesigning` 结果为 0 个身份。
  - `/Applications/Paseo.app`（0.8.2）的 DR 是 `cdhash H"5d2da0d6…"`。
  - `~/Library/Logs/Paseo/main.log` 里有 4 次 `quitAndInstall requested`，`before-quit-for-update` 出现 0 次。
- 发版文档 `docs/release.md`
  - `:130-145` 是 macOS 首次打开的说明，其中 `:143` 的说法与事实不符。
  - `:151-160` 是本地出包的说明。
  - `:93-128` 是 fork 发版路径。

## 5. 手机端与协议

- 手机用的是官方 Paseo App。App 端不按 semver 比较 daemon 版本，只有插件需求会比较（`packages/protocol/src/plugin-requirements.ts`）。
- 功能按 `server_info.features` 做 capability 门控，见 `docs/protocol-compatibility.md`。
