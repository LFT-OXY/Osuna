# Osuna 差异面板现状（2026-10-19 读代码所得）

来源：子代理只读梳理 + 主会话亲自核对（标 ✔ 的已亲眼核对）。未做过任何实测，卡顿耗时均未量。

## daemon 侧（路径相对 packages/server/src）

- 取数一次算完所有文件，不按文件懒加载。✔ `utils/checkout-git.ts:2122` 注释 "Temporary until diffs load lazily per file"；上游 `upstream/main`（本地引用截至 2026-10-13，b0f054de9）同一注释仍在（该文件 :2157），上游尚未做懒加载。
  - 文件列表：`git diff --name-status` + `ls-files --others`（`checkout-git.ts:507-576`）。
  - 行数：`git diff --numstat`（`:655`）。
  - 已跟踪文件：每 64 个一批 `git diff <refs> -- :(literal)p...`（`:644`、`:737-785`、`:3308`）。
  - 未跟踪文件：串行循环，每个文件一个 `git diff --no-index /dev/null` 子进程（`:3479-3494`、`:2241`）。
  - 全文：`git cat-file --batch` 读新旧两版（`:3094`、`utils/git-file-contents.ts:7`）。
- 上限：✔ 单文件 1MB（`PER_FILE_DIFF_MAX_BYTES`）、patch 总量 2MB（`TOTAL_DIFF_MAX_BYTES`），结构化结果约 23MB（按 relay 32MiB 帧反推，`CHECKOUT_DIFF_MAX_STRUCTURED_BYTES`），超了整体 diffTooLarge。二进制：已跟踪看 numstat `-`（`:694`），未跟踪嗅探前 16KB（`:2151`）。
- 高亮：服务端 lezer，`server/utils/diff-highlighter.ts:326-358` 的 `highlightDiffWithFileContent` 对新旧两版**整文件**各解析一次；`packages/highlight/src/highlighter.ts:23-56` 按字符分配 styleMap 并逐字符拼串。同步执行，文件间仅 `setImmediate` 让步（`checkout-git.ts:3163`）。无跨刷新的高亮缓存。
- 推送：订阅 `subscribe_checkout_diff_request`，首发 `_response`，之后每次整包 `checkout_diff_update`（`session/checkout/checkout-session.ts:423-473`）；一次性读取 `checkout.diff.get`（`:409`）。无分页、无流式。
- 刷新：✔ 未提交模式下文件监听 → `workspace-git-service.ts:1531` → `:2090` 清缓存并通知；`server/checkout-diff-manager.ts:7` 防抖 `CHECKOUT_DIFF_WATCH_DEBOUNCE_MS = 150`，强制刷新（`:390`）。base 模式跟随 workspace 快照（1s 防抖）。每次全量重算；整快照 `JSON.stringify` 做指纹去重（`checkout-diff-manager.ts:317`），发送时 `websocket-server.ts:1248` 再序列化一次。监听降级为轮询时每 tick 都让 diff 缓存失效（`workspace-git-service.ts:1639`）。
- 只看文件树也拉全量高亮：`checkout-diff-manager.ts:266` 固定 `includeStructured: true`。

## 协议

`packages/protocol/src/messages.ts:2828-2856`（文件/hunk/行/token）、`:5613-5640`（payload `files[]`）。每文件带全部 hunk；每行 `content` 与 `tokens[]` 各存一遍文字。

## 客户端（路径相对 packages/app/src）

- 右侧 Changes 面板 `git/diff-pane.tsx:1438` 的 `ChangesSurface`，主体 `:1793` `DiffDocument`。全屏/tab：`panels/diff-panel.tsx:132`、`:186`（working_diff / changes_tree / commit_diff）。移动端 `components/compact-explorer-sidebar.tsx:508`。
- 渲染已窗口化：Web 用 Canvas 只画可见窗口（`git/diff-document/surface.web.tsx:166`、`:278`），原生 Skia 分块（`surface.native.tsx`、`native-slabs.ts`）。文件树 FlatList（`git/changed-files-tree.tsx:140`）。
- 默认全部展开：`panels/changes/state.ts` `collapsedFilePaths: []`。
- 数据：react-query `useReplicaQuery`（`git/use-diff-query.ts:84`）；每次推送对所有行、token 深比较，未变文件复用旧对象（`git/diff-sharing.ts:7`、`:50-97`）。
- `buildDiffDocumentModel`（`git/diff-document/model.ts:72`、`:243`）每次为所有展开文件的每行生成几何行，只测量窗口内文字；开自动换行时测全部（`:275-279`，默认关）。滚动跨过 2 倍视口区间或任一文件变化都重建。
- 收包：主线程整包 `JSON.parse` + 逐 token AOT 校验（`packages/client/src/daemon-client.ts:6750`、`:6757`）。

## 已有测试与历史

- `packages/app/e2e/browser/diff-performance.spec.ts`（需 `PASEO_DIFF_PERF_E2E=1`；2000 个单行小文件，只测滚动）。
- `packages/server/src/server/daemon-e2e/git-diff-bottleneck.local.e2e.test.ts`（需环境变量）。
- 单测：`checkout-diff-manager.test.ts`、`checkout-diff-cache.test.ts`、`diff-highlighter.test.ts`、`measurement-cost.test.ts`。
- 相关上游提交：#4174、#4574、#4676。未合入的上游 Diff 修复：be0acb293 "fix(app): keep Diff updates alive after the first edit (#6745)"。
- 未覆盖：大量中等/大文件、agent 持续改文件时的刷新风暴。

## 卡顿点

确认（读代码）：
1. 任一文件变化（150ms 防抖）即全量重算：所有文件重取 patch、读两版全文、整文件 lezer 高亮，在 daemon 主线程同步跑，会拖慢整个 daemon（含 agent 输出流）。
2. 未跟踪文件串行，每个一个 git 子进程 + stat + 嗅探 + 读文件 + 高亮。
3. 整包推送：payload 可达十几 MB（文字存两遍），daemon 序列化 3 次，经 relay 还要加密；客户端主线程 parse、校验、深比较、重建 model。
4. 只看文件树也拉全量。

推测（未验证）：
5. 轮询降级时每 tick 触发重算。
6. 上方文件高度一变，其后所有行重新定位。

Bug（读代码确认，未复现）：✔ `checkout-git.ts:3479-3482` 未跟踪文件循环在 `diffBytes >= TOTAL_DIFF_MAX_BYTES` 时 `break`，剩余未跟踪文件从结果中消失，连 too_large 占位都没有（已跟踪文件走 `appendTrackedPlaceholderComment` 有占位）。

## 补充核对（第二个子代理，2026-10-19）

- 协议无「只要文件列表」字段：`CheckoutDiffCompareSchema` 只有 `mode`/`baseRef`/`ignoreWhitespace`（`packages/protocol/src/messages.ts:2315-2319`），订阅请求 `:2327-2333`。`normalizeCompare` 丢弃多余字段（`checkout-diff-manager.ts:154-163`），`:266` 写死 true。changes_tree 与 diff 走同一条订阅（`panels/diff-panel.tsx:100/132` → `git/diff-pane.tsx:1551` → `git/use-working-diff.ts:63`）。服务端底层已有不做结构化的分支（`checkout-git.ts:3206`、`:3470`）。
- 监听回调拿得到变动路径（`workspace-git-service.ts:1502-1528` 的 `events[].path`），但 `notifyWorkingTreeConsumers` 调无参 `listener()`（`:2094-2096`，签名 `onChange: () => void`，`:980`），下游只有「有变化」信号。
- diff 缓存 `checkout-diff-cache.ts`：LRU 64 条，key `[cwd, mode, baseRef, ignoreWhitespace, includeStructured]`（`:35-41`），整份失效（`:83-91`），有效期 15s（`:47`）。无按文件缓存。推测可按 `--raw` 的 blob hash（`checkout-git.ts:2502`）/ 未跟踪文件 mtime+size 做按文件复用。
- 退订：tab 隐藏、切 tab、切工作区会退订（`components/retained-panel.tsx:22-29`、`git/use-diff-query.ts:52-53`、`data/push-router.ts:332-337, 494-499`）。窗口最小化/应用进后台**不**退订：`setAppVisible(false)` 只 `replicaCache.flush()`（`runtime/host-runtime.ts:2561-2566`）。
- `collapsedFilePaths` 按 tab 存（`panels/use-panel-state.ts:10-14` → `stores/workspace-layout-store.ts:1054`），zustand persist 到 AsyncStorage "workspace-layout-state"（`:1709-1711`）；旧字段 `collapsedFilePathsByWorkspace`（`stores/panel-store/state.ts:146`）。收起的文件只占文件头高度、不生成行（`git/diff-document/model.ts:74-75, 91`），但数据照样下发、服务端照样算。单文件点文件头切换（`git/diff-document/document-file-header.tsx:26-31`），有「全部收起/展开」按钮 `changes-toggle-collapse-all`（`git/diff-pane.tsx:794-820`）。
- 仓库内无生成文件 / lock 文件 / linguist-generated 识别逻辑。
- 全进程一个 `CheckoutDiffManager`（`server/bootstrap.ts:1189`），同 cwd + 同 compare 共用一个 target，算一次发给所有监听者（`:320-339`）。
- **桌面版 daemon 是独立子进程**（`server/daemon-instance.ts:229-253` spawn detached；`ELECTRON_RUN_AS_NODE=1`，`desktop/src/daemon/node-entrypoint-launcher.ts:32`）。daemon 被占满不会冻住 Electron 窗口；窗口冻住更可能来自渲染进程处理大包（JSON 解析、AOT 校验、`shareCheckoutDiff`、建行模型）——推测，待实测。daemon 内高亮跑在主事件循环，无 worker_threads。
- 并发：同一 target 防抖 + 串行合并（`checkout-diff-manager.ts:240-250, 299-326`），缓存层合并在途 promise（`checkout-diff-cache.ts:50-74`）。文件持续变动时基本是不停的全量重算（推测）。
