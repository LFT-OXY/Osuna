# 14 — 文档收口、i18n 终检与真机 Intl 冒烟

**What to build:** 功能完整后，文档与语言层面收口：`docs/usage.md` 承载代码说不出的事（为什么 UTC 15 分钟桶、为什么成本查询时算、四家日志的坑、OMP 目录真值、回填 = 启动轮、崩溃窗口重复计数、唯一出站请求与隐私说明、`.jsonl.zst` 不做），CLAUDE.md 文档表加一行；`docs/data-model.md` Usage 一节与 agent 记录字段完整、目录树四类文件齐；`docs/release.md` 有刷新价格快照一行；`docs/glossary.md` 的新词条随本任务提交。切到 zh-CN 走一遍「用量」页、footer、弹层、价格表无残留英文（来源名、模型名、单位缩写、`$` 除外）；iOS 与 Android 真机各做一次 `Intl` 千分位 / 日期 / 星期冒烟。

**Status:** ready-for-agent
**Impl:** ready

**Blocked by:** 09, 10, 11, 12, 13

依据：spec 实现决策第 12 节数字与日期本地化、第 14 节；CLAUDE.md「Writing docs」规则（整合不追加、不写逻辑、一事一文）。

- [ ] `docs/usage.md` 存在且 CLAUDE.md 表有一行；内容不复述代码，每段回答"代码为什么这样"或"坑在哪"。
- [ ] `docs/data-model.md`、`docs/release.md`、`docs/glossary.md` 更新到位，`rg "COMPAT\("` 能找到 `features.usage` 的标签。
- [ ] 前面各票留下的 spec / 决策票与实现不一致处已回写（`prd.md` 或 `docs/`），无孤儿段落。
- [ ] zh-CN 走查截图：「用量」页、footer、弹层、价格表区块。
- [ ] iOS / Android 真机 Intl 冒烟各一张截图（千分位、日期区间、星期短名）。
- [ ] 资源测试通过；`npm run typecheck`、`npm run lint`、`npm run format:check` 通过。

## Comments

**票 01 实现与审查时发现** —— 两处被票 01 落下的文档陈述，收口时一并改：

- `docs/providers.md:83`「imports terminal-started sessions from `~/.omp/agent/sessions`」：现在这只是默认分支，`PI_CONFIG_DIR` / `OMP_PROFILE` / `PI_CODING_AGENT_DIR` / `XDG_DATA_HOME` 都会改写它。
- `docs/custom-providers.md` 的 `omp-work` 示例与其后一段：示例 `env` 只设 `XDG_CONFIG_HOME` / `XDG_STATE_HOME`，而上游按 `XDG_DATA_HOME` 定 sessions 目录，示例里的 `params.sessionDir` 因此指向 OMP 不会写入的位置；provider `env` 的值也不展开 `~`。段落里「If `command` or XDG env vars move OMP's state directory, set `params.sessionDir`」的 `XDG_DATA_HOME` 一支现已自动解析，适用范围变窄。票 01 曾试改这段，因与紧邻示例自相矛盾被审查打回并整段还原——改之前先把示例本身修对。
