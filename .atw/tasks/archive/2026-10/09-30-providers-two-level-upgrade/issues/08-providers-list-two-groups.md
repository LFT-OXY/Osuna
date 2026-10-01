# 08 — Providers 列表分"已启用""已停用"两组，「添加提供方」只留 ACP 目录

**What to build:** 设置 → Providers 里所有提供方都在一页：启用的在"已启用"组（可用、检测中、出错、未安装都在这里，各自显示状态），停用的在"已停用"组，包括添加过又关掉的自定义 / ACP 提供方。两组每行都有开关，拨一下，快照更新后这一行就出现在另一组，背景短暂高亮（系统要求减少动态效果时不高亮）。已停用的行图标变淡、标题变灰，状态行写"已停用 · 启用后检测是否已安装"，不再标"未安装"。点任何一行都只进详情页，不改配置。「+」打开的「添加提供方」弹窗只剩搜索框和 ACP 目录，"添加"改成 outline 按钮；从 ACP 添加成功后仍关闭弹窗、进入新提供方的详情页。设计见 `design/design-brief.md`（方向 01）。

**Blocked by:** None — can start immediately
**Status:** ready-for-agent
**Impl:** done

- [x] 分组规则只看 `enabled`；"已停用"组为空时连标题一起不显示，"已启用"组为空时显示空提示；「+」在"已启用"组标题上
- [x] 两组每行都有开关，写入 `enabled`；开关失败时错误显示在"已启用"卡片顶部，行不移动
- [x] 点"已停用"的一行只导航到详情页，不写配置
- [x] 「添加提供方」弹窗没有"未启用"组，ACP"添加"为 outline；不再使用的文案和组件删掉
- [x] 组件测试覆盖分组、两个方向的开关写入、点击只导航、弹窗只有 ACP 目录；分组规则的单测随之修改
- [x] `acp-provider-catalog.spec.ts` 和 `settings-providers-list-detail.spec.ts` 依赖旧规则的断言已修改
- [x] `docs/glossary.md` 的 **Add provider** 条目、`docs/design.md` 里相关句子已更新；新增文案 9 个语言文件都补上
- [x] Web 和 Electron 截图：列表两组、拨开关前后、添加提供方弹窗
- [x] typecheck 和 lint 都通过
