# 02 — Terminal font 与 Terminal size

**What to build:**
- 用户可以在外观 → 字体里给终端单独设置字体和字号，默认跟随 Code font / Code size。
- 设置存在本地，新增两个字段：
  - `terminalFontFamily`：`""` 表示跟随 Code font。
  - `terminalFontSize`：`null` 表示跟随 Code size，范围 9–22，写入时 clamp。
- 老数据缺这两个字段时取默认值，不迁移。
- 界面新增两行：
  - Terminal font：暂时沿用现有的字体文本输入，由 03 升级为选择器；只在桌面端和 Web 端显示。
  - Terminal size：全平台显示；留空表示跟随，占位符显示当前 Code size。
- 终端从 01 的解析逻辑取有效字体栈和 `terminalFontSize ?? codeFontSize`，经现有的 `setFont` 热更新，已打开的终端立即生效。
- 补齐中英文文案："Terminal font" / "Terminal size"，"终端字体" / "终端字号"。
- 去掉 `docs/glossary.md` 里 Terminal font 条目的 "Planned" 标注。

**Blocked by:** 01 — 统一默认等宽栈，自选字体前插默认栈
**Status:** ready-for-agent
**Impl:** done

- [ ] 单独设置终端字体或字号后，终端随之变化，代码块和 diff 不受影响；已打开的终端无需重开。
  - 未勾：解析规则有单测，终端经现有 `setFont` 热更新只读过代码，未在 App 里实测。
- [x] 清空 Terminal font 和 Terminal size 后，终端回到跟随 Code font / Code size。
  - 证据：`font-stack(.native).test.ts` 的跟随用例（含纯空白视为跟随）；`storage.test.ts` 的 `""` / `null` 往返用例；设置页空输入提交 `null`。
- [ ] Terminal size 留空时，占位符显示当前 Code size；超出 9–22 的输入被 clamp。
  - 未勾：存储值会 clamp（`storage.test.ts`），但输入框不回显 clamp 后的值（`FormTextInput` 只读一次 `initialValue`，现有字号行同样如此）；占位符只读过代码，未实测。
- [ ] iOS/Android 上能设置 Terminal size，并对终端生效；原生端不显示 Terminal font 行。
  - 未勾：原生解析有单测（`font-stack.native.test.ts`），行的显示规则只读过代码，未在模拟器或真机上验证。
- [x] 缺少新字段的老设置数据可以正常解析。
  - 证据：`storage.test.ts` "defaults the appearance fields when an old blob omits them"。
- [x] `storage.test.ts` 覆盖新字段的缺省、clamp 与 `null` 跟随；跟随/覆盖规则由 `resolveTerminalFont` 承担，断言放在 `font-stack.test.ts` / `font-stack.native.test.ts`（主题 token 不含终端字段，`apply.test.ts` 不涉及）。typecheck 和 lint 通过。
  - 证据：上述测试文件本地通过；提交钩子里 lint、format、全仓 typecheck 通过（`38ac3a4f5`）。
