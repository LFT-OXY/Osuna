# 06 — file-observer 模块能否承担四个日志目录的观察

**Type:** research
**Blocked by:** None
**Status:** resolved

## Question

读 `docs/file-observation.md` 与 `packages/server/src/server/file-observer` 的公开接口，确定：(1) 观察 `~/.claude/projects`（681 文件）、`~/.pi/agent/sessions`、`~/.omp/agent/sessions`、`~/.codex/sessions` 这类 home 目录下的树是否在该模块的设计范围内（它目前只服务 workspace git）；(2) Linux 上 watcher 上限与 250,000 条目失败进入轮询的规则对这四个目录意味着什么；(3) 事件粒度是否足以做某文件追加了内容的增量触发，还是只能拿到路径再 stat；(4) 与 Paseo 会话 `turn_completed` 触发解析、5 分钟兜底扫描相比，是否值得接 watcher，还是 mtime 轮询就够。给出推荐。产出 `research/file-observer-fit.md`。

## Answer

详细报告：`research/file-observer-fit.md`。

- **设计范围**：模块是通用递归观察器，只认"绝对目录 + 排除子树"，无 git 语义（`docs/file-observation.md` 第 1、7 段；`file-observer/index.ts:50-54`）。观察 home 目录树在范围内，但用量服务须自建 `createFileObserver()` 实例并自行 `close()`；模块**没有内建轮询回退**，出错只回调一次 `error` 并自毁（`internal/observation.ts:144-151`），降级轮询是消费者写的（`workspace-git-service.ts:86, 1478-1530`）。root 不存在时 `subscribe` 直接抛错（`observation.ts:67-71`），没装 Codex 的机器要处理。不要沿用 WorkspaceGit 的金丝雀（会往第三方目录写文件，`watcher-liveness-canary.ts:35`）。
- **事件粒度**：只有 `{path, type}`，无 size/offset（`index.ts:10-13`）。macOS 实测稳定态追加写以 `rename` 送达，观察器 stat 后报为 `create`（`internal/native-recursive.ts:152-165, 585`）；Linux 追加是 `update`（`internal/linux.ts:97`）。结论：事件类型不可信，消费者必须 stat + 按持久化游标续读；watcher 只买到延迟，不省解析。
- **Linux 限额**：每 root 5,000 目录（`linux.ts:8`），四目录目前 415/274/273/38，合计约 1,000 个 inotify watch，余量 5 倍以上；250,000 条目上限只在 macOS/Windows 后端（`native-recursive.ts:8`），最大 root 1,761 条目。Linux 启动会对既有文件发一批 `create`（`linux.ts:176-178`），消费者要当"请核对"处理。
- **推荐**：v1 不接 watcher。走 `turn_completed`（`agent/agent-manager.ts:493, 2299`）定向增量 + 周期 mtime/size 指纹扫描（默认 60 s，可配，同时充当兜底；四目录 2,000 余 jsonl 一次 stat 约 20 ms）。理由：唯一实时消费点是 Paseo 自己会话的工具条（Q27），已被 `turn_completed` 覆盖；外部 CLI 会话只进小时桶，60 s 无感；省掉两套路径、平台分支与降级轮询。定时器写法参考 `workspace-reconciliation-service.ts:174-178`（`setInterval` + `unref` + 时钟注入）。
- **对 Q12 的影响**：原决定"其余目录 watcher + 5 分钟兜底"建议改为"周期扫描（60 s）"，watcher 留作后续可选升级；接法已写在报告第 6 节。
