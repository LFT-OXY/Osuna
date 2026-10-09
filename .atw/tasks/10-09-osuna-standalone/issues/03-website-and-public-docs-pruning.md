# 03 — 官网与 Public docs 结构裁剪

**What to build:** 官网访客只会看到首页、下载页、Public docs、更新日志、隐私、条款六类页面；Public docs 里没有上游社区项目、没有 SDK 文档，插件文档只有一套当前 API 不分版本。本票只删与挪，不改文案（文案改写在后续票）。

**Blocked by:** 01
**Status:** ready-for-agent
**Impl:** done

- [x] 官网删除约 45 个按代理名的 SEO 落地页与 `/agents` 索引、7 篇替代品对比页、博客路由与 posts 目录、赞助页、首页推荐语跑马灯与头像图片；页眉页脚对应链接删除；预渲染路由与 sitemap 同步
- [x] `llms.txt` 删除 agents 与 alternatives 两节，文档节保留
- [x] Public docs 删除 `community.md` 与 `sdk/` 整目录
- [x] 插件文档去分版：删 `plugins/v0.7/` 整目录与 v0.8 迁移指南；v0.8 的 index / reference / providers 上提为 `plugins/` 下三篇；删版本选择页、旧 URL 重定向表；双版本导航测试改为断言单套树；内部 `docs/plugins.md` 的链接随改
- [x] 官网 `vite build` 成功，官网 vitest 全绿，`npm run typecheck`、`npm run lint` 全绿
