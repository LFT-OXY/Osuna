# 07 — 桌面端 userData 目录搬迁

**What to build:** 0.14.x 桌面端用户自动更新到 1.0.0 后，Electron 的 `Paseo` userData 变成 `Osuna` 目录，设置文档与窗口状态原样可用；搬不动时在开窗前看到一个带路径与手工命令的错误框，下次启动再试（spec 决策 C 层 1）。

**Blocked by:** 04
**Status:** ready-for-agent
**Impl:** ready

- [ ] 搬迁在 Electron `ready` 前、electron-log 第一次写日志之前完成，日志目录在搬迁之后才创建；macOS 旧日志目录 `~/Library/Logs/Paseo` 不动；dev 用的隔离 userData 与强制 userData 路径不走迁移
- [ ] 条件与动作与 daemon home 一致：旧是真实目录且新不存在才搬，rename 失败退回复制，旧目录不删；不给上游 Paseo.app 留链接
- [ ] 失败时主进程开窗前 `showErrorBox`（中文，含旧路径、新路径、手工命令）后退出；每次启动重试、无计数；成功时主进程日志一条 info
- [ ] 迁移代码带 `COMPAT(paseoDataMigration)` 标签，到期日与 daemon 侧一致
- [ ] 单测在临时目录覆盖搬迁、跳过、失败三类分支；现有 Electron 隔离 userData 脚本验证从 `Paseo` 目录启动后设置文档出现在 `Osuna` 目录且日志目录顺序正确
- [ ] `npm run typecheck`、desktop 现有测试全绿
