# 接口管理好用性验收遗留

## Goal

10-16-endpoint-management-ux 验收（2026-10-21）时留下的小问题：窄窗口 key 截断、已禁用的模型删除失败缺浏览器测试、3 处截图证据不全、4 个用户故事缺完整流程测试，以及验收中观察到的几处小瑕疵。用户决定该任务照常归档，这些在本任务补。

## Requirements

**合并进 main 前必做**（2026-10-21 在分支上手动跑 CI，run 39565218013）：

- CI 规矩检查 `scripts/ci-workflow.test.mjs`「browser and desktop tests have exclusive, directory-owned suites」失败：`packages/app/e2e/browser/settings-api-endpoints.spec.ts` 里用了 `paseoDesktop`（工单 28 导入链接的用例），要挪到桌面端测试目录。
- `packages/server/src/server/api-endpoints/import-apps.test.ts`「a database Osuna has no permission to open is unreadable…」在 Windows 上失败（chmod 在 Windows 不生效），要按平台处理。
- 先合并 origin/main（含 #24 把 Linux 机器固定在 24.04，否则 Playwright 装不上、浏览器测试一条都没跑），再跑一遍 CI，确认浏览器测试与 app 测试全过。分支起点就有的 `claude.test.ts`「keeps provider names out of the generic server bootstrap」和 Windows 上 `cli-bypass.test.ts`、`login-shell-env.test.ts` 的失败在 main 上已不出现，合并后复查。

验收没勾上的项（原任务工单里仍是 `- [ ]`）：

- 工单 05「编辑窗口 / key 已显示 / 窄窗口 390 — 原文完整可读」：英文 390 截图里 key 末尾被截掉（`Hide` 按钮比中文宽）；真实长度的 key 中英文都会截断。
- 工单 06「模板列表 … 三组」：截图（含 30 号重拍）只拍到「厂商」「中转服务」，没拍到「本机」组；浏览器测试已断言该组存在。
- 工单 16「浏览器测试：增删条目的成功与失败」：删除（Enable）失败只在单元测试 `disabled-models-list.test.ts` 里有，浏览器测试没有。
- 工单 22「编辑窗口 / 请求头与附加请求体」：截图都滚过了请求头的名 / 值输入行，看不到请求头编辑区。
- 工单 24「接口详情页 / 高级区展开」：冷却设置实际在编辑窗口的「高级」区；位置与工单字面不符，需定是改工单措辞还是补截图说明。
- 原任务 prd「用户故事 1–113 都有端到端或浏览器测试」：9（模板与接口行的品牌图标）、70（上下文大小小标）、89（只在接口页或用量页开着时查状态页）、102（新界面中文用词）只有单元测试；101（官方手机 App）只有旧形状保存的端到端用例。

验收中观察到的小瑕疵（不挡原任务验收）：

- `30-endpoint-list-desktop-1280-*` 左侧栏高亮在「概览」而非「第三方接口」（多半是悬停态），会误导看图的人。
- `30-import-dialog-compact-390-en-light.png` 显示测试临时目录路径。
- `docs/glossary.md` 第 90 行「Don't confuse with Import…」与第 65 行接口导入的 Import 矛盾。
- `docs/glossary.md` 未收「Forget fetched list」「Built-in icons」「逐个模型」。
- 拉模型清单失败时报错露出「GET http://… HTTP 401」原样请求地址（工单 10 起）。
- 英文「Search 1 models」单复数。
- 用量页每日用量表最后一列表头被截断。

## Acceptance Criteria

- [ ] TBD（由 `/atw-spec` 定）

## Notes

- 原任务归档后在 `.atw/tasks/archive/` 下，证据与截图在其 `screenshots/`。
