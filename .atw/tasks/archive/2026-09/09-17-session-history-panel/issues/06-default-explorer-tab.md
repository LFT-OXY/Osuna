# 06 — 会话历史成为 Explorer sidebar 的默认 tab

**What to build:** 用户打开任何 workspace，右侧 Explorer sidebar 直接有"文件 / 更改 / 会话历史"三个 tab，不需要右键或启动器手动打开。新 workspace 从种子里带上；已经保存过布局的旧 workspace 在加载时补上一次。用户主动关掉后不再自动出现。

**Impl:** done
**Status:** ready-for-agent

**Blocked by:** 01

- [x] `createDefaultExplorerSidebarTabs`（`stores/workspace-layout-actions.ts`）的种子加入 `{ kind: "session_history" }`，排在 changes_tree 之后
- [x] 已保存布局：加载时若 explorer pane 里没有 `session_history` 且用户没有关过它，补一个 tab（需要一个"已补过 / 用户关过"的标记，放在 layout 持久化里，schema 走 `workspace-layout-storage.ts`；旧 payload 缺字段时按未补过处理）
- [x] 紧凑布局的 Explorer 覆盖层分段控件与 `explorer-tab-memory` 的默认值同步检查，保证手机上也默认可见（核实 `compact-explorer-sidebar.tsx` 无条件列出 sessions，无需改动）
- [x] 测试：`workspace-layout-store.test.ts`（仓库无 actions 独立测试文件）覆盖新 workspace 种子、旧布局补齐一次、用户关闭后不再补
- [x] `npm run typecheck`、`npm run lint` 通过
