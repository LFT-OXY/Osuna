# 终端体验对比：Paseo（当前项目）vs orca

日期：2026-09-17
范围：仅 macOS desktop；只覆盖用户实际遇到的三个问题。手机端、输入延迟、复制粘贴等未纳入。
orca 路径：`/Users/oxy/Documents/Configuration/dev-environment/demo/源码/orca`（下文记为 `ORCA`）。

## 用户报告的现象

1. TUI 画面左侧贴边、右侧留空（Pi 截图）。
2. 浅色主题下 Codex 输入框纯黑，文字不可见。
3. 终端整体"泛白"、对比度低（Pi 截图里警告文字几乎看不见）。

## 根因

### 现象 2 与 3：daemon 把终端背景色永远报告为黑色

TUI（Codex、Pi、Claude Code 等）启动时用 `OSC 11 ; ?` 查询终端背景色，据此选择深色或浅色配色。

Paseo 的应答链路：

- 浏览器端 xterm 明确不回答任何终端查询：`packages/app/src/terminal/runtime/terminal-emulator-runtime.ts` 的 `registerProtocolQuerySuppression` 把 OSC 10/11/12 的 `?` 查询吞掉。
- daemon 侧 headless xterm 代为应答，但值写死：`packages/server/src/terminal/terminal.ts:24`
  ```ts
  const TERMINAL_OSC_COLOR_QUERY_RESPONSES = new Map([
    [10, "rgb:e6e6/e6e6/e6e6"], // 前景 浅灰
    [11, "rgb:0b0b/0b0b/0b0b"], // 背景 近黑
    [12, "rgb:e6e6/e6e6/e6e6"],
  ]);
  ```
- 协议里 `create_terminal_request` / `subscribe_terminal_request` 没有任何字段携带客户端的终端颜色（`packages/protocol/src/messages.ts:2910`、`:2965`），daemon 无从得知客户端是浅色还是深色。

结果：无论 app 主题如何，TUI 都被告知"背景近黑"，于是按深色方案渲染。Codex 的输入框深色底就是这样来的；Pi 在白底上用深色方案的浅色文字，就是"泛白、对比度低"。

另外三个缺口会让修复不完整：

- Paseo 不处理 `OSC 4 ; n ; ?`（256 色调色板查询），TUI 拿不到 ANSI 色值。
- Paseo 不回答 `CSI ? 996 n`（color-scheme 查询，Codex/ratatui 系新版会先发这个）。
- Paseo 不处理 `DECSET 2031`（主题变更订阅），用户在 app 里切换深浅主题时，已运行的 TUI 不会收到 `CSI ? 997 ; 1|2 n`，仍停留在旧配色。

浅色调色板本身还有一个独立缺陷：`packages/app/src/styles/theme.ts:237` 把 ANSI `white` 定义为 `#ffffff`，与白色背景相同，任何用 white 的输出在浅色主题下不可见。客户端 xterm 的 `minimumContrastRatio` 为 1（`terminal-emulator-runtime.ts` 的 Terminal 选项），即关闭了 xterm 的自动对比度修正。

### 现象 1：宿主容器无内边距，fit 余量全落在右侧

`packages/app/src/components/terminal-emulator.tsx:63` 的 `HOST_DIV_STYLE` 四边 padding 为 0。FitAddon 按容器宽度取整数列数，剩余不足一列的像素加上 8px 滚动条预留全部留在右侧，于是左贴边、右留白。这是布局问题，不是 resize 逻辑问题。

## orca 的做法

### 主题信息桥（对应现象 2、3）

orca 把这个问题命名为"默认黑 OSC-11 bug"，专门做了一层"view-attribute bridge"：

| 环节         | 位置                                                                                    | 要点                                                                                                                                                                               |
| ------------ | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 数据结构     | `ORCA/src/shared/terminal-view-attributes.ts`                                           | 一个 app 级快照：`foreground`、`background`、`cursor`、256 项 `ansi`、`colorSchemeMode`、光标样式。值相等判定用于去重。                                                            |
| 渲染层推送   | `ORCA/src/renderer/src/components/terminal-pane/terminal-view-attributes-publisher.ts`  | 每次应用终端外观时，按 xterm ThemeService 的规则把 ITheme 解析成 RGB（含默认值、cursor alpha 混合、256 色尾巴），模块级去重后推给主进程。                                          |
| 主进程存储   | `ORCA/src/main/runtime/terminal-view-attribute-store.ts`                                | 单例快照，最后一次推送生效；相同快照不触发应用器。**首次推送前为 null，null 时对所有颜色查询保持沉默**，注释明确写着"伪造默认值会复活默认黑 bug"。                                 |
| daemon 应答  | `ORCA/src/main/daemon/terminal-view-attribute-responder.ts`                             | 处理 OSC 4/10/11/12 查询与 SET、OSC 104/110/111/112 恢复、`CSI ?996n`。回复格式与可见 xterm 字节一致（ST 结尾、16 位通道）。`?996n` 按背景/前景相对亮度算深浅，而不是按 app 模式。 |
| 主题变更通知 | `ORCA/src/shared/terminal-color-scheme-protocol.ts` + `terminal-output-side-effects.ts` | 扫描输出流里的 `DECSET 2031` 订阅/退订；app 主题切换时向已订阅的 PTY 写 `CSI ?997;1n`（深）或 `?997;2n`（浅）。                                                                    |
| 对比度       | `ORCA/src/renderer/src/lib/terminal-contrast-correction.ts`                             | `minimumContrastRatio` 按背景亮度取 4.5（浅底）或 3（深底），不按 app 模式；写入前做值比较避免清 xterm 缓存。                                                                      |

设计上值得照搬的三条不变量：

1. 没收到客户端颜色前不应答，宁可沉默也不猜。
2. TUI 用 OSC SET 改过的颜色要保留，主题重新推送时才整体覆盖。
3. 深浅判定用相对亮度，而不是 app 的 light/dark 开关。

### 内边距（对应现象 1）

`ORCA/src/renderer/src/assets/terminal.css:507`：

```css
.xterm-container {
  width: calc(100% - var(--pane-padding-x, 4px));
  height: calc(100% - var(--pane-padding-y, 4px));
  margin-top: var(--pane-padding-y, 4px);
  margin-left: var(--pane-padding-x, 4px);
}
```

默认 4px，用户可通过 `terminalPaddingX/Y` 设置或 Ghostty 配置导入覆盖（`ORCA/src/shared/global-settings-types.ts:153`、`ORCA/src/main/ghostty/mapper.ts:164`）。滚动条宽度 7px 作为 gutter 由 FitAddon 预留（`ORCA/src/renderer/src/lib/pane-manager/pane-terminal-options.ts:58`）。

注意 orca 只做了左/上 margin，右/下靠 width/height 减法保证等距。fit 取整的余量仍在右侧，但因为左右都有至少 4px 基线，视觉上不再"贴边"。

## 差异矩阵

| 能力                                 | Paseo                 | orca                                              |
| ------------------------------------ | --------------------- | ------------------------------------------------- |
| OSC 10/11/12 查询应答                | daemon 写死深色       | 按渲染层推送的真实颜色应答                        |
| 未知主题时的行为                     | 仍答黑色              | 沉默                                              |
| OSC 4 调色板查询                     | 不处理                | 按 256 项调色板应答                               |
| OSC SET 覆盖与 104/110/111/112 恢复  | 不处理                | 每 PTY 覆盖层                                     |
| `CSI ?996n`                          | 不处理                | 按亮度应答                                        |
| `DECSET 2031` + `?997n` 主题变更推送 | 不处理                | 支持                                              |
| minimumContrastRatio                 | 固定 1（关闭）        | 浅底 4.5 / 深底 3，可覆盖                         |
| 浅色 ANSI white                      | `#ffffff`，与白底同色 | 由内置主题保证可读                                |
| 终端内边距                           | 0                     | 默认 4px，可配置                                  |
| 多客户端颜色冲突                     | 无此概念              | 单窗口桌面应用，最后推送生效；远程 web 端为空实现 |

## 与 Paseo 架构的适配点

orca 是单进程 Electron，渲染层直连主进程；Paseo 是 daemon + 多客户端（desktop、浏览器、手机），差异集中在两处：

1. **颜色从哪来**：需要一个新的可选协议字段把客户端终端的前景/背景/ANSI 16 色送到 daemon。放在 `subscribe_terminal_request` 或独立的 `terminal.view.attributes.update.request`（按 `docs/rpc-namespacing.md` 命名）。老客户端不发，daemon 保持沉默，等同 orca 的 null 策略。
2. **多客户端谁说了算**：已决定复用尺寸所有权（`packages/server/src/terminal/terminal-size-ownership.ts`）：持有 PTY 尺寸 claim 的连接的颜色生效。orca 没有这个问题，无可参考。

## 用户已做的决定（本次访谈）

- 不做独立的终端主题选择器；终端继续跟随 app 主题，只需把真实前景/背景色告诉 TUI。
- 颜色来源采用"客户端推送给 daemon"，不采用"daemon 不应答"。
- 多客户端冲突跟随尺寸所有者。
- 先只锁定 macOS desktop。

- 主题桥做到"中等"层：OSC 10/11/12 应答 + `CSI ?996n` 应答 + `DECSET 2031` 订阅与 `?997n` 主题变更推送。不做 OSC 4 调色板查询，不做 OSC SET 覆盖层。
- 内边距取固定的设计系统 spacing token，不做设置项。
- 对比度修正一并做：xterm `minimumContrastRatio` 按背景亮度取 4.5（浅底）/ 3（深底）；修正浅色调色板 ANSI white 与白底同色。

## 写 PRD 时要用到的 Paseo 接口事实

- 尺寸所有权：`packages/server/src/terminal/terminal-size-ownership.ts` 的 `applyTerminalSize(terminal, owner, request)`，owner 是连接对象（`terminal-session-controller.ts:266` 传入的 `source`），以 WeakMap 存储。intent 为 `claim` 时转移所有权，`update` 时非所有者被忽略。
- resize 走 `TerminalClientMessageSchema`（`packages/protocol/src/messages.ts` 中 `subscribe_terminal_request` 之后的 discriminatedUnion），随终端输入的二进制帧发送，不在 `subscribe_terminal_request` 里。客户端在 attach 时先发一次 `claim` resize（`packages/app/src/terminal/runtime/terminal-stream-controller.ts:80`），再订阅。视图属性沿同一通道发送最贴合现有结构。
- 客户端主题来源：`packages/app/src/utils/to-xterm-theme.ts` 把 app 主题的 `colors.terminal` 映射为 xterm ITheme；`terminal-emulator.tsx` 已按 ITheme 变化重新应用主题，可在同一处推送视图属性。
- daemon 侧 OSC 应答在 headless xterm 的 parser 上注册（`packages/server/src/terminal/terminal.ts:1044`），该 xterm 运行在终端 worker 进程中。worker 协议已有 `send` 消息把 `ClientMessage`（含 resize）转发给终端会话（`terminal-worker-protocol.ts:94`），新的视图属性消息若定义为 `ClientMessage` 的一种，可沿 `send` 直达 worker，不必新增 worker 协议类型。
