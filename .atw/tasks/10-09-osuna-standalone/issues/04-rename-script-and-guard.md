# 04 — 全量改名脚本与守线

**What to build:** 仓库里除例外清单外不再有任何 Paseo 拼写：命令叫 `osuna`，home 是 `~/.osuna`，环境变量 `OSUNA_*`，配置 `osuna.json`，scheme `osuna://`，MCP server `osuna`，插件清单 `osuna-plugin.json` 与 requirements 键 `osuna`，Electron userData `Osuna`，Docker 镜像 `ghcr.io/lft-oxy/osuna` 与 `/home/osuna`，skills `/osuna-*`，npm 作用域 `@osuna/*`，nix 包名与启动器名，安卓 / iOS 标识 `com.chinhae.osuna`。一条 CI 守线从此守住这条线（spec 决策 A）。本票不写迁移逻辑：改名后的 daemon 与桌面端直接用新路径启动，旧数据迁移由后续票接上。

**Blocked by:** 01, 02, 03
**Status:** ready-for-agent
**Impl:** ready

- [ ] 改名脚本按 07 号票例外清单整文件跳过：`LICENSE`、`NOTICE`、`CHANGELOG.md`、`docs/adr/**`、`.atw/tasks/**`、`.atw/workspace/**`、`**/fixtures/legacy-paseo/**`、四份 README、`docs/glossary.md`；其余全部替换，含文件名与目录名、隐藏目录（`.atw/spec`、`.github`、`.agents`）
- [ ] 包名 `@osuna/*`、lockfile 重新生成、根脚本的 `--workspace` 名随改；Docker 镜像名与容器内用户目录、nix 包名与桌面启动器名、skills 目录与命令名、插件示例与 e2e 夹具的清单文件名与 requirements 键随改
- [ ] 应用配置：显示名 Osuna、slug `osuna`、scheme `osuna://`、安卓包名与 iOS bundle id `com.chinhae.osuna`（调试版 `.debug`）；桌面 appId 与产物名 `Osuna-*` 保持不变；package.json 作者 `LFT-OXY <autuhae@gmail.com>`
- [ ] 上游 URL 全部替换：仓库链接改 `LFT-OXY/Osuna`，`app/relay/paseo.sh` 改对应 `*.chinhae.cc`，配置 `$schema` 改 `https://osuna.chinhae.cc/schemas/osuna.config.v1.json`，文档示例域名改 osuna 示例
- [ ] `fastlane/metadata/` 整目录删除
- [ ] 新增仓库脚本级守线检查：扫描整棵树（含隐藏目录，排除 node_modules / dist / 锁文件）中的 `paseo` 字样，只放行例外清单与带 `COMPAT(paseoDataMigration)` 标签的代码；自带临时目录测试；接入每个 PR 都跑的仓库脚本检查
- [ ] `npm run typecheck`、`npm run lint`、`npm run format:check`、守线检查全绿；CLI 测试套件以 `osuna` 命令名通过；server / desktop / app / website 现有测试绿；Docker 构建与 nix 工作流在 CI 通过
