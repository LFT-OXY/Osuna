# 02 — 作用域三档、搜索与刷新

**What to build:** 面板顶部可在 workspace / project / host 三档作用域间切换，默认 project 且记住上次选择；project 作用域列出该 project 在当前 host 上所有活动 workspace（含 worktree）的会话且无重复，host 作用域列出整个 host；project 与 host 下行内显示会话目录相对项目根的路径。顶部搜索框按标题与提示词预览过滤；切回窗口自动刷新，另有手动刷新按钮；某个 Provider 查询失败时其他会话照常显示，并在列表上方看到可收起的失败说明。

**Impl:** ready
**Status:** ready-for-agent

**Blocked by:** 01

- [ ] 作用域偏好按设备全局持久化，默认 `project`
- [ ] `workspace`：单次请求带当前 cwd；`project`：对该 project 在当前 host 的每个活动 workspace cwd 各请求一次，客户端按 `providerId + providerHandleId` 去重合并；`host`：单次请求不带 cwd
- [ ] project 与 host 作用域下行内显示相对项目根的目录；cwd 在项目根之外时显示完整路径
- [ ] 搜索在客户端进行，匹配标题、首条与末条提示词预览；不向 daemon 传 query；空结果与"该作用域没有会话"文案区分
- [ ] 刷新：查询挂载、窗口重获焦点、手动按钮；不轮询
- [ ] `providerErrors` 非空时列表上方一条可收起警示，列出 Provider 名与原始错误（原始错误不翻译）
- [ ] 文案走 i18n，九个 locale 同步
- [ ] 测试：组件测试覆盖三档请求参数、去重、相对目录、搜索过滤、错误警示
- [ ] `npm run typecheck`、`npm run lint` 通过
