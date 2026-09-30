# 02 — Codex 第三方接口通路

**What to build:** Codex 的提供方详情面板也出现「官方 / 第三方接口」模式区，可以新建和启用第三方接口。

启用后，daemon 按 ADR 0004 改写 Codex 的 `config.toml`：

- 顶层的 `model_provider` 和 `model`，指向 Osuna 专用的 provider 表；
- 这张表里写 name、base_url（与现有自定义 Codex 提供方的归一化规则一致）、`wire_api = "responses"`，以及 `auth` 的 command、args、timeout_ms；
- `auth.command` 读取 daemon 私有的 key 文件（权限 0600）。

`auth.json` 从头到尾一个字节都不碰。切回官方时，只恢复顶层键，专用表保留，这样第三方模式下创建的 Codex 会话还能恢复。Codex 版本低于 `auth.command` 要求的最低版本时，拒绝启用，并说明需要升级。

**Blocked by:** 01

**Status:** ready-for-agent
**Impl:** ready

- [ ] 选定一个改写后能保留注释和格式的 TOML 方案（不能用 `smol-toml` 整份重写），并把选择和理由补写进 ADR 0004。
- [ ] Codex 补丁纯函数的测试覆盖：用户原有的注释和格式保留、已有 `model_provider` 和 `model`、恢复到「原本不存在」、专用表在切回后仍然保留、输出稳定、无法解析。
- [ ] 专用 provider id 不能与 Codex 的保留 id 冲突，也不能与现有自定义 Codex 提供方注入时用的 id 冲突。有测试证明两者共存时不会合并出错误的配置。
- [ ] 启用前先切换 key 文件，再写 `config.toml`。`config.toml` 写入失败时，模式保持为切换前的状态。
- [ ] 按平台生成的 `auth.command`：macOS/Linux 用系统的读文件命令，Windows 用 PowerShell 的绝对路径，并调大超时。单元测试执行生成出来的命令，断言输出与 key 文件内容完全一致；这条测试在 CI 的 Windows server 测试里通过。
- [ ] 进程内 daemon 测试使用临时 `CODEX_HOME` 和一个只会打印版本号的假 `codex` 可执行文件，覆盖：版本不足时拒绝、启用和切回官方后的文件内容、`auth.json` 前后字节一致。
- [ ] 文件位置遵循 daemon 环境里的 `CODEX_HOME`，缺省为 `~/.codex`。
- [ ] 新文案 9 种语言齐全；`npm run typecheck`、`npm run lint`、改动涉及的测试文件都通过。
