# 03 — CLI 改指向中转站

**What to build:** 某个 Agent 的「使用第三方接口」总开关从关到开时，生成该 Agent 的口令，Claude Code 的 `settings.json` 写 `ANTHROPIC_BASE_URL`（中转站）、`ANTHROPIC_AUTH_TOKEN`（口令）、`ANTHROPIC_API_KEY` 置空、顶层 `model`（默认模型），不写 `ANTHROPIC_MODEL`、`ANTHROPIC_DEFAULT_*_MODEL`、`ANTHROPIC_SMALL_FAST_MODEL`（存在则记录并删除）；Codex 的 `config.toml` 写顶层 `model_provider`、`model`、`model_catalog_json`，专用表写 `base_url`（中转站 `/v1`）、`wire_api = "responses"`、`experimental_bearer_token`（口令明文），去掉 `auth.command`、`codex-api-key` 文件与最低版本检查。Codex 模型目录文件列去重后的光秃秃模型名（可见）与各家 `标识/模型名`（隐藏），接口、已选模型、任一开关变化即重新生成。关总开关时全部还原、口令作废、目录文件删除。daemon 启动绑定端口后比对接管记录里的网址，不一致则重写；旧数据换算来的「总开关开着」的 Agent 从没经历「从关到开」，没有口令（02 只在设置写入时补），启动这一步要先补口令再写配置；非 TCP 监听时拒绝打开总开关并说明。ADR 0004 的文件编辑规则全部保留。对应 prd R-B2～R-B6。

**Blocked by:** 02
**Status:** ready-for-agent
**Impl:** done

实现备注：删除的模型变量切回官方时值原样回来但排到 `env` 末尾（e2e 按内容比较）；Codex 目录每个条目带 Codex 自己的基础指令（不带则整个目录读不进来）；socket 下的不可用原因字段为列表的 `gatewayUnavailable`，拒绝错误用同一个 code `gateway_requires_tcp`；口令文件在两个 Agent 都关着时删除；启动时清理 v0.15 留下的 Codex 专用表与 key 文件。

- [x] 总开关打开后 `settings.json` 只多出规定的键、`config.toml` 只多出规定的键与专用表，用户原有的其它内容（含注释与排版）一字不差；关掉后两个文件回到接管前原样，口令文件与模型目录文件删除。沿用现有 claude / codex e2e 的「手写配置不丢」断言并按新写法重写。（e2e）
- [x] 接管时 `settings.json` 里已有 `ANTHROPIC_MODEL` / `ANTHROPIC_DEFAULT_*_MODEL` / `ANTHROPIC_SMALL_FAST_MODEL`：被记录并删除，切回官方后原值恢复。（e2e）
- [x] Codex 模型目录文件：内容包含去重后的光秃秃模型名与各家 `标识/模型名`，可见 / 隐藏字段正确；改已选模型、接口开关、总开关任一项后文件更新；切回官方后文件删除且 `model_catalog_json` 键还原。（e2e）
- [x] 口令在总开关从关到开时生成、关时作废；作废后用旧口令访问中转站得到 401。（e2e）
- [x] daemon 改端口重启后两个 CLI 配置里的中转站网址被重写为新端口，其它内容不动。（e2e）
- [x] daemon 以 socket 监听启动时，打开总开关的请求被拒并带原因；已打开的总开关在该情形下列表里显示不可用原因字段。（e2e）
- [x] 现有 `codex-auth-command` 相关代码与版本检查删除，无遗留引用。
