# 16 — 旧 daemon 仍在运行时的升级

**What to build:** 0.14.x 用户开着"退出后保持运行"升级到 1.0.0 时，数据目录不会在仍在运行的旧 daemon 脚下被搬走；升级要么顺利接管并完成迁移，要么让用户看到明确的原因和下一步，而不是一句 "exit 1"。迁移完成后的 daemon 不再向上游 App 留下的推送令牌外呼。任何入口都不会在迁移之前抢先建出默认 home（最终评审的遗留项 PA(c)4、PA(c)3，以及 dev 脚本的同类问题）。

**Blocked by:** None — can start immediately
**Status:** ready-for-agent
**Impl:** done

- [x] 旧 home 里的锁文件仍被存活的 0.14.x daemon 持有时，1.0.0 的任何拉起方（桌面端、CLI、supervisor 直启）都不搬目录
- [x] 桌面端升级后首次启动：按桌面端现有对"托管 daemon 版本过旧"的处理方式停掉旧 daemon，随后完成搬迁并启动新 daemon，用户无需手动操作；停不掉时走 daemon 错误状态面并说明原因
- [x] CLI：`osuna daemon status` 能认出仍在运行的 0.14.x daemon，`osuna daemon stop` 能停掉它；其余命令遇到它时给出一句明确的提示（旧 daemon 在运行、如何停掉），退出码非零
- [x] 后台拉起的 daemon 拒绝启动时，原因能到达用户（桌面端状态面或 CLI 输出），不再只有 "exit 1"
- [x] 推送：迁移过来的 home 里若有 0.14.x 留下的推送令牌，daemon 不向它们发送任何推送、不产生对外请求；令牌文件原样保留不删不改；1.0.0 发布说明草稿写明这一点
- [x] 仓库的 dev 脚本在不设任何变量时不会在真实的默认 home 下创建目录
- [x] 读旧布局的代码都带 `COMPAT(paseoDataMigration)` 全文标签；新文件登记进守线的迁移文件清单
- [x] 测试：进程级测试用一个存活的假旧 daemon 覆盖"不搬目录"、"status 认得出"、"stop 停得掉"、"停掉后下一次启动完成搬迁"；推送一条断言零外呼；全部在隔离的用户目录里运行
- [x] `docs/release.md` 的迁移节与回滚节同步这次的行为；`npm run typecheck`、`npm run lint`、守线检查全绿

> 15 号票落地后的约束（2026-10-09）：`@osuna/client` 在握手处拒绝一切低于 1.0.0 的主机（`DaemonHostOutdatedError`，CLI 错误码 `HOST_OUTDATED`），此后一条请求都不发。`osuna daemon stop` 现在走 `connectToDaemon` + `shutdownServer`，对 0.14.x 的 daemon 会被这道判定挡住；本票的 status / stop 要按 pid 处理，或者另走一条不经过该判定的路，不要在判定处加别名或回退。
