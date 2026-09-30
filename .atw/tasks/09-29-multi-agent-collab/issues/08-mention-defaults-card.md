# 08 — 提及智能体默认值卡片

**What to build:**
- 设置 → Host → Agents 的"Agents"区块之后新增 section「提及智能体默认值」，行为以 06 号决策票与原型 `prototype/mention-defaults-card.html`（方案 B）为准：每个已启用 provider 一行摘要，展开是模型、思考、模式三条下拉；即时保存；首项"默认（X）"；换模型后思考档位联动清回默认并短暂提示；不支持时置灰；失效值显示 ⚠ 与"将使用默认（X）"；加载中与出错状态；"全部恢复默认"；Osuna tools 关闭时顶部提示但照常可编辑；老 Host 只显示更新提示。
- 保存失败时在卡片内显示可重试的错误。
- 新文案补齐九种语言。

**Blocked by:** 07
**Status:** ready-for-agent
**Impl:** ready

- [ ] 浏览器 e2e：选择后刷新页面值仍在；选"默认（X）"清除覆盖；换模型后档位清回默认并出现提示。
- [ ] 浏览器 e2e：失效值显示警示与"将使用默认（X）"；全部恢复默认清空该 provider 配置。
- [ ] 浏览器 e2e：保存失败时界面显示错误并可重试。
- [ ] Osuna tools 关闭提示与老 Host 提示正确。
- [ ] Electron QA 截图：浅色、深色各一张（含展开行与失效值）。
- [ ] `npm run typecheck`、`npm run lint` 通过。
