# 07 — Composer

**What to build:** Composer 成为页面上最明显的操作入口：圆角 22、低透明度 1px 描边，亮色用 Composer 阴影、暗色用顶部内高光，Web / Electron 带毛玻璃；Composer toolbar 左侧 Agent controls 为 28 高幽灵按钮，右侧附件按钮、上下文占用、32 圆形停止与发送按钮（运行中两者同时出现，发送沿用现有的运行中发送设置）；新增只读的上下文信息条（工作区类型、分支、host）附着在 Composer 底部。窄 pane 时左侧控件截断，发送与停止按钮不被压缩或遮挡。

**Blocked by:** 02 — Text、Row 组件与左侧栏；03 — 通用控件与浮层
**Status:** ready-for-agent
**Impl:** done

- [x] 分屏窄 pane 下发送与停止按钮完整可见、可点击
- [x] 键盘快捷键、附件、语音等 Composer 现有行为不变
- [ ] 原生端为不透明表面，键盘弹出时布局不回退（未验证，2026-09-27 用户决定作为已知缺口接受：没有 iOS / Android 模拟器或真机证据）
- [x] 该区域 Electron 桌面端亮色与暗色截图与原型观感一致，截图作为证据附在本票 Comments
- [ ] 该区域中断言 CSS 值或几何尺寸的 e2e 已随设计更新，且在 CI 上通过
- [x] testID 与英文 UI 文案逐字未变
- [x] docs/design.md 等设计文档中对应章节已改写（改写过时内容，不在末尾追加）
- [x] typecheck 与 lint 通过

## Comments

### 2026-09-26 — 实现记录与视觉证据

实现中由用户决定的两点：
- 智能体面板的 Composer 下原本没有上下文信息条。用户选择新增只读条，显示工作区类型、分支和 host，只在工作区 pane（智能体面板、草稿 tab）且非手机布局时出现。
- 运行中 Stop 与 Send 同时出现，Send 与 Enter 仍按现有的运行中发送设置执行（默认 steer），不强制排队。工单原文与 PRD 已据此改写。

Electron 桌面端证据：
- 启动方式：dev，`FORCE_COLOR=3 PASEO_LISTEN=127.0.0.1:6769 npm run dev --workspace=@getpaseo/desktop`。
- 数据：先在临时 git 仓库里用 mock `ten-second-stream` 跑一轮，再 `send --no-wait` 发一轮让它运行，同时在 Composer 里填草稿。
- 截图：用 Playwright CDP 截图并读取计算样式。
- 截图文件：[暗色（运行中 + 草稿）](../evidence/07-electron-dark-composer.jpg)、[亮色](../evidence/07-electron-light-composer.jpg)
- 计算样式：
  - 表面：两种配色都是圆角 22px、`blur(12px) saturate(1.14)`。
    - 暗色：底色 `rgba(17, 17, 17, 0.8)`，描边 `rgba(245, 245, 245, 0.09)`，阴影透明，内高光 `rgba(255, 255, 255, 0.04)`。
    - 亮色：底色 `rgba(255, 255, 255, 0.8)`，描边 `rgba(39, 39, 42, 0.09)`，阴影 `rgba(0, 0, 0, 0.4) 0 12px 28px -18px`。
  - 按钮：Agent controls 高 28、圆角 8px；附件、听写、语音为 28×28、圆角 8px；Send 为 32×32 圆。
  - 上下文条：高 28，底色 `rgb(23, 23, 23)`（暗色 `surface2`），底部圆角 14px。
- 与原型（`osuna-ui-prototype.html`）对照：
  - 一致：
    - 圆角 22 与 9% 描边。
    - 亮色投影、暗色内高光。
    - 毛玻璃。
    - 左侧幽灵按钮。
    - 右侧顺序为附件、上下文占用、Stop、Send。
    - Stop 为前景色实心圆，Send 为 accent 圆。
    - 上下文条两侧收进、贴在 Composer 底边。
  - 有差异、保留现状：
    - 上下文条高 28（原型 30），描边与 Composer 同为 9%（原型 7%），都取现有 token。
    - 本机 host 按徽标设置默认隐藏，所以条的右侧默认为空（原型写的是 "Local"）。
    - 听写与实时语音按钮原型里没有，保留在上下文占用与 Stop 之间。
    - Agent controls 悬停时只加底色，文字不变为主色。
    - 上下文占用图标仍为 16（原型 18）。
    - 输入区内边距为 12 / 16 / 8（原型 14 / 18 / 6），最小高度沿用原值。

实现形态：
- 表面：`composerSurfaceStyle`（`styles/floating-surface.ts`），新增派生角色 `borderComposer`（前景色 9%，所有主题与插件主题自动获得）。
- Stop / Send：由 `resolvePrimaryActions`（`composer/input/state.ts`）决定。运行中 Stop 常驻；有草稿时 Send 出现在右边；运行中提交进行时不会出现第二个可中断按钮。
- 工具栏布局：
  - 附件按钮移到右组，附件菜单改为 `align="end"`。
  - 右组不参与压缩；左组 `overflow: hidden`，窄 pane 下由 agent controls 截断。
  - GitHub issue/PR 选择器仍用 `top-start` 锚在附件按钮上，由 Combobox 夹在窗口内。
- 上下文条：`composer/context-strip/`。工作区类型按 daemon `deriveWorkspaceKind` 的规则由 git 状态推出（`mainRepoRoot` 决定是否为 worktree）；新增 `composer.context.{worktree,local}`，9 个语言都已补上。
- Agent controls：`AgentControlTrigger` 与 provider 徽标、features 按钮、模型选择器默认触发器统一为 28 高、圆角 8、`interactionHighlight`；toolbar 文字改为 `<Text variant="label">`。
- `useUnistyles()` 清理：`agent-controls/index.tsx` 里的 4 处全部去掉。开关类功能图标色改为 `iconColorMapping`，经 leaf `withUnistyles(ControlIcon)` 给出。

测试：
- 单测：
  - `state.test.ts` 新增 5 条 Stop / Send 用例。
  - `context-strip/model.test.ts` 新增 6 条。
  - `theme.test.ts` 新增 `borderComposer` 字面值，并把它加入全目录角色断言。
  - 以上连同 composer、styles、i18n，共 379 条，全部通过。
- browser：`floating-surface.browser.test.tsx` 新增 `composerSurfaceStyle` 的毛玻璃与原生不透明两条；连同 composer 与 ui 目录，共 55 条，全部通过。
- e2e 本地定向：
  - `agent-message-submission` 新增 "keeps Stop and Send whole and clickable in a narrow split pane"：视口 1024 加分屏，Composer 宽度小于 500；Stop / Send 都是 32×32，完整落在 Composer 内，中心点命中自身；依次点击 Send 与 Stop。
  - "keeps one Stop action…" 中有草稿时的 Stop 计数由 0 改为 1。
  - 另跑了 `composer-attachments`、`composer-autocomplete`、`new-workspace-meta-row-layout`。
  - 以上全部通过；全量 e2e 待 CI。
- 本地 `format:check` 只报 `screens/settings/host-page.tsx`，是本票之前就有的问题，本票没有改动它。

未验证：
- 原生端没有真机或模拟器证据。代码路径上 `GLASS_SURFACES_ENABLED` 为 false 时是不透明的 `surfaceCard`，`KeyboardTranslateView` 未改，但对应验收项没有勾选。
- 全量 e2e 待 CI，对应验收项没有勾选。

