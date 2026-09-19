# file-observer 能否承担四个日志目录的观察

对应票：`map-issues/06-file-observer-fit.md`。日期 2026-09-18。所有路径相对仓库根。

## 结论摘要

- **设计范围**：`packages/server/src/server/file-observer` 是通用递归目录观察器，接口只认"一个绝对目录 + 排除子树"，模块内没有任何 git 或 workspace 假设；用它观察 home 目录树在设计范围内。但它**只做通知，不做轮询回退**：任何后端错误都让订阅自毁并回调 `error`，降级轮询是消费者（现在只有 WorkspaceGit）自己写的。
- **事件粒度**：回调只给 `{path, type: "create"|"update"|"delete"}`，没有 size/offset。而且 **macOS 上稳定态追加写会以 `rename` 送达**（实测），观察器会把它 stat 后当成 `create` 上报。所以"追加了内容"必须由消费者 stat + 从游标读，事件类型不可作为语义依据。
- **Linux 限额**：Linux 后端每个目录一个 inotify watch，单 root 上限 5,000 目录；四目录目前共约 1,000 个目录，余量 5 倍以上。250,000 条目上限只在 macOS/Windows 后端，四目录合计约 4,700 条目，远未触及。
- **推荐**：用量统计 v1 **不接 watcher**，走"`turn_completed` 定向增量解析 + 周期 mtime/size 指纹扫描（建议 60 s，可配；同时充当兜底）"。理由见末节。watcher 保留为后续可选升级，模块本身合用，接法与代价已列出。

## 1. 公开接口摘要

来源：`packages/server/src/server/file-observer/index.ts`。

| 符号                                          | 位置                     | 说明                                                                                                                                                                                             |
| --------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `FileChange { path; type }`                   | `index.ts:8-13`          | `type` 三值：`create`/`update`/`delete`。无 size、mtime、offset。                                                                                                                                |
| `FileObserverCallback(error, events)`         | `index.ts:19`            | 一次回调一批事件（10 ms 内合并，`internal/observation.ts:19,130-142`）。`error !== null` 表示该订阅已失效并自行关闭（`observation.ts:144-151`），不会自动重连。                                  |
| `subscribe(directory, callback, { ignore? })` | `index.ts:50-54, 90-114` | `directory` 会 `resolve()`；启动时要求存在且是目录（`observation.ts:67-71`），否则抛错。`ignore` 是绝对路径，必须落在 root 内（`internal/paths.ts:30-35`），root 外的会被静默丢弃。              |
| `subscription.updateIgnore(paths)`            | `index.ts:22`            | 屏障语义：resolve 后不会再投递被新排除路径下的事件（`observation.ts:87-101`）。Linux 会重扫整棵树（`internal/linux.ts:43-52`），macOS 触发一次全量盘点（`internal/native-recursive.ts:87-93`）。 |
| `subscription.unsubscribe()`                  | `index.ts:23`            | awaited 屏障，resolve 后无残留回调/句柄（`observation.ts:103-109`，各后端 `finishClose`）。                                                                                                      |
| `getDiagnostics()` / `close()`                | `index.ts:116-152`       | 服务级聚合指标；`close` 释放所有订阅。                                                                                                                                                           |
| `createFileObserver()`                        | `index.ts:61-69`         | 按 `process.platform` 选后端：darwin/win32 → 原生递归；其余 → Linux 逐目录。                                                                                                                     |

同路径事件合并规则（`observation.ts:168-174`）：`create`+`delete` → `update`，`delete`+`create` → `update`，`create` 后续任何类型仍为 `create`。

## 2. 两个后端的差异

### Linux（`internal/linux.ts`）

- 每个目录一个 `fs.watch(dir)`（非递归）（`linux.ts:93-103`），`MAX_WATCHED_DIRECTORIES = 5_000` 每 root（`linux.ts:8`）。超限在 `watchDirectory` 和 `scan` 两处抛错（`linux.ts:87-92, 237-242`），经 `host.fail` 让订阅失效。
- 事件映射：`eventType === "change"` → `update(path)`；`rename` → `stat` 分类为 `create`/`delete`（`linux.ts:97-98, 249-263`）。inotify 里追加写是 `IN_MODIFY`（inotify(7) "IN_MODIFY: File was modified (e.g., write(2))"），libuv 映射为 `change`，所以 **Linux 上追加写会得到 `update`**。
- 启动扫描会把"在其目录 watcher 装好之前发现的文件"作为 `create` 事件发出（`linux.ts:176-178, 232-234`）。对 `~/.claude/projects` 这种 1,300+ 文件的树，**订阅一建立就会收到一批 create**，消费者要把它们当成"请核对"而不是"新文件"。
- 拓扑修复 50 ms 尾部去抖、按 scope 局部重扫（`linux.ts:9, 123-134, 169-190`）。
- 历史教训：PR #794（https://github.com/getpaseo/paseo/pull/794）记录了逐目录 watcher 在持续写入的子树上把 daemon 拉到 100% CPU、5,006 个 inotify watch 的复现，才加了 5,000 上限与 ignore 剪枝。

### macOS / Windows（`internal/native-recursive.ts`）

- 一个 `fs.watch(root, { recursive: true })`（`native-recursive.ts:36-37`），内存里维护 files/directories/entries 盘点表。
- `MAX_TRACKED_ENTRIES = 250_000`（文件 + 目录，每 root）（`native-recursive.ts:8, 600-605`），超限抛错 → 订阅失效。
- 事件映射：`change` → `update(path)`（`:144-146`）；`rename` 或未知路径 → `stat` 分类，存在则 `create`，不存在则 `delete`（`:152-165, 580-598`）；`filename === null` → 对 root 发 `update` 并触发根目录浅扫（`:133-138`）。
- 审计节奏（`:9-15`）：普通 500 ms 静默 / 5 s 最长；仅 change 的"可选审计"8 s；全量安全审计 30 s 静默、30 s 最小间隔、5 min 饥饿上限。启动全量盘点 `emitDiff=false`（`:80-85, 203-209`），**macOS 启动不发历史文件事件**。

### 实测：macOS 追加写的事件类型

脚本：scratchpad 里的 `watch-append.mjs`，`fs.watch(root, { recursive: true })`，Node v24.15.0 darwin（项目 CI/.tool-versions 用 Node 22，见 `.tool-versions`、`.github/workflows/ci.yml:46`；FSEvents 映射在 libuv 层，版本差异不影响结论）。

| 操作                             | 收到的 `(eventType, filename)`                                                                                  |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 新建文件后 2.5 s 再追加一行      | `change root`（无路径）、`rename proj`、`rename proj/sub`、`rename proj/sub/s.jsonl`、`change proj/sub/s.jsonl` |
| 稳定态连续两次追加（间隔 1.5 s） | `rename proj/sub/s.jsonl`、`rename proj/sub/s.jsonl`                                                            |
| 写临时文件后 `rename` 覆盖       | `rename tmp.jsonl`、`rename s.jsonl` ×2                                                                         |

即 macOS 上纯追加多数以 `rename` 送达；观察器会 `stat` 后上报为 **`create`**（`native-recursive.ts:585`）。Node 文档也只承诺 `eventType` 是 `rename` 或 `change`、`filename` 可能为 `null`、跨平台不一致（Node v22 fs 文档 "fs.watch > Caveats / Filename argument"）。

**粒度结论**：观察器能给的只是"这条路径动过"。`create`/`update` 必须一视同仁地处理成"stat 该文件，size 大于持久化游标就从游标续读，小于则整文件重解析"。它不能告诉你追加了多少、也不能可靠区分追加与覆盖。

## 3. Linux 限额对四目录的含义

本机（macOS）2026-09-18 统计（`find -type f | wc -l`、`find -type d | wc -l`）：

| 目录                    | 文件                             | 目录  | 最大深度 | 体积   | 说明                                                               |
| ----------------------- | -------------------------------- | ----- | -------- | ------ | ------------------------------------------------------------------ |
| `~/.claude/projects`    | 1,346（jsonl 687）               | 415   | 4        | 671 MB | 每项目一目录，子目录多为会话 id 目录与 `memory/`；单文件最大 57 MB |
| `~/.pi/agent/sessions`  | 594（全 jsonl）                  | 274   | 4        | 305 MB |                                                                    |
| `~/.omp/agent/sessions` | 2,210（jsonl 501，`.log` 1,347） | 273   | 3        | 442 MB | `.log` 是 bash 输出副本，会产生无关事件                            |
| `~/.codex/sessions`     | 77（全 jsonl）                   | 38    | 3        | 33 MB  | `年/月/日/` 三层                                                   |
| 合计                    | 4,227                            | 1,000 |          |        |                                                                    |

（票里写的 681 是 jsonl 数；全量文件数是 1,346。）

- **Linux 5,000 目录/root 上限**：四个 root 分别 415/274/273/38，各自余量 12 倍以上；即便都乘 5 也不触顶。`~/.omp` 与 `~/.claude` 目录数随会话数线性增长，一个会话通常增 1 个目录，按每天 10 个新会话算也要一年多才逼近。
- **inotify 用户配额**：四 root 合计约 1,000 个 watch，加上 WorkspaceGit 已有的（PR #794 修复后单仓约 263 个）。`/proc/sys/fs/inotify/max_user_watches` 是每 real UID 的上限（inotify(7) "/proc interfaces"），发行版常见默认为 8,192 或更高，1,000 级别不构成压力；但 daemon 若同时打开十几个大仓，总量要一起算。
- **250,000 条目**是 macOS/Windows 后端的上限，四 root 最大的 `~/.claude/projects` 是 1,761 条目，差两个数量级。
- **root 不存在**：`subscribe` 前置 `stat` 要求目录存在（`observation.ts:67-71`）。没装过 Codex 的机器 `~/.codex/sessions` 不存在，会直接抛错；Linux 上 root 被删也会让订阅 `fail`（`linux.ts:111-114`）。消费者需要自己处理"目录尚未出现 → 稍后重试"。
- **超限/出错后的行为**：观察器只回调一次 `error` 然后关闭，**没有内建轮询**。文档里的"fails into polling"指 WorkspaceGit 自己进入 5 s 降级轮询（`workspace-git-service.ts:86, 1417-1420, 1478-1530`）。用量服务若接 watcher，同样要自写降级轮询。

## 4. home 目录树是否在设计范围内

支持的证据：

- 接口只收一个目录和排除列表，模块内没有 git 语义；docs 明确 "Git owns Git-ignore evaluation... keeps Git policy out of the filesystem module"（`docs/file-observation.md` 第 7 段）。
- docs 要求 "Create one observer service at the owning service boundary"（第 1 段），即用量服务应自建 `createFileObserver()` 实例、在自己的 dispose 里 `close()`，而不是借 WorkspaceGit 的实例（其实例是私有字段 `workspace-git-service.ts:523, 574`，关闭在 `:976`）。
- 测试用的都是临时目录树，不依赖 git（`file-observer/index.test.ts:132-160` 等）。

需要注意的不匹配：

- WorkspaceGit 对仓库元数据订阅用"金丝雀文件"验证 watcher 活性（`watcher-liveness-canary.ts:14-66`，`workspace-git-service.ts:1822, 1890`），它会往被观察的 root 里**写一个临时文件**。往 `~/.claude/projects` 这类第三方目录里写金丝雀不合适（有些工具会枚举目录里的文件），用量服务不应沿用。
- 现有消费者只有 WorkspaceGit 一处（`grep createFileObserver`）。另有一个同名但无关的单文件观察器 `packages/server/src/server/file-explorer/observer.ts`（父目录 `fs.watch` + 50 ms 去抖 + 5 s 轮询回退 + size/mtime 指纹，`observer.ts:111-171`），它"事件 → 重新 stat → 指纹变了才通知"的形状反而更接近用量服务需要的东西。

## 5. 现成的定时模式

| 模式                                                 | 位置                                                      | 可复用点                                |
| ---------------------------------------------------- | --------------------------------------------------------- | --------------------------------------- |
| 5 分钟全量重扫 `setInterval` + `unref` + 100 ms 去抖 | `workspace-reconciliation-service.ts:20-21, 174-178, 185` | 时钟通过 `clock` 依赖注入，测试可假时钟 |
| 1 s tick 的调度器                                    | `schedule/service.ts:32, 285-296`                         | 同样 `unref`                            |
| 5 分钟结果缓存（拉式，无定时器）                     | `services/quota-fetcher/service.ts:20, 42-64`             | 适合"请求时才刷新"，不适合后台增量      |
| 5 s 降级轮询 `setTimeout` 链                         | `workspace-git-service.ts:86, 1478-1530`                  | watcher 失效后的回退写法                |
| 单文件 size/mtime 指纹                               | `file-explorer/observer.ts:168-171`                       | 指纹比较去重                            |

全量 `stat` 的成本实测：四目录 2,000 余个 jsonl 一次 `stat` 约 20 ms（`find ... -exec stat`，本机 SSD）。

## 6. 方案比较与推荐

候选：

|                        | A. file-observer watcher + `turn_completed` + 5 min 兜底（Q12 原决定）                       | B. `turn_completed` + 周期 mtime/size 指纹扫描（60 s，可配） |
| ---------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 外部 CLI 会话的新鲜度  | 秒级                                                                                         | ≤ 扫描周期                                                   |
| Paseo 自己会话的新鲜度 | 轮次结束即时                                                                                 | 轮次结束即时（同左）                                         |
| 每次触发要做的事       | stat + 从游标续读（事件类型不可信，见第 2 节）                                               | stat + 从游标续读（相同）                                    |
| 平台差异               | Linux 启动 create 风暴、macOS `rename`/`create` 混淆、`filename === null`、root 不存在即抛错 | 无                                                           |
| 失效处理               | 需自写降级轮询 + 恢复重订阅（参考 WorkspaceGit 约 250 行）                                   | 无                                                           |
| 资源                   | 约 1,000 inotify watch（Linux）；macOS 一个 FSEvents 流 + 4 份内存盘点                       | 每周期约 20 ms I/O                                           |
| 噪音                   | `~/.omp` 的 `.log`、Claude 的 `.json/.txt/.md` 事件要过滤                                    | 只 stat 匹配后缀的文件                                       |
| 代码量                 | 订阅生命周期 + 降级 + 事件过滤 + 兜底扫描，两套路径                                          | 一套扫描路径，`turn_completed` 只是提前调用它                |

**推荐 B**，理由：

1. 用量的唯一实时消费点是 Composer 工具条上"本会话用量"（interview-decisions Q27），那是 Paseo 自己的会话，`turn_completed`（`agent/agent-manager.ts:493, 2299`）已经覆盖；外部 CLI 会话只进小时桶热力图与汇总，60 s 延迟无感。
2. watcher 不能省掉任何解析工作：无论 `create` 还是 `update`，消费者都要 stat 再按游标续读；它买到的只是延迟，而延迟在这里不值钱。
3. 20 ms/周期的扫描比维持四个订阅的生命周期、Linux 启动风暴处理和降级轮询便宜得多，且没有平台分支。
4. 扫描本身就是兜底，不需要再叠一层"5 分钟兜底"；周期做成 daemon 配置项，默认 60 s。

若后续确有秒级需求再接 watcher，接法：用量服务自建 `createFileObserver()`；四 root 各一个订阅，root 不存在时跳过并在下次扫描周期重试；回调里忽略 `type`，按后缀过滤后统一"stat + 游标续读"；`error` 回调后回到周期扫描并按 `WATCH_RECOVERY_BASE_DELAY_MS` 类似的退避重订阅；不写金丝雀。

## 7. 游标与指纹的注意点（两方案共用）

- 持久化 `(path → { size, mtimeMs, offset })`。`size > offset` 从 `offset` 续读；`size < offset` 视为文件被覆盖，从 0 重解析；`size === offset` 且 mtime 变了可忽略。
- 追加可能落在半行：续读时只消费到最后一个 `\n`，剩余字节留到下次。
- 原子替换（临时文件 + `rename`）在两种方案下都表现为 size 变化，游标逻辑自然覆盖；不需要 inode 跟踪。
- Claude 单文件可达 57 MB，历史回填（Q23）必须流式读，不能 `readFile`。

## 来源

- `docs/file-observation.md`
- `packages/server/src/server/file-observer/index.ts`、`internal/{contracts,paths,observation,linux,native-recursive}.ts`、`index.test.ts`
- `packages/server/src/server/workspace-git-service.ts`、`watcher-liveness-canary.ts`、`file-explorer/observer.ts`、`workspace-reconciliation-service.ts`、`schedule/service.ts`、`services/quota-fetcher/service.ts`
- PR #794 https://github.com/getpaseo/paseo/pull/794
- Node.js v22 fs 文档 `fs.watch` Caveats（via context7 `/websites/nodejs_latest-v22_x_api`）
- inotify(7) https://man7.org/linux/man-pages/man7/inotify.7.html
- 本机实测脚本 `watch-append.mjs`（scratchpad，Node v24.15.0 darwin）与 `find`/`stat` 统计
