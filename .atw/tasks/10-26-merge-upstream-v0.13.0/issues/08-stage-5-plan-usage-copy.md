# 08 — 第五段适配：套餐用量文案

**What to build:** 套餐用量的文案以上游的 `providerUsage` 键与上游的文案模块为底；九种语言的值改回 Osuna 现有译法（以术语表为准：「已用」「剩余」「套餐用量」「提供方」「刷新中…」等）；补回 Osuna 独有的键（「刚刚 / x 分钟前」、CLI 登录凭证关闭的提示、接口开启时的说明、配速文字、Codex 剩余重置次数等）；删掉 `usage.planUsage` 中与上游重复的键。合并前后界面上的中文措辞不变，每行写明是已用还是剩余。规格见 `prd.md`「套餐用量」，决定见 `research/discovery.md` 第 8 条与 ADR 0006。

**Blocked by:** 06
**Status:** ready-for-agent
**Impl:** done

- [ ] 套餐用量各处（弹窗、卡片、侧栏摘要、上下文圆环悬浮卡、Composer 用量条）走上游的键；`usage.planUsage` 中与上游重复的键已删，没有引用残留。
- [ ] 九种语言的值与合并前 Osuna 的译法逐键一致，对照表记在 `## Comments` 下；Osuna 独有的键都在。
- [ ] 上游的文案与格式化测试按 Osuna 的译法改预期，逐条记下；Osuna 的用量条与视图测试通过。
- [ ] typecheck 和 lint 通过；改到的测试文件逐个单独跑过并通过（不跑整套）。
- [ ] 没有 Osuna 的断言被删除或放宽；必须跟着改的断言逐条记在 `## Comments` 下，供 14 写 PR 正文用。
- [ ] UI：dev 桌面端 1280 宽、中文界面 / 套餐用量弹窗与用量页卡片 — 截图上写「已用」或「剩余」「套餐用量」「提供方」，与合并前一致。

## Comments

- 对照表：`research/ticket08-copy-map.md`（键的对应、九种语言逐键的改前与改后、删掉与留下的 `usage.planUsage` 键）。Osuna 的译法以本工单开始时的 `usage.planUsage.*` 为准，它是 main 的超集：只多了合并时补的 `lastUpdated`、`resetTimePassed`、`noSuccessfulUpdate` 三条。`timing.justNow` 和 `*Ago` 取 Osuna 的 `usage.common.time.*`。`values.used` 取 Osuna 侧栏摘要 `summaryWindowUsed` 去掉名字那部分。没有 Osuna 对应键的 `labels.*`、`duration.*`、`runsOutNow` 保留上游译文。
- 西语 `values.remaining` 取 `queda {{amount}}`（规格评审指出）。上游用这一个键同时管百分比和余额，Osuna 原来百分比写 `queda`、余额写 `quedan`，现在按百分比的写法取，所以余额也会写成 `queda`。其余语言里这两个值本来就相同。
- 阿拉伯语 `timing.*Ago` 的六个复数变体都写成 Osuna 原来的缩写（如 `قبل {{value}} ي`）。上游测试要求复数变体齐全，所以变体保留；读起来从「قبل يومين」退成「قبل 2 ي」。
- `runsOutNow`（第 6 张工单留下的）：保留上游的键和译文，不删。原因是 Osuna 的 `formatRunsOutLabel` 在用完时间已过时不返回文字，所以没有地方引用它；删掉的话，以后合并上游时这里会多一处冲突。
- `usage.planUsage.hostUnavailable`（「连接到这台主机后可查看套餐用量」，不带主机名）作为 Osuna 独有保留。它在用量页的套餐卡片里用，那里主机名已经写在分组标题上；上游的 `providerUsage.hostUnavailable` 句子里要带 `{{host}}`，说法不同。
- `usage/copy.ts` 以上游为底，只留 `problem`、`clientUnavailable`，另加 Osuna 的 `accountName`、`summary`。组件里的文案改用 `useTranslation()`：`usage-plan-card.tsx`、`cli-sign-ins-off-notice.tsx`。`plan-usage/strip.ts`、`strip-gauge.tsx`、`context-window-details.tsx`、`api-endpoints/balance-section.tsx` 从重复键换成上游的键。`model.ts` 删掉已经没人用的 `formatUsageFreshness`。
- 「提供方」：合并前，套餐用量各处的中文本来就没有这个词，现在也没有；上游的「提供商」都已改回（原来出现在 `hostUnavailable`、`hostUpgradeRequired`）。截图里看不到「提供方」，原因就是这个。
- 断言变更（PR 正文要列）：
  - `usage/format.test.ts`（上游用例，按 Osuna 译法改预期）：ja `formatRunsOutLabel` 从「2時間後に上限に到達」改为「2時間後に上限」；fr reset 从「se réinitialise dans 1 234 j」改为「réinitialisation dans 1 234 j」，runsOut 从「s’épuise dans …」改为「épuisé dans …」；ar reset 从「تتم إعادة التعيين خلال ساعتين」改为「إعادة التعيين بعد ساعتين」，runsOut 从「ينفد خلال 3 ساعات」改为「ينفد بعد 3 ساعات」，ago 从「قبل يومين」改为「قبل 2 ي」。
  - `usage/model.test.ts`（上游用例）：韩语的主机不可用提示，从「Laptop에 연결하여 제공업체 사용량을 확인하세요」改为「Laptop에 연결하면 플랜 사용량을 볼 수 있습니다」。
  - `usage/model.test.ts`（Osuna 用例）：被测的 `formatUsageFreshness` 已删。卡片的更新时间从第 6 张工单起就走上游的 `formatAgo` 加 `providerUsage.timing.updated`（`card.tsx` 的 `UsageFreshness`），所以 describe 改名为「report freshness」，改测这条路径。「刚刚更新」「3 分钟前更新」「2 小时前更新」「4 天前更新」「Updated just now」「Updated 3m ago」这几条断言不变。只有 `"Updated Jan 15"` 改成 `"Updated 30d ago"`，这是行为变化：上游的 `formatAgo` 对较早的时间只写天数，不写日期。
  - `e2e/browser/usage-modal.spec.ts`（上游用例，日文）：选项按钮名从「設定」改为「プラン使用量のオプション」，「割合」改为「表示」，并限定在选项面板内（日文里「表示」在别处也会出现）。
  - `plan-usage/strip.test.ts`：只把翻译键名换成上游的键，断言不变。
- 测试：在 `packages/app` 下逐个运行，`usage/copy`、`model`、`format`、`pinned`、`preferences`、`plan-usage/strip`、`use-strip-usage`、`i18n/resources` 全部通过。`usage/bars.browser.test.tsx` 先挪开 Vite 缓存再跑，通过。`usage-modal.spec.ts` 本机没跑，交给 CI。app 的 typecheck 和改动文件的 lint 都通过。按仓库规定，整套测试不在本机跑，交给开 PR 时的 CI。
- 截图：`screenshots/08-plan-usage-modal-{used,remaining,options}-1280-zh.png` 和 `08-usage-page-plan-card-1280-zh.png`。用的是无头 Chromium 加一次性 Playwright 用例和假数据，没有用 dev 桌面端，因为真实账号会把套餐百分比截进仓库。一次性用例里关掉了所有真实提供方，不会启动任何真实 CLI，用例拍完已删。视觉评审指出的「标题栏浅灰圆形」「用量页刷新入口重复」「左下角浮动按钮遮挡」都与本工单的文案改动无关，不在本工单处理。
- 新增守护测试：`i18n/resources.test.ts`「keeps plan usage sentences that upstream already has out of usage.planUsage」。`usage.planUsage` 里一旦出现与 `providerUsage` 英文相同的句子（参数名不算区别），测试就会挂。验证过：临时塞回一条 `refresh: "Refresh"` 时它会挂。规范 `.atw/spec/app/frontend/component-guidelines.md` 里旧的「copy.ts 每句改成 usage.planUsage 的取值函数」那一条已改写，规则表加了一行。
