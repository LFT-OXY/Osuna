# 05 — OMP 的模型角色

**What to build:** OMP 设置页的「使用第三方接口」一块多一个「模型角色」区：Subagent、小任务、难题、规划、看图、顾问、提交说明、极小任务、记忆 9 个角色，各能选第三方接口的模型和思考档位，也能清空交还 OMP；打开开关时只改默认角色，其余角色空着。

**Blocked by:** 04
**Status:** ready-for-agent
**Impl:** done

- [ ] Agent 设置新增可选的「模型角色」字段（每个角色一个模型取值和一个思考档位），只对 OMP 有意义；旧客户端照常。
- [ ] 设了的角色写进 `config.yml` 的 `modelRoles.<role>`，带思考档位时写成 `osuna/<模型>:<档位>`；角色键照 OMP：task、smol、slow、plan、vision、advisor、commit、tiny、memory。清空的角色放回原值或删掉。
- [ ] 打开开关只改 `default` 角色；关开关时每个被改过的角色放回原值，用户期间自改的保留；再打开时放回上次走中转站的角色。
- [ ] 角色指向的模型不再提供时照默认模型的处理；接口变化时同步。
- [ ] Osuna 配置里手写的 `smolModel` / `slowModel` / `planModel` 仍作为启动参数传入，在 Osuna 开的 OMP 对话里优先；终端不受影响。
- [ ] 测试：OMP 接入的端到端测试与 OMP 配置改写套件加用例；浏览器测试覆盖选角色模型、选思考档位、清空、失败时错误留在原处。
- [ ] 9 种语言的新文字齐全；中文角色名为「Subagent（task）」「小任务（smol）」「难题（slow）」「规划（plan）」「看图（vision）」「顾问（advisor）」「提交说明（commit）」「极小任务（tiny）」「记忆（memory）」。
- [ ] UI：OMP 提供方设置页 / 模型角色区 / 1280 与 390 — 9 行角色，每行有模型选择、思考档位选择和「空着时用什么」的说明（照 magpie），模型名不是等宽字体，宽 390 不溢出。

参考：prd「提供方与设置」「写进 OMP 配置的内容」，用户故事 24–29。

实现时凡本工单没写明的细节，先查 magpie `7597c132` 的做法并照做（出处见 `research/decisions.md`，源码在 `/tmp/magpie-7597`，不在就重新克隆 yetone/magpie 切到该提交）；比 magpie 少做或更严一律不行，除非 prd 写明。测试绝不读写真实的 `~/.pi`、`~/.omp`，不运行真的 Pi / OMP。
