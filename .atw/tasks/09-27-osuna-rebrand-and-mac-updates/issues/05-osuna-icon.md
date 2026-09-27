# 05 — Osuna 图标

**What to build:** 桌面包的应用图标（Dock、Finder、Windows 安装包与任务栏、Linux）、打包进应用和通知里的图标、开发版图标、Web 的 favicon（包括 running、attention 状态变体，以及亮色和暗色）、PWA 和 apple-touch 图标，全部换成 Osuna 折纸鸟。欢迎页和启动闪屏显示彩色图标。16px 的工具调用图标换成新描的单色鸟形 SVG，颜色随主题变化，取代原来的蝴蝶组件。源图放进仓库，另写一个可以重复运行的派生脚本：先清理源图（把底板内部的 alpha 补到 255，去掉边缘的低 alpha 杂点），再生成所有尺寸。手机端图标、网站、fastlane 元数据不动。

**Blocked by:** None — can start immediately
**Status:** ready-for-agent
**Impl:** done

- [x] 源图（用户调整后的版本）已放进仓库；重新运行派生脚本，生成的产物没有差异
- [x] 清理后的源图：底板内部 alpha 全部为 255，底板以外没有残留的杂点
- [x] 桌面端的 icns、ico（16–256）、各尺寸 png、开发版图标都已替换；macOS 图标在 Dock 里的大小和系统图标一致
- [x] Web 的 favicon 状态变体沿用原来的状态语义（running、attention 的标记方式不变），在亮色和暗色下都清晰可辨
- [x] 欢迎页和启动闪屏显示彩色图标；16px 工具调用图标是单色鸟形，颜色随主题变化；蝴蝶组件不再被任何地方引用
- [x] 桌面端亮色和暗色下的欢迎页、闪屏截图附在本票的 Comments 里
- [x] typecheck 与 lint 通过

## Comments

**实现结论（2026-09-27）**

- **源图与脚本**：源图放在 `packages/desktop/icon-source/osuna.png`，与用户调整后的原图 sha1 相同。派生脚本是 `scripts/generate-osuna-icons.mjs`（Node + sharp，sharp 加为根 devDependency，用户确认），运行方式为 `node scripts/generate-osuna-icons.mjs`。连续运行多次，19 个产物的 shasum 完全一致。
- **清理**：底板取 alpha ≥ 128 的最大连通区域并填洞，内部 alpha 补到 255。紧贴底板 2px 以内、alpha ≥ 16 的抗锯齿像素保留，其余清成全透明。脚本在派生之前会断言这两条，不满足就报错。清理后的非零像素包围盒是 (127,136)–(1126,1123)，与底板一致。
- **桌面端**：`icon.icns`、`icon.ico`（16/24/32/48/64/256）、`icon.png`（512）、`32x32` / `64x64` / `128x128` / `128x128@2x` 都用整张画布生成，保留 Apple 栅格留白，底板约占 80%。原来的图标是 88%，比系统图标大一圈。
  - icns 的条目类型与 iconutil 的输出相同：ic04 / ic05 用 ARGB 格式，其余用 PNG。
  - `iconutil -c iconset` 能解出全部 10 个尺寸。最初用 icp4 / icp5 存 PNG，iconutil 解出来是花屏，已改掉。
- **开发版图标**：鸟身色相转 140°，由蓝变为橙棕，胸口变为青色；按饱和度混合，米色底板不变（用户确认）。
- **Web**：favicon、PWA 192/512、apple-touch 180 按底板满版裁切，与原来一致。
  - favicon 的状态标记与原来相同：圆点位置、大小不变，running 为 `#3b82f6`，attention 为 `#22c55e`。
  - 额外做法：圆点外圈挖了一道透明缝。理由是 running 的蓝点与鸟身同属蓝色，有了这道缝，在任何标签栏底色上都能和底板分开。
  - 亮暗两版仍是同一张图，原来就是这样。在深色、浅灰、纯白三种底色上核对过 48px 和 16px，三种状态都能分辨。
- **应用内**：新组件在 `components/icons/osuna-logo.tsx`。
  - `OsunaLogo` 显示彩色位图 `assets/images/osuna-logo.png`（288px），用于欢迎页、闪屏加载态、闪屏错误态和打开项目页。打开项目页原来也引用蝴蝶组件，一并替换。
  - `OsunaGlyph` 是按源图描出的单色剪影（复用 `SvgPathIcon`），用于工具调用图标，颜色由调用处的 `uniProps` 随主题传入。
  - `paseo-logo.tsx` 已删除，并从 `.oxlintrc.json` 的 useUnistyles burn-down 列表移除（计数 74→73、68→67）。
  - 闪屏高光：原来 Web 端用蝴蝶路径做 mask，现在改为按底板圆角（边长的 22%）裁切，扫一道白色高光。native 端仍用 MaskedView，改以位图的 alpha 作遮罩。
- **未处理的孤儿**：`butterfly-*.svg`、`favicon-*.svg` 在本次改动前就没有被引用，不属于本票造成的孤儿，保留不动。

**截图**

截图只保存在本地，未入库，路径为本会话 scratchpad 下的 `qa/`：

- 欢迎页：`welcome-light.png`、`welcome-dark.png`
- 闪屏加载态：`splash-light-5.png`、`splash-dark-4.png`
- 打开项目页：`open-project-light.png`、`open-project-dark.png`

检查结果：

- 亮色和暗色下，彩色图标都完整显示，四角圆弧没有露底，底板和页面背景都能区分开。
- 闪屏加载态有高光扫过。
- 16px 单色鸟形另外渲染核对过：前景色为 `#0a0a0a` 和 `#fafafa` 时，都能认出鸟形和翅膀下的空洞。
- 闪屏错误态很难触发，未截图。

截图方式：通过 CDP 连接 dev 桌面端。闪屏靠 CPU 降速 30 倍拉长后连拍截到。欢迎页是 dev 实例自动补回本机 host 后，用 expo-router 的 `router.push("/welcome")` 打开的。

**验证**

- typecheck：app、desktop 通过。
- lint：全仓 oxlint 0 错误。改动文件的 oxfmt 通过。
- 单测：app 全量 652 个文件、5926 个测试通过。根 `scripts/` 的测试全部通过：vitest 70 个，node:test 44 个。
- 本票没有新增测试接缝，PRD 的 Testing Decisions 不为声明式资源造接缝。清理的正确性由脚本内的断言保证，可重复性由重跑后比对 shasum 验证。
