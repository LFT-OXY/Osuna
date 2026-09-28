# 访谈结论：拆分提供方与模型选择 + 提供方彩色图标

来源：2026-09-28 `/atw-askme-with-docs` 访谈。Command chip（斜杠指令渲染成块）已移出，后续单独立任务。思考滑条在 `09-28-thinking-slider`。

## 已定决策

### 提供方 / 模型拆分

- 平台：桌面/Web 工具栏与紧凑布局（手机 sheet）都改。
- 提供方按钮：只显示品牌图标、不带文字，放在模型按钮左边，顺序为 提供方 → 模型 → 思考 → 模式。点开是提供方列表，列表图标用品牌色，当前项打勾。
- 运行中的 Agent：提供方按钮显示但不可点（Agent session 创建后不能换提供方）。
- 提供方菜单：可用的（已安装、已登录）平铺，不可用的折叠进「More agents (N)」。不新增「常用提供方」设置。
- 模型菜单：只列当前提供方的模型；跨提供方收藏只显示属于当前提供方的；Agent profiles 仍留在模型菜单（应用 profile 可能顺带切换提供方）；搜索保留，只在当前提供方模型内搜。
- 草稿切换提供方时：模型沿用该提供方上次选择（`use-agent-form-state.ts` 现有的按提供方记忆偏好），没有记录就用默认模型。
- 紧凑布局：sheet 新增「提供方」行（品牌色图标 + 名字），点进去是提供方列表；「模型」行只列当前提供方模型；运行中的 Agent 上这一行只读。

### 彩色图标

- 来源：
  - LobeHub Icons 彩色 SVG（MIT）：Codex（蓝紫 app 图标，去掉白色圆角方底，只保留渐变云朵与 `>_`）、Kiro、MiniMax、Kimi、Gemini CLI。
  - OMP：omp.sh 官网 `favicon.svg`（粉紫青渐变）。logo 无单独授权说明，用户已接受。
  - Claude Code：保持现有星芒图形 + `#D97757`。
  - Copilot、OpenCode、Pi、Cursor：没有彩色版，保持单色。
- SVG 放进本仓库 assets 并附 Lobe 的 MIT LICENSE，不引入 npm 包。
- 每家同时保留单色与彩色两个版本，由 `tone` 决定：`tone="brand"` 且有彩色版时用彩色版，否则走现有单色 + `color` 路径。
- 使用范围：只在 Composer 的提供方按钮、提供方菜单、模型列表、工具栏里用彩色；其余位置（侧边栏、标签页等）不变。
- `ModelBrowser` 模型列表行的图标改为品牌色（共享组件，定时任务表单、元数据生成设置页一起生效，不另加参数）。
- 品牌色表补齐（从各自 SVG 取主色）：Codex `#3941FF`、Kiro `#9046FF`、MiniMax `#E73562`、Kimi `#1783FF`、OMP `#9B4DFF`、Gemini `#207CFE`。该表也被思考滑条的渐变使用。

## 代码事实

- 当前合并选择器：`CombinedModelSelector`（`packages/app/src/components/combined-model-selector.tsx`）+ `ModelBrowser`（`packages/app/src/components/model-browser.tsx`，视图 `all` / `provider`，见 `model-browser-view.ts`）。
- 独立的提供方 Combobox 已存在于 `DesktopAgentControlsContent`（`packages/app/src/composer/agent-controls/index.tsx:994`），但生产代码中没有调用方传 `providerOptions`，因此从未显示。
- 草稿走 `onSelectProviderAndModel` → `setProviderAndModelFromUser`（`packages/app/src/hooks/use-agent-form-state.ts:278`）；运行中 Agent 的模型选择器只包含自己的提供方。
- 图标：`ModelProviderGlyph` 的 `tone`（`model-browser.tsx:216-238`），模型列表行用默认 `muted`（`:698`、`:1019`）；工具栏触发器用 `brand`（`combined-model-selector.tsx:305`）。
- 品牌色表 `PROVIDER_BRAND_COLORS` 目前只有 `claude: "#d97757"`（`packages/app/src/components/provider-icons.ts:33`）。`createSvgIcon` 靠 `color` 驱动 `currentColor`，彩色 SVG 写死 fill，需要另一条渲染路径。
- 现有图标全部单色：`packages/app/src/components/icons/*`、`packages/app/src/assets/acp-provider-icons/*.svg`（`currentColor`）；Kiro 目前用 lucide `PackagePlus`。

## 彩色 SVG 来源核实（子代理调研）

- Lobe Icons：MIT（GitHub LICENSE、README、npm registry 三处一致）。`@lobehub/icons-static-svg@1.95.1`，彩色版本以 `src/toc.json` 的 `hasColor` 为准。
- 坑：Lobe 的 `copilot-color` 是 Microsoft Copilot，不是 GitHub Copilot；GitHub Copilot（`githubcopilot`）无彩色版。GitHub 品牌页写明 Copilot 自 2025 年起无独立 logo。
- Codex 彩色：`codex-color.svg`，渐变 `#B1A7FF → #7A9DFF → #3941FF`，带白色圆角方底。OpenAI 品牌规范不允许改动 logo，去白底是用户接受的取舍。
- 接入 SvgXml 前：去掉根节点的 `width="1em"`、`style`、`<title>`；Lobe 渐变 id 固定（如 `lobe-icons-codex-_R_0_`），同页多次渲染 id 重复但指向同一渐变。
- 商标：MIT/CC0 只覆盖 SVG 文件，不授予商标权；只做指示性使用，不改造型（Codex 去白底除外）。
- 访问过的来源：`raw.githubusercontent.com/lobehub/lobe-icons/master/{LICENSE,README.md,src/toc.json}`、`data.jsdelivr.com/v1/packages/npm/@lobehub/icons-static-svg@1.95.1`、`brand.github.com/brand-identity/copilot`、`openai.com/brand/`、`omp.sh/favicon.svg`、`kiro.dev/icon.svg`。
