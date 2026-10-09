# 08 — 渲染层存储跨 origin 迁移

**What to build:** 0.14.x 桌面端用户升级后，主机列表、设置、草稿、面板布局在首个窗口打开时就已经在 `osuna://app` 下；旧 `paseo://app` 的数据永不清空；导入失败时用户可以选择重试或放弃旧数据继续（spec 决策 C 层 2，细节见 `research/renderer-storage-migration.md`）。

**Blocked by:** 07
**Status:** ready-for-agent
**Impl:** done

- [x] 主进程在首个窗口创建前开隐藏顶层 `BrowserWindow`，从 `paseo://app` 枚举全部 `localStorage` 键与 `indexedDB.databases()` 导出（不依赖键名），`clearStorageData` 清空 `osuna://app` 后整体写入；两个 scheme 同时登记为 privileged，`paseo` 处理器只服务内联导出页；Blob 值过 IPC 转 ArrayBuffer
- [x] 键名与库名只在导入端按映射表改名（`@paseo:` → `@osuna:`、`paseo-` → `osuna-` 等前缀），不匹配任何前缀的键原样保留；映射表对研究列出的 23 个键与 4 个库逐一有单测断言等于渲染器新常量
- [x] 完成标记写在新 userData 桌面设置文档的 `migrations` 字段，不设失败计数字段；已有标记则跳过；旧 origin 数据永不删除
- [x] 导入失败弹对话框二选一（中文）：「重试」退出下次再跑；「放弃旧数据继续」写完成标记后正常启动，之后不再清空新 origin；不设自动重试上限；成功时主进程日志一条 info
- [x] 迁移代码带 `COMPAT(paseoDataMigration)` 标签
- [x] 导出 / 导入脚本在 Node + fake-indexeddb 下做往返一致性测试（含 Blob）
- [ ] `fixtures/legacy-paseo/` 固定一份去掉无关目录的 0.14.x userData 样本（约 1 MB 以内，文件名与内容保持旧拼写并加入守线例外）；Electron e2e 以副本启动，断言主机列表、草稿、面板布局出现，标记已写，`paseo://app` 旧数据仍在；失败注入（导出页 404、导入抛错）断言不写标记且下次启动成功
- [x] `npm run typecheck`、desktop 现有测试与 e2e 全绿
