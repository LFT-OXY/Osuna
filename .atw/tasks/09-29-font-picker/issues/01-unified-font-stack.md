# 01 — 统一默认等宽栈，自选字体前插默认栈

**What to build:**
- 外观模块提供唯一的有效字体栈解析，代码区、diff（包括 web diff 画布原先的硬编码栈）、编辑器、终端都从这里取值，默认等宽栈只在主题 token 里定义一处。
- Web 端（含 Electron）用户填的 Interface font / Code font 前插到默认栈：字体名含空格或特殊字符时补引号，generic 关键字不加引号。原生端保持"用户值替换默认值"。
- 默认等宽栈只含具体字体名和结尾的 `monospace`，不含 `ui-monospace`。
- 终端有效栈在 `monospace` 之前追加常见的本机 Nerd Font 名。
- 顺手更正 `theme.ts` 里提到已不存在的 `Fonts` 的注释。

**Blocked by:** None — can start immediately
**Status:** ready-for-agent
**Impl:** done

- [ ] Code font 留空时，代码块、diff、终端解析出的是同一套默认等宽栈。
- [ ] Web 端 Code font 填 `Maple Mono`，有效栈为 `"Maple Mono", <默认等宽栈>`；填本机没装的字体时，界面落到默认等宽字体，而不是浏览器默认字体。
- [ ] 老用户手写的完整字体栈照常作为首选生效。
- [ ] 原生端有效字体与改动前一致。
- [ ] 终端有效栈中，Nerd Font 名排在 `monospace` 之前。
- [ ] `apply.test.ts`（主题 token）与 `font-stack.test.ts` / `font-stack.native.test.ts`（解析函数）覆盖以上行为。typecheck 和 lint 通过。
