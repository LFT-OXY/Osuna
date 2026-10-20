# 参考项目的差异视图做法（2026-10-19 只读调研）

源码根：`/Users/oxy/Documents/Configuration/dev-environment/demo/agent客户端源码/`。行号来自子代理，主会话未逐条核对。

## openchamber（`openchamber/packages`）

- 渲染：`@pierre/diffs` `VirtualizedFileDiff`，同一滚动容器共用一个 Virtualizer（`ui/src/components/views/PierreDiffViewer.tsx:7-8, 569-628, 1318`）。
- 两段取数：`git status` + `diff --numstat` 拿列表（`web/server/lib/git/service.js:2537-2548`）；展开时才 `getGitDiff(path, 3)`（`ui/.../DiffView.tsx:831-866`）。
- 默认展开随文件数递减：≤6 全展开、≤12 展开 6、≤25 展开 4、更多展开 2（`DiffView.tsx:70-77`）。
- 只挂载视口 ±300px 内已展开文件（`DiffView.tsx:66, 1667-1724`）。
- 改动 >500 行先占位 +「仍然渲染」（`DiffView.tsx:65, 1153-1169`）；内容 >500KB 不高亮（`PierreDiffViewer.tsx:62, 1199-1204`）。
- 高亮：shiki-wasm Worker 池 + AST LRU，空闲预热（`ui/src/contexts/DiffWorkerProvider.tsx`）；缓存 key = 长度 + 首尾 200 字符的 fnv1a（`PierreDiffViewer.tsx:301-319`）。
- 刷新：由 agent 工具调用结束触发，不用文件监听（`ui/src/lib/sessionEvents.ts:80-91`）；带 paths 时只让这些文件重挂（nonce 进 key，`DiffView.tsx:1775-1790, 2234`）；面板不可见时攒着（`:1799-1808`）；服务端同 key 一个在跑一个排队、全局并发 4（`web/server/lib/git/serial-refresh.js`）；条目 `React.memo`。
- 其它：按需取全文展开上下文；diff 缓存 LRU 30 条 / 20MB；预取 ≤25 个文件、并发 2；未跟踪文件 8 并发池（`service.js:2937-2959`）。

## PI-Desktop

- 自研 div 逐行、不高亮（`apps/desktop/src/components/ReviewChangeCard.tsx:45-62`）。
- 一次取全部：`status --porcelain -z` + `git diff HEAD -M -U3`；最多 100 文件，超出 `truncated`；单文件 patch >200KB 标 `tooLarge`（`packages/host-runtime/src/workspace-diff.ts:18-19, 220-253`）；UI 有截断提示。
- git 子进程设 `GIT_OPTIONAL_LOCKS=0`、关 fsmonitor 与 hooks（`workspace-diff.ts:40-53`）。
- 卡片默认折叠，展开才渲染；无虚拟化。远程 diff 手动刷新、全量重取。

## orca（Electron + Monaco）

- 每文件一个 Monaco DiffEditor（`src/renderer/src/components/editor/DiffSectionBody.tsx:193-221`）。
- `git status --porcelain=v2` 流式解析，>1000 条杀进程并提示「改动太多」（`src/main/git/source-control/status-read.ts:148-177`，`src/shared/git-status-limit.ts:6`）；numstat 并行（`status-line-stats.ts`）。
- 大文件三档：改动 >1 万行点击才加载（`combined-diff-on-demand-load.ts:5,82`）；单侧 >12 万行或合计 >600 万字符只回元数据（`src/shared/large-diff-render-limit.ts`）；`git show` >10MB 当二进制。
- 文件区块 `@tanstack/react-virtual` 虚拟化，挂载才加载，调度器一次 1 个（`combined-diff-load-scheduler.ts:13`）。
- 刷新：监听 + 活动信号，防抖 125ms、最少间隔 3s、60s 兜底轮询（`useGitStatusPolling.ts:26-30`）；内容未变不替换 model；主进程按 HEAD/index/mtime 戳缓存已算好的 diff，并发相同读取合并（`settled-diff-cache.ts`、`worktree-diff-stamp.ts`、`file-diff.ts:49`）。
- 生成文件识别正则（只用于行数统计，不折叠）：`src/shared/generated-code-path.ts:21`。

## t3code（Web + 移动，`@pierre/diffs`）

- 一次请求 numstat 列表 + patch，patch 上限 120KB；超限标 `truncated`，前端改逐文件取，单文件上限 1MB（`apps/server/src/vcs/GitVcsDriverCore.ts:58-60, 2407-2485`）；每批 4 个、并发 4。
- 默认全部折叠（`packages/contracts/src/settings.ts:369`）；IntersectionObserver 哨兵 600px 分批加载（`DiffFileLoadingBoundary.tsx:13`）。
- 高亮：Shiki WASM（避免 JS 正则引擎回溯卡死）Worker 池，大小核数一半夹在 2–6，LRU 240，>1000 字符的行不分词（`DiffWorkerPoolProvider.tsx`）。
- 刷新：窗口获焦 + agent 写文件/执行命令后；每文件 identity key + 内容哈希 version，只重画内容变了的（`apps/web/src/lib/diffRendering.ts:230-299`）。
- 未跟踪文件：临时 index + `add --intent-to-add`，和已跟踪文件一起 diff（`GitVcsDriverCore.ts:2327-2397`）。

## 共性

先拿清单、按需取内容；文件多默认收起；大文件先不显示或不高亮；只重新处理变了的文件；高亮不占界面线程。四个项目都没有在 diff 视图里默认折叠 lock/生成文件。
