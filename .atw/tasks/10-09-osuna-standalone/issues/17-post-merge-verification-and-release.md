# 17 — 合并后验证与预发布

**What to build:** 集成分支合并到 main 之后，Osuna 自己的三条部署链路实际上线、安卓工作流产出签名包、0.14.2 能自动更新到 1.0.0 预发布并完成迁移，最后维护者本机完成真实迁移。这是原 14 号票里必须先合并才能验证的那一半。合并、发布预发布版本、迁移本机都是难以撤回的操作，每一步动手前要得到用户确认。不含正式版发布，正式版走 release playbook。

**Blocked by:** 14
**Status:** ready-for-agent
**Impl:** ready

- [ ] draft PR 转正并以 merge commit 合并到 main（用户确认后）；main 上 `CI`、`Desktop Packages`、`Docker` 绿，`Nix` 的结果记录在案
- [ ] `deploy-app` / `deploy-relay` / `deploy-website` 在 main 上跑通：`osuna-relay.chinhae.cc/health` 200；`osuna-app.chinhae.cc` 能打开网页端并完成一次配对；`osuna.chinhae.cc` 首页、下载页、文档、`/schemas/osuna.config.v1.json` 均 200
- [ ] 发布预发布版本之前核实：稳定通道的 0.14.x 用户不会被推送预发布版本（读更新逻辑并给出依据）
- [ ] 发布 1.0.0 预发布版本（用户确认后）；`android-apk-release` 在该标签上跑通，Release 上有 `osuna-<tag>-android.apk`，`apksigner verify --print-certs` 的 SHA-256 等于 `docs/release.md` 记录值；`timeout-minutes` 按实测收紧
- [ ] 虚拟机 / 自动更新：0.14.2 自动更新到 1.0.0 预发布后数据原样、`osuna://` 深链可用、旧 origin 的数据仍在
- [ ] 维护者本机迁移（用户确认后，先备份旧 home 与旧 userData）：主机列表、设置、草稿、面板布局、工作区与 Agent 历史原样，旧 home 路径是符号链接
- [ ] `docs/qa.md` 矩阵余下条目逐项附证据；原生端条目注明免验收
- [ ] 发布前置（GitHub 已脱离 fork 网络、Cloudflare 基建、安卓 Secrets）复核仍有效
- [ ] 1.0.0 发布说明草稿的"待定事项"清空：每条要么已解决，要么写进升级段
