# 14 — 合并前验证

**What to build:** 在不碰 main、不发布任何东西的前提下，证明集成分支可以合并：分支上的 CI 全绿，能打出签名的 macOS 与 Windows 测试安装包，并在虚拟机里走通全新安装、从 0.14.2 升级、回退这几条路径。CI 暴露的问题在这张票里修。只有这张票承诺分支整体绿（expand–contract 的 integrate-and-verify 票）；合并、部署、发版在 17 号票。

**Blocked by:** 12, 13, 15, 16
**Status:** ready-for-agent
**Impl:** doing

- [x] 集成分支推到 origin 并开 draft PR（不合并）；`CI` 与 `Desktop Packages` 两个工作流在该 PR 上全绿，含守线检查与 Linux 打包冒烟；红灯在本票修掉并重跑
- [x] `Docker` 工作流在分支上手动触发（不发布镜像）构建通过
- [x] 手动触发 `Desktop Release`：从集成分支构建、不发布、版本取 `1.0.0-beta.1`，产出自签的 macOS 与 Windows 安装包作为工作流产物（Windows 包按 `docs/release.md` 不做代码签名）；不打任何 tag，不创建或修改任何 Release
- [x] 隐私与条款页没有占位文字（内容由用户提供后填入）
- [ ] 虚拟机 / 全新安装：1.0.0 测试包能启动、能创建并运行一个 Agent
- [ ] 虚拟机 / 从 0.14.2 升级（旧 daemon 已退出）：主机列表、设置、草稿、面板布局、工作区、Agent 历史原样；旧 home 路径是指向新 home 的符号链接；已有 worktree 无需 `git worktree repair`
- [ ] 虚拟机 / 从 0.14.2 升级（旧 daemon 仍在运行）：行为符合 16 号票，数据完整
- [ ] 虚拟机 / 连一台仍是 0.14.2 的主机：行为符合 15 号票
- [ ] 虚拟机 / 回退：卸掉 1.0.0 装回 0.14.2，按 `docs/release.md` 的回滚步骤操作后原有数据可用
- [ ] 虚拟机 / `osuna://` 深链能打开 1.0.0
- [ ] `docs/qa.md` 矩阵里合并前可验证的条目逐项附证据（截图存 `screenshots/`）；原生端条目注明免验收；只能合并后验证的条目列入 17 号票
- [x] 全程未推送 `v*` 标签、未合并到 main、未触发任何部署工作流
