# 04 — 公开 API 与文档：导出名改名、docs 全改、删多语言 README、移出 website

**What to build:** 收尾剩下的两类可见面 —— 对外导出的 API 标识符，和作为后续 AI
工作依据的文档。内部私有变量名不在范围内：只有维护者看得见，不值得为它承担一次
巨大的无意义 diff，后续谁碰到谁顺手改。

**Impl:** ready
**Status:** ready-for-agent

**Blocked by:** 03

- [ ] 导出的函数名与类型名改名（`createPaseoClient`、`PaseoClient` 及同类），同步
      `packages/client/README.md` 与 `packages/client/examples/quickstart.ts` 的示例
- [ ] `docs/` 26 篇全改，含各文档里的命令名、环境变量名、端口、路径
- [ ] `CLAUDE.md` 全改（首行的项目描述、仓库地图、Quick start 命令、关键规则里的
      端口与 `PASEO_HOME`）
- [ ] `CONTRIBUTING.md`、`SECURITY.md` 全改
- [ ] 删 `README.ja.md`、`README.ko.md`、`README.zh-CN.md`（个人维护，翻译会立刻腐化）
- [ ] `packages/website` 移出根 `package.json` 的 workspaces
- [ ] 删 `fastlane/metadata/`（上游的 F-Droid 商店文案，真要上架时重写）
- [ ] relay / Hub 的默认地址留空并要求显式配置，**不要**指向尚不存在的 `osuna.sh`
      —— 指向不存在的域名比报错更难排查
- [ ] `CHANGELOG.md` 历史条目保持原样，不改
- [ ] 验收：`rg -i paseo` 在排除 `CHANGELOG.md` 与 `LICENSE` 原版权行后无命中
- [ ] `npm run typecheck`、`npm run lint`、构建通过
