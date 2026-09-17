# 02 — 实时跟随：所有者门控的视图属性更新与主题变更通知

**What to build:** 运行中且订阅了 `DECSET 2031` 的 TUI 在用户于 app 里切换深浅主题后立刻跟随换配色，不用重启 agent（Codex、Claude Code 不订阅，需重启）。同一终端被多台设备打开时，配色跟随当前的终端尺寸所有者：焦点切到另一台设备后，TUI 换成那台设备的主题。

**Status:** ready-for-agent
**Impl:** done

**Blocked by:** 01 — 首帧颜色

## 范围

- 协议：终端客户端消息增加"视图属性"类型（与 resize 同一 discriminatedUnion），字段同 01。
- daemon：该消息只接受来自当前尺寸所有者连接的，其它连接静默忽略；沿现有 worker `send` 路径转发到会话，不新增 worker 协议类型；会话更新保存的视图属性。解析 `DECSET 2031` 开启/关闭并记录订阅状态；已订阅且新属性使深浅分类翻转（含从未知变为已知）时，向 PTY 写一次 `CSI ?997;1n` 或 `?997;2n`；分类不变或未订阅不写。
- 客户端：每次发送 `claim` 意图的 resize 后紧接发送一次视图属性；主题对象变化时再发，值相同不重复发；能力位为假时不发。

## 验收

- [x] 首帧取色在深浅两侧都正确：浅色下启动 Codex 输入框为浅色底，切到深色后重启 Codex 输入框为深色底；daemon 在深色下对 OSC 11 回答 `rgb:1818/1b1b/1a1a`（2026-09-17 人工验收）。Codex 不订阅 2031，运行中不跟随，属其自身限制。
- [ ] 浅色下启动 Pi（开启其终端配色通知）或 opencode，切到深色主题，提示文字随之换成深色方案；切回浅色再变回。（待人工验收）
- [ ] Mac 与手机同开一个终端，焦点切到手机后 TUI 按手机主题渲染，切回 Mac 后按 Mac 主题渲染。（待人工验收）
- [x] 真实 PTY 测试：helper 开启 2031 后，更新视图属性使深浅翻转，helper 收到对应 `?997n`；翻转不发生时不收到；未开启 2031 时不收到。另加"创建时无颜色、之后首次收到"也通知一例。
- [x] worker 转发测试：视图属性消息穿过 worker 到达会话（`worker-terminal-manager.test.ts`，用 `captureTerminal` 读 worker 权威输出）。
- [x] 会话控制器测试：非所有者的视图属性被忽略，所有者生效，`claim` 后新所有者生效（`terminal-session-controller.resize.test.ts` 与 `terminal-size-ownership.test.ts`）。
- [x] 流控制器单元测试：attach 时 `claim` 之后紧接视图属性；主题变化时再发；值相同不重复；没有可发送颜色时不发。"能力位为假不发"落在 `daemon-client.test.ts`（门控在 `DaemonClient.sendTerminalViewAttributes`，与工单 01 同层）。
- [x] `npm run typecheck`、`npm run lint` 通过；入站校验已重新生成（`pretypecheck` 钩子）。
