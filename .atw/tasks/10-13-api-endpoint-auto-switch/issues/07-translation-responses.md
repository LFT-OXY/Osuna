# 07 — 协议转换：OpenAI Responses 两向

**What to build:** 补 OpenAI Responses 协议文件：Anthropic ↔ Responses、Chat ↔ Responses 两向互转，含 Responses 加密推理只回 Responses、Responses `input_file` 丢弃、只给 `file_id` 的图片回 400、Responses 直通前也做工具配对修补。做完后 Codex 能跑只有 Anthropic 或只有 Chat 地址的接口，Claude Code 能跑只有 Responses 地址的接口。对应 prd R-C1～R-C5 中 Responses 相关部分。

**Blocked by:** 05
**Status:** ready-for-agent
**Impl:** ready

- [ ] Codex 格式请求到只有 Anthropic 地址的接口、到只有 Chat 地址的接口：假上游收到正确翻译的请求，流式回复翻回 Responses 事件流，工具调用、stop、usage、模型名正确。（e2e）
- [ ] Claude Code 格式请求到只有 Responses 地址的接口：同上。（e2e）
- [ ] magpie 夹具中 Responses 相关各组（请求、流、配对、推理、附件）全部通过。（单元）
- [ ] Responses 直通请求在转发前完成工具配对修补，其余字段不变。（单元）
- [ ] Responses 加密推理发给非 Responses 上游时丢弃；Responses 请求只给 `file_id` 的图片返回 400 并按 Agent 协议包装。（单元）
