# 12 — 官网首页与下载页换皮

**What to build:** 官网访客在 `osuna.chinhae.cc` 看到中文的 Osuna 首页与下载页，截图是 Osuna 自己的界面，下载直接指向 `LFT-OXY/Osuna` 的 Release；配置文件的 `$schema` 链接能打开（spec 决策 H 与 UI and Design）。沿用现有版式，不改布局与配色。

**Blocked by:** 03, 04, 09
**Status:** ready-for-agent
**Impl:** ready

- [ ] 首页：Osuna 名称与 logo、中文标语与段落、英雄区桌面 / 手机截图换成 Osuna 自己的（替换 `hero-mockup`、`homepage-hero`、`phone-1~3`、`iphone-mockup-left`、`mobile-mockup` 等上游界面图）、删上游专属段落；页眉页脚只留 文档 / 更新日志 / 下载 / 隐私 / 条款；OG 图与 favicon 为 Osuna
- [ ] 下载页：中文；列桌面端各平台包（稳定 / Beta 切换保留）与安卓 APK；Release 源、下载链接、Release API、文档页脚"在 GitHub 上编辑"全部指向 `LFT-OXY/Osuna`
- [ ] 官网托管 `/schemas/osuna.config.v1.json`，内容与 daemon 配置 schema 一致；新增一条测试断言该文件存在且可解析为 JSON Schema
- [ ] 隐私与条款页改为 Osuna 主体，无 Hub 段
- [ ] UI: 首页 / 默认 / 桌面 1280 — 截图无 Paseo 字样、无上游截图、无推荐语、无 Hub 入口
- [ ] UI: 首页 / 默认 / 手机 390 — 同上，且主 CTA 可见不被裁切
- [ ] UI: 下载页 / 稳定与 Beta 两种状态 / 1280 与 390 — 平台包与 APK 列表完整，下载按钮 390 宽不裁切，链接 host 为 github.com/LFT-OXY/Osuna
- [ ] 用现有 Playwright 浏览器项目取两页四张截图作为证据；官网 vitest 与 build 绿；推 main 后线上可访问
