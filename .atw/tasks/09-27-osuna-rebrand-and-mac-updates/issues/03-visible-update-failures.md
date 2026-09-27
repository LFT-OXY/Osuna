# 03 — 更新失败要可见

**What to build:** macOS 用户在应用内点「安装更新」之后，只有当应用真的开始退出安装时，才看到「正在重启」。如果更新器报错，或者等待超时，界面上会显示失败原因，并提供一个「前往 Releases 手动下载」的入口，指向本仓库。维护者能在 main.log 里看到更新器的 info、warn、error 日志，其中包括 Squirrel.Mac 的签名校验错误。

**Blocked by:** None — can start immediately
**Status:** ready-for-agent
**Impl:** ready

- [ ] electron-updater 的 logger 接入 electron-log，更新器的 error 不再被丢弃，会写进 main.log
- [ ] app-update-service 的测试覆盖以下情况：调用安装后、收到 `before-quit-for-update` 之前，不会报告已安装；收到之后进入重启状态；先收到更新器错误时，返回失败和原因；等待超时时按失败处理
- [ ] 界面的更新区域在安装失败时显示原因和手动下载入口，入口链接指向本仓库的 Releases
- [ ] 新增的界面文案在 9 种语言里都有对应的翻译
- [ ] typecheck 与 lint 通过
