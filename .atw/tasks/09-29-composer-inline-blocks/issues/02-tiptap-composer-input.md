# 02 — Web/Electron 输入框换成 Tiptap（纯文字，行为不变）

**What to build:**
- 前置重构。为 Composer 单独做一个 Tiptap 3 的 Web 文本输入（Metro 平台扩展名分开，Electron 走同一实现），对外保持现有 imperative handle 与回调契约（取文字、替换文字与选区、选区变化、按键拦截、聚焦、高度）。
- 只替换 Composer；查找、重命名等其他使用共享文本输入的地方不动。原生端不动。
- 本工单不引入块，用户看到的行为与现在一致。

**Blocked by:** None — can start immediately
**Status:** ready-for-agent
**Impl:** done

- [x] 所有使用 `Composer` 的界面（agent 面板、草稿 tab、新建工作区页、工作区设置弹窗）都用新输入。——四处都经 `MessageInput` 渲染同一个输入；agent 面板与新建工作区页有 e2e 覆盖，工作区设置弹窗未单独手测。
- [x] 无回归：IME 组字、Enter 发送与 Shift+Enter 换行、Command menu 与 `@` 列表的触发与键盘导航、粘贴 / 拖拽图片与文件进 Attachment tray、语音输入插入、随内容长高与最大高度、placeholder、聚焦快捷键、`preserve-and-lock` 提交锁定、只读模式、Skill chip 的退格删除。
- [x] 现有 composer 相关 Playwright e2e 与 browser 测试通过（需要改测试选择器时只改定位方式，不改断言含义）。——本机跑过 12 个相关 e2e 文件，唯一失败是 `new-workspace-entry` 的 Ctrl+P（macOS 上绑定为 Cmd+P，与本工单无关）；全量以 CI 为准。三处用例改用 Tiptap 的 `element.editor` 在同一 tick 改草稿，断言不变。
- [x] Electron 上中文输入法组字 QA 截图。——用户用豆包拼音手打：组字中 `ni'hao` 带下划线显示、选字上屏、Shift+Enter 换行、组字中 Enter 只确认字母不发送，事件记录与截图均符合预期。
- [x] 报告 Web 包体积增量。——未压缩 +402 KB，gzip +115 KB，brotli +95 KB。
- [x] `npm run typecheck`、`npm run lint` 通过。
