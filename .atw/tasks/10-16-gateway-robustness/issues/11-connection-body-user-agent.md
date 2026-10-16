# 11 — 连接、请求体与 User-Agent

**What to build:** 三件事：

- **复用的连接被掐**：上游回复开始之前，复用的连接被关掉（EOF、broken pipe 一类），立刻在新连接上重发。不算失败，也不冷却。
- **压缩过的请求体**：按 Content-Encoding 解开 zstd 和 gzip，其他编码回 415。64 MB 的上限按解开后的大小算；超了回 413，文字说明这是中转站的上限，并建议用 `/compact`。直通发给上游的是解开后的请求体，同时去掉 Content-Encoding。
- **User-Agent**：直通时原样转发 CLI 的；翻译时也带上 CLI 发来的；CLI 没带时，写 `Osuna/<版本>`。

**Blocked by:** None
**Status:** ready-for-agent
**Impl:** ready

- [ ] 端到端：假上游第一次在复用的连接上直接关闭，中转站在新连接上重发并成功；这家不冷却。
- [ ] zstd、gzip 压缩的请求体，直通和翻译各一例都成功；上游收到的是解开后的请求体，没有 Content-Encoding。
- [ ] 其他编码回 415；解开后超过 64 MB 回 413，文字里提到 `/compact`。
- [ ] 直通和翻译时，上游收到的都是 CLI 自己的 User-Agent；CLI 没带时，上游收到 `Osuna/<版本>`。
- [ ] 借鉴 magpie 的代码，文件头保留 MIT 声明。
- [ ] `npm run typecheck`、`npm run lint` 通过，改到的测试文件本机通过。

参考：prd.md 第 44–46 条；明细 01·A33、A36、C28。
