# 02 — 运行时标识：OSUNA_* 环境变量、~/.osuna、工作区 .osuna/、端口

**What to build:** 把 daemon 的运行时身份整体搬到 Osuna 名下，使它能与本机 6767 上
仍在运行的上游 Paseo daemon 同机共存、互不踩踏。不写任何自动迁移代码，新 daemon
从零起。

**Impl:** done
**Status:** ready-for-agent

**Blocked by:** 01

- [x] 全部 `PASEO_*` 环境变量 → `OSUNA_*`（100+ 个名字，`PASEO_HOME` 单独 330 处引用），
      含 `.github/workflows/`、`scripts/`、`docker/`、`nix/`、e2e 与 Maestro 用的
      `PASEO_MAESTRO_*`
- [x] 数据目录 `~/.paseo` → `~/.osuna`
- [x] 工作区目录 `.paseo/`（Hub 的 triggers / workflows）→ `.osuna/`，含 CLI 的
      `hub deploy` 相关测试夹具
- [x] 默认端口 `6767` → `6777`，含 `packages/protocol/src/ssh-transport.ts:1` 的
      `DEFAULT_SSH_DAEMON_PORT`、`packages/cli/src/commands/onboard.ts` 的帮助文案、
      client README 与示例
- [x] dev 端口 `6768` → `6778`（`package.json:39,42,93`、`scripts/dev-daemon.sh:9`），
      同时避开本机 Orca 占用
- [x] dev home `.dev/paseo-home` → `.dev/osuna-home`
- [x] 不写迁移代码、不动 `~/.paseo`、**不重启 6767 上的 daemon**（会杀掉正在运行的 agent）
- [x] 验收：`npm run dev` 起 dev daemon，`npm run cli -- daemon status` 连通，
      确认落在 `~/.osuna` 与新端口上；6767 的上游 daemon 不受影响
- [x] 测试：跑 server 里受影响的测试文件，单文件 `npx vitest run <file> --bail=1`
- [x] `npm run typecheck`、`npm run lint` 通过

## Comments

**2026-09-20 落地。** typecheck / lint / oxfmt 全绿。验收：`npm run dev:server` 起的 dev
daemon 报 `Server listening on http://127.0.0.1:6778`，`osuna daemon status` 返回
`home: .../.dev/osuna-home`、`listen: 127.0.0.1:6778`、`connectedDaemon: reachable`；
生产默认解析到 `~/.osuna`（daemon 一起来就开始往 `~/.osuna/models/local-speech` 下载语音
模型，即 prd 预期的「从零起」）。6767 上当时没有进程，我也没往上起任何东西，验收后已停掉
自己起的 6778 daemon。

清单外一并改的运行时标识（都已补进 prd 映射表）：`paseo.json` → `osuna.json`、docker 容器
身份、app 持久化键 `@paseo:*`、git stash 前缀、nix + flake、wire schema 标识符。
其中 wire 标识符按 prd 新增的归属规则处理，理由写在 `docs/protocol-compatibility.md`
新增的「首发前唯一窗口」一节。

**抓到的真问题（按发现顺序）**

1. `auth.ts` 分段解析 WS 子协议（`segments[0] === "paseo"`），client 已发 `osuna.bearer.`
   而 server 还认旧名 —— 会把密码认证整个弄坏。
2. `checkout-git.ts` 的 `isOsunaOwnedWorktree` 与 `agent-working-directory-suggestions.ts`
   的路径正则写作 `\.paseo`（正则转义），daemon 已建 `.osuna/worktrees` 而检测仍匹配旧名
   —— worktree 归属判断失效。两条都是本次改动引入的生产回归，靠测试抓到。
3. `docker-entrypoint`（无扩展名，被端口扫描的 glob 漏掉）仍默认 `0.0.0.0:6767`，而
   Dockerfile `EXPOSE 6777`、compose 发布 `6777:6777` —— 镜像监听在没人映射的端口上。
4. `.gitignore` 行首的 `.paseo/` 漏改 —— daemon 新建的 `.osuna/worktrees` 一度不再被忽略。
5. maestro 脚本与 flow 的端口默认值仍是 6767 —— 它们会去驱动**上游**的 daemon，正是本票
   要求避开的。
6. `nix.yml` 的 `OSUNA_LISTEN` 与健康探测仍是 6767。
7. `isPaseoOwnedWorktree`、`paseoTools` 是 zod schema 的对象键（会上 wire），此前只查了
   字符串字面量、没查字段名。
8. `CLAUDE.md:119` 与 `.atw/spec` 两处「不要重启 6767 上的 daemon」安全护栏，改名后不再
   覆盖 Osuna 的 6777/6778 —— 已改成按「在跑的 daemon」表述并列出四个端口。

**审查发现里我驳回或修正的**

- `deploy-triggers.ts` 的 `.osuna/hub.yml` 被判为死代码，读错了：它就是**当前**的 bundle
  路径，"legacy" 形容的是 bundle 这种部署方式过时，不是路径过时。
- `deploy-bundle.ts` 的 TOML 检查我原本打算删，仔细看后改为只改名
  （`LEGACY_TOML_PATH` → `UNSUPPORTED_TOML_PATH`）：它失去了「识别 Paseo 时代布局」的原意，
  但仍在做有用的事 —— 有人手写 `.osuna/hub.toml` 时给出明确报错，删掉会丢掉这个提示。
- `paseo-config-schema.ts` 的 `.passthrough()` shim 没死 —— 它容忍的是未知键、与文件名无关。
  只把注释里变成假话的那句改成说明历史文件叫 `paseo.json`。
- `SECURITY.md`、`docs/`、`public-docs/`、i18n 产品名文案：prd 明确归批次 4，已把批次 2
  造成的失效项逐条列进批次 4 的清单。

**保留的既有问题**：`RESERVED_DAEMON_PORTS` 的 owner 在 `packages/app/e2e/`，cli / desktop /
scripts 构建上下文不同无法 import，四端口列表在那三处仍各写一份；把测试专用常量塞进已发布的
protocol 包更糟。`osuna-auto-stash:` 仍有两处独立定义（既有重复，两边一致改名，不顺手合并）。
`osuna-home.ts` 导出的仍是 `resolvePaseoHome`（导出名归批次 4）。
