# 10 — 发布 0.10.0 并通过硬门槛

**What to build:** 团队成员拿到第一个叫 Osuna 的版本 `0.10.0`，并且从这一版开始 macOS 可以自动更新。发版说明写清楚三件事：本版需要手动下载安装一次；装好后删除旧的 Paseo.app；首次打开时怎么放行（说明里的应用名改成 Osuna.app）。走现有的 fork 发版路径发布 `0.10.0`，在一台真实的 Mac 上手动安装；接着发布 `0.10.1`，在同一台机器上通过应用内更新完成升级。这一步通过之前，不通知团队。

**Blocked by:** 02, 03, 04, 05, 06, 07, 08, 09
**Status:** ready-for-agent
**Impl:** done

- [x] CHANGELOG 和发版说明包含：需要手动安装、需要删除 Paseo.app、首次打开的放行步骤（使用 Osuna.app）
- [x] `0.10.0` 的 Release 已经转正，mac（arm64、x64）和 windows 的清单都齐全，mac 产物通过签名断言
- [x] 真机手动安装 `0.10.0` 后，名称、图标、已有 host 都正确
- [x] 发布 `0.10.1` 后，应用内更新成功：main.log 中出现 `before-quit-for-update`，重启后版本是 `0.10.1`，并且没有 Squirrel 报错
- [x] 硬门槛通过的证据（日志片段、版本截图）附在本票的 Comments 里，然后再通知团队

## Comments

**硬门槛验收（2026-09-28）**

- 发版说明：`CHANGELOG.md` 的 0.10.0 条目含「升级前必读」三步（手动安装、删除旧的 Paseo.app、首次打开的放行，均写 Osuna.app），Release 正文由它同步。
- 0.10.0：tag 推送触发 Desktop Release run 36364049950，全部作业成功，Release 转正，18 个产物：mac arm64/x64 的 dmg、zip 与 `latest-mac.yml`，windows 的 `Osuna-Setup-*` 与 `latest.yml`。macOS 两个架构通过签名断言。
- 真机手动安装 0.10.0（用户确认名称、图标、已有 host 正确）。本机核对：`CFBundleShortVersionString` 为 `0.10.0`，DR 为 `identifier "com.chinhae.osuna.desktop" and certificate root = H"41b36eddc9e915b7a457c0a08673ac5df0daf77b"`。
- 0.10.1：首次 run 36366816561 构建与签名断言通过，但上传失败，Release 留在草稿。原因是 `scripts/github-release.mjs` 按 `Paseo <tag>` 标题查找草稿，而 `3599162a3` 已把同步说明时新建的 Release 标题改为 Osuna。修复 `a4f133b7a` 后，用 `workflow_dispatch`（`tag=v0.10.1`、`checkout_ref=main`、`platform=all`）重跑 run 36368398125，全部成功，重复的空草稿被 `--cleanup-duplicates` 清掉。重跑的代码比 tag 多出这一个发版脚本提交，应用代码相同。
- 应用内更新：同一台 Mac 在「设置 → 关于 → 应用更新」手动检查并安装（手动检查不受 36 小时分批推送限制）。`~/Library/Logs/Paseo/main.log` 摘录：

  ```text
  [2026-09-28 10:25:03.938] [info]  [auto-updater] update available { targetVersion: '0.10.1' }
  [2026-09-28 10:25:27.498] [info]  New version 0.10.1 has been downloaded to .../pending/Osuna-0.10.1-arm64.zip
  [2026-09-28 10:25:44.945] [info]  [auto-updater] quitAndInstall requested { targetVersion: '0.10.1', isSilent: false, isForceRunAfter: true }
  [2026-09-28 10:25:46.199] [info]  [auto-updater] before-quit-for-update { currentVersion: '0.10.0' }
  [2026-09-28 10:25:53.724] [info]  [desktop] app startup { version: '0.10.1', ... }
  ```

  `~/Library/Caches/com.chinhae.osuna.desktop.ShipIt/ShipIt_stderr.log` 结尾为 `Successfully launched application at file:///Applications/Osuna.app/`、`ShipIt status 0`，没有签名校验错误。更新后 `CFBundleShortVersionString` 为 `0.10.1`，DR 与 0.10.0 相同。
- 日志里的两处非阻断记录：main.log 的 `Cannot download differentially, fallback to full download`（增量下载校验不符，已改为整包下载并成功）；ShipIt 的 `Unrecognized attribute string flag '?'`（系统运行时提示，与签名、安装无关）。
- 证据用日志摘录与 Info.plist 版本号代替截图。通知团队由用户进行。
