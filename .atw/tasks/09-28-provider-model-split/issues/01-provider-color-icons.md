# 01 — 提供方彩色图标与品牌色

**What to build:** 在 Composer 工具栏的模型按钮和模型列表的每一行里，提供方图标显示彩色版：Codex、Kiro、MiniMax、Kimi、Gemini CLI、Oh My Pi 用彩色 SVG（Codex 去掉白色圆角方底），Claude 保持现有星芒和陶土色，GitHub Copilot、OpenCode、Pi、Cursor 保持单色。每个提供方同时保留单色版和彩色版，由 `tone` 决定取哪个（`resolveProviderGlyph`）；brand tone 且有彩色版时取彩色版，否则走现有单色加 `color` 的路径。Kimi 彩色版的 K 改用 `currentColor` 跟随主题前景色（用户决策），其余品牌色部分固定。品牌色表补齐 7 家。侧边栏、标签页等 Composer 以外的位置外观不变。

**Status:** ready-for-agent
**Impl:** done
**Blocked by:** none

- [x] 彩色 SVG 已清理根节点属性（`width="1em"`、`style`、`<title>`）后放入应用 assets，同时附上 LobeHub Icons 的 MIT LICENSE；没有新增 npm 依赖
- [x] brand tone 下，有彩色版的提供方渲染彩色版，品牌色部分不受传入的 `color` 影响（Kimi 的 K 跟随前景色）；没有彩色版的提供方仍按 `color` 渲染
- [x] 品牌色表包含 Claude `#D97757`、Codex `#3941FF`、Kiro `#9046FF`、MiniMax `#E73562`、Kimi `#1783FF`、Oh My Pi `#9B4DFF`、Gemini `#207CFE`
- [x] 模型浏览器的行图标改用 brand tone（共享组件，定时任务表单和元数据生成设置页一起生效）
- [x] 亮色和暗色主题下，Composer 工具栏和模型列表里的彩色图标都清晰可辨，Codex 没有白色方底
- [x] 侧边栏、标签页等其他调用方的图标外观不变
- [x] 提供方图标的单元测试覆盖按 tone 选版本和品牌色表；typecheck 和 lint 通过
