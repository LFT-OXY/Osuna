# 07 — 第四段的适配：Explorer 标签

**What to build:** Explorer 的标签用上游的新写法——有 + 菜单、能拖动排序、Files 与 Changes 能关闭——同时是 Osuna 的样子，并且 Osuna 的会话历史视图是其中正式的一种标签：默认就在，能关掉，能从 + 菜单重新打开，能拖到别的位置。标签的高度、圆角、选中态与工作区标签是同一种，不带上游的色值与间距。规格见 `prd.md` 的「Explorer 的标签」「UI and Design」，以及 `docs/explorer-sidebar.md`、`docs/menus.md`、`docs/design.md`。

**Blocked by:** 06
**Status:** ready-for-agent
**Impl:** ready

- [ ] 会话历史是新写法里的一种标签：默认标签列表里有它；关闭后 + 菜单里出现它，点一下重新打开；能拖动排序。
- [ ] Files、Changes 可关闭并能从 + 菜单打开；PR 标签的行为与上游一致。
- [ ] 上次打开的 Explorer 标签在切换工作区与重启后的记忆行为与合并前一致（Osuna 现有的测试通过，无一改动断言）。
- [ ] Explorer 标签的测试里有会话历史的用例：默认存在、关闭、从 + 菜单打开。
- [ ] 标签的外观按 `docs/design.md` 与工作区标签的现有样式；上游在这批改动里对色值、间距的纯外观调整没有收。
- [ ] + 菜单按 `docs/menus.md` 的菜单引擎约定，桌面是浮层、窄屏是抽屉，外观与 Osuna 其他菜单一致。
- [ ] 上游 e2e 里写死上游主题色值的断言已对照 Osuna 的主题重算；改动逐条记在 `## Comments` 下。
- [ ] `docs/explorer-sidebar.md` 的冲突两边都留，并写上会话历史在新标签结构里的位置。
- [ ] 界面语言为中文时，+ 菜单与标签上没有残留的英文；翻译资源测试通过。
- [ ] typecheck 和 lint 通过；改动涉及的测试文件逐个跑过并通过。
- [ ] UI：Explorer / 默认状态 / 桌面 1280 — 标签栏里有会话历史；标签的高度、圆角、选中态与同一窗口里的工作区标签一致。
- [ ] UI：Explorer / + 菜单展开 / 桌面 1280 — 菜单里列出当前未打开的视图，圆角与底色与 Osuna 其他菜单一致。
- [ ] UI：Explorer / 关掉 Files 之后 / 桌面 1280 — 标签栏里没有 Files，+ 菜单里有。
