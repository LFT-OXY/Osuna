# 01 — 列表：分组、自上而下、新行样式

**What to build:** 输入 `/` 时 Command menu 的列表分成"命令""技能"两组（带小标题，空组不显示），技能行立方体图标、命令行 `SquareSlash` 图标；从上往下排，默认高亮第一项，方向键移动、Enter/Tab 选中、Esc 关闭，高亮项滚动跟随；每行"图标 · `/name` · 弱化描述（一行截断）· 更弱的参数提示"；详情卡去掉；提示行（加载中 / 不完整 / 无匹配）不可选。输入 `@` 的文件列表换成同样的行样式与自上而下顺序，不分组。见 PRD「Implementation Decisions」中除面板外观外的各条。

**Status:** ready-for-agent
**Impl:** done

**Blocked by:** None — can start immediately

- [x] 分组依据 `kind`；客户端内置命令与插件命令归"命令"；组内沿用现有匹配排序
- [x] 去掉 above-input 倒序、默认末项、滚动到底
- [x] 键盘与悬停共用高亮（`interactionHighlight`），悬停按 `docs/hover.md`
- [x] 行规格：`MENU_ITEM_HEIGHT`（桌面 30 / 紧凑 40）、内缩 4、`radius.sm`；文字层级 `foreground` / `foregroundMuted` / `foregroundExtraMuted`；图标 16
- [x] 组标题、无匹配文案进 i18n，所有现有语言补齐
- [x] 测试：vitest browser（参照 `text-input.web.browser.test.tsx`、`thinking-slider.browser.test.tsx`）覆盖分组、顺序、默认高亮、键盘跳过提示行、无匹配、`@` 模式无分组；更新 `autocomplete-utils.test.ts` 中倒序断言
- [x] `typecheck`、`lint` 通过
