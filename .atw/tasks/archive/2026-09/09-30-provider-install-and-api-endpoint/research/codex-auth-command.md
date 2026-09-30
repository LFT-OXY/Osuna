# Codex `auth.command` 与第三方端点（2026-09-29 调研）

依据 openai/codex@18194bfd35 的源码和官方文档，全程没有运行 codex。

## `model_providers.<id>.auth` 字段

- 可用字段：`command`（字符串）、`args`（字符串数组）、`cwd`、`timeout_ms`（默认 5000，不能为 0）、`refresh_interval_ms`（默认 300000，设为 0 表示只在收到 401 后才重跑）。
  - 出处：`codex-rs/protocol/src/config_types.rs:563-590`；https://developers.openai.com/codex/config-reference
- 输出要求：命令拿不到 stdin，读取整段 stdout 并 trim。输出为空、不是 UTF-8、或退出码非 0 都算错误（`login/src/auth/external_bearer.rs:103-158`）。
- 执行方式：直接 exec，不经过 shell，继承 Codex 进程的环境变量，不展开 `~`。Windows 上带 `CREATE_NO_WINDOW` 标志运行。
- 引入版本 0.118.0（PR #16286–#16288），文档没有标 experimental。
- 互斥：不能和 `env_key`、`experimental_bearer_token`、`requires_openai_auth = true` 同时使用（`model-provider-info/src/lib.rs:361-388`）。
- **不碰 auth.json**：配置了 auth 的 provider 走 `AuthManager::external_bearer_only`（`model-provider/src/auth.rs:187-195`、`login/src/auth/manager.rs:2329-2358`）。PR #16287 的原话是 "bearer-only external auth never persists to auth.json"。
  - `codex login status` 仍然读 auth.json（`cli/src/login.rs:445-480`）。
- 用 command 认证的 provider 会刷新模型目录；用 `env_key` 的会出现 "Unknown model" 警告（`models-manager/src/manager.rs:545-553`；OpenRouter Codex 指南）。
- 保留 id：`openai`、`ollama`、`lmstudio`、`amazon-bedrock` 不能用（`config/src/config_toml.rs:67-73`）。

## 跨平台写法

- macOS / Linux：`command = "/bin/cat"`，`args = ["<绝对路径>"]`。这是按源码语义推出来的。
- Windows：OpenRouter 官方示例用的是 `command = "powershell"` 加 `-NoProfile -Command ...`。
  - 改成读文件的写法（`Get-Content -Raw -LiteralPath`）**还没验证**。
  - powershell 冷启动可能超过 5 秒，需要调大 `timeout_ms`。
  - `cmd /c type` 在路径含空格时的引号问题还没验证。
  - 路径建议用 TOML 单引号字面量。
  - 验证方式：在 GitHub Actions 的 Windows 机器上验证。

## Codex 的 ChatGPT 令牌

- 刷新令牌后会写回 auth.json（https://developers.openai.com/codex/auth/ci-cd-auth ）。
- refresh token 是一次性的（openai/codex-plugin-cc#789，`refresh_token_reused`）。
- 所以绝不能用旧快照还原 auth.json。

## Osuna 现状

- 启动方式：`codex app-server`，不带 `-c`。自定义 codex provider 的 `model_providers` 通过 thread/start 和 thread/resume 的 config 注入（`codex-app-server-agent.ts:3234-3264`、`5146-5190`）。
- 请求级 config 和 config.toml 是逐表深合并的，所以 Osuna 写进文件的 provider id 必须和注入用的 id 不同。
- 内置 codex provider 不注入 `model_provider`，会跟随 config.toml 顶层设置。
- Osuna 目前没有 Codex 的全局最低版本检查，只有 goals（0.128.0）和 auto-review（0.115.0）两处（`:171-172`）。需要为 0.118.0 新增一道检查。
- 套餐用量只读 auth.json（`packages/server/src/services/quota-fetcher/providers/codex.ts:174-176`）。

## 其他备选方案（已否决）

- `env_key`：终端里要 export 环境变量，而且会出现 Unknown model 警告。
- `experimental_bearer_token`：key 明文写进 config.toml，官方不推荐（cc-switch 用的是这个）。
- `--profile`：终端里每次都要手动加参数。
