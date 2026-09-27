# 07 — 更新与外链只指向本仓库

**What to build:** 应用和 CLI 里不再有任何地方把用户引向上游，具体包括：
- Rosetta 提示里的「下载 Apple Silicon 版」拿到的是本仓库 Releases 里的 Osuna 包，失败时的回退地址也指向本仓库的 Releases。
- 应用内更新日志显示本仓库主分支的 CHANGELOG。
- CLI onboard 里的下载链接指向本仓库。
- 「反馈问题」、Issue 和仓库链接指向 `LFT-OXY/Osuna`。
- 删除赞助链接。
- 删除应用和 CLI 里所有指向上游文档站的链接，以及只为承载这些链接而存在的「了解更多」元素。

**Blocked by:** None — can start immediately
**Status:** ready-for-agent
**Impl:** ready

- [ ] desktop-updates 的测试断言 Rosetta 下载地址指向本仓库
- [ ] 应用内打开更新日志时，内容来自本仓库
- [ ] 在产品代码（不含测试夹具）中搜索上游仓库地址、上游作者赞助页、上游文档站，没有剩余命中。hub、relay、app 的服务端点默认值不属于本票范围，这类命中要单独列出并注明原因
- [ ] 删除文档链接后，相关页面的布局没有留下空白或孤立的分隔元素（附截图）
- [ ] typecheck 与 lint 通过
