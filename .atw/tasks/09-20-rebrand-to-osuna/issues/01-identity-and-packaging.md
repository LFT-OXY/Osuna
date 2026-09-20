# 01 — 身份与打包面：桌面/移动/CLI 的名称、应用 ID、发布源与署名

**What to build:** 把用户和商店看得见的身份全部换成 Osuna：桌面与移动端的展示名、
应用 ID、深链 scheme、安装包文件名、自动更新源指向 `LFT-OXY/Osuna`、CLI 命令名、
npm scope、以及 LICENSE 追加版权行与 README 的 fork 溯源段。本票含本任务唯一的
不可逆项（应用 ID），验收必须在真实构建产物里肉眼核对拼写。

**Impl:** ready
**Status:** ready-for-agent

**Blocked by:** None — can start immediately

- [ ] `packages/desktop/electron-builder.yml`：`productName` / `executableName` → `Osuna`；
      `appId` → `com.chinhae.osuna.desktop`；protocols scheme → `osuna`；mac/linux/win/appImage
      四处 `artifactName` → `Osuna-...`；`executableArgs` → `--class=Osuna`
- [ ] 同文件：`publish` → `owner: LFT-OXY` / `repo: Osuna`；`vendor` → `Osuna`；
      `maintainer` → `chinhae <autuhae@gmail.com>`；三处 `extraResources` 的 `bin/paseo`
      与 `bin/paseo.cmd` → `bin/osuna` / `bin/osuna.cmd`，并同步重命名 `packages/desktop/bin/` 下的文件
- [ ] `packages/app/app.config.js`：`variants.production.name` → `Osuna`、
      `development.name` → `Osuna Debug`；`packageId` → `com.chinhae.osuna` /
      `com.chinhae.osuna.debug`；`scheme` → `osuna`；`owner` 与 `extra.eas.projectId`
      换成本人 EAS 账号与新建 project
- [ ] `packages/app/eas.json`：移除 `submit.production.ios.ascAppId`（`6758887924` 是上游的
      App Store 应用，无权使用），不是替换
- [ ] `packages/cli/package.json`：`bin` 键 `paseo` → `osuna`，并重命名 `packages/cli/bin/paseo`
- [ ] 11 个 workspace 的 `package.json` 名称 `@getpaseo/*` → `@osuna/*`，同步所有
      workspace 间依赖引用与 `npm run --workspace=` 的调用点
- [ ] 根 `package.json`：`name` → `osuna`、`description`、`author` → `chinhae`、
      `homepage` 留空、`repository.url` → `LFT-OXY/Osuna`
- [ ] `LICENSE` 保留 `Copyright (c) 2025-present Mohamed Boudra`，其上追加
      `Copyright (c) 2026-present chinhae`；正文里的 "Paseo" 指代随之更新
- [ ] `README.md` 改名并在顶部加 fork 溯源段（fork 自 github.com/getpaseo/paseo，
      基于 Apache-2.0）
- [ ] 验收：本地构建一个桌面包，在产物里肉眼确认三处拼写 ——
      `com.chinhae.osuna.desktop`、安装包文件名 `Osuna-*`、maintainer 的
      `chinhae <autuhae@gmail.com>`
- [ ] `npm run typecheck`、`npm run lint` 通过
