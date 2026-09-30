# 04 — 测试连接

**What to build:** 在新建或编辑第三方接口的表单里，用户点「测试连接」，先从已勾选或手动添加的模型里选一个，然后由 daemon 从主机直接向该接口发一条最小的对话请求：

- Claude 接口：用 Anthropic Messages 协议，`max_tokens` 取最小值；
- Codex 接口：用 OpenAI Responses 协议，不带 `store` 和 `previous_response_id`。

结果要展示：成功或失败、HTTP 状态码、上游返回的错误信息（截断到合理长度）、耗时。界面文案要写明，这个测试只验证接口本身，Claude 的登录冲突这类 CLI 侧的问题，要等到第一次真实对话时才会暴露；遇到时可以尝试 `/logout`。

保存前就能测试。编辑已保存的接口时，key 留空就用已保存的 key 来测。

**Blocked by:** 01, 02

**Status:** ready-for-agent
**Impl:** done

- [x] Claude 和 Codex 各自按上述协议发出最小请求，请求有超时，并且可以取消。
- [x] 结果包含成功或失败、状态码、截断后的上游错误信息、耗时；key 不出现在结果和日志里。
- [x] Codex 接口不支持 Responses 协议时，结果能让用户看出来。
- [x] 测试用本地假上游 HTTP 服务覆盖：成功、401、模型不存在、协议不符、超时。
- [x] 界面先弹出模型选择，再展示结果；局限说明文案齐全。
- [x] 新文案 9 种语言齐全；`npm run typecheck`、`npm run lint`、改动涉及的测试文件都通过。
