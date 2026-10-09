# 13 — 内部文档与 1.0.0 发布说明

**What to build:** 贡献者与 AI agent 照 `docs/` 操作不会碰到不存在的命令、中继或发布路径；维护者发 1.0.0 时有现成的发布说明升级段，用户不用翻文档就知道要做什么（spec 决策 I）。

**Blocked by:** 05, 06, 07, 08, 09, 10, 11
**Status:** ready-for-agent
**Impl:** ready

- [ ] `docs/release.md`：「Fork 分发」一节重写为 Osuna 的正式发布路径，删上游 npm 发布路径；新增 COMPAT 到期清单（`paseoDataMigration` 三层）与 0.14.x 回滚步骤（整版退回，数据靠 `~/.paseo` 符号链接）；安卓 keystore 一节保留
- [ ] `docs/architecture.md` 与 `docs/release.md`：Cloudflare Worker 就是生产中继，删除"legacy、生产用 Elixir"的说法
- [ ] `CLAUDE.md`、`docs/development.md`、`.atw/spec/**`、skills：命令、路径、端口、home 等描述与改名后一致；`docs/testing.md` PR 路由段删 Hub 句
- [ ] 1.0.0 发布说明草稿（放任务目录或 CHANGELOG 顶部条目）：升级段含 CLI 卸旧装新、上游 Paseo App 请卸载、Docker 链接到 Public docs 升级段、安卓包无推送通知、上游手机 App 不再受支持；官网与 APK 链接或"即将上线"说明
- [ ] `docs/data-model.md`、`docs/android.md`、`docs/glossary.md` 已由前序票改写，本票只核对一致性
- [ ] 守线检查绿；`npm run lint` 对改动文件通过
