# 15 — 模型选择弹框高度算上分组标题

**What to build:** 工单 14 真实验收发现：总开关打开后，聊天里的模型选择弹框比内容矮，只露出两三行就要滚动（官方模式模型多、已到上限 400，看不出）。原因是 `packages/app/src/components/model-browser.tsx` 的 `resolveDesktopFixedHeight` 只按模型个数估高度，没算 10 票加的接口分组标题行（`buildModelListItems` 产出的 `group` 项）。估算改成按列表实际行数（模型行 + 分组标题行）算，上下限不变。对应 prd R-E7。

**Blocked by:** None
**Status:** ready-for-agent
**Impl:** ready

- [ ] 高度估算按列表实际行数算：一家接口、四个已选模型时弹框装下全部行不用滚动；行数超过上限时仍停在 400 并可滚动。（单元：对估算函数断言）
- [ ] 官方模式（无分组）的弹框高度与改动前一致。（单元）
- [ ] UI: 聊天模型选择弹框 / 总开关打开、一家接口四个模型 / 桌面 1280 — 全部模型一屏可见；截图与官方模式对照。
