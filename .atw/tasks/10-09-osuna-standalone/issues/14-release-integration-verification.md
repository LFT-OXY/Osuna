# 14 — 1.0.0 集成验证

**What to build:** 所有前序票合在一起后，CI 全绿、三条部署链路实际上线、安卓工作流产出签名包、桌面打包可用，QA 矩阵逐项有证据；只有这张票承诺整体绿（expand–contract 的最终 integrate-and-verify 票）。不含实际发版，发版走 release playbook。

**Blocked by:** 12, 13
**Status:** ready-for-agent
**Impl:** ready

- [ ] CI 全部必需检查绿，含守线检查、Docker 与 nix 工作流
- [ ] `deploy-app` / `deploy-relay` / `deploy-website` 在 main 上跑通：`osuna-relay.chinhae.cc/health` 200，`osuna-app.chinhae.cc` 能打开网页端并完成一次配对，`osuna.chinhae.cc` 首页 / 下载页 / 文档 / schema URL 均 200
- [ ] `android-apk-release.yml` 在预发布标签上跑通，Release 上有 `osuna-<tag>-android.apk`，`apksigner` 指纹等于文档值
- [ ] 桌面打包 smoke（现有 packaged-app smoke）通过；本机从 0.14.x 自动更新到 1.0.0 预发布：主机列表、设置、草稿、面板布局、工作区与 Agent 历史原样，`~/.paseo` 为符号链接，`osuna://` 深链可打开 App，`paseo://app` 旧数据仍在
- [ ] `docs/qa.md` 矩阵逐项附证据；原生端条目注明免验收；版本漂移项（0.14.x 客户端连 1.0.0 daemon）按协议兼容规则核一次
- [ ] 发布前置（GitHub 脱离 fork、Cloudflare 基建、安卓 Secrets）复核仍有效
