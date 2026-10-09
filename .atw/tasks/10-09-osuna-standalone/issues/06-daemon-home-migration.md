# 06 — Daemon home 迁移与 PASEO_* 警告

**What to build:** 0.14.x 用户装上 1.0.0 的 daemon（桌面端内置或源码构建）后，第一次启动就能看到原有的工作区、worktree 与 Agent 历史，不用手动搬目录也不用 `git worktree repair`；搬不动时 daemon 拒绝以空数据启动并告诉用户怎么手工搬；残留的 `PASEO_*` 环境变量会被逐个点名（spec 决策 B）。

**Blocked by:** 04
**Status:** ready-for-agent
**Impl:** ready

- [ ] 启动时、读任何文件之前，仅当 home 解析为默认 `~/.osuna` 时执行迁移；显式 `OSUNA_HOME` 一律不迁移；旧 `~/.paseo` 是真实目录且新目录不存在才搬，旧是符号链接或新已存在则跳过；不写任何标记文件
- [ ] 搬迁用 rename，跨分区失败退回复制且旧目录原封不动；成功后原位留 `~/.paseo → ~/.osuna` 符号链接（Windows 用 junction）；已持久化的绝对路径不改写，新建 worktree 落 `~/.osuna/worktrees`
- [ ] rename 与 copy 都失败时 daemon 非零退出，错误含旧路径、新路径与手工命令 `mv ~/.paseo ~/.osuna && ln -s ~/.osuna ~/.paseo`；每次启动重试、不设上限不记计数；桌面端的 daemon 错误状态面能显示该退出信息（核实并补齐传递链路）
- [ ] 旧目录比新目录新时以新为准不动旧的，记一条 warn；成功时 `daemon.log` 一条 info，无任何 UI 提示
- [ ] daemon 与 CLI 启动时检测到任一 `PASEO_*` 变量，各打一条 warn 逐个列出并给出 `OSUNA_*` 对应名；不做别名
- [ ] 迁移代码带 `COMPAT(paseoDataMigration): added in v1.0.0, remove after 2027-10-09 or in 2.0.0, whichever first`
- [ ] 单测：迁移逻辑作为接收旧路径、新路径与文件系统操作的函数，在临时目录覆盖六种分支（真实目录搬迁留链接、旧是链接跳过、新已存在跳过并 warn、rename 失败退回 copy、都失败抛带手工命令的错误、显式 home 不迁移）；`PASEO_*` 残留产生的 warn 列表有断言
- [ ] 整链路：ad-hoc 进程内 daemon 从带旧目录的临时 home 启动，断言启动后工作区与 agent 数据可读；CLI 测试套件新增 `PASEO_*` 警告断言
