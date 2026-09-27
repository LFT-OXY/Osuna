# 09 — 停用 fork 下必然失败的工作流触发

**What to build:** 推 tag 或者推到 main 时，Actions 页面上不再出现 Android APK、Web app 部署、网站部署、relay 部署这四条必然失败的运行。这四个工作流去掉 tag 和 push 触发，只保留手动触发，工作流文件本身不删。

**Blocked by:** None — can start immediately
**Status:** ready-for-agent
**Impl:** doing

- [ ] 四个工作流只剩手动触发，YAML 能被 GitHub 正常解析（推送后 Actions 页面不报 workflow 语法错误）
- [x] 其余工作流（Desktop Release、Docker、CI 等）的触发条件没有变化

## Comments

**实现结论（2026-09-27）**

- `android-apk-release.yml`、`deploy-app.yml`、`deploy-website.yml` 的 `on:` 只剩 `workflow_dispatch`，各加一行中文注释说明原因（依赖上游 EAS / Cloudflare 账号）。`deploy-relay.yml` 在基点上已经只有手动触发，没动。
- `deploy-website` 原先还挂着 `release: published`：Desktop Release 发布草稿时会触发，在 fork 下同样必然失败，按「只保留手动触发」一并去掉。
- 有意保留的死分支：`deploy-website` 的 job `if`（判断 release 事件）、`android-apk-release` 里 `github.event_name == 'workflow_dispatch' && inputs.tag || github.ref` 的兜底。手动派发下它们恒走同一支，不影响运行；保留是为了把触发加回来时只改 `on:`，也少和上游冲突。评审两轴都认可保留。
- `docs/release.md` 的 fork 分发章节补一段：这四个工作流在 fork 下只手动触发，文件保留供自建。上游章节里关于 APK / 网站触发的描述属于上游发布路径，不改。
- 验证：用 `yaml` 包解析全部 12 个工作流通过，四个工作流的触发只剩 `workflow_dispatch`，其余 8 个的触发与基点一致；没有工作流通过 `workflow_run` / `workflow_call` 引用这四个；改动文件 oxfmt 检查通过。纯 YAML 与文档改动，不涉及 typecheck 和单测。
- 待确认：第一条验收里「推送后 Actions 页面不报 workflow 语法错误」要推送后才能确认，Impl 保持 doing。
