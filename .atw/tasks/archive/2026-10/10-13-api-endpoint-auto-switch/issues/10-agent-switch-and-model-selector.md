# 10 — Agent 页总开关、默认模型与聊天模型选择器

**What to build:** Claude Code / Codex 提供方详情页的「第三方接口」区只剩一张三行卡片：「使用第三方接口」总开关（没有「开着且已选模型」的接口或 daemon 以 socket 监听时不可打开并说明原因）、「默认模型」下拉（光秃秃模型名，开着接口已选模型合并去重，总开关关时隐藏）、「管理第三方接口 ›」入口行（汇总「N 个开着 · 某家冷却中，x 分钟后恢复」）。现有「官方 / 使用」单选行、行内编辑删除、健康提示去掉。聊天模型选择器在这两个 Agent 下按接口名分组（创建顺序）、模型名前加家族小图标、只列开着接口的已选模型、同名模型在各家下各出现一次；选某家下的模型，会话内部用「标识/模型名」发给 CLI，界面只显示光秃秃模型名。Osuna 新建对话优先用记住的上次选择，没有时用默认模型。对应 prd R-E4、R-E5、R-A2。

**Blocked by:** 03, 09
**Status:** ready-for-agent
**Impl:** done

- [x] UI: Claude Code 页 / 总开关可打开、已打开 / 桌面 1280 — 三行卡片、默认模型下拉有值、入口行汇总正确；旧的单选行与行内操作不再出现。
- [x] UI: Claude Code 页 / 总开关不可打开 / 桌面 1280 — 开关灰掉，说明为「先到「第三方接口」页开启一家并勾选模型」或 socket 监听原因。
- [x] UI: 聊天模型选择器 / 两家接口各有已选模型且有同名 / 桌面 1280 — 按接口名分组、每个模型名前有家族小图标、同名模型在两组各出现一次、不显示斜杠拼接名。
- [x] 打开总开关后 daemon 改写 CLI 配置指向中转站（03 的行为）并自动得到默认模型；关掉后恢复、默认模型下拉隐藏。（Playwright + e2e）
- [x] 选某家下的模型发消息，daemon 收到的会话模型为该家的「标识/模型名」，中转站把请求送到那家；时间线与选择器显示光秃秃模型名。（Playwright + e2e）（用户 10-15 决定：本机不能跑 Claude Code，「界面把请求发给后台」这一步不测；选择器选中哪家由 Playwright 验证，`标识/模型名` 送到那家由 `api-endpoint-gateway.e2e.test.ts` 验证，Codex 选择器另有 Playwright 用例。）
- [x] 新建对话：有记住的上次选择用它，否则用默认模型；默认模型因失踪规则改变后下拉随之更新。（Playwright）
- [x] 所有新文案九种语言齐全，资源测试通过。

## Comments

- 10 票已落下：提供方快照新增可选 `apiEndpointModelGroups`（每家开着且选了模型的接口一组，模型 id 是不透明的 `标识/模型名`，label 光秃秃），新客户端的选择器、新建表单、composer、定时任务一律经 `selectableEntryModels(entry)` 取模型。这是 01 票「slug 不进任何响应」的例外：slug 仍不作为字段出现，只出现在快照的模型 id 里；规范已改（`persistence.md`、`rpc-and-protocol.md`）。
- 官方模式下，用第三方接口时记下的带斜杠模型（记忆或开着的草稿）改用默认模型，免得官方 CLI 收到 `relay-b/…`；子智能体行经 `resolveSnapshotModelLabel` 只显示光秃秃模型名。
- 旧的单选区、旧表单（`form-sheet.tsx`、`internal/form-model.ts`、`use-api-endpoints.ts`）与健康提示（`internal/section-state.ts`）已删。它们用到的约 60 个 `settings.providers.apiEndpoints.*` 翻译键成了孤儿，九种语言里都还在，交 12 票删除并同步守卫表。
- 交 12 票：不可打开的开关轨道太淡，几乎看不出有开关（共用 `Switch` 的禁用样式，改它影响全 App）；选择器勾号与齿轮右边距不齐、组标题与上一组间距偏小。
- 「第三方接口」区仍在「版本」「安装与升级」之后，没有照原型挪到页头下：`provider-detail/index.test.tsx` 有意固定了这个顺序（CLI 未安装时安装说明要排在前面）。
- 截图：`screenshots/agent-page_switch-on_*`、`agent-page_switch-blocked_*`、`model-selector_grouped-top_*`、`model-selector_grouped-shared-name_*`（浅色、中文、1280；深色与 Electron 归 12 票）。
