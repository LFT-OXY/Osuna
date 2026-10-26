# 05 — 准备：删除 DOM 文件预览，逻辑图改走源码视图

**What to build:** 在合第五段之前单独提交：按 ADR 0016 删掉 Osuna 在 Web 上的 DOM Markdown 文件预览，Web 与 Electron 改用当前的共享渲染器；逻辑图带行号的节点在所有平台都打开源码视图并定位到那一行。这样第五段上游把 `file-pane` 改名 `file-panels` 时，这 13 个文件不再随改名冲突。规格见 `prd.md`「Markdown」，决定见 `research/discovery.md` 第 15、16 条与 ADR 0016。

**Blocked by:** 04
**Status:** ready-for-agent
**Impl:** ready

- [ ] Osuna 的 DOM 预览（Web 专用的渲染、样式、提示框、代码块、图片、链接、资源刷新、行号定位）与它的三个测试文件已删除；删除的文件清单记在 `## Comments` 下，供 PR 正文写明「Osuna 原有的测试不删除」的例外。
- [ ] 只为 DOM 预览引入的依赖若别处不再使用，从 `package.json` 移除，`package-lock.json` 重新生成。
- [ ] 逻辑图带行号的节点打开源码视图并定位到那一行，有测试；决定预览还是源码的逻辑里「预览可定位」只剩 false 一种。
- [ ] `.atw/spec/app/frontend/styling.md` 里讲 DOM 预览的那一节已改写或删除。
- [ ] typecheck 和 lint 通过；改到的测试文件逐个单独跑过并通过（不跑整套）。
- [ ] 没有 Osuna 的断言被删除或放宽；必须跟着改的断言逐条记在 `## Comments` 下，供 14 写 PR 正文用。
- [ ] UI：dev 桌面端 1280 宽 / 逻辑图点一个带行号的节点 — 截图上打开的是源码视图，停在那一行。
