# 15 — 模型选择弹框高度算上分组标题

**What to build:** 工单 14 真实验收发现：总开关打开后，聊天里的模型选择弹框比内容矮，只露出两三行就要滚动（官方模式模型多、已到上限 400，看不出）。原因是 `packages/app/src/components/model-browser.tsx` 的 `resolveDesktopFixedHeight` 只按模型个数估高度，漏算了 10 票加的接口分组标题行（`buildModelListItems` 产出的 `group` 项）、顶部配置区，基数 80 也比标题搜索区加列表留白小。估算改成按弹框里的全部内容算，上下限不变。对应 prd R-E7。

**Blocked by:** None
**Status:** ready-for-agent
**Impl:** done

- [x] 高度估算按弹框全部内容算（标题与搜索、列表留白、配置区、接口组标题、模型行）：一家接口、四个已选模型时弹框装下全部行不用滚动；内容超过上限时仍停在 400 并可滚动。（单元：对估算函数断言）
- [x] Claude Code 官方模式的弹框仍停在 400 上限，与改动前一致；官方模型少的提供方会变高（用户 10-15 认可）。（单元）
- [x] UI: 聊天模型选择弹框 / 总开关打开、一家接口四个模型 / 桌面 1280 — 全部模型一屏可见；截图与官方模式对照。

## Comments

- 照票面只补分组标题不够：1280 桌面 Web 上实测标题与搜索 83、列表上下留白 36、「创建 Agent 配置」行 36、配置区标题 27 + 每个配置 36 + 分隔线 1、接口组标题 27、模型行 40；一家四个模型要 342，只补组标题是 280，仍要滚。用户 10-15 选「全部算进去」：估算挪到 `model-browser-view.ts` 的 `resolveModelBrowserDesktopHeight`，基数 120、组标题 28、配置行 36、模型行 40，上下限 220 / 400 不变。
- 第二条验收原写「官方模式高度与改动前一致」，随上面的决定改写。官方模型少的提供方会变高：本机 Codex 官方 7 个可见模型，从 360 变 400（原来同样要滚）。
- 截图（浏览器 Web、浅色、英文、1280×800，一次性 Playwright 用例 + 假中转站，拍完删除）：`screenshots/15-model-picker_switch-on-one-endpoint-four-models_*`（344 高、不滚动）、`15-model-picker_switch-off-official_*`（400，对照）、`15-model-picker_switch-on-one-endpoint-two-profiles_*`（顶到 400，余 7 像素可滚）。
- 票外发现，未修：配置行的说明直接显示配置存的模型 id，接口模型会露出 `标识/模型名`（见 two-profiles 截图里的 `yunwuzhongzhuan/kimi-k2`），和 10 票「不显示斜杠拼接名」不一致。
