# 03 — 桌面端模型菜单限定为当前提供方

**What to build:** 在桌面/Web 端，模型按钮点开的菜单只列当前提供方的模型，不再有跨提供方的「全部」视图和返回入口。搜索只在当前提供方的模型里匹配。（收藏已在 v0.3.2 移除并迁移为 Agent profiles，没有收藏区可过滤。）Agent profiles 区保留并展示全部 profiles；套用一个指向其他提供方的 profile 时，提供方按钮同步切换。运行中的 Agent 仍可切换同一提供方下的模型。

**Status:** ready-for-agent
**Impl:** done
**Blocked by:** 02

- [x] 模型浏览器的初始视图固定为当前提供方，没有「全部」视图和返回入口
- [x] 搜索结果不包含其他提供方的模型（收藏项不适用，见上）
- [x] Agent profiles 全部可见；套用跨提供方的 profile 后，提供方按钮和模型按钮都更新为该 profile 的值
- [x] 共享同一模型浏览器的定时任务表单和元数据生成设置页，其行为变化已确认，没有导致功能缺失（两处传 `scope="allProviders"`，行为不变，各自 e2e 通过）
- [x] 模型浏览器视图的单元测试覆盖单一提供方下的初始视图、搜索范围和 profiles 展示范围
- [x] 浏览器 e2e 覆盖搜索范围和 profile 联动切换提供方；typecheck 和 lint 通过
