# 06 — OMP 的多套配置

**What to build:** OMP 设置页自动列出电脑上的每套 OMP 命名配置（`omp --profile <名字>` 用的那些），「使用第三方接口」按 OMP 配置分块：「默认」一块，每套命名配置一块，每块各有开关、默认模型、默认思考档位和模型角色，互不影响；新找到的默认关着。建议在 05 之后做，两张改同一块界面。

**Blocked by:** 04
**Status:** ready-for-agent
**Impl:** ready

- [ ] daemon 扫 OMP 根目录（`~/.omp` 或 `PI_CONFIG_DIR` 给的名字）下的 `profiles/<名字>/agent`，名字规则照 OMP；扫到的列表随设置一起返回（可选新字段）。
- [ ] daemon 环境里 `OMP_PROFILE` / `PI_PROFILE` 已经指向的那套由「默认」块管，不另列。
- [ ] 每套命名配置的设置存在自己的键下（`omp` 加配置名，不和提供方 id 撞名）；各套共用 OMP 的中转站口令；一套打开、关掉、改设置不影响别的套。
- [ ] 继承 `omp`、在 `env` 里给了 `OMP_PROFILE` 的自定义提供方跟随那一套的设置，不单独出现开关。
- [ ] 每套的配置文件各自有接管记录、副本、还原，「要重开」提示与同步按套处理。
- [ ] 测试：临时目录里放两套命名配置，端到端测试检查列表、各套独立、当前已指向的不重复；浏览器测试检查分块与各自开关。
- [ ] 核对 `docs/glossary.md`：Default model、Default thinking、Compact at、Long conversations、Full window、Test models 等条目里「Claude Code and Codex」的说法改对，Compact at 等写明只对 Claude Code、Codex。
- [ ] 文档：`docs/custom-providers.md` 的「OMP profiles」一节写明自定义提供方跟随对应配置块的设置。
- [ ] 9 种语言的新文字齐全。
- [ ] UI：OMP 提供方设置页 / 两套配置 / 1280 与 390 — 两块标题分别是「默认」和配置名，各有独立的 Switch，宽 390 不溢出。
- [ ] UI：OMP 提供方设置页 / 没有命名配置 / 1280 — 只显示默认那一块，没有块标题。

参考：prd「提供方与设置」，用户故事 30–35。

实现时凡本工单没写明的细节，先查 magpie `7597c132` 的做法并照做（出处见 `research/decisions.md`，源码在 `/tmp/magpie-7597`，不在就重新克隆 yetone/magpie 切到该提交）；比 magpie 少做或更严一律不行，除非 prd 写明。测试绝不读写真实的 `~/.pi`、`~/.omp`，不运行真的 Pi / OMP。
