# 04 — 终端预览样例与字号重置

**What to build:**
- `AppearancePreview` 增加一段静态终端样例，不启动真实 xterm：
  - 字体和字号取终端的有效值，与真实终端走同一个解析逻辑。
  - 样例里包含一个 Nerd Font 提示符图标。
  - 用户正在输入、尚未提交的 Terminal size 草稿值也会实时反映到样例上。如果 Code font / Code size 草稿会影响终端的跟随值，也一并反映。
- Interface size、Content size、Code size、Terminal size 四个字号行：值不等于默认值时，右侧出现重置图标按钮，样式和交互参照快捷键设置页的重置按钮。
  - 点击后恢复默认值；Terminal size 恢复为空，即跟随 Code size。
  - 值等于默认时按钮不显示。
- 不做全局"恢复全部默认"。
- 字号输入框回显（2026-09-29 决定从 02 移到这里）：`FormTextInput` 只在挂载时读取 `initialValue`，改 draft 不会刷新框内文字。四个字号行在 clamp 或重置后，框内文字都要与提交后的值一致。修法是让输入框重挂载或直接替换文字。
- 终端样例的字体与字号取 `resolveTerminalFont`（02 新增），传入 Code font / Code size / Terminal font / Terminal size 的草稿值。

**Blocked by:** 02 — Terminal font 与 Terminal size
**Status:** ready-for-agent
**Impl:** done

- [x] 预览区有终端样例，修改终端字体或字号（包括跟随代码字体、代码字号时）会实时变化。
  - 证据（2026-09-29 Electron dev，CDP 实测）：Terminal size 输入 20 未提交时样例即为 20px；Terminal size 留空时 Code size 输入 18 未提交，样例跟随为 18px；Code font 选"系统默认"后样例首个字体变为 `SFMono-Regular`，选回 Menlo 后变回 `Menlo`。审查后字号草稿改为 clamp，复测 Terminal size 输入 30 未提交时样例为 22px。
- [x] 本机装有常见 Nerd Font 时，样例里的提示符图标正常显示。
  - 证据：Electron 截图中 U+E0A0 分支图标正常渲染，没有显示成方框。
- [x] 任一字号行改过后出现重置按钮；点击后恢复默认，按钮随之消失。
  - 证据：Electron 实测四行都会出现 `重置<字段>` 按钮，点击后恢复默认，按钮消失；`font-size-row.browser.test.tsx` "offers reset only while the size differs from the default"。审查后按钮改为 ghost `Button` 纯图标，Electron 复测截图与点击均正常。
  - 偏离说明：快捷键页的"重置"是 `…` 菜单里的菜单项，不是独立按钮。这里只沿用它的 `Undo2` 图标，按钮本身用 `docs/design.md` 要求的 `<Button variant="ghost" size="sm">`，与同页侧栏排序按钮一致。按钮放在输入框左侧，输入框和 `px` 不随按钮出现而移动。
- [x] Terminal size 重置后回到跟随，占位符显示当前 Code size。
  - 证据：Electron 实测重置后存储为 `null`，输入框为空，占位符为 `15`（当前 Code size），样例回到 Code size。
- [x] 四个字号行输入超出范围的值并提交后，输入框显示 clamp 后的值；点击重置后显示默认值（Terminal size 显示为空）。
  - 证据：Electron 实测 Terminal size 30→22、重置后为空；Code size 99→22、重置后为 12；Content size 5→10、重置后为 15；Interface size 40→21、重置后为 14。浏览器测试覆盖 Enter、失焦和重置三种回显，去掉 `resetKey` 后三个用例都会失败。
- [x] 新增文案有中英文翻译。
  - 证据：`resetSizeAccessibility` 已补齐 9 个语言，`i18n/resources.test.ts` 通过。
- [x] typecheck 和 lint 通过。
  - 证据：app typecheck 通过，排除 `.expo` 的 CI 探针配置下本次改动文件无报错；改动文件 lint 通过。
