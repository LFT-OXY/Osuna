# 03 — 更新失败要可见

**What to build:** macOS 用户在应用内点「安装更新」之后，只有当应用真的开始退出安装时，才看到「正在重启」。如果更新器报错，或者等待超时，界面上会显示失败原因，并提供一个「前往 Releases 手动下载」的入口，指向本仓库。维护者能在 main.log 里看到更新器的 info、warn、error 日志，其中包括 Squirrel.Mac 的签名校验错误。安装前为更新停掉的本地 daemon，在安装失败后会被重新拉起。

**Blocked by:** None — can start immediately
**Status:** ready-for-agent
**Impl:** done

- [x] electron-updater 的 logger 接入 electron-log，更新器的 error 不再被丢弃，会写进 main.log
- [x] app-update-service 的测试覆盖以下情况：调用安装后、收到 `before-quit-for-update` 之前，不会报告已安装；收到之后进入重启状态；先收到更新器错误时，返回失败和原因；等待超时时按失败处理
- [x] 界面的更新区域在安装失败时显示原因和手动下载入口，入口链接指向本仓库的 Releases
- [x] 新增的界面文案在 9 种语言里都有对应的翻译
- [x] 安装失败后，为更新停掉的本地 daemon 会被主进程重新拉起（评审后经用户确认追加）
- [x] typecheck 与 lint 通过

## Comments

**实现结论（2026-09-27）**

- 交接：`AppUpdateRuntimeConfiguration.onBeforeQuitForUpdate` 由 `auto-updater.ts` 订阅 Electron 内置 `autoUpdater` 的 `before-quit-for-update`；MacUpdater 原生路径与 BaseUpdater（NSIS / Linux）都经这个事件交接。等待上限 60 秒（用户确认），只在 `restart: true` 的手动安装生效。
- 安装结果改为判别联合（`failure: handoff-timeout | updater-error | null`），界面新增 `install-failed` 状态；新增文案 `desktop.updates.status.installFailed`、`desktop.updates.manualDownload`、`desktop.updates.installTimedOut`，9 种语言齐全。Releases 地址 `https://github.com/LFT-OXY/Osuna/releases`，经 `openDesktopReleasesPage` 打开。
- 评审后追加（用户确认）：安装失败时 `daemon-manager.ts` 的 `install_app_update` 重新启动为更新而停掉的 daemon（原先失败后本地 host 会一直断开）。这一处没有单测，靠 typecheck 与人工验证。
- `auto-updater.test.ts` 里「频道未发布时 console 静默」的断言改为「不走 `[auto-updater] Failed to check for updates:` 上报」：logger 接入 electron-log 后，这类 error 会进 main.log，这是本票要求的取舍。
- `formatStatusText` 改为查表：多加一个分支会让复杂度到 21，超过 oxlint 上限 20。
- 未处理（记为已知边界，已写入 PRD）：超时后 Squirrel 才成功时应用仍会重启；等待期间的无关更新器 error 也会判失败；MacUpdater 每次 quitAndInstall 都会再挂一个 `update-downloaded` 监听（库行为）。
- 验证：desktop 全量 385 通过；app 单元测试 5744 通过；两包 typecheck、改动文件 oxlint/oxfmt 通过。真机的签名失败与成功路径留给 10 号工单的硬门槛验证。
