# 14 — 文档收口、i18n 终检与真机 Intl 冒烟

**What to build:** 功能完整后，文档与语言层面收口：`docs/usage.md` 承载代码说不出的事（为什么 UTC 15 分钟桶、为什么成本查询时算、四家日志的坑、OMP 目录真值、回填 = 启动轮、崩溃窗口重复计数、唯一出站请求与隐私说明、`.jsonl.zst` 不做），CLAUDE.md 文档表加一行；`docs/data-model.md` Usage 一节与 agent 记录字段完整、目录树四类文件齐；`docs/release.md` 有刷新价格快照一行；`docs/glossary.md` 的新词条随本任务提交。切到 zh-CN 走一遍「用量」页、footer、弹层、价格表无残留英文（来源名、模型名、单位缩写、`$` 除外）；iOS 与 Android 真机各做一次 `Intl` 千分位 / 日期 / 星期冒烟。

**Status:** ready-for-agent
**Impl:** done

**Blocked by:** 09, 10, 11, 12, 13

依据：spec 实现决策第 12 节数字与日期本地化、第 14 节；CLAUDE.md「Writing docs」规则（整合不追加、不写逻辑、一事一文）。

- [x] `docs/usage.md` 存在且 CLAUDE.md 表有一行；内容不复述代码，每段回答"代码为什么这样"或"坑在哪"。
- [x] `docs/data-model.md`、`docs/release.md`、`docs/glossary.md` 更新到位，`rg "COMPAT\("` 能找到 `features.usage` 的标签。
- [x] 前面各票留下的 spec / 决策票与实现不一致处已回写（`prd.md` 或 `docs/`），无孤儿段落。
- [~] zh-CN 走查截图：「用量」页、价格表区块已截；footer 与弹层未截（见下）。
- [ ] iOS / Android 真机 Intl 冒烟各一张截图（千分位、日期区间、星期短名）。
- [x] 资源测试通过；`npm run typecheck`、`npm run lint`、`npm run format:check` 通过（后两项的既有失败都在 `packages/` 之外，见下）。

## Comments

**票 01 实现与审查时发现** —— 两处被票 01 落下的文档陈述，收口时一并改：

- `docs/usage.md` 要写明：用量扫描只按环境变量定 OMP sessions 目录，**不读** `settings.json` 的 `sessionDir`（04 号票已定的取舍），所以用它搬走 sessions 的用户该来源为空。
- `docs/providers.md:83`「imports terminal-started sessions from `~/.omp/agent/sessions`」：现在这只是默认分支，`PI_CONFIG_DIR` / `OMP_PROFILE` / `PI_CODING_AGENT_DIR` / `XDG_DATA_HOME` 都会改写它。
- `docs/custom-providers.md` 的 `omp-work` 示例与其后一段：示例 `env` 只设 `XDG_CONFIG_HOME` / `XDG_STATE_HOME`，而上游按 `XDG_DATA_HOME` 定 sessions 目录，示例里的 `params.sessionDir` 因此指向 OMP 不会写入的位置；provider `env` 的值也不展开 `~`。段落里「If `command` or XDG env vars move OMP's state directory, set `params.sessionDir`」的 `XDG_DATA_HOME` 一支现已自动解析，适用范围变窄。票 01 曾试改这段，因与紧邻示例自相矛盾被审查打回并整段还原——改之前先把示例本身修对。

**票 04 审查时发现** —— `docs/usage.md` 再加一条 OMP 分支会话的取舍：

- 扫描器靠 header 时间戳跳过 OMP 分支 / 续接文件里复制来的父会话条目，不去读父文件。父文件不在被扫描的根下（换了 profile、被 `settings.json` 搬走、已删除）时，那段历史两边都不计，报表会少这一截。

**本票实现与审查时定下：**

- `docs/usage.md` 新增「What gets scanned」「The scan」「What each log makes hard」
  「Where the numbers fall short」四节。票面点名的「为什么 UTC 15 分钟桶」与
  「崩溃窗口重复计数」**没有**写进这份文档：前者 `docs/glossary.md` 的 **Usage bucket**
  条目已给出理由，后者 `docs/data-model.md` §7「Rows are flushed before the cursor」
  已经写明，再写第三遍违反 CLAUDE.md「One fact, one doc」。usage.md 用链接指过去。
- 票面「四家日志的坑」按「坑在哪」而不是「解析怎么做」来写：每条讲的是直接读原始
  日志的人会踩的坑（Claude 一响应多行 + resume 整份复制、Codex `total_token_usage`
  归零与 0.153.2 的双份记账、Pi/OMP header 行位与 reasoning 列名不同、四家都可能
  出现的裸 U+2028/U+2029 让 `readline` 静默丢行），且都跨 CLI 版本。
- `docs/providers.md` 不再枚举 OMP 的环境变量，改为链到
  `docs/custom-providers.md#omp-profiles-and-pi-compatible-forks`：一份文档拥有这套
  规则，其余只做指路（同时修掉 Spec 轴指出的漏列 `PI_PROFILE`）。
- `docs/custom-providers.md` 的 `omp-work` 示例改用 `OMP_PROFILE`。原示例的
  `XDG_CONFIG_HOME` / `XDG_STATE_HOME` 定不了 sessions 目录（上游按 `XDG_DATA_HOME`，
  且只在该目录已存在时生效），`params.sessionDir` 因此指向 OMP 不会写入的位置；
  provider `env` 的值不展开 `~`，而 `params.sessionDir` 会展开，这两条都写进了正文。
- `docs/glossary.md` 清掉了六条 `Planned in .atw/tasks/09-18-usage-stats` 占位与随之
  过期的将来时措辞（「becomes Price table once Plan usage moves out」「moving from the
  host settings page」「会话费用 is renamed to this」）。

**未完成，需要人来做：**

- footer 与环形表弹层的 zh-CN 截图没拿到。一次性 Playwright 脚本里，mock agent 路由
  在第二次导航/reload 后被启动恢复打回「Workspace 不可用」，因此无法先切到 zh-CN 再
  停在 agent 页。参照用例 `context-window-token-label.spec.ts` 单跑通过，说明是取证脚本
  的问题而非产品缺陷；这两处的 zh-CN 文案已由 `src/i18n/resources.test.ts`（36 项键位
  对齐）与「组件内无硬编码英文字面量」的全量 grep 覆盖。
- iOS / Android 真机 `Intl` 冒烟（千分位、日期区间、星期短名）无法在本环境完成，需要真机。
  Web 端 zh-CN 截图里千分位（180,248）、日期（2026年9月17日）、星期短名（一二三四五六日）
  均正常。

**既有问题，与本票无关：**

- `npm run format:check` 全仓报 154 个文件，`npm run lint` 报 28 条错误，全部落在
  `.pi/extensions/atw/index.ts` 与 `.claude|.agents/skills/oxy-learning-hub/assets/course.js`，
  不在 `packages/` 内，本票未动。
