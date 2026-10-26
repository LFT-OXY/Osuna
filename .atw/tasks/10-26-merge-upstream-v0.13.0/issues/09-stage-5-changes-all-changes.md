# 09 — 第五段适配：Changes 的 All changes 接上大改动集优化

**What to build:** Changes 默认显示上游的 All changes（已提交与未提交合成一份）。Osuna 的按文件复用、1 秒节流、只看文件树时不读全文、生成文件与大文件默认收起、文件展开状态在 All changes 模式下照常工作。规格见 `prd.md`「Changes」，裁决见 `research/feature-overlap.md` 3.2 第 25、26 条。

**Blocked by:** 06
**Status:** ready-for-agent
**Impl:** ready

- [ ] 客户端默认 All changes。
- [ ] All changes 模式下按文件复用生效，有测试。
- [ ] 上游私有 index 下未跟踪文件的判定正确，有测试。
- [ ] 只看文件树时不读全文、生成文件默认收起在 All changes 下生效，有测试。
- [ ] Osuna 已单独摘过的 #6745 与上游的等价提交取上游一侧。
- [ ] typecheck 和 lint 通过；改到的测试文件逐个单独跑过并通过（不跑整套）。
- [ ] 没有 Osuna 的断言被删除或放宽；必须跟着改的断言逐条记在 `## Comments` 下，供 14 写 PR 正文用。
- [ ] UI：dev 桌面端 1280 宽 / 一个有生成文件的大改动集的 Changes 面板 — 截图上默认是 All changes，生成文件收起。
