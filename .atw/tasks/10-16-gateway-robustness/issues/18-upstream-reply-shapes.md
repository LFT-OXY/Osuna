# 18 — 认清上游回的是什么

**What to build:** 照 magpie：

- **整份 JSON**：上游无视流式要求、回了一整份 JSON 时，转成 CLI 要的流。现在的做法是当作失败换家。
- **不是本协议回复的 2xx**（HTML 登录页、Cloudflare 挑战页、空内容、不以 JSON 开头）：当 502 换家并冷却，原因里写上页面标题。直通也这样认。
- **流里的错误**：保留厂商的 type、code、param；Responses 流里的 `invalid_request_error` 读成 400；只用 `event:` 行命名的错误也认。
- **智谱包在 200 里的拒绝**（`{"code":…,"success":false}`）：按它的错误码当作 401 或 429，照常换家、冷却。

**Blocked by:** 13
**Status:** ready-for-agent
**Impl:** done

- [ ] 端到端：上游回一整份 JSON，CLI 收到它要的事件流，内容一致。
- [ ] 直通和翻译各一例：上游回 HTML 登录页，就换到下一家，这家冷却；日志和最后的错误里有页面标题。
- [ ] 流里的厂商错误转给 CLI 时，type 和 code 保留；`invalid_request_error` 读成 400。
- [ ] 智谱 200 信封的两种错误码各一例：一种按 401 处理（标「需要检查」），一种按 429 处理（冷却）。
- [ ] 借鉴 magpie 的代码，文件头保留 MIT 声明。
- [ ] `npm run typecheck`、`npm run lint` 通过，改到的测试文件本机通过。

参考：prd.md 第 22 条、第 26 条（智谱部分）；明细 01·B08、B09、B12、02·A75。
