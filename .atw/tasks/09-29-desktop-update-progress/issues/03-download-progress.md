# 03 — 下载进度

**What to build:**

下载中的卡片显示真实进度。主进程订阅 electron-updater 的 `download-progress` 事件，把最新的 `{ percent, transferred, total, bytesPerSecond }` 写进更新状态快照并广播；频率跟随 electron-updater 自身的节流，不另外加节流。

卡片的下载中阶段显示一条进度条和一行 `42% · 41.4 / 98.6 MB · 3.2 MB/s`：大小和速度按 MB、MB/s 保留一位小数，不显示剩余时间。收到第一份进度之前显示「正在下载…」。仓库里没有通用的进度条组件，在更新卡片里写一个最小实现，样式参照文件下载提示那条，不抽公共组件，也不改 `DownloadToast`。差量下载时 `total` 可能小于完整安装包，按事件里的值显示即可。

**Blocked by:** 02 — 手动下载主链路
**Status:** ready-for-agent
**Impl:** ready

- [ ] 下载中卡片的进度条随下载推进，显示百分比、已下载/总大小和速度；第一份进度到达前显示「正在下载…」。
- [ ] 多个窗口显示同一份进度。
- [ ] 更新服务测试覆盖进度事件写入快照并广播；描述器测试覆盖进度文字的格式化，以及还没有进度时的显示。
- [ ] 进度条样式符合 `docs/design.md`，在亮色和暗色主题下都清晰可辨（附 dev 桌面端注入假状态的截图）。
- [ ] `npm run typecheck`、`npm run lint` 通过。
