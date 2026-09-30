# 参考项目的第三方配置做法（2026-09-29/30 调研）

源码都在 `/Users/oxy/Documents/Configuration/dev-environment/demo/源码/` 下。

| 项目 | 形态 | 官方与第三方能否并存 | 作用方式 | settings.json 覆盖 | 上游模型 | 测试连接 | key |
|---|---|---|---|---|---|---|---|
| t3code | 同一 driver 下多个实例，每个实例一张环境变量表 | 能 | 注入进程环境变量，可选 `CLAUDE_CONFIG_DIR` / `CODEX_HOME` 隔离 | 不检测 | 手填 | 无 | 只写，0600 文件 |
| codeg | 「认证方式」下拉：官网订阅 / 自定义接口 / 模型供应商 | 不能 | 环境变量，同时改写 settings.json、config.toml、auth.json | 自己接管这些文件 | 手填（Kimi 例外） | 无 | 明文，会回显 |
| desktop-cc-gui | 每个 CLI 一张「渠道」列表，单选 | 不能 | 一次性快照后，从快照重写 CLI 配置文件 | 自己接管这些文件 | 可拉取，作输入建议 | 无 | 明文，会回显 |
| orca | 通用的环境变量框 | 不适用 | 注入环境变量；托管账号时剥离继承的认证变量 | 能读出，但不提示 | 无 | 无 | 明文，会回显 |
| openchamber | 只包装 OpenCode，另建 provider 条目 | 能 | 改写 opencode.json | 不适用 | 手填 | 无 | 只写 |
| cc-switch | 每个 CLI 一张供应商列表，单选 | 不能 | 只改自己负责的键、按原顺序改写（2026-09-27 起） | 自己接管这些文件 | 可拉取 | 只测 base_url 是否可达 | 明文，会回显 |

## cc-switch 可借鉴的规则（`src-tauri/src/live/`）

- **负责的键**：`env` 中以 `ANTHROPIC_*`、`AWS_*`、`VERTEX_REGION_*` 开头的键，`CLAUDE_CODE_USE_*`，顶层的 `model`、`modelOverrides` 等（`live/floor.rs:18-105`）。`enabledPlugins`、`hooks`、`permissions` 属于用户，切换时不碰（`floor.rs:241-249`）。
- **Codex**：用 toml_edit 按原顺序改写（`live/project/codex.rs:500-653`）。切回官方时保留一个休眠的 provider 表，这样按 provider id 分桶的旧会话仍然能 resume（`codex.rs:437-440`、`714-720`）。
- **写入**：先记下 hash，重读后比对，内容变了就重算，最多 3 次，还不行就报 Conflict（`mode/operation.rs:121-172`）。
  - auth.json 整份写入受保护，被外部改过就拒绝。
  - 文件解析失败就不写（`live/patch/mod.rs:71-172`）。
- **首次写入前做一次字节备份**（`live/engine.rs:158-184`）。
- **列模型**：先试 `/v1/models`，再试 `/models`，兼容 `data[]` 和 `models[].slug` 两种返回格式（`services/model_fetch.rs:236-293`）。
- **CHANGELOG 里记录的事故**：
  - 回填抹掉了 Key（#7434）
  - 旧快照覆盖了新登录（#6277）
  - 第三方 Key 写进 auth.json 后一直返回 401
  - 解析失败后从空文档开始写，清空了用户配置
  - `AUTH_TOKEN` 和 `API_KEY` 同时设置时 Claude Code 报警告
- **Codex 0.149 起**，自定义 provider 不再读取 auth.json 里的 Key（`codex.rs:74-84`）。

## 为什么不直接搬 cc-switch

- 它是约 21 万行的 Rust/Tauri 桌面应用，没有 headless 或 CLI 模式。
- Osuna 的切换必须跑在 daemon 里，手机和远程客户端才能用。
- 它的默认行为与本任务的决策相冲突：会删除 auth.json、key 会回显、预设带推广链接。
- 许可证是 MIT，允许参考和移植，但要保留版权声明。
