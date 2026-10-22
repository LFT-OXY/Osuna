# 09 — 套餐窗口第二批：Command Code、Ollama Cloud、智谱团队

**What to build:** Command Code 套餐 key 显示 5 小时、周窗口和 credits；Ollama Cloud 显示月度额度窗口（旧套餐是 Session 与 Weekly）。智谱团队套餐用户在「高级」里填团队组织 ID 与项目 ID 后，个人窗口为空时显示团队窗口，并写出按窗口算的重置次数（只显示）。

**Blocked by:** 08, 05
**Status:** ready-for-agent
**Impl:** ready

- [ ] Command Code、Ollama Cloud 的请求与窗口照 magpie `commandcode_plan.go`、`ollama_usage.go`（27–32 天的区间叫 Month）。
- [ ] 余额设置新增团队组织 ID、项目 ID（只在智谱地址时出现在表单里）；团队请求照 magpie 带 `Bigmodel-Organization`、`Bigmodel-Project`、`Set-Language`，请求 `?type=2`；不读 ZCode 的登录。
- [ ] 团队的重置次数按窗口分 5 小时与周，只显示，没有用掉的按钮。
- [ ] 端到端测试：两家窗口；智谱个人窗口为空且填了 ID 时的团队窗口与重置次数；没填 ID 时不发团队请求。
- [ ] `docs/usage.md` 写进这三处请求；`docs/data-model.md` 写进团队 ID 字段。`docs/glossary.md` 收「团队组织 ID」「团队项目 ID」。
- [ ] 9 种语言的新文字齐全。
- [ ] UI：详情分区 / 智谱团队窗口与重置次数 / 1280 与 390。
- [ ] UI：编辑窗口高级区 / 智谱地址时的两个 ID 栏 / 1280。

参考：prd 第 1、7 条，用户故事 36、39、40。

实现时凡本工单没写明的细节，先查 magpie `7597c132` 的做法并照做（出处见 `research/decisions.md`）；比 magpie 少做或更严一律不行，除非 prd 写明。
