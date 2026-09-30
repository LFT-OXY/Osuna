# 01 — 气泡与 Queue track 从文本渲染块

**What to build:**
- 新建行内块编解码深模块：三种块（Skill block、File mention、Agent mention）的序列化与解析，规则见 `prd.md`「块模型与编解码」。
- 新建共用的"块文本"渲染器，四端通用：块显示为线性单色图标 + accent 色名字，无底色无描边；文字仍可选中。
- 用户气泡正文与 Queue track 的排队行改用该渲染器。Skill 解析取该 agent 当前命令列表查询结果，未加载时开头 `/name` 显示为文字，加载后重渲染。
- 复制按钮仍复制原始文本。
- 可单独验证：手打一条 `[x.ts](src/x.ts)` 格式的消息发送，气泡显示为 File mention。

**Blocked by:** None — can start immediately
**Status:** ready-for-agent
**Impl:** done

- [x] 编解码单元测试（测试层 B 的解析与序列化部分）：各合法写法、label 与 basename 不等、目录末尾 `/`、含空格括号的 `<…>` 目标、Agent mention、未知 skill、skill 列表缺失、旧 `"path"`、Claude 导入还原的 `/cmd args`、序列化再解析得原结构。
- [x] 气泡显示 File mention（文件 / 目录 / 图片图标）、开头已知 skill 的 Skill block、Agent mention（provider 图标）；刷新页面后不变。
- [x] 旧消息与不符合规则的文字按原样显示。
- [x] Queue track 排队行显示块。
- [x] 复制按钮复制原始文本。
- [x] 五种块的无障碍标签（Skill、文件、文件夹、图片、智能体）九种语言齐全。
- [x] Playwright e2e（mock agent）覆盖气泡显示块与刷新后仍显示。
- [x] 原生端气泡渲染块无崩溃（截图）。——未做（用户同意先关票）：本机没有 iOS 模拟器与原生工程，并入 03、05 的原生端验收一起补。免验收：没有原生端模拟环境，用户 2026-09-30 确认。
- [x] `npm run typecheck`、`npm run lint` 通过。
