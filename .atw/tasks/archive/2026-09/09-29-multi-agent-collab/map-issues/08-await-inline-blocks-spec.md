# 08 — 等待 `09-29-composer-inline-blocks` 的 spec 确认

**Type:** task
**Blocked by:** None
**Status:** resolved

## Question

行内块的线格式（块类型、正文区间、可读标记长什么样、草稿/排队/发送失败恢复中的表示、气泡渲染用的结构化字段）由前置任务 `09-29-composer-inline-blocks` 决定。该任务的 `prd.md` 通过 stop ② 后关闭本票，Answer 记下：块的线格式、智能体块可用的扩展位、可读标记文本、原生端保真度结论。HITL：由用户推进前置任务并通知。

## Answer

前置任务已通过 stop ② 并实现、归档（`.atw/tasks/archive/2026-09/09-29-composer-inline-blocks/prd.md`；决策 `docs/adr/0005-inline-blocks-live-in-message-text.md`）。本票要的四项：

- **块的线格式**：没有线格式。块就是正文里的普通文字，协议与 daemon 不改、不加能力开关。智能体块写作 `[@显示名](paseo://agent/<target>)`，`target` 经 `encodeURIComponent` 编码；气泡、Queue track、Rewind、导入会话都从文本解析（`packages/app/src/inline-blocks/index.ts` 的 `serializeInlineBlock` / `resolveLinkBlock`）。未发送状态（草稿、排队、发送失败恢复）另存 app 端分段结构 `segments`，不上线。
- **智能体块的扩展位**：只有一个不透明的 `target` 字符串（类型 `{ kind: "agent"; target; name }`，注释写"provider 或 profile 标识"），解码后不能含 `/`；没有别的槽位。模型、模式、思考档位不进块，由 daemon 发送时按 05 号票的规则解析。provider 与 profile 怎么在 `target` 里区分没有定——而这个格式一旦写进历史就冻结（ADR 0005 Consequences），所以要在 09 号票里第一个定。图标按 `getProviderIcon(target)` 取，认不出时退回 `Bot`，profile 目前会显示成 `Bot`。
- **可读标记文本**：`@显示名` 放在链接 label 里；agent 看到的就是 Markdown 链接原文。官方 Paseo 手机 App 显示链接原文。
- **原生端保真度**：原生端输入框仍是 `TextInput`，不显示块；选中项以序列化文字插入（skill 插在开头 `/name `，文件插链接文字）。智能体选中时照此插入链接文字即可。气泡与 Queue track 四端都显示块。原生端手打的链接与插入的链接分不开（已接受）。

对本 map 的影响：
- PRD 原定的 `mentions` 协议字段作废（`prd.md` 第 18 行已记），daemon 从正文提取 Agent mention 链接。因此 09 号票的 (1)(2) 改问"target 命名空间"和"daemon 在哪里、用什么解析器提取"，见 09 号票更新。
- 前置任务里 Agent mention 只经解析出现，输入框没有插入入口；`@` 列表的智能体分组、置灰和插入归本任务。
