# 08 — daemon 自更新下线

**What to build:** 任何客户端（官方手机 App 或本仓库的界面）连上 Osuna 的 daemon 之后，都不再出现「更新 daemon」的入口，因为 daemon 不再在 `server_info.features` 里声明 `daemonSelfUpdate`。即使有人直接调用自更新 RPC，也会被拒绝。这样 Docker 部署的 daemon 就不会被换成上游的 npm 版。实现要遵循 protocol compatibility 的 feature contract：只在 capability 这一处关闭，不在其他地方加防御分支。

**Blocked by:** None — can start immediately
**Status:** ready-for-agent
**Impl:** ready

- [ ] daemon client 的 e2e 测试断言：`server_info.features` 里没有 `daemonSelfUpdate`，直接调用自更新 RPC 会得到拒绝
- [ ] 设置页的 host 页面在连接 Osuna daemon 时，不显示更新 daemon 的卡片
- [ ] 不再被引用的自更新代码，是否删除按「只清理本次改动产生的孤儿」的原则处理，处理结果写进 Comments
- [ ] typecheck 与 lint 通过
