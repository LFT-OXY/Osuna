# 01 — 共用 agent 链接解析器与两段式 target

**What to build:**
- 前置重构。Agent mention 链接的序列化、解析（`paseo://agent/` 前缀、`encodeURIComponent` 编码、`provider/<id>` 与 `profile/<id>` 两种 kind）和整条 Markdown 链接的匹配规则（排除 `![`、`\[`）抽到 `packages/protocol` 的新模块，供 app 与 daemon 共用。
- app 行内块的智能体块类型从单个 `target` 改为带 kind 的形式，气泡、Queue track、Rewind、导入会话都经新解析器认出块。
- 块图标：provider 用 provider 图标；profile 用它的 `icon`，认不出时用所属 provider 的图标，profile 已删除时退回 `Bot`。旧气泡显示发送时的 label。
- 本票不加 `@` 智能体分组，也不改 daemon 行为。

**Blocked by:** None — can start immediately
**Status:** ready-for-agent
**Impl:** done

- [x] agent 链接的解析与序列化只有 `packages/protocol` 里一份，app 行内块模块改用它，没有第二份实现。
- [x] 单测覆盖：两种 kind、编码与含特殊字符的 id、解码后含 `/` 的 target 被拒、排除 `![` 与 `\[`、序列化后再解析得到原结构。
- [x] 气泡里 `paseo://agent/provider/<id>` 与 `paseo://agent/profile/<id>` 两种链接都显示成块，图标按上述规则取。
- [x] 现有行内块单测与 `composer-inline-blocks.spec.ts` 通过。
- [x] `npm run typecheck`、`npm run lint` 通过。
