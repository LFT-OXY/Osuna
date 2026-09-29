# 字体设置：现状与参考项目调研

## Osuna 现状

- 外观 → 字体：界面字体、界面字号、内容字号、代码字体、代码字号（`packages/app/src/screens/settings/appearance/appearance-section.tsx:795-847`）。字体名为自由文本输入；界面字体行在原生端隐藏（`:575`）。
- 存储：客户端 AsyncStorage `@paseo:app-settings`，`hooks/use-settings/storage.ts`（字段 `:89-93`，校验 `sanitizeFontFamily` `:493-511`）。daemon/protocol 无字体字段。
- 应用：`appearance/apply.ts:84-130` patch 所有 Unistyles 主题；web 端界面字体靠 `appearance/apply-root-font.web.ts` 注入 CSS 变量，代码区用 `data-pmono` 排除。
- 用户字体整串替换默认栈（`apply.ts:85-86`），无回退。
- 终端与代码字体/字号共用（`components/terminal-pane.tsx:226-229,1061-1062`）；留空时终端默认栈 `terminal/runtime/terminal-font.ts:3-21`（JetBrains/Nerd 优先）与 `theme.ts:922-926` 代码默认栈（SFMono 优先）不一致。
- 硬编码等宽栈：`git/diff-document/surface.web.tsx:47`、`desktop/components/desktop-updates-section.tsx:501`、`git/diff-document/surface.native.tsx:77`。
- 无打包字体、无 expo-font / @font-face。
- Electron 未设置 `setPermissionRequestHandler`，`local-fonts` 权限按 Electron 默认放行。
- 可复用组件：`components/ui/combobox.tsx`（搜索、`allowCustomValue`、`renderOption`、支持虚拟列表子元素）。
- 设置页无搜索功能；重置按钮先例：`screens/settings/keyboard-shortcuts-section.tsx:229`。

## t3code（最接近目标）

- 4 种字体（界面/Prompt/代码/终端）+ 4 个字号 + macOS 字体平滑；Simple/Advanced 两档。
- 文本框聚焦时调用 `queryLocalFonts()`，授权后换成可搜索下拉，每项用自身字体渲染；已授权则挂载时预枚举（`apps/web/src/components/settings/FontFamilyPicker.tsx`、`apps/web/src/appearanceFonts.ts:363-389`）。过滤 `.` 开头的 macOS 内部字体。
- 代码/终端字体经 `isMonospaceFamily` 过滤；提交前用 canvas 测宽校验存在性与等宽，不合格标红不保存（`SettingsPanels.tsx:1827-1846`；`appearanceFonts.ts:152-232`）。不用 `document.fonts.check()`：对未安装字体也返回 true。
- 用户字体前插默认栈（`appearanceFonts.ts:97-110`），字体名做引号规范化（`:53-72`）。
- 终端：`setFont` 预加载四种样式、epoch 防竞态、监听 `document.fonts` `loadingdone` 重新测量；比例字体整体回退默认栈；追加 Nerd Font 符号回退。
- 反例：Simple 下 Prompt 字体仍暗中生效；切两档终端字号跳变；CSS 与 JS 默认等宽栈不一致。

## openchamber

- 预设白名单（UI 10 / Mono 9），存 id；jsDelivr CDN 按需 `FontFace` 加载，仅 latin 子集。离线与 VS Code CSP 下静默失效。
- 界面缩放改根元素 font-size；终端/编辑器字号独立；每项 ghost 重置按钮。
- 反例：CodeMirror 不跟随用户代码字体；终端字号上限、默认值多处不一致。

## desktop-cc-gui

- 当前 v1.0.4 无字体设置，只剩 WebView 缩放；完整实现在 v0.9.6（`52259cfba`）。
- `queryLocalFonts` 失败时回退 canvas 测宽检测 24 个候选字体。
- 反例：只存主字体名、无回退栈；前后端默认值两处定义；UI 缩放曾冻结 WebView 被下线。
