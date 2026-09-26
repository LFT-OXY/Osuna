# 01 — token 与主题

**What to build:** 打开应用即看到新的默认配色：默认亮色和暗色主题的语义色换成 t3code 默认色板取值（暗色画布 #0a0a0a、侧栏 #000，更暗于画布；强调色亮 #1b4ed8 / 暗 #346bf1），并新增 PRD 列出的语义角色（画布与外框、surface、message surface、侧栏行 hover / active / selected 与选中描边、文字三级、边框与输入框边框、diff 行底色与色条、Composer 阴影、暗色内高光）。其余内置主题与插件主题缺失的新角色由一个纯函数从各自已有语义色派生，不逐套手调。状态色沿用"每信号一个 token"的生成规则，只调整生成输入。圆角梯度（6/8/10/14/18/22）、控件高度（24/28/32）、图标尺寸 token 就位。Electron 窗口初始背景色改为新画布色。做完后全应用整体变色，组件形态保持原样。

**Blocked by:** None — can start immediately
**Status:** ready-for-agent
**Impl:** done

- [x] 默认亮 / 暗主题 id 不变，用户已保存的主题选择、字体与字号偏好升级后继续生效，无需迁移
- [x] 主题单测覆盖每一套内置主题和一个插件主题样例：新角色全部有值、派生结果确定、文字与背景对比度满足现有阈值、侧栏行三态之间可辨
- [x] 终端对比度单测、控件几何单测保持通过
- [x] Electron 启动时没有旧背景色闪烁
- [x] 该区域 Electron 桌面端亮色与暗色截图与原型观感一致，截图作为证据附在本票 Comments
- [ ] 该区域中断言 CSS 值或几何尺寸的 e2e 已随设计更新，且在 CI 上通过
- [x] testID 与英文 UI 文案逐字未变
- [x] docs/design.md 等设计文档中对应章节已改写（改写过时内容，不在末尾追加）
- [x] typecheck 与 lint 通过

## Comments

### 2026-09-26 — 实现记录与视觉证据

Electron 桌面端（dev，`FORCE_COLOR=3 PASEO_LISTEN=127.0.0.1:6769 npm run dev --workspace=@getpaseo/desktop`，Playwright CDP 截图），选中行为 "Session start"：

- 暗色工作区：[../evidence/01-electron-dark.jpg](../evidence/01-electron-dark.jpg)（画布 `#0a0a0a`、侧栏 `#000`、选中行计算底色 `rgb(19, 19, 19)`）
- 亮色工作区：[../evidence/01-electron-light.jpg](../evidence/01-electron-light.jpg)（画布 `#fcfcfc`、侧栏 `#fafafa`、选中行计算底色 `rgb(234, 234, 234)`）
- 设置页：[../evidence/01-electron-dark-settings.jpg](../evidence/01-electron-dark-settings.jpg)、[../evidence/01-electron-light-settings.jpg](../evidence/01-electron-light-settings.jpg)

组件形态未变（圆角、控件高度仍走旧 token），只有配色变化；与原型对照，画布 / 侧栏明度方向、蓝色强调色一致。

审查后用户确认的取舍（两次确认，共 7 项）：

1. 亮色侧栏选中用灰底 `#eaeaea`（`#fafafa` 上叠 7.5% 前景色），不用原型的白底：白底在色值表 `#fafafa` 侧栏上只有 1.04:1，工单 02 接上选中描边之前看不出来。
2. 状态色保持生成规则，输入不变：新侧栏静止与 hover 行上，亮色状态点最低 3.01:1，约束仍成立。色值表的 error / warning 不采用。
3. 次级文字阈值只约束画布：默认亮色 `#71717b` 在消息气泡上 4.39、在 hover 行上 4.27，接受。
4. 侧栏行态不取色值表（色值表亮色三态重合，暗色选中比 hover 还暗），按设计稿的半透明叠色折算：
   - 暗色：hover 为黑上 4% 白 `#0a0a0a`，选中 7.5% 白 `#131313`，选中描边在选中底色上叠 6% 白 `#212121`。
   - 亮色：hover 为 `#fafafa` 上 3.5% 黑 `#f1f1f1`，选中见第 1 项，选中描边在选中底色上叠 7% 黑 `#dadada`。
   - 按下态由派生得出。

   为保证全目录相邻行态 ≥ 1.05:1，派生改动了 4 套旧主题的既有值：
   - Pure Black 选中 `#111111→#131313`
   - Catppuccin Latte hover `#e6e9ef→#e0e3ea`
   - Rosé Pine Dawn hover `#f4ede8→#e9e2e0`
   - GitHub Light hover `#f6f8fa→#f0f2f4`

   其余旧主题的 hover 和选中不变。
5. 默认 `destructive`（危险按钮填充，配白字）：亮 `#c10007`（t3code 亮色 errorForeground），暗 `#c44a4a`（沿用 Zinc 的中性红）。
6. 默认 `borderAccent`（outline 按钮描边）：亮 `#d4d4d8`（t3code input 色），暗 `#262626`。t3code 的 `#1e1e1e` 在 `#0a0a0a` 画布上只有 1.14:1。
7. `app.config.js` 的 Android 通知强调色由旧绿 `#20744A` 改为 `#346bf1`。

其他随改动产生的变化：
- 选中描边叠在选中底色上，而不是照原型画在行外、叠在侧栏上。RN 的 border 画在行内，而且亮色选中已是灰底，按原型折算出的 `#e9e9e9` 与选中底色几乎一样。
- 亮色 `destructiveForeground` / `successForeground` 在 builder 里跟随 `surface0`，因此由 `#ffffff` 变为 `#fcfcfc`。
- `index.html` 的 `focus-visible` 描边由旧绿改为新强调色（亮 `#1b4ed8`、暗 `#346bf1`）。`manifest.json` 和 `theme-color` 改为新的暗色画布色。

- 主题选择器里 Dark 的色块由旧绿 `#2D8B62` 改为新强调色 `#346bf1`。
- `accentBright`（链接等强调文字）：亮 `#3160db`（t3code 亮色 messageActionHover）、暗 `#51a2ff`（t3code 暗色 updateForeground），均出自 t3code `themePalettes.ts` 默认主题，不在调研色值表里。
- diff 行色条与底色同源：色条取 `statusSuccess` / `statusDanger`，底色为其 15% / 10% 透明版，与现有 diff 视图（`git/diff-document/palette.ts`）一致。
- 暗色第三级文字 `foregroundExtraMuted` 取原型的 `--faint` `#555555`（画布上 2.66:1）；这一级只用于退在次级文字之后的被动外框元素，现有阈值不约束它（亮色 `#a1a1aa` 同样不达标）。
- 暗色内高光按参考取白色 4%（`rgba(255, 255, 255, 0.04)`），所有暗色主题相同。

单测（`packages/app` 下 `npx vitest run <files>`）：
- `styles/theme`、`plugins/theme`、`terminal/runtime/terminal-contrast`、`components/ui/control-geometry`、`git/diff-document/palette`、`appearance/apply`、`appearance/resolve-theme`、`appearance/theme-labels`、`components/appearance-style-boundary`、`styles/markdown-styles`、`hooks/use-settings/storage`：11 个文件、328 条全部通过。其中终端对比度单测已覆盖新的暗色 `terminalBlack` `#525252` / `terminalBrightBlack` `#737373`。
- `packages/desktop` 的 `window/window-manager`：15 条通过。

e2e：断言颜色值的 `appearance-theme-picker`（选中行两条）、`file-editing`（编辑器光标）、`terminal-protocol-query`（OSC 11 回答）已更新，本地定向运行全部通过；全量 e2e 未在本地跑，待 CI 确认。
