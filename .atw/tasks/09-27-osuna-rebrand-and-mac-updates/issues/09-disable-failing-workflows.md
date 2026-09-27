# 09 — 停用 fork 下必然失败的工作流触发

**What to build:** 推 tag 或者推到 main 时，Actions 页面上不再出现 Android APK、Web app 部署、网站部署、relay 部署这四条必然失败的运行。这四个工作流去掉 tag 和 push 触发，只保留手动触发，工作流文件本身不删。

**Blocked by:** None — can start immediately
**Status:** ready-for-agent
**Impl:** ready

- [ ] 四个工作流只剩手动触发，YAML 能被 GitHub 正常解析（推送后 Actions 页面不报 workflow 语法错误）
- [ ] 其余工作流（Desktop Release、Docker、CI 等）的触发条件没有变化
