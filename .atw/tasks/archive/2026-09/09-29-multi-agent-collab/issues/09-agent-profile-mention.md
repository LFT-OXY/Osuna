# 09 — Agent profile mention

**What to build:**
- `@` 列表在 provider 后面列出 provider 已启用的 Agent profile，显示名字、图标、颜色，副文字写所属 provider；过滤匹配 profile 名。
- Routing block 对 profile mention 按"profile 字段 → 该 provider 的 Mention defaults → 运行时默认"逐字段叠加，`featureValues` 原样放进 `settings.features`。
- profile 已删除或其 provider 不可用时，该 mention 写"无法启动：原因"。

**Blocked by:** 06, 07
**Status:** ready-for-agent
**Impl:** done

- [x] 浏览器 e2e：profile 排在 provider 后面，显示正确的图标与名字，选中插入 `paseo://agent/profile/<id>` 块。
- [x] daemon 测试：profile 字段优先、缺的字段取 Mention defaults、再缺取运行时默认；`featureValues` 进入 settings。
- [x] daemon 测试：profile 已删除、provider 已停用时写原因，其余 mention 照常。
- [x] `npm run typecheck`、`npm run lint` 通过。
