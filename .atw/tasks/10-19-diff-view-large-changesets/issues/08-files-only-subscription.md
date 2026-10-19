# 08 — 只开文件树时只拿清单

**What to build:** Changes 面板只开文件树、diff 正文不可见时，只向 daemon 要文件清单，daemon 不读全文、不做高亮，推送的包很小。正文一出现，就切回完整订阅。连着还没升级的旧 daemon 时，照旧走完整订阅，面板照常能用。

- 协议：`CheckoutDiffCompareSchema` 加可选字段，表示「只要文件清单」。打开时，每个 file 仍带 path、oldPath、isNew、isDeleted、additions、deletions、status、generated，`hunks` 为空数组。按 `docs/rpc-namespacing.md` 和 `docs/protocol-compatibility.md` 的规矩来。
- daemon：这个字段进入 `normalizeCompare` 和 target key，清单订阅和完整订阅各算各的、各自缓存。daemon 底层已有不做结构化的分支，在它的基础上补上清单字段。
- `server_info.features` 加一个开关，宣告支持这个选项，并打 `COMPAT(...)` 标记。客户端只在开关为 true 时用清单订阅。

**Blocked by:** 02, 07
**Status:** ready-for-agent
**Impl:** ready

- [ ] daemon 用例（真实 git 仓库）：只要清单时，每个 file 的清单字段齐全、和完整订阅里的同名字段一致，`hunks` 为空。
- [ ] 用例：同一个 cwd 同时有清单订阅和完整订阅，两边各自收到正确内容。
- [ ] 客户端用例：有开关时只开文件树走清单订阅，打开正文后切到完整订阅；没有开关时始终走完整订阅。
- [ ] 协议兼容：旧 daemon 的 schema 能解析带新字段的请求（忽略它）。
- [ ] UI：桌面版只开文件树时，文件树内容、增删行数、Generated 标记与完整订阅时一致（截图）。
- [ ] typecheck、lint 通过。
