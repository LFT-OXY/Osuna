# 03 — 第一段适配：提供方

**What to build:** 「添加提供方」仍是 Osuna 的弹窗与行列表外观，搜索结果改用上游的匹配度排序；列表里有 Hoplite，能添加；写进配置的内置提供方（如 Hoplite）能在详情页删除。长自定义模型名的删除按钮修复挪到 Osuna 的提供方详情位置；元数据生成只用所选模型。`paseo usage` CLI 在主机关掉「读取 CLI 登录凭证」时说明原因，而不是只显示空列表。规格见 `prd.md`「提供方」「套餐用量」，裁决见 `research/feature-overlap.md` 3.2 第 2–7、29 条。

**Blocked by:** 01
**Status:** ready-for-agent
**Impl:** ready

- [ ] 「添加提供方」弹窗保留 Osuna 的行列表与行内错误，不是卡片网格；搜索结果按上游的匹配度排序，排序的测试保留并通过。
- [ ] 弹窗接上 Hoplite 的能力位；旧 daemon 不支持时的提示走翻译键，九种语言齐全。
- [ ] 提供方详情页的删除条件补上「写进配置的内置提供方可删除」，有测试。
- [ ] 长自定义模型名的删除按钮在 Osuna 的详情页上不被挤掉；`custom-model-removal`、`provider-removal` 两个 e2e 按 Osuna 结构适配。
- [ ] 元数据生成的新文案里 “Paseo” 改 “Osuna”，文档链接不放回。
- [ ] `paseo usage` 在主机关掉「读取 CLI 登录凭证」时输出原因，有测试。
- [ ] typecheck 和 lint 通过；改到的测试文件逐个单独跑过并通过（不跑整套）。
- [ ] 没有 Osuna 的断言被删除或放宽；必须跟着改的断言逐条记在 `## Comments` 下，供 14 写 PR 正文用。
- [ ] UI：dev 桌面端 1280 宽 / 设置 → Providers →「添加提供方」弹窗，输入搜索词 — 截图上是 Osuna 的行列表，有 Hoplite，文字是中文。
