# 08 — 迁移的用户体验与失败处理

**Type:** interview
**Blocked by:** 02
**Status:** resolved

## Question

Q6/Q6c 定了迁移范围与 move 策略。还要定用户看得见的部分：

1. 成功时是否完全静默，还是在首启显示一条一次性提示"已从 Paseo 迁移数据"？推荐静默 + daemon 日志记录。
2. move 失败退回 copy 也失败（磁盘满、权限）时：阻止启动并弹出带手工命令的错误页，还是降级为全新空数据启动并提示？推荐阻止启动，避免用户以为数据丢了又开始写新数据。
3. 新旧目录同时存在且旧目录更新（用户回退到 0.14.x 又用了一段时间）：以新为准已定；是否在日志里提醒"旧目录有更新的数据"？
4. 渲染层存储迁移失败（02 号票的失败模式）与目录迁移失败是否同一个错误页？
5. Docker 与手装 CLI 用户的手工步骤写在哪个文档（`docs/docker.md`、`public-docs/docker.md`、发布说明）。
6. 迁移完成标记文件名与位置（推荐 `~/.osuna/.migrated-from-paseo`，内容为时间与来源路径）。
7. **与上游 Paseo.app 并存的机器**（02 号票带出）：Q6c 的 move 会把共用的 `~/.paseo` 与 `appData/Paseo` 整体搬走，机器上若还装着上游 Paseo，它会变成空白。ADR 0002 曾承诺"并排安装"。选项：(a) 坚持 move，发布说明告知"升级后请卸载上游 Paseo"；(b) 检测到上游 Paseo.app 存在时改用 copy（磁盘翻倍但两边都能用）；(c) 一律 copy。推荐 (a)：Osuna 用户不该再同时跑上游 Paseo，而且两者共用 `~/.paseo` 本来就会互相覆盖配置。
8. **迁移代码的 COMPAT 到期日**：到期删除后再升级的老用户会永久留在旧 origin。推荐保留到 2.0 或 1.0.0 发布后 12 个月（取先到者），并在 `docs/release.md` 记一条。

## Answer

用户 2026-10-09 访谈，11 条全部按推荐拍板。

**新发现的事实（改变了问题形状）**
- `~/.paseo` 只在 `packages/server/src/server/paseo-home.ts:15` 解析，daemon / CLI / 桌面 daemon-manager 共用。
- 本机 `~/.paseo` 7.4 GB，`worktrees/` 占 6.3 GB，是用户仓库的 git worktree：主仓库 `.git/worktrees/<name>/gitdir` 指向 `~/.paseo/worktrees/...` 绝对路径，`projects/workspaces.json` 有 14 处 `/.paseo/`，`agents/` 目录名也编码该路径。整目录 rename 会让这些引用全部失效。
- 05 号票"回滚可行因为旧目录仍在"与 Q6c 的 move 矛盾；02 号票 L1 的"空启动 + 3 次重试"失效（空启动写出的 `desktop-settings.json` 让 `hasRealData(newDir)` 变真，之后永不重试）。两者由下面的决定修正。

**决定**
1. **老路径引用：rename 后原位留符号链接 `~/.paseo → ~/.osuna`**（Windows 用 junction，免管理员权限）。已持久化的绝对路径、git `gitdir` 指针、`agents/` 目录名都不改写；新建 worktree 落 `~/.osuna/worktrees`。副作用接受：磁盘上留着 `~/.paseo` 这个名字，老条目 UI 显示 `~/.paseo/...`。附带收益：0.14.x 回滚和上游 Paseo daemon 数据通过符号链接继续可用。符号链接属 ADR 0006 的迁移例外。
2. **`~/.paseo` 搬迁由 daemon 执行**：启动时、读任何文件之前，紧跟 home 解析。仅当 home 解析为默认 `~/.osuna` 时才迁移；显式 `OSUNA_HOME` 一律不迁移。手装 CLI 用户的手工步骤只剩装新二进制；Docker（镜像显式设 home）保持手工步骤。
3. **残留 `PASEO_*` 环境变量**：不认、不做别名。daemon 与 CLI 启动时检测到任一 `PASEO_*` 变量，打 warn 逐个列出并给出 `OSUNA_*` 对应名。
4. **成功静默**：不弹提示不出 toast。三层各一条 info 日志：home 搬迁进 `daemon.log`，userData 搬迁与 origin 导入进 Electron 主进程日志。
5. **目录搬迁硬失败（rename 与 copy 都失败）阻止启动，不以空数据起。** daemon 非零退出，信息含旧路径、新路径、手工命令 `mv ~/.paseo ~/.osuna && ln -s ~/.osuna ~/.paseo`，桌面端走现有"daemon errored"状态面（spec 要核实 daemon 的退出信息能到达该状态面）。Electron userData 失败：主进程开窗前 `dialog.showErrorBox` 后退出。每次启动重试，不设上限、不记计数器。**替代 02 号票的"空启动 + 3 次封顶"。**
6. **origin 导入失败**另起对话框（无手工修复路径）：「重试」= 退出下次再跑；「放弃旧数据继续」= 写 done 标记后正常启动，之后不再 `clearStorageData`。不设自动重试上限。
7. **旧目录比新目录新**：Q1 后基本不发生；仅当用户删了符号链接、0.14.x 建出真实 `~/.paseo` 时，按"以新为准不动旧的"，另记 warn"检测到未迁移的 `~/.paseo`"。不做 UI。
8. **目录搬迁不设标记文件**：旧为真实目录且新不存在才搬；旧是符号链接或新已存在则跳过。不要 `~/.osuna/.migrated-from-paseo`。origin 导入标记按 02 留在 `desktop-settings.json → migrations`，去掉失败计数字段。
9. **手工步骤落点**：Docker 步骤（卷挂 `/home/osuna`、环境变量改名、首启前在卷里 `mv .paseo .osuna`）写 `public-docs/docker.md` 升级段，1.0.0 发布说明只放链接；`docs/docker.md` 只改内部事实。CLI 用户的卸旧装新只写发布说明。
10. **COMPAT**：三层迁移代码统一 `COMPAT(paseoDataMigration): added in v1.0.0, remove after 2027-10-09 or in 2.0.0, whichever first`。比默认六个月长，因为是用户数据不是协议。到期删除不碰磁盘符号链接。`docs/release.md` 记一条。
11. **与上游 Paseo.app 并存**：接受 `appData/Paseo` 搬走后上游 App 丢主机列表与设置，不给它留符号链接（两个 Electron 共用 userData 抢 leveldb 锁）。发布说明写明"上游 Paseo 不再受支持，请卸载"。
