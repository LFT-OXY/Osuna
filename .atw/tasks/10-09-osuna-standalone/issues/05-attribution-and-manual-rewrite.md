# 05 — 署名与人工改写

**What to build:** 维护者能证明 Osuna 符合 Apache-2.0 的署名要求，README 读者知道 Osuna 源自 Paseo 但不再是它；术语表只在 **Paseo** 条目里提到上游（07 号票的人工改写项）。

**Blocked by:** 04
**Status:** ready-for-agent
**Impl:** done

- [x] 新建 `NOTICE`，写明源自 Paseo (Apache-2.0) 并保留上游仓库链接；`LICENSE` 保留上游版权行不改
- [x] 四份 README（默认、zh-CN、ja、ko）：页尾一行致谢含上游链接；明确指上游的句子（如"不要从 npm 装 `@getpaseo/cli`，那是上游"）保留；其余 Paseo → Osuna；安装说明只列桌面端、Docker、源码构建
- [x] `docs/glossary.md`：**Paseo** 条目保留为上游项目；Daemon、Forge、Worktree、Usage、Fork 等其余条目的产品名改 Osuna；**Product discussion** 改指本仓库 Discussions
- [x] 守线检查仍绿（这几份文件在例外清单里）；`npm run lint` 对改动文件通过
