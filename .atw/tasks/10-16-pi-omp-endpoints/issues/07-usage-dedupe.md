# 07 — Pi / OMP 用量不算两遍

**What to build:** 用量页里 Pi / OMP 经过中转站的调用只算一次、按接口分开：读 Pi / OMP 会话记录时用记录里的回复编号对上中转站账本，对不上且服务商是 `osuna` 的条目跳过；在终端里直接跑的 Pi / OMP 调用也记进账。

**Blocked by:** 01
**Status:** ready-for-agent
**Impl:** ready

- [ ] 读 Pi / OMP 会话记录时回复编号改用记录里的 `responseId`；没有它的老记录照旧。
- [ ] 能按回复编号对上账本的条目合并后只算一次（token、接口、耗时取账本，项目、会话、轮次取会话记录），与到达顺序、daemon 中途重启无关。
- [ ] 对不上且 provider 是 `osuna` 的条目跳过，只算账本；Pi 的 `usage` 条目、OMP 的 `model_usage` 条目同样处理。
- [ ] 用量页按接口分开时 Pi / OMP 的用量落在对应接口和「官方」上；「请求」列表与接口页「最近异常」里出现 Pi / OMP 的请求。
- [ ] 测试：Pi / OMP 用量解析套件、合并对账套件加用例；daemon 端到端测试让假 Pi / OMP 会话记录与经过中转站的请求同时存在，读用量 RPC 检查只算一次、按接口分开（先例：中转站账本的用量测试）。
- [ ] 文档：ADR 0014 的 Pi / OMP 规则写明服务商名是 `osuna`；`docs/usage.md` 的用量来源与 Pi / OMP 对账更新。

参考：prd「用量对账」，用户故事 47–50；ADR 0014。

实现时凡本工单没写明的细节，先查 magpie `7597c132` 的做法并照做（出处见 `research/decisions.md`，源码在 `/tmp/magpie-7597`，不在就重新克隆 yetone/magpie 切到该提交）；比 magpie 少做或更严一律不行，除非 prd 写明。测试绝不读写真实的 `~/.pi`、`~/.omp`，不运行真的 Pi / OMP。
