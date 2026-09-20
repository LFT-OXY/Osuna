# 01 — 身份与打包面：桌面/移动/CLI 的名称、应用 ID、发布源与署名

**What to build:** 把用户和商店看得见的身份全部换成 Osuna：桌面与移动端的展示名、
应用 ID、深链 scheme、安装包文件名、自动更新源指向 `LFT-OXY/Osuna`、CLI 命令名、
npm scope、以及 LICENSE 追加版权行与 README 的 fork 溯源段。本票含本任务唯一的
不可逆项（应用 ID），验收必须在真实构建产物里肉眼核对拼写。

**Impl:** done
**Status:** ready-for-agent

**Blocked by:** None — can start immediately

- [x] `packages/desktop/electron-builder.yml`：`productName` / `executableName` → `Osuna`；
      `appId` → `com.chinhae.osuna.desktop`；protocols scheme → `osuna`；mac/linux/win/appImage
      四处 `artifactName` → `Osuna-...`；`executableArgs` → `--class=Osuna`
- [x] 同文件：`publish` → `owner: LFT-OXY` / `repo: Osuna`；`vendor` → `Osuna`；
      `maintainer` → `chinhae <autuhae@gmail.com>`；三处 `extraResources` 的 `bin/paseo`
      与 `bin/paseo.cmd` → `bin/osuna` / `bin/osuna.cmd`，并同步重命名 `packages/desktop/bin/` 下的文件
- [x] `packages/app/app.config.js`：`variants.production.name` → `Osuna`、
      `development.name` → `Osuna Debug`；`packageId` → `com.chinhae.osuna` /
      `com.chinhae.osuna.debug`；`scheme` → `osuna`；`owner` 与 `extra.eas.projectId`
      **删除**（无 EAS 账号，创建 project 是后续独立任务；见 prd）
- [x] `packages/app/eas.json`：移除 `submit.production.ios.ascAppId`（`6758887924` 是上游的
      App Store 应用，无权使用），不是替换
- [x] `packages/cli/package.json`：`bin` 键 `paseo` → `osuna`，并重命名 `packages/cli/bin/paseo`
- [x] 11 个 workspace 的 `package.json` 名称 `@getpaseo/*` → `@osuna/*`，同步所有
      workspace 间依赖引用与 `npm run --workspace=` 的调用点
- [x] 根 `package.json`：`name` → `osuna`、`description`、`author` → `chinhae`、
      `homepage` 留空、`repository.url` → `LFT-OXY/Osuna`
- [x] `LICENSE` 保留 `Copyright (c) 2025-present Mohamed Boudra`，其上追加
      `Copyright (c) 2026-present chinhae`；正文里的 "Paseo" 指代随之更新
- [x] `README.md` 改名并在顶部加 fork 溯源段（fork 自 github.com/getpaseo/paseo，
      基于 Apache-2.0）
- [x] 验收：本地构建一个桌面包，在产物里肉眼确认三处拼写 ——
      `com.chinhae.osuna.desktop`、安装包文件名 `Osuna-*`、maintainer 的
      `chinhae <autuhae@gmail.com>`
- [x] `npm run typecheck`、`npm run lint` 通过

## Comments

**2026-09-20 落地。** typecheck / lint 全绿；桌面包本地构建通过，产物核对
`com.chinhae.osuna.desktop`、`Osuna-0.8.0-arm64.dmg`/`.zip`、`Osuna Helper.app`、
`Contents/Resources/bin/osuna`、URL scheme `osuna`。`maintainer` 是 Linux-only 字段，
mac 产物里验不到，顺延批次 5（见 prd）。

改动面比清单原文宽的地方，都是本票改动的连带后果，不是主动扩范围：

- **深链 scheme 跨层**：`electron-builder.yml` 的 protocols 改了，同一个 scheme 还硬编码
  在 `packages/protocol/src/agent-deep-link.ts`、desktop `APP_SCHEME`、server CORS 白名单
  `osuna://app`、app + server 的诊断脱敏正则、`nix/desktop-package.nix` 的 `EXPO_DEV_URL`
  与移动端 e2e 资产。只改一处会让打包后的渲染进程加载不了自己。不留兼容读取。
- **productName 连带**：`main.ts` 的 `APP_NAME`/`setDesktopName`/dev userData 目录、
  `after-pack.js` 与 `after-sign.js` 的 `EXECUTABLE_NAME`、`linux-sandbox` 的启动器名、
  `packages/cli/src/commands/open.ts` 的 app bundle 查找路径、桌面 e2e smoke 脚本、
  `.github/workflows/nix.yml` 的 bundle 断言、`desktop-packages.yml` 的
  `dpkg --remove osuna`（deb 包名随 productName 变）。
- **appId 连带**：`updater.ts` 的 Squirrel ShipIt 目录名 `com.chinhae.osuna.desktop.ShipIt`、
  fastlane `app_identifier`、maestro / agent-device e2e 的目标 app id。
- **CLI 命令名连带**：`bin` 键与 `bin/osuna` 文件、`program.name()`、42 个文件里的
  help / 错误文案、`npx osuna` 形式的本地 e2e、`knip.json` 与 `trace-daemon.mjs` 的
  entry、`@osuna/cli/bin/osuna` 的两处运行时解析、桌面 CLI shim 安装名。
- **npm scope 连带**：`plugin-examples/` 的 import（`packages/plugin` 的 typecheck 会编译
  它们，不改则 typecheck 红）、已发布包的 README（它们随包上 npm）、
  `android-apk-release.yml` 的 `asset_name`。scope 变短后 oxfmt 会把 22 个文件的多行
  import 折成一行，属预期格式化结果。

**回退的一处**：`.github/ISSUE_TEMPLATE/*` 曾改指 LFT-OXY/Osuna 并去掉上游 Discord，
经审查判定超范围 —— 它必须与 `CONTRIBUTING.md` 一起改，否则仓库里两处投稿目的地互相
矛盾。已还原，归批次 4。

**一并修的上游缺陷**：`nix/package.nix` 与 `nix/desktop-package.nix` 的
`meta.license` 由 `agpl3Plus` 改为 `asl20` —— 仓库实际是 Apache-2.0，许可证元数据错误
与本票的 LICENSE/署名同一个面，且在对外发布前是真风险。

**审查后驳回的两条**：`bin/osuna` 缺 `PASEO_DESKTOP_MANAGED` 是上游 commit `0110302b6`
造成的既有不对称（重命名如实保留 HEAD）；保留 `PASEO_*` 不需要 `COMPAT(...)` 标签，
它们不是双读兼容路径，只是批次 2 待改的标识符。两条都记进了 prd 的 `不改` 一节。
