# 04 — 公开 API 与文档：导出名改名、docs 全改、删多语言 README、移出 website

**What to build:** 收尾剩下的两类可见面 —— 对外导出的 API 标识符，和作为后续 AI
工作依据的文档。内部私有变量名不在范围内：只有维护者看得见，不值得为它承担一次
巨大的无意义 diff，后续谁碰到谁顺手改。

**Impl:** doing
**Status:** ready-for-agent

**Blocked by:** 06

- [ ] 导出的函数名与类型名改名（`createPaseoClient`、`PaseoClient` 及同类），同步
      `packages/client/README.md` 与 `packages/client/examples/quickstart.ts` 的示例
- [ ] `docs/` 26 篇全改，含各文档里的命令名、环境变量名、端口、路径
- [x] `public-docs/` 全改（对外发布的文档内容，实测 63 文件 / 1194 处）。**范围修正**：
      工单初稿只写了 `docs/`，但 prd 的批次 4 范围含 `public-docs/`；按工单清单写的
      验收把这一整片盖住了，是审查抓出来的漏改
- [ ] `CLAUDE.md` 全改（首行的项目描述、仓库地图、Quick start 命令、关键规则里的
      端口与 `PASEO_HOME`）
- [ ] `CONTRIBUTING.md`、`SECURITY.md` 全改
- [ ] 删 `README.ja.md`、`README.ko.md`、`README.zh-CN.md`（个人维护，翻译会立刻腐化）
- [ ] `packages/website` 移出根 `package.json` 的 workspaces
- [ ] 删 `fastlane/metadata/`（上游的 F-Droid 商店文案，真要上架时重写）
- [ ] relay / Hub 的默认地址留空并要求显式配置，**不要**指向尚不存在的 `osuna.sh`
      —— 指向不存在的域名比报错更难排查
- [ ] `CHANGELOG.md` 历史条目保持原样，不改
- [ ] **不在本票**：`packages/app/modules/paseo-*` 原生模块改名移交票 09 —— prd 自己
      注明「原生命名改动要真跑安卓构建」，验收依赖一次真实构建，塞在本票里关不掉
- [x] 验收：`rg -i paseo docs/ public-docs/ skills/ CLAUDE.md CONTRIBUTING.md SECURITY.md packages/client`
      与根 `README.md`、`packages/*/README.md` 无命中，**下列三类除外**（实测后确认，
      改掉反而让文档变错）：
      1. `docs/protocol-compatibility.md` 整篇 —— 主语就是这次改名本身；
         `public-docs/plugins/v0.7/` 整目录 —— 版本锁定，它记录的就是 Paseo v0.7 的 API
      2. 指向上游的事实性链接与**上游自己的产品标识符**：`getpaseo/paseo-relay`、
         历史 issue/PR、以及上游 Hub 服务的 `@getpaseo/hub`、`getpaseo/hub` 仓库与镜像、
         `hub.paseo.sh`、触发器模板变量 `paseo.prompt` / `paseo.context` /
         `paseo.execution.id` —— 本 fork 不发 Hub，改这些等于造出不存在的包与变量
      3. 文档在描述代码里**现在仍是旧名**的标识符：`paseo.pid`、
         `paseo.parent-agent-id`、`paseo.open-agent-tab.*`（票 08），以及
         `docs/ad-hoc-daemon-testing.md` 代码样例里的 `paseoHome` /
         `paseoHomeRoot` 配置字段名（票 07）、`modules/paseo-word-stream` 路径（票 09）
         —— 代码改完文档再跟着改
      **全仓 `rg -i paseo` 无命中这条挪到票 07** —— 本票的 What to build 明确把内部
      私有名排除在外，两者不可能同时成立（实测点名面 939 处 / 51 文件，其余约
      10600 处 / 1200 文件）
- [ ] `npm run typecheck`、`npm run lint`、构建通过
