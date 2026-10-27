# 12 — 第六、七段：合并到 v0.13.0

**What to build:** 合并分支上依次有两个 merge commit，分别合进上游 `30d8cb044`（v0.13.0-beta.2）与 `d34d17a90`（v0.13.0），每个之后分支都能通过检查。这两段带进来终端去掉 WebView 渲染器与粘贴图片、拖入文件，经中继连接必须带密码（#7668），Claude 代理的重写，术语表与发版文档的上游改动，安卓商店说明。规格见 `prd.md`「终端」「中继密码」「提供方」「文档」。

**Blocked by:** 07, 08, 09, 10, 11
**Status:** ready-for-agent
**Impl:** ready

- [ ] 两个 merge commit 的双亲分别是合并前的分支头与对应的上游发布点；每段合完都过一遍本清单里的通用项，结果按段记在 `## Comments` 下。
- [ ] 终端：接受删掉 WebView 渲染器，设置页与存储测试里对旧渲染器开关的引用已清掉；Osuna 的字体、字号、四边内边距、配色派生与 DECSET 2031 主题推送的现有测试通过。
- [ ] 中继密码：接受强制校验，`relayPasswordOptional` 分支已删；会话准入认证的测试按新行为改预期并记下；`SECURITY.md` 与 `public-docs/security*.md` 不再写「放行不带密码的中继连接」；给下次发版更新日志的「行为变化」说明草稿记在 `## Comments` 下。
- [ ] Claude 代理的重写与 Osuna 的指令发现、Routing block 剥离、已装版本与一键升级两边都留；上游新 Claude 用例若触发进程启动，按 `.atw/spec/server/backend/testing.md` 改用例不改实现。
- [ ] `server/bootstrap.ts` 解完后不出现提供方名字。
- [ ] `docs/glossary.md`、`docs/release.md` 的冲突两边都留，术语以 Osuna 的为准。
- [ ] 合并前按 `docs/release.md`「合并后核对」的口径统计应用与 CLI 源码中指向上游站点的链接数（全部与非测试），记在 `## Comments` 下；合完后非测试数不多于合并前。
- [ ] 每个冲突文件怎么裁的、依据哪条规则，按区域逐个记在 `## Comments` 下，供 14 写 PR 正文用。规则裁决不了、或保留两边会改变用户可见行为的冲突没有自行取舍：已停下来问过维护者，问答记在 `## Comments` 下。
- [ ] 所有工作区版本号是 `0.17.0`；各 `package.json` 相对合并前的差异只有上游在版本号之外的改动；`package-lock.json` 是重新生成的，差异能逐项对应到上游新增或升级的依赖。
- [ ] `CHANGELOG.md` 与合并前逐字节相同；与 Osuna 同名的安卓商店说明文件留 Osuna 的；README 与 `CLAUDE.md` 的冲突块取 Osuna 的。
- [ ] 协议新增的字段都是可选的，协议的现有测试无一改动断言；上游新带进来的 `COMPAT(...)` 标签（合并前 main 上不存在的名字）改写为 `v0.18.0`，清单记在 `## Comments` 下。
- [ ] `docs/release.md`「合并后核对」逐项过完，结果记在 `## Comments` 下：更新源、桌面身份与数据目录、签名与签名断言、只手动触发的部署工作流、上游站点链接、翻译键。
- [ ] 翻译资源测试单独跑过并通过；上游新增的键九种语言齐全，zh-CN 是真实翻译、符合术语表。
- [ ] 对本段冲突涉及的测试文件对比合并前后，没有 Osuna 的断言行被悄悄删掉；必须跟着改的断言逐条记在 `## Comments` 下。
- [ ] 指令目录的现有测试全部通过，无一改动断言；取指令列表不启动进程（ADR 0003）。
- [ ] typecheck 和 lint 通过；本段冲突文件对应的测试文件、以及本段新增或改动过的测试文件逐个单独跑过并通过（不跑整套）。
- [ ] 合并分支包含 `d34d17a90`；`759532509` 与 `d34d17a90` 都是合并分支的祖先。
- [ ] dev 桌面端快速冒烟：侧栏、输入框、终端（粘贴一张图片）、Providers 页、第三方接口页、用量页、逻辑图、关于页打开正常，无报错。

## Comments

- 从工单 03 挪来：上游 #7611「元数据生成只用所选模型」（`457414231`）在第 6 段进来。合完照收逻辑（`structured-generation-providers.ts`、`git-metadata-generator.ts`），文案键 `fallbackHint` 换成 `modelHint` 后，九种语言里的 “Paseo” 改 “Osuna”（main 的 `fallbackHint` 已是），`metadata-generation-page.tsx` 不放回 paseo.sh 文档链接（feature-overlap 3.2 第 5 条）。
- 从工单 10 挪来：上游 #7683（`21e7ccb03`）在第 6 段把结束通知搬进 `agent/finish-subscriptions/internal/notification.ts`。合完把 Osuna 的权限文案（由用户在子会话里批准、未授权别用 `respond_to_permission`，现在在 `agent-prompt.ts` 的 `setupFinishNotification`）搬进新文件，同时收下上游的 `host unreachable`、`host removed` 两种原因，`serverId` 本段已有、照留（prd「连接的主机与 Agent 间消息」）；`agent-prompt.test.ts`「finish notifications survive permission responses」若随上游删掉，挪进新文件对应的测试，断言原文不变；再跑一次 `subagent-permission.e2e`。
