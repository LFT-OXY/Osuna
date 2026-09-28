# 08 — daemon 自更新下线

**What to build:** 任何客户端（官方手机 App 或本仓库的界面）连上 Osuna 的 daemon 之后，都不再出现「更新 daemon」的入口，因为 daemon 不再在 `server_info.features` 里声明 `daemonSelfUpdate`。即使有人直接调用自更新 RPC，也会被拒绝。这样 Docker 部署的 daemon 就不会被换成上游的 npm 版。实现要遵循 protocol compatibility 的 feature contract：只在 capability 这一处关闭，不在其他地方加防御分支。

**Blocked by:** None — can start immediately
**Status:** ready-for-agent
**Impl:** done

- [x] daemon client 的 e2e 测试断言：`server_info.features` 里没有 `daemonSelfUpdate`，直接调用自更新 RPC 会得到拒绝
- [x] 设置页的 host 页面在连接 Osuna daemon 时，不显示更新 daemon 的卡片
- [x] 不再被引用的自更新代码，是否删除按「只清理本次改动产生的孤儿」的原则处理，处理结果写进 Comments
- [x] typecheck 与 lint 通过

## Comments

**实现结论（2026-09-27）**

- capability：`websocket-server.ts` 的 `server_info.features` 删掉 `daemonSelfUpdate`（连同它的 COMPAT 注释），桌面托管与否都不再声明。`packages/protocol` 的 schema 字段和 COMPAT 注释保留（字段不能删）。
- 拒绝：`DaemonSession.handleUpdateRequest` 对 `daemon.update.request` 一律回 `daemon.update.response { success: false, error: "Daemon self-update is not available on Osuna. Update the host the way it was installed.", previousVersion, newVersion: null }`。沿用被删 updater 拒绝桌面托管 daemon 时的形式，客户端 `updateDaemonFromSettings` 会弹失败提示并带上原因，比 `rpc_error` 友好。`session.ts` 的分发改为同步调用后 `return undefined`，与 `daemon.config.reload.request` 一致。
- 孤儿清理（按「只清理本次改动产生的孤儿」）：删除 `daemon-self-updater.ts`、`daemon-self-update-session-controller.ts`、`install-origin.ts`、`npm-global-cli.ts` 及三个对应测试；`DaemonSessionHost.emitLifecycleIntent` 与 `DaemonSessionOptions.clientId` 只服务于 controller，一并删除。保留：`DaemonRuntimeConfig.desktopManaged`（server_info 与 diagnostics 仍在用）、`getControlRpcLogInfo` 对 `daemon.update.request` 的日志 reason、`operation-permissions` 与 `owned-subscriptions/replies.ts` 里的协议消息映射（消息仍在协议中）、client 的 `updateDaemon`、app 的更新卡片（连上游 Paseo daemon 时仍可能用到）。
- host 页卡片：`host-page.tsx` 未改，卡片条件是 `hasVersionMismatch && (supportsSelfUpdate || desktopManaged)`。Docker 或 npm 部署的 Osuna daemon 不再显示卡片（按代码推理确认，未实机截图）。例外：远程的桌面托管 daemon 版本与 app 不一致时，仍显示按钮禁用、提示去 host 上更新桌面端的卡片。这是原有的版本不一致提示，不是自更新入口，要隐藏它就得在 app 里另加判断，违反 feature contract，所以不动。
- 测试：`daemon-client.e2e.test.ts` 断言 `features` 不含 `daemonSelfUpdate`（普通与桌面托管两个用例），新增「直接调用自更新 RPC 被拒绝」。先红后绿。
- 验证：server typecheck 通过；改动文件 oxlint、oxfmt 通过；`session/daemon/` 单测 11 个通过。`daemon-client.e2e.test.ts` 整文件另有 3 个失败（上传文件 id、agent lifecycle、permission flow），server 单测单独跑时 `bootstrap-provider-availability`、`workspace-service-port-allocator` 各 1 个失败，都已在基线 `cd6c6693d` 上复现，与本票无关。全量并行时偶发的 github-service、workspace-git observation 失败单独跑能通过，属于不稳定用例。
