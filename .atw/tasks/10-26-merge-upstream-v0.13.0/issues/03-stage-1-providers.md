# 03 — 第一段适配：提供方

**What to build:** 「添加提供方」仍是 Osuna 的弹窗与行列表外观，搜索结果改用上游的匹配度排序；列表里有 Hoplite，能添加；写进配置的内置提供方（如 Hoplite）能在详情页删除。长自定义模型名的删除按钮修复挪到 Osuna 的提供方详情位置；元数据生成只用所选模型。`paseo usage` CLI 在主机关掉「读取 CLI 登录凭证」时说明原因，而不是只显示空列表。规格见 `prd.md`「提供方」「套餐用量」，裁决见 `research/feature-overlap.md` 3.2 第 2–7、29 条。

**Blocked by:** 01
**Status:** ready-for-agent
**Impl:** done

- [ ] 「添加提供方」弹窗保留 Osuna 的行列表与行内错误，不是卡片网格；搜索结果按上游的匹配度排序，排序的测试保留并通过。
- [ ] 弹窗接上 Hoplite 的能力位；旧 daemon 不支持时的提示走翻译键，九种语言齐全。
- [ ] 提供方详情页的删除条件补上「写进配置的内置提供方可删除」，有测试。
- [ ] 长自定义模型名的删除按钮在 Osuna 的详情页上不被挤掉；`custom-model-removal`、`provider-removal` 两个 e2e 按 Osuna 结构适配。
- [ ] 元数据生成的新文案里 “Paseo” 改 “Osuna”，文档链接不放回。
- [ ] `paseo usage` 在主机关掉「读取 CLI 登录凭证」时输出原因，有测试。
- [ ] typecheck 和 lint 通过；改到的测试文件逐个单独跑过并通过（不跑整套）。
- [ ] 没有 Osuna 的断言被删除或放宽；必须跟着改的断言逐条记在 `## Comments` 下，供 14 写 PR 正文用。
- [ ] UI：dev 桌面端 1280 宽 / 设置 → Providers →「添加提供方」弹窗，输入搜索词 — 截图上是 Osuna 的行列表，有 Hoplite，文字是中文。

## Comments

### 做了什么
- 「添加提供方」：Osuna 的弹窗与行列表、行内错误都没变；列表的过滤换成上游 `rankProviderCatalog`（`components/provider-catalog-list.tsx`），排序测试 `provider-catalog-search.test.ts` 保留并通过。两处随之变化：无搜索词时按名称字母排序（原来按目录顺序）；搜索只匹配名称和 id，不再匹配描述（上游有意只匹配行上显眼的字段，子序列匹配用在长描述上几乎什么都能匹配上）。
- Hoplite：弹窗把 `features.hopliteProvider` 传给 `buildAcpProviderConfigPatch`；主机不支持时报 `providerCatalog.errors.hostUpdateRequired`（九种语言），显示在弹窗的行内错误里。上游硬编码的英文提示在同一处改走翻译键，`COMPAT(hopliteProvider)` 只此一处。原英文句子加进 `i18n/resources.test.ts` 的 `migratedSourceLiterals`（已验证：把旧写法放回去，该测试失败）。
- 删除条件：上游 #6568 + #6953 的「写进配置才可删」搬到 Osuna 详情页：纯函数 `isConfigOwnedProvider`（`hooks/use-acp-provider-catalog.ts`，有用例）在 `useProviderDetailHeader` 里算出 `configOwned`，`ProviderDetailMenu` 的 `canRemove` = 主机支持 && source 为 custom && 写进配置。效果：Hoplite 这类写进配置的内置提供方可删；插件注册的提供方（source 同为 custom）不再给删除（上游修的 bug，Osuna 之前也有）。配置还没读到时删除项暂不显示，与上游相同。
- 长自定义模型名：上游 #6507 的 `flexShrink`/`minWidth` 挪到 `provider-detail/models.tsx` 的 `ModelRow`（有行末操作的行让名字收缩，删除按钮 `flexShrink: 0`）。
- `paseo usage`：daemon 回 `cliSignInsOff` 时，`usage` / `usage ls` 的人读输出说明「读取 CLI 登录凭证」关着、去主机的「隐私」设置打开；`usage inspect` 报 `CLI_SIGN_INS_OFF`。`--json` 仍输出 `[]`（不改列表的 JSON 形状）。

### 没做 / 挪走
- 「元数据生成只用所选模型」（上游 #7611，`457414231`）在上游第 6 段（v0.13.0-beta.2）才进来，第 1 段合并里没有这段代码，本工单做不了，挪到工单 12（已在工单 12 的 Comments 记交接）。本工单的「元数据生成的新文案里 Paseo 改 Osuna」一项因此未完成。

### 按 Osuna 结构改的上游 e2e 断言（供 14 写 PR 正文）
- `acp-provider-catalog.spec.ts`「unsupported host asks for an update…」：toast（`app-toast-message` 的 `toHaveText` + `toBeInViewport`）改为弹窗行内错误 `provider-catalog-error` 里整句 `Update the host to add Hoplite.` 可见（规则 1：Osuna 是行内错误）；点「Add Hoplite」改为搜索后点「Add」（Osuna 行按钮没有带提供方名的无障碍名）。
- 同文件「adds Hoplite from the catalog」：添加后 `expectProviderInstalledInSettings` 改为 `expectProviderDetail`（Osuna 添加成功进详情页，与 MiniMax 用例一致）；删除后先 `expectProvidersList`；最后一次添加后经面包屑回列表再断言在「已启用」组；`provider-actions-hoplite` / `provider-remove-hoplite` 加 `visible` 过滤。
- `provider-removal.spec.ts`「does not offer Remove for a plugin-registered provider」：原断言列表行没有 `provider-actions-*`（Osuna 列表行本来就没有，会恒真），改为进详情页打开 ⋯ 菜单、断言没有 `provider-remove-direct-example`；删配置后改为轮询快照仍有它、回列表后行可见。
- `support/helpers/custom-models.ts`：添加按钮从上游 sheet（`add-custom-model-sheet`）改为 Osuna 就地添加行的 `provider-add-model-submit`；进 Claude 详情改用 `clickProviderRow`（点行左上角，避免点中「Upgrade to …」）。
- Osuna 自己的断言没有删或放宽：`provider-detail/index.test.tsx` 的菜单用例只在渲染助手里加了 `configOwned`，新增一条「插件注册、配置里没有的提供方不给删除」。

### 测试
- 单元（逐个单独跑）：`cli usage/index.test.ts` 13、`provider-catalog-search.test.ts` 4、`use-acp-provider-catalog.test.ts` 16、`provider-detail/index.test.tsx` 79、`i18n/resources.test.ts` 46、`providers-section.test.tsx` 36，全部通过。typecheck、lint 通过。
- Playwright e2e（`acp-provider-catalog`、`provider-removal`、`custom-model-removal`）本机没跑，交给 CI：上游这期的 Claude 模型探测会在测试 daemon 启动时用本机真实登录拉起 Claude Code，按约定不在本机测 CLI 登录。
- 截图（dev 桌面端 1280×860，中文）：`screenshots/03-add-provider-search-co-1280.png`、`screenshots/03-add-provider-search-ho-hoplite-1280.png`。启动前后核对过真实 `~/.codex/config.toml`、`~/.claude/settings.json` 未变。

### 评审
- Standards：无硬性代码规范违规；底线守卫 5 行都是上游用例按 Osuna 结构改（prd「规则」与接缝 4 允许），已记在上面。已改：`toContainText` 放宽 → 精确整句；能力位两处检查 → 一处。判断项未改：`configOwned` 与 `providerSource`、`hostSupportsRemoval` 成组下传（沿用 Osuna 菜单现有参数形状）；纯函数放在 `use-…` 文件里（与上游 `buildAcpProviderConfigPatch` 同处）；`--json` 不带原因。
- Spec：已补本节 Comments；已把硬编码提示改走翻译键。未改：配置加载前删除项不显示（与上游同）；描述不再参与匹配（见上，待维护者看）。
- Visual：两项验收满足；「添加失败」状态的截图不在本工单验收项里，留给 13；`manual` 是目录数据里的版本字段；弹窗随结果数上下跳、有无滚动条时行宽差 11px 是 Osuna 弹窗现有行为，本工单没改。
