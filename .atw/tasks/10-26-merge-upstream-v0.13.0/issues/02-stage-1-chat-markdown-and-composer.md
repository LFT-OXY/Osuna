# 02 — 第一段适配：聊天 Markdown 与 Composer

**What to build:** 聊天消息用上游的新渲染器显示，Osuna 的样式（代码块语言标签头、复制按钮、语法主题着色）迁到上游新的样式位置；在电脑上看，聊天里的代码块与合并前一样。手机端收下上游的全屏写消息：它依赖的测高模块只在原生端恢复，范围以全屏编辑实际用到的为限；Web 与 Electron 仍是 Tiptap。规格见 `prd.md`「Markdown」「Composer」，决定见 `research/discovery.md` 第 7 条。

**Blocked by:** 01
**Status:** ready-for-agent
**Impl:** ready

- [ ] Web 上聊天的代码块有语言标签头与复制按钮，按当前语法主题上色；高亮代码块组件的现有测试通过。
- [ ] 上游新渲染器的跨段选择、表格横滑、代码块复制照收；上游渲染器的测试通过。
- [ ] 手机端代码块失去语言标签头，接受，记在 `## Comments` 下供 PR 正文用。
- [ ] 测高模块只在原生端恢复，Web 端的打包里不含它；原生端 typecheck 与 Composer 相关单元测试通过。手机端免验收。
- [ ] 上游新用例里按 textarea 读 Composer 的，改成读 contenteditable 的文字；Web 端 Tiptap 的浏览器测试通过。
- [ ] typecheck 和 lint 通过；改到的测试文件逐个单独跑过并通过（不跑整套）。
- [ ] 没有 Osuna 的断言被删除或放宽；必须跟着改的断言逐条记在 `## Comments` 下，供 14 写 PR 正文用。
- [ ] UI：dev 桌面端 1280 宽 / 聊天里一条带代码块与表格的回复 — 截图上代码块有语言名与复制按钮、代码着色，表格完整显示。
