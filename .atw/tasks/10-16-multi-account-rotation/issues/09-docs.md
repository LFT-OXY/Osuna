# 09 — 说明文档：对外请求、术语、存储、许可

**What to build:** 把前面几张做出来的东西写进项目文档，让以后的人知道 Osuna 带着用户的登录去了哪里、账号存在哪、借鉴了 magpie 哪些文件。

**Blocked by:** 03, 04, 05, 06, 07, 08
**Status:** ready-for-agent
**Impl:** done

- [x] `docs/usage.md` 的「Outbound requests」逐类写明新增请求：发给谁、带什么、什么时候发、怎么关——Codex 续期与保活、各号额度读取（保持上游浏览器 User-Agent，注明是 ADR 的例外）、Codex OAuth 登录，以及为存着的 Claude 号运行的 `claude -p /usage` 与 `claude auth login`。
- [x] `docs/glossary.md`：**Account**、**Rotate accounts**、**Limit**、**Keep signed in to**、**Only switch the sign-in** 按最终界面文字核对并补 Code 指向；**Read CLI sign-ins** 补「关掉时多号自动轮换停止」；**Plan usage** 补存着的号的额度怎么来。
- [x] `docs/data-model.md` 写明账号存储与「一个登录只有一个持有者」。
- [x] 根目录 `THIRD_PARTY_NOTICES` 覆盖借鉴的 magpie 文件，借鉴的源文件顶上保留 MIT 声明。
- [x] 按 CLAUDE.md「Writing docs」：改写现有段落，不往末尾堆；一个事实只写一处。
