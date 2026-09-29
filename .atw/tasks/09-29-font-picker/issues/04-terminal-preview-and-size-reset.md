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

**Blocked by:** 02 — Terminal font 与 Terminal size
**Status:** ready-for-agent
**Impl:** ready

- [ ] 预览区有终端样例，修改终端字体或字号（包括跟随代码字体、代码字号时）会实时变化。
- [ ] 本机装有常见 Nerd Font 时，样例里的提示符图标正常显示。
- [ ] 任一字号行改过后出现重置按钮；点击后恢复默认，按钮随之消失。
- [ ] Terminal size 重置后回到跟随，占位符显示当前 Code size。
- [ ] 新增文案有中英文翻译。
- [ ] typecheck 和 lint 通过。
