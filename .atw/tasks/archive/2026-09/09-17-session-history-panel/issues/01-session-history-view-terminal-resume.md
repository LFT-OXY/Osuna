# 01 — 会话历史视图骨架：当前 workspace 的外部会话，点击在终端恢复

**What to build:** 用户在 Explorer sidebar 切到"会话历史"视图，看到当前 workspace 目录下由各 Provider 留下的会话（终端里直接跑的 claude / codex 等），每行有标题、Provider 图标、相对时间，按最后活动倒序；点击一行，当前 workspace 新开一个终端 tab，进程就是该 Provider 的 resume 命令，cwd 为会话目录。手机的紧凑布局从 Explorer 覆盖层同样可达。

**Impl:** done
**Status:** ready-for-agent

**Blocked by:** None — can start immediately

- [x] Explorer sidebar 新增 `sessions` 视图与对应的仅 explorer 宿主单例 tab target；桌面 tab rail 上下文菜单、New Tab 启动器、紧凑覆盖层分段控件三处入口都能进入
- [x] 用现有 `fetch_recent_provider_sessions` 按当前 workspace 的 cwd 取数，limit 取协议上限；react-query 管理
- [x] 只列出有 resume 命令模板的 Provider；模板表补 `copilot --resume=<id>`
- [x] 行内：标题（会话标题 → 首条提示词预览 → Provider 名称）、Provider 图标、相对时间；按最后活动倒序
- [x] 点击行：用现有终端创建通道创建终端，`cwd` 为会话目录、`command/args` 来自模板表、终端名为会话标题、携带当前主题 view attributes；新 tab 在当前 workspace 打开
- [x] host 断开复用现有断开包装态；空列表有空态文案
- [x] 全部文案通过 i18n，九个 locale 补 key，资源平价测试通过
- [x] 测试：面板组件 + 假 DaemonClient（取数参数、行渲染、排序、无模板 Provider 过滤、点击创建终端的参数）；模板表 copilot 用例；Explorer 视图与 panel manifest 测试加新视图
- [x] `npm run typecheck`、`npm run lint` 通过
