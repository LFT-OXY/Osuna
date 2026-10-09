# 02 — Electron 渲染层存储跨 origin 迁移（paseo://app → osuna://app）

**Type:** research
**Blocked by:** None
**Status:** resolved

## Question

桌面端渲染器从 `paseo://app` 加载（`packages/desktop/src/main.ts`，`registerSchemesAsPrivileged` / `protocol.handle`），主机列表、设置等存在该 origin 的 localStorage / IndexedDB / AsyncStorage 里。改成 `osuna://app` 后 Chromium 视为另一个 origin，数据不可见。要在 1.0.0 首启无感迁移。

查清并给出推荐方案：

1. 渲染层到底存了什么、用什么 API：盘点 `packages/app/src` 里 web 端持久化（`localStorage`、`@react-native-async-storage/async-storage` web 实现、IndexedDB、`expo-secure-store` web 回退等），列出键名与大致体积。
2. 方案比较：(a) 主进程开隐藏 `BrowserWindow` 加载 `paseo://app` 上的一段导出脚本，把存储序列化后经 IPC 交给主进程，再开隐藏窗口加载 `osuna://app` 导入；(b) 直接操作 userData 下 Chromium 的 `Local Storage/leveldb` 与 `IndexedDB/` 目录，按 origin 改名（查 Electron / Chromium 对此的支持与风险）；(c) Electron `session` / `protocol` 层是否有把两个 scheme 映射到同一 storage partition 的办法（如 `partition`、`protocol.registerSchemesAsPrivileged` 的 `standard`/`secure` 与 origin 计算）。
3. 推荐方案的失败模式：导出脚本跑在旧 origin 时若渲染器代码已改名找不到键怎么办；迁移一半崩溃如何幂等重试；迁移完成标记放哪。
4. 顺带确认 Electron userData 目录 `Paseo`→`Osuna` 用 `fs.rename` 在 macOS / Windows / Linux 的注意点（Windows 上目录被占用、macOS 日志目录 `~/Library/Logs/Paseo`）。

产出 `research/renderer-storage-migration.md`：键名清单、三方案对比、推荐方案与伪代码级步骤。

## Answer

- 推荐方案 a：主进程在首个窗口创建前开隐藏 `BrowserWindow`，从 `paseo://app` 导出、写入 `osuna://app`；两个 scheme 同时登记为 privileged，`paseo` 处理器只服务内联导出页，标 `COMPAT` 到期删除。
- 方案 b 不可行：Local Storage 的 origin 编在每条 leveldb 键里（`_paseo://app\x00…`，块经 Snappy 压缩），IndexedDB 库内键也含 origin，格式随 Chromium 版本变。方案 c 不存在：storage key 由 origin 决定，Electron/Chromium 无别名机制。
- 导出端枚举全部 `localStorage` 键与 `indexedDB.databases()`，不依赖键名；键名改名（`@paseo:`→`@osuna:` 等）只在导入端查表完成，所以"渲染器改名后找不到键"不成立。
- 幂等：导入前 `clearStorageData({origin:"osuna://app"})` 整体替换；标记在新 userData 的 `desktop-settings.json` → `migrations`；失败 3 次封顶；旧 origin 数据永不删除。
- 导出窗口必须是顶层窗口（Chromium 115+ 第三方存储分区会让 iframe 看到空存储）；Blob 值要转 ArrayBuffer 过 IPC。
- userData 改名要在 electron-log 第一次写日志之前做，否则 Windows/Linux 上 `Osuna/logs` 先被建出来导致 rename 失败；macOS 旧日志目录 `~/Library/Logs/Paseo` 不动。
- 待定：与上游 Paseo.app 并存的机器上 move 会掏空上游数据（Q6c 与 ADR 0002 冲突）；存储键/分区字符串是否改名归 07 号工单。
- 详见 `research/renderer-storage-migration.md`（键清单、三方案对比、伪代码步骤、失败模式、平台注意点、外部依据）。

## Comments

### 2026-10-09 被 08 号票订正

- L1 失败处理"本次空启动、下次重试、3 次封顶"**作废**：空启动会写出 `desktop-settings.json`，让 `hasRealData(newDir)` 变真，之后永不重试。改为阻止启动 + `dialog.showErrorBox` + 每次启动重试、无上限（08 号票第 5 条）。
- L2 失败"3 次封顶"**作废**：改为对话框「重试 / 放弃旧数据继续」，后者写 done 标记（08 号票第 6 条）。`migrations` 里的两个 `*Attempts` 计数字段不要。
- 两个待定项已定：并存机器接受上游 App 丢 userData（第 11 条）；COMPAT 到期 2027-10-09 或 2.0.0（第 10 条）。
- `~/.paseo` 搬迁归 daemon，原位留符号链接（第 1、2 条）；本票的 userData 层不变。
