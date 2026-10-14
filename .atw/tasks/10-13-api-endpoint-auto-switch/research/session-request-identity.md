# CLI 请求里的会话标识（07 票子调研，2026-10-14）

目的：中转站要把一次 HTTP 请求对应回具体的 Osuna 会话，才能在时间线上加「本轮改由接口 B 回答」。只读官方文档、开源源码与本机已装二进制的字符串，未运行需要登录的 CLI。

本机版本：Claude Code 2.1.296（Bun 打包，`strings` 可扫）；Codex CLI 0.162.0。

## Claude Code（Anthropic Messages 协议）

- **请求头 `x-claude-code-session-id`：默认每个请求都带，不需要任何环境变量。** 官方文档 https://code.claude.com/docs/en/llm-gateway-protocol 「Request headers」基础表；二进制 `Ml()` 组装 `{"x-app": cli|cli-bg, "User-Agent", "X-Claude-Code-Session-Id": K()}`，`ANTHROPIC_BASE_URL` 路径不过滤（Bedrock/Vertex 路径走白名单会过滤）。
- 值 = 会话 id：`K()` 同时用于转录文件名 `~/.claude/projects/<project>/<id>.jsonl` 与 `--resume` 比对，三者同值。
- 后台小任务（标题、compaction、子代理）仍是同一个会话 id；子代理额外带 `x-claude-code-agent-id` / `x-claude-code-parent-agent-id`。
- `metadata.user_id`：2.1.296 已是 JSON 字符串 `{device_id, account_uuid, session_id, parent_session_id?, ...}`，`session_id` 同值；旧版 `user_<sha256>_account_<id>_session_<uuid>` 模板在二进制里已搜不到。字段含义官方未写，属反推。
- 「提示头」`x-claude-code-request-class` / `-agent-type` / `-compaction` / `-prompt-id` 等另受 `CLAUDE_CODE_GATEWAY_HINT_HEADERS` 控制：自定义 base URL 默认不发，设 `=1` 才发，需 v2.1.273+。中转站不依赖它们。
- 旁证头：`x-app: cli`（后台会话 `cli-bg`）；`User-Agent: claude-cli/<version> (external, cli...)`；`anthropic-beta` 含 `claude-code-20250219`。

## Codex（OpenAI Responses 协议，自定义 `model_providers`）

- **请求头 `session-id` 与 `thread-id`（连字符），另有 `x-client-request-id`（= thread id）、`x-codex-turn-metadata`（JSON，含 session_id/thread_id/turn_id/agent_name/parent_thread_id）、`x-codex-window-id`、`x-codex-installation-id`、`x-codex-parent-thread-id`、子代理 `x-openai-subagent`（review/compact/memory_consolidation/collab_spawn）。** 源码 `codex-rs/codex-api/src/requests/headers.rs:5-14` `build_session_headers`；`codex-rs/codex-api/src/endpoint/responses.rs:86-92`；WebSocket 握手 `codex-rs/core/src/client.rs` ~1236-1260 同样带。
- **对自定义 provider 照发**：头合并处无 provider 判定（`core/src/client.rs:1296-1325`）。按 `is_openai()` 门控的只有 `x-codex-routing-hint`、attestation、zstd、`encrypted_function_args`、并发推理摘要。provider 级 `http_headers` 只追加不移除。
- 值：根线程 `session_id == thread_id`（`core/src/session/session.rs:941-953`）；子代理线程 `thread-id` 是自己的、`session-id` 是根会话的。rollout 文件名 `rollout-<ts>-<thread id>.jsonl`（`codex-rs/rollout/src/recorder.rs:82-102`），`codex resume <id>` 用的也是 thread id。
- **头名演变**（`git log -- headers.rs`）：2025-11-25 `conversation_id`+`session_id` → 2026-01-12 删 `conversation_id`（#9107）→ 2026-05-06 加 `thread_id`（#20437）→ 2026-05-08 改连字符 `session-id`/`thread-id`（#21757）→ 2026-05-13 删下划线版（#22193）。**中转站要同时接受 `thread-id` / `thread_id` / `x-client-request-id`**，老版本 Codex 才对得上。
- `originator` 头固定 `codex_cli_rs`（TUI `codex-tui`、VSCode `codex_vscode`），`codex-rs/login/src/auth/default_client.rs:42,456-458`。

## 对应回 Osuna 会话

- Claude Code：取 `x-claude-code-session-id`，与会话记录的 `runtimeInfo.sessionId` / `providerSessionIds`（`packages/server/src/server/agent/agent-storage.ts`）比对；兜底解析 `metadata.user_id` JSON 的 `session_id`。
- Codex：取 `thread-id`（兼容 `thread_id`、`x-client-request-id`），同上比对；`session-id` 用于把子代理请求归到根会话。
- 两者都不需要特殊地址或环境变量。对不上的请求（终端里直接开的 CLI 会话、未知版本）不归属任何会话。
