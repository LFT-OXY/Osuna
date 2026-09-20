# 04 — 公开 API 与文档：导出名改名、docs 全改、删多语言 README、移出 website

**What to build:** 收尾剩下的两类可见面 —— 对外导出的 API 标识符，和作为后续 AI
工作依据的文档。内部私有变量名不在范围内：只有维护者看得见，不值得为它承担一次
巨大的无意义 diff，后续谁碰到谁顺手改。

**Impl:** done
**Status:** ready-for-agent

**Blocked by:** 06

- [x] 导出的函数名与类型名改名（`createPaseoClient`、`PaseoClient` 及同类），同步
      `packages/client/README.md` 与 `packages/client/examples/quickstart.ts` 的示例
- [x] `docs/` 26 篇全改，含各文档里的命令名、环境变量名、端口、路径
- [x] `public-docs/` 全改（对外发布的文档内容，实测 63 文件 / 1194 处）。**范围修正**：
      工单初稿只写了 `docs/`，但 prd 的批次 4 范围含 `public-docs/`；按工单清单写的
      验收把这一整片盖住了，是审查抓出来的漏改
- [x] `CLAUDE.md` 全改（首行的项目描述、仓库地图、Quick start 命令、关键规则里的
      端口与 `PASEO_HOME`）
- [x] `CONTRIBUTING.md`、`SECURITY.md` 全改
- [x] 删 `README.ja.md`、`README.ko.md`、`README.zh-CN.md`（个人维护，翻译会立刻腐化）
- [x] `packages/website` 移出根 `package.json` 的 workspaces
- [x] 删 `fastlane/metadata/`（上游的 F-Droid 商店文案，真要上架时重写）
- [x] relay / Hub 的默认地址留空并要求显式配置，**不要**指向尚不存在的 `osuna.sh`
      —— 指向不存在的域名比报错更难排查
- [x] `CHANGELOG.md` 历史条目保持原样，不改
- [x] **不在本票**：`packages/app/modules/paseo-*` 原生模块改名移交票 09 —— prd 自己
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
- [x] `npm run typecheck`、`npm run lint`、构建通过

## 落地记录

**范围被修正过一次。** 工单初稿只写 `docs/`，我按清单写的验收也只列了 `docs/` 等五处，
结果把 prd 批次 4 范围里的整片 `public-docs/`（63 文件 / 1194 处）盖住了。代码审查的
Spec 轴称之为「拿例外掩盖漏改」，判断成立。`public-docs/` 与 `skills/` 随后补做，验收
grep 扩到这两处；原生模块 `packages/app/modules/paseo-*` 拆到票 09（验收依赖真实安卓构建）。

**默认地址一共有七个生产者。** 票面只说「relay / Hub 的默认地址留空」，实际分布在
protocol/daemon-endpoints.ts（无人消费）、server/config.ts、pairing-offer.ts、
bootstrap.ts 两处、新家的默认持久化配置、cli/commands/hub/authority.ts、nix/module.nix。
漏掉任何一处，改名都等于没做。Hub 那处是**文档清扫反查出来的** —— 文档里对不上的
`hub.osuna.sh` 暴露了代码里还留着 `hub.paseo.sh`。

**两个偏离票面的设计判断：**
1. relay 启用但无端点时**不抛错**，而是保持离线并告警指名配置项。按票面写成抛错后
   `config.test.ts` 直接红了：省略 `relay.enabled` 的旧配置按 COMPAT 规则会解析成启用，
   抛错会让这些用户升级后 daemon 起不来。
2. `appBaseUrl` 未配置时配对链接与二维码返回 `null`，沿用既有的 `url: string | null`
   契约。**代价是没有自建 web app 的用户暂时拿不到配对二维码** —— 这是真功能缺口，
   不是纯清理。

**改名反查出的两处潜伏缺陷：**
- `stripInternalPaseoMcpServer` 按 key 查找 daemon 注入的 MCP 配置。key 改名后，
  改名前存下的老记录不再被剔除，会当成用户自定义 server 传给 agent、指向失效地址。
  改为按 URL 形状认领，并用旧 key 作输入钉住这条升级路径。
- `website/latest-release.ts` 的 dmg / AppImage 正则仍是 `Paseo-*`，而 electron-builder
  已产出 `Osuna-*`：`hasRequiredAssets` 会把今后每个 release 判为不合格，下载页永远拿不到
  版本；夹具同样停在旧名，绿灯掩盖了断裂。同文件的 `GITHUB_RELEASES_URL` 还指着上游 API。

**我在这一票里犯了两轮同类错误**，都是跨层指南白纸黑字记着的「通用规则会造出比两端都糟
的标识符」：第一轮把 `"paseo.` 当规则，改出了 `osuna.sh` 域名（已整批撤回重做）；第二轮
造出 `getosuna/osuna` 组织、`hub.osuna.sh` 等 11 个不存在的标识符，以及「Osuna is a fork
of Osuna」。教训已按可执行形式折回
`.atw/spec/guides/cross-layer-thinking-guide.md`：**先占位保护再 sweep、保护清单分三类、
反向 grep 查自己造了什么**。第二轮正是靠这条反查把 11 个全部抓回来的。

**另两条折回 spec 的**：文档不能跑在代码前面改（文档清扫本质是对代码的一致性检查）；
改文件名会在 `dist/` 留下活着的孤儿，源码层 sweep 证明不了运行时正确。

**全量单测**：5778 passed / 6 failed。三条是本票的测试主语变了，已按新行为重写；另三条
与本票无关 —— `bootstrap-provider-availability` 与 `workspace-service-port-allocator`
在基线上同样失败，`github-service` 单独跑 3 次全绿属并发 flaky。

**未验的一段**：`packages/website` 已移出 workspace，其 vitest 因 Cloudflare vite 插件
配置冲突起不来（与本次改动无关），所以 website 的改动只有 typecheck 与 lint 背书。
