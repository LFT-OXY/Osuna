# 02 — 面板贴合 Composer 顶边

**What to build:** Command menu 与 `@` 列表的面板从 Composer 里"长出来"：左右相对 Composer 内缩（与 Composer context strip 相同），上两角 `radius["3xl"]`、`borderComposer` 描边，底边齐平落在 Composer 顶边上（Portal 在 Composer 之上，无法压到其后，用户已确认），内容在底部约 16 范围渐隐；Web / Electron 为与 Composer 相同的玻璃表面，原生为不透明 `surfaceCard`；最大高度 300 且受 Composer 上方可用空间约束，键盘弹出时跟随。见 PRD「面板外观」。

**Status:** ready-for-agent
**Impl:** done

**Blocked by:** 01

- [x] 仍走现有 Portal / floating-panel host，遵守 `docs/floating-panels.md`（Android、生命周期）
- [x] 不新增颜色 token；深色与插件主题下协调（插件主题未单独截图：面板只读 `composerSurfaceStyle` 与 `surfaceCard` 等主题 token）
- [x] Electron 截图：浅色、深色各一张（含两组），外加 `@` 列表一张
- [ ] 原生端（iOS 或 Android）截图一张——本机无模拟器，留待用户在设备上补
- [x] `typecheck`、`lint` 通过
