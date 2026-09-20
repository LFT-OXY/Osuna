# 02 — 运行时标识：OSUNA_* 环境变量、~/.osuna、工作区 .osuna/、端口

**What to build:** 把 daemon 的运行时身份整体搬到 Osuna 名下，使它能与本机 6767 上
仍在运行的上游 Paseo daemon 同机共存、互不踩踏。不写任何自动迁移代码，新 daemon
从零起。

**Impl:** ready
**Status:** ready-for-agent

**Blocked by:** 01

- [ ] 全部 `PASEO_*` 环境变量 → `OSUNA_*`（100+ 个名字，`PASEO_HOME` 单独 330 处引用），
      含 `.github/workflows/`、`scripts/`、`docker/`、`nix/`、e2e 与 Maestro 用的
      `PASEO_MAESTRO_*`
- [ ] 数据目录 `~/.paseo` → `~/.osuna`
- [ ] 工作区目录 `.paseo/`（Hub 的 triggers / workflows）→ `.osuna/`，含 CLI 的
      `hub deploy` 相关测试夹具
- [ ] 默认端口 `6767` → `6777`，含 `packages/protocol/src/ssh-transport.ts:1` 的
      `DEFAULT_SSH_DAEMON_PORT`、`packages/cli/src/commands/onboard.ts` 的帮助文案、
      client README 与示例
- [ ] dev 端口 `6768` → `6778`（`package.json:39,42,93`、`scripts/dev-daemon.sh:9`），
      同时避开本机 Orca 占用
- [ ] dev home `.dev/paseo-home` → `.dev/osuna-home`
- [ ] 不写迁移代码、不动 `~/.paseo`、**不重启 6767 上的 daemon**（会杀掉正在运行的 agent）
- [ ] 验收：`npm run dev` 起 dev daemon，`npm run cli -- daemon status` 连通，
      确认落在 `~/.osuna` 与新端口上；6767 的上游 daemon 不受影响
- [ ] 测试：跑 server 里受影响的测试文件，单文件 `npx vitest run <file> --bail=1`
- [ ] `npm run typecheck`、`npm run lint` 通过
