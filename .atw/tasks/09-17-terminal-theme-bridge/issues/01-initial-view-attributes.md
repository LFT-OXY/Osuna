# 01 — 首帧颜色：创建终端时携带视图属性，daemon 据此回答颜色查询

**What to build:** 浅色主题的 desktop 用户通过 Terminal profile 启动 Codex 或 Pi 时，TUI 从第一帧起就按浅色方案渲染：输入框是浅色底、提示文字对比度正常。深色主题下表现与现在一致。连接旧 daemon 的新客户端和连接新 daemon 的旧客户端都不受影响。

**Status:** ready-for-agent
**Impl:** done

**Blocked by:** None — can start immediately

## 范围

- 协议：`create_terminal_request` 增加可选的视图属性字段（前景、背景、光标，`#rrggbb`）；`server_info.features` 增加能力位；wire schema 保持纯 zod，重新生成入站校验。
- daemon：终端会话保存创建时收到的视图属性；OSC 10/11/12 的 `?` 查询用真实值回复，字节格式与现有回复一致；`CSI ?996n` 按背景/前景相对亮度回复 `?997;1n`（深）或 `?997;2n`（浅）；未收到视图属性时这些查询一律消费但不回复，删除写死的默认色。回复仍直接写 PTY。
- 客户端：创建终端时把当前 xterm 主题的三色转成 `#rrggbb` 随请求发送；仅当能力位为真时附带，COMPAT 打标签并写移除日期。
- 覆盖所有创建终端的入口（工作区新建 tab、New Workspace 启动目标、Terminal profile 菜单）。

## 验收

- [ ] 浅色主题下通过 Terminal profile 启动 Codex，输入框第一帧即浅色底、文字可读；Pi 提示文字对比度正常。
- [ ] 深色主题下 Codex 与 Pi 表现与修改前一致。
- [x] 真实 PTY 测试：带视图属性创建时前台 helper 收到对应 rgb 的 OSC 11 回复；不带时 helper 超时（无回复）；`?996n` 按亮度回复深/浅。
- [x] 协议 schema 测试：不带新字段的创建请求仍能解析；带字段能解析。
- [x] 客户端单元测试：能力位为假时创建请求不带视图属性；为真时带且值为当前主题三色。
- [x] 现有 OSC 11 用例更新为新语义，不再断言写死的黑色。
- [x] `npm run typecheck`、`npm run lint` 通过；`npm run build:client` 后 server 类型无 stale 错误。
