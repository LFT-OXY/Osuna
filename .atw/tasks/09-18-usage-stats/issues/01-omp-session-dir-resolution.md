# 01 — 预构：OMP 会话目录按上游规则解析

**What to build:** Paseo 解析 OMP 会话目录的方式与 OMP 上游一致：`PI_CONFIG_DIR` / `OMP_PROFILE` / `PI_PROFILE` / `PI_CODING_AGENT_DIR` / `$XDG_DATA_HOME/omp/sessions`，不再读 Paseo 自造的 `OMP_AGENT_DIR` / `OMP_SESSION_DIR`；provider 配置里让后续分支不可达的默认字面量被修正。用量扫描器（04 号票）与 Session history 共用同一个解析函数，用户设置了上游环境变量后两处都能找到会话。

**Status:** ready-for-agent
**Impl:** done

**Blocked by:** None — can start immediately

依据：`research/pi-omp-log-format.md` 目录解析一节；spec 实现决策第 1 节。

- [ ] 一个导出的 OMP 会话目录解析函数，接受 env（可注入）并按上游优先级返回目录；Pi 侧保持现状。
- [ ] 上游环境变量各设一种的单元用例，断言解析出的绝对路径；未设任何变量时回到默认路径。
- [ ] Session history 对 OMP 会话的扫描改用该函数；现有 OMP session-descriptor 测试通过。
- [ ] 不再有代码读取 `OMP_AGENT_DIR` / `OMP_SESSION_DIR`；provider 配置默认值不再屏蔽后续分支（原来不可达的分支有一条用例覆盖）。
- [ ] `npm run typecheck`、`npm run lint` 通过。
