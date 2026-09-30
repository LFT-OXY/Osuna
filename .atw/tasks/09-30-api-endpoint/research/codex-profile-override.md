# Codex profile 会不会覆盖 Osuna 写的顶层键

2026-09-30 核实，来源为 openai/codex 源码各版本的 `codex-rs/core/src/config/mod.rs`（`gh api repos/openai/codex/contents/...?ref=<tag>`）和官方配置文档 https://developers.openai.com/codex/config-advanced 、https://developers.openai.com/codex/config-file/config-reference 。

## 两代 profile

- **旧写法（0.118.0–0.133.x）**：`config.toml` 顶层 `profile = "name"` 选中 `[profiles.name]`，表里的键（含 `model_provider`、`model`）覆盖顶层。0.118.0 的 `ConfigToml` 仍有 `profile` 和 `profiles` 字段。
- **新写法（0.134.0 起）**：profile 是 `$CODEX_HOME/<name>.config.toml` 独立文件，只能用命令行 `--profile name` 选。顶层 `profile = "name"` 会让配置加载直接报错：`legacy profile = "<name>" config is no longer supported; use --profile <name> with <name>.config.toml instead`（0.133.0 没有，0.134.0 有）。
- 优先级：命令行参数 > profile > 项目配置 > 用户配置（官方文档）。项目级 `.codex/config.toml` 里的 `profile`、`profiles`、`model_provider`、`model_providers` 会被忽略。

## 对 Osuna 的含义

- 能从文件里查出的只有旧写法：顶层 `profile` 指向的 `[profiles.<name>]` 里写了 `model_provider` 或 `model`。这时切换在 0.118–0.133 上可能不生效，健康状态报 `codex_profile_override`。
- 新写法只由终端里的 `--profile` 选中，daemon 查不到。Osuna 启动 `codex app-server` 时不带 `--profile`，所以 Osuna 自己的会话不受影响。
- `openai_base_url`（官方配置参考）是内置 `openai` provider 的地址覆盖。官方模式下判断「CLI 自身配置指向哪里」时一并读它。
