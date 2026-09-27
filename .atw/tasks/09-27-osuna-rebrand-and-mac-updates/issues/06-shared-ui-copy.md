# 06 — 共享界面文案改名

**What to build:** 用户在桌面端界面里看到的产品名一律是 Osuna。改动范围包括 9 种语言的翻译文件、硬编码文案，以及 Web 的 manifest 和页面标题。指代手机官方 App 的地方保留 "Paseo"，比如「用手机上的 Paseo 扫码」，依据是 glossary 里的 Osuna / Paseo 词条。`paseo` 命令名、`paseo.json`、`~/.paseo` 这类内部标识不改。手机端的打包配置不动，所以 Web 标题需要找一个不经过手机 app config 的注入点。

**Blocked by:** None — can start immediately
**Status:** ready-for-agent
**Impl:** ready

- [ ] 9 种语言文件里指代本产品的 "Paseo" 都改成 "Osuna"；指代手机官方 App 的条目逐条核对后保留，并在 Comments 里列出保留了哪些
- [ ] i18n 之外的硬编码文案同样处理
- [ ] 命令名、配置文件名、数据目录这类标识在文案里保持原样
- [ ] Web manifest 的 name/short_name、页面标题、apple-mobile-web-app-title 显示 Osuna，手机端的 app config 没有改动
- [ ] 依赖旧文案的单元测试和 e2e 断言已经更新；e2e 失败要和基线对照，本机基线原本就失败的用例单独列出，交给 CI 判断
- [ ] typecheck 与 lint 通过
