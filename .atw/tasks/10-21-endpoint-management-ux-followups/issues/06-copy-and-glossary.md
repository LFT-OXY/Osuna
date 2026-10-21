# 06 — 文案与术语

**What to build:** 英文模型搜索框单复数正确；术语表里接口「导入」与把提供方会话转成 Agent 会话的 Import 不再互相矛盾，并补上「忘掉拉到的清单」「内置图标」「逐个模型」；规范写明冷却设置在编辑窗口的「高级」区。

**Blocked by:** 02
**Status:** ready-for-agent
**Impl:** ready

- [ ] 英文只有 1 个模型时写「Search 1 model」，多个时复数；走 i18n 单复数，9 种语言资源测试通过。
- [ ] `docs/glossary.md`：两条 Import 的互斥说明改写一致；新增 Forget fetched list、Built-in icons、Each model 三条，中文与界面一致。
- [ ] 前端规范写明冷却设置位于编辑窗口的「高级」区（取代原工单「接口详情页」的字面）。
- [ ] `npm run typecheck`、`npm run lint` 通过，改到的测试文件本机通过。

参考：prd.md 用户故事 13、18、22、23。
