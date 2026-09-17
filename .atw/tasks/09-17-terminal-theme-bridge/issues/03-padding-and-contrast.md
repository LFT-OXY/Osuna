# 03 — 对称内边距与对比度修正

**What to build:** 终端内容四周留白相等，多分栏时左右边缘对齐，第一列字符不再贴着面板边缘。浅色主题下用 ANSI white 输出的文字在白底上可读；暗色背景上接近背景色的文字被温和提亮，鲜艳颜色不被洗白。

**Status:** ready-for-agent
**Impl:** ready

**Blocked by:** None — can start immediately

## 范围

- 宿主容器四边使用同一个设计系统 spacing token 作为内边距，内边距区域填充终端背景色；fit 按扣除内边距后的内框计算行列。不做设置项。
- xterm 最小对比度按当前主题背景的相对亮度取值：浅底 4.5，深底 3；主题变化时重算，仅在值变化时写入。
- 浅色调色板中 `white` 与 `brightWhite` 改为在白底上可读的灰色（与背景对比度不低于 3:1），其它 ANSI 色不动。
- 仅改 web（浏览器与 Electron）终端渲染路径；原生渲染文件不动。

## 验收

- [ ] macOS desktop 上终端内容左右留白肉眼一致；两分栏时左右边缘对齐。
- [ ] 浅色主题下 `printf` 一段 ANSI white 与 brightWhite 文本可读。
- [ ] 深色主题下现有语法高亮颜色无明显变化。
- [ ] 浏览器测试：浅色主题挂载后最小对比度为 4.5，深色为 3，切主题后仅在变化时写入；宿主内框相对外框四边等距。
- [ ] `npm run typecheck`、`npm run lint` 通过。
