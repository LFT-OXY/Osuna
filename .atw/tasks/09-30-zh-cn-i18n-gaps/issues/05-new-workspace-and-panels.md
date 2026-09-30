# 05 — 新建工作区与工作区 / 终端面板迁移

**What to build:** 简体中文下，新建工作区页面的项目、隔离方式、主机等无障碍标签，项目搜索占位，「暂无可用项目」空状态，「请选择项目」「请为此项目选择主机」「所选主机上没有此项目」等校验错误显示中文。工作区里以下文案也显示中文：标签页的「Agent 运行中」「Agent 需要输入」、「更新 Osuna 以恢复此工作区」、终端面板的「找不到工作区目录」、终端的显示 / 隐藏键盘、粘贴、复制、原生终端的「底部」、导入会话的「按提供方筛选」和「会话缺少工作目录」、浏览器设备预设名。新增的键在其他 7 种语言里填英文原文。

**Blocked by:** 01

**Status:** ready-for-agent
**Impl:** done

- [x] 上述文案在中文下显示中文，英文界面文案不变
- [x] 本工单迁移的代表性英文字面量加入源码扫描清单，测试通过
- [x] 所有语言资源的键和英文一致，插值占位符一致
- [x] 资源测试文件、typecheck、lint 通过
- [x] Electron 桌面端中文截图检查新建工作区页面、工作区标签页状态、终端面板；原生端终端文案注明免验收

**Notes:** 终端面板复用 `panels.file.directoryMissing`，和文件、差异等面板一样译「未找到工作区目录。」，没有采用工单原文的「找不到」，也没有新建 `panels.terminal` 键。`workspace-route-state.ts` 保持纯模块，不再返回英文：`unsupportedAction` 改为新增的 `needsAppUpdate` 状态，由 `workspace-route-state-views.tsx` 渲染 `workspace.route.recovery.updateToRecover`。「所选主机上没有此项目」沿用 `createMultiplicityWorkspace` 已有的 `createFailedMessage` 做法，由调用方传入 `projectUnavailableMessage`。浏览器设备预设改为 `name`（型号名，保留英文）和 `nameKey`（Responsive、Laptop、Desktop 1080p/1440p，走翻译）二选一，Desktop 译「台式机」。源码扫描清单没有收 `"Project"`、`"Host"`、`"Bottom"`：它们会命中其他文件的模板前缀或同名字面量。终端的粘贴、复制只在原生端渲染（`shouldShowTerminalPasteAction` 取决于 `isNative`），键盘切换属于移动端虚拟键盘，「底部」在原生终端里，这几项在桌面端看不到，按原生端免验收处理。「Workspace creation returned no agent」是内部不变量错误，不在工单清单里，没有迁移。Ctrl / Shift / Alt 是键名，不翻译。桌面端中文 QA 截图（`/tmp/qa05/`）：新建工作区页面和项目选择器（「搜索项目」「暂无可用项目。」、无障碍标签「工作区项目」「工作区隔离方式」）、标签页状态「Agent 运行中」「Agent 需要输入」、终端面板。另外发现侧栏分组标题「Workspaces」在中文下仍是英文，它是 `components/left-sidebar.tsx:760` 的 JSX 硬编码，排查清单漏了，和工单 06 的 `left-sidebar.tsx:770` 相邻，留给工单 06。
