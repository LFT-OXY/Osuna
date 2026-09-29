# 03 — 系统字体选择器

**What to build:**

在桌面端和 Web 端，把 Interface font、Code font、Terminal font 三行的文本输入换成基于现有 `Combobox` 的字体选择器。

选择器：
- 触发按钮显示当前值，并用当前值的字体渲染。
- 展开时（这是一次用户手势）才请求枚举本机字体。结果去重、按字母排序，过滤掉以 `.` 开头的 macOS 内部字体，同一会话内缓存。
- 列表首项：Interface font 和 Code font 是"默认"，Terminal font 是"跟随代码字体"。选中首项写入 `""`，选中系统字体写入单个字体名。
- 列表可以搜索，每一项用该字体本身渲染。Code font 和 Terminal font 只列等宽字体。
- 允许自定义值。已存的多字体栈不在列表里，作为自定义值原样显示在触发按钮上。
- "默认"只显示"系统默认"，不反查实际渲染的字体名。

新增字体探测模块，字体来源可以注入，供测试替换。它对外提供三种能力：
- 列出本机字体。API 不可用、被拒或抛错时返回"不可用"，不抛异常；此时选择器退化为搜索框加自定义值。
- 判断字体是否已安装。用 canvas 以三种 generic 字体作基准测量同一段文字的宽度，任一宽度不同即判定为已安装。不用 `document.fonts.check()`，它对没装的字体也返回 true。
- 判断字体是否等宽。多个字形宽度一致即为等宽；无法测量时视为等宽。

提示：只检查用户值里的第一个字体名。
- 本机没装时，行下提示"本机未检测到该字体，将使用回退字体"。
- Code font 或 Terminal font 不是等宽时，提示"不是等宽字体，可能错位"。
- 提示不阻止保存。

原生端三行维持现状。

**Blocked by:** 01 — 统一默认等宽栈，自选字体前插默认栈；02 — Terminal font 与 Terminal size
**Status:** ready-for-agent
**Impl:** done

- [x] Electron 上展开任一字体选择器即可看到本机字体，能搜索，每项用自身字体渲染。
  - 证据（2026-09-29 Electron dev，CDP 实测）：三行都是选择器（`界面字体族：系统默认` / `代码字体族：系统默认` / `终端字体族：跟随代码字体`）；展开 Code font 列出 21 款本机等宽字体，首项 computed font-family 为 `"Andale Mono", SFMono-Regular, …`，截图中每项字形各不相同。三行是同一个组件，实测只展开了 Code font。搜索由 `font-picker-row.browser.test.tsx` 覆盖。
- [x] Code font 和 Terminal font 列表里没有比例字体。
  - 证据：Electron 实测列表里没有 Helvetica、Arial 等比例字体；浏览器测试 "lists only monospace fonts"。
- [x] 浏览器拒绝授权、API 不支持或非安全上下文时，仍能输入并保存自定义字体名，没有报错。
  - 证据：`font-probe.browser.test.ts` 覆盖 API 缺失返回 `unavailable`、`NotAllowedError` 不抛出且下次重试；`font-picker-row.browser.test.tsx` 在 `unavailable` 下输入 `Maple Mono` 并保存。没有在真实浏览器里点"拒绝"实测。
- [x] 老用户已存的多字体栈原样显示，并且继续生效。
  - 证据：浏览器测试 "shows a stored font stack verbatim"（触发按钮文字与无障碍名原样显示）；生效由工单 01 的前插解析负责，选择器不改写已存的值。
- [x] 选"默认"或"跟随代码字体"写入 `""`，界面随即恢复。
  - 证据：Electron 实测 Code font 选"系统默认"后存储为 `""`，预览代码行回到默认等宽栈；浏览器测试覆盖两种首项都写入 `""`。
- [x] 本机没装的字体、非等宽的 Code font 或 Terminal font 会出现对应提示，值照常保存。
  - 证据：Electron 实测 Code font 填 `Helvetica` 行下出现"不是等宽字体，可能错位"，填 `NoSuchFont Zeta` 出现"本机未检测到该字体，将使用回退字体"，两者都已存储。Chromium 不支持的 `ui-monospace` 不误报（探测测试）。
- [x] 新增文案有中英文翻译。
  - 证据：9 个语言文件都补了 5 个键，`i18n/resources.test.ts` 通过。
- [x] 选择器有浏览器测试（`*.browser.test.tsx`，注入假字体源），覆盖以上行为。
  - 证据：`font-picker-row.browser.test.tsx`（9 个用例）与 `font-probe.browser.test.ts`（7 个用例）；app 全部浏览器测试 26 个文件、227 个用例通过，清空 Vite 缓存后复跑也通过。
- [ ] `appearance-font-size.electron.mjs` 追加回归：打开 Code font 选择器能列出本机字体，选中后代码区 computed `font-family` 以所选字体开头。本机跑不通时以 CI 为准。
  - 未勾：回归段已追加，但本机没跑（desktop browser-tabs e2e 在 macOS 上本来就跑不通）。同样的步骤已在 Electron dev 上通过 CDP 手工走通，等 CI 结果。
- [x] typecheck 和 lint 通过。
  - 证据：app typecheck 通过，排除 `.expo` 类型后复核也通过；改动文件 lint 通过。
