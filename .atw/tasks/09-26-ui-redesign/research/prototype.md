# 原型（2026-09-26）

- 文件：`/private/tmp/claude-501/-Users-oxy-Documents-code-My-Osuna/c362dbf0-0eee-4c61-b721-f9bc7d8d289c/scratchpad/osuna-ui-prototype.html`（会话 scratchpad，系统清理临时目录后会消失；需要长期保留时由用户决定挪到哪里）
- 按用户决定：单个本地 HTML，不进 git、不发布线上。这偏离了 atw-prototype 的"推到一次性分支"约定，是用户的明确选择。
- 回答的问题：t3code 风格 token 落到 Osuna 结构上的观感；左侧栏 V1 / V2 / V3 选哪种；暗色侧栏明度方向；V2 标题取值。
- URL 参数：`sb=v1|v2|v3`、`theme=dark|light`、`tone=darker|lighter`、`v2title=agent|name`、`page=workspace|settings`、`overlay=none|menu|dialog`、`split=0|1`、`glass=1|0`；键盘 ← / → 切换左侧栏。
- token 取值：t3code `themePalettes.ts` 默认主题；圆角 6/8/10/14/18/22；系统字体栈。
- 已知简化：没有 hover 卡片、拖拽、真实滚动数据；"原生降级"只是关掉毛玻璃和噪点的近似效果。

## 结论

用户于 2026-09-26 确认"按推荐来"：

- **左侧栏用 V1**（现状结构换皮：36px 单行 + 右侧 ±diff，第二行按现有显示偏好展示分支 / PR / 主机 / 标签）。零数据改动，密度最高，兼容 project / status 两种分组。
- **从 V3 借两处**（不需新数据）：选中态用细描边 + 轻底色而非整块底色；未读 / 需要处理（现有 `attention` 状态）时标题加粗。
- **不采用 V2**：Osuna 一行是工作区（可含多个 agent），t3code 式"对话标题"行没有唯一取值；且打平项目分组、78px 行高密度低。
- **不采用 V3 的内嵌 agent 行**：需新增每工作区 agent 列表数据，行高约 116px。列为后续独立增强（例如仅选中工作区展开），不在本任务范围。
- **暗色侧栏比主区更暗**（t3code：sidebar #000 / canvas #0a0a0a），与主参考、Osuna 现状一致，与右侧 Explorer 对称。
- V2 标题问题随 V2 不采用而作废。
- 整体观感（t3code token、毛玻璃仅 Web / Electron、系统字体）用户接受。
