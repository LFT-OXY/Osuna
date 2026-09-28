# 04 — 手机端 sheet 的「提供方」行与限定后的「模型」行

**What to build:** 在紧凑布局（手机）下，Agent controls sheet 新增「提供方」行，行上显示品牌色图标和提供方名字，点进去是和桌面端分组规则一样的提供方列表（平铺加「More agents (N)」，当前项打勾）。「模型」行进入的模型列表只列当前提供方的模型。运行中的 Agent 上，「提供方」行只读。

**Status:** ready-for-agent
**Impl:** done
**Blocked by:** 02, 03

- [x] sheet 里「提供方」行位于「模型」行之前，显示品牌色图标和名字
- [x] 提供方列表复用 02 的分组函数，行为和桌面端一致
- [x] 在草稿里切换提供方后，模型的记忆与默认规则和桌面端一致
- [x] 「模型」行只列当前提供方的模型，搜索范围与 03 一致：`model-sheet.tsx` 里两个 `useModelBrowser` 的 `scope` 从 `"allProviders"` 改为 `"selectedProvider"`
- [x] 运行中的 Agent 上「提供方」行只读，点击没有反应
- [x] 现有 Maestro 模型 sheet 流程如果因为新增的行受影响，同步更新（不在本地跑，交给 CI）；typecheck 和 lint 通过（`model-tablet-agent.android.ad` 已改为弹窗直接列当前提供方的模型；`model.android.ad` 的坐标下拉未本地验证）
