# 05 — Osuna 图标

**What to build:** 桌面包的应用图标（Dock、Finder、Windows 安装包与任务栏、Linux）、打包进应用和通知里的图标、开发版图标、Web 的 favicon（包括 running、attention 状态变体，以及亮色和暗色）、PWA 和 apple-touch 图标，全部换成 Osuna 折纸鸟。欢迎页和启动闪屏显示彩色图标。16px 的工具调用图标换成新描的单色鸟形 SVG，颜色随主题变化，取代原来的蝴蝶组件。源图放进仓库，另写一个可以重复运行的派生脚本：先清理源图（把底板内部的 alpha 补到 255，去掉边缘的低 alpha 杂点），再生成所有尺寸。手机端图标、网站、fastlane 元数据不动。

**Blocked by:** None — can start immediately
**Status:** ready-for-agent
**Impl:** ready

- [ ] 源图（用户调整后的版本）已放进仓库；重新运行派生脚本，生成的产物没有差异
- [ ] 清理后的源图：底板内部 alpha 全部为 255，底板以外没有残留的杂点
- [ ] 桌面端的 icns、ico（16–256）、各尺寸 png、开发版图标都已替换；macOS 图标在 Dock 里的大小和系统图标一致
- [ ] Web 的 favicon 状态变体沿用原来的状态语义（running、attention 的标记方式不变），在亮色和暗色下都清晰可辨
- [ ] 欢迎页和启动闪屏显示彩色图标；16px 工具调用图标是单色鸟形，颜色随主题变化；蝴蝶组件不再被任何地方引用
- [ ] 桌面端亮色和暗色下的欢迎页、闪屏截图附在本票的 Comments 里
- [ ] typecheck 与 lint 通过
