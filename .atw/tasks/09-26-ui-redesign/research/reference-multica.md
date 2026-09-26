# 参考：multica（补充参考）

根目录 `R/` = `/Users/oxy/Documents/Configuration/dev-environment/demo/源码/multica`

## 定位

任务看板 + AI agent 执行；Web（Next.js）/ Desktop（Electron）共用 `packages/ui` + `packages/views`；Mobile（Expo）独立一套 token，视觉与 web 不一致 —— 借鉴以 web 端 `R/packages/ui/styles/tokens.css` 为准。无终端、无文件树。

## 值得借鉴

- **token 组织**（`tokens.css`，oklch，zinc h≈286）：表面四层 app-shell < page-canvas < surface < surface-raised（:146-159）；单一 brand 蓝 ≈ #2f6fe6；muted / faint foreground 按 WCAG 4.5:1 / 3:1 推导（:187-194）。
- **用途命名字号阶梯**（:67-122）：micro 11/15、caption 12/16、label 13/18、body 14/20、body-lg 15/22、title-sm 16/24、title 18/28、title-lg 20/28、display-sm 24/32、display 36/40。可作为 Osuna Typography primitive 的命名参考。
- **圆角梯度 + 强制脚本**：xs 3 / sm 4 / md 6 / lg 8 / xl 12 / 2xl 16；`R/scripts/check-ui-radius-tokens.mjs`。
- **尺寸常量**：按钮 24/28/32/36，列表行 36，页头 48（`tokens.css:132-145,224`）。
- **状态规则**：hover `surface-hover`、选中 `surface-selected`，选中态 hover 时仍可辨（`R/AGENTS.md:109`、`list-row.tsx:87-91`）。
- **"灰外框 + 圆角内画布"** 分层（`R/apps/desktop/src/renderer/src/components/desktop-layout.tsx:127`）—— 若不喜欢 t3code 毛玻璃，可作为质感替代。
- **agent 执行记录**：`R/packages/views/common/task-transcript/agent-transcript-dialog.tsx`（状态胶囊 `色/15` 浅底 :739-800、工具图标映射 :205-221）。
- **Diff**：`detail-surfaces.tsx:27-78,202-282`（11px mono，`success/10` / `destructive/10` 行底）。
- **设置行**：`R/packages/views/settings/components/settings-layout.tsx:110-185`（控件最宽 56%、行最小高 64、自动保存状态图标）。
- **UI Lab**：`R/apps/ui-lab/`（token 实时调节工作台，思路可借鉴）。

## 截图

`R/apps/docs/public/images/docs/`：`chat-conversation.webp`、`task-transcript.webp`、`workspace-overview.webp`、`workspace-settings.webp` 等约 60 张。
