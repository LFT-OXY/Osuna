# 07 — 改名例外清单：哪些地方保留 paseo 字样

**Type:** interview
**Blocked by:** None
**Status:** resolved

## Question

Q4 定了"全部改名、无一例外"，但有几类文本改了反而是错的，需要用户逐条确认哪些保留：

1. **法律与致谢**：`LICENSE` 版权行、新建的 `NOTICE`、README 页尾致谢——保留 Paseo 字样（Q13 已定）。
2. **历史记录**：`CHANGELOG.md` 已发布版本的条目（Q13 已定保留）；`docs/adr/0002-rename-stops-at-app-identity.md` 等 ADR 正文是历史决策，保留原文只加 superseded 状态。
3. **归档任务**：`.atw/tasks/archive/**` 里的 prd / 工单 / research 提到 paseo 的地方——推荐不动（历史）。
4. **指向上游的 URL**：`https://github.com/getpaseo/paseo`、`paseo.sh` 文档链接——在 NOTICE / 致谢中保留，其余删除或换成自己的。
5. **测试夹具与样例数据**：测试里出现的 `paseo` 字面量跟着代码改；但若夹具模拟的是"上游旧版本的数据文件"（如迁移测试里的 `~/.paseo` 样本），必须保留旧拼写——需要列出这类夹具。
6. **第三方外部名**：npm 上的上游包名 `@getpaseo/hub` 等若在文档中提及作为对比，保留。
7. **术语表**：`docs/glossary.md` 的 **Paseo** 条目只剩"上游项目"一个含义。

先用 `rg` 按目录给出分类计数，再带着清单访谈。产出：例外清单（路径模式 + 理由），供 spec 的改名脚本做排除表。

## Answer

访谈一轮（2026-10-09），10 项全部按推荐拍板。

**排除表（改名脚本整文件 / 整目录跳过）**

| 路径模式 | 理由 |
|---|---|
| `LICENSE` | Apache-2.0 要求保留上游版权声明 |
| `NOTICE`（新建） | 写明源自 Paseo (Apache-2.0)，保留 `github.com/getpaseo/paseo` 链接 |
| `CHANGELOG.md` | 已发布条目是历史；1.0.0 条目起用 Osuna |
| `docs/adr/**` | ADR 正文是历史决策；0002 只保留已加的 `superseded by ADR-0006` 头 |
| `.atw/tasks/**` | 归档任务 160 个文件 + 本任务目录，均为历史 / 规划文本 |
| `.atw/workspace/**` | 开发者日志，历史 |
| `**/fixtures/legacy-paseo/**` | 迁移测试的旧版数据样本，文件名与内容都必须保持旧拼写（现在还没有，规则先立） |
| `README.md` / `README.zh-CN.md` / `README.ja.md` / `README.ko.md` | 句内保留，脚本跳过后人工改写 |
| `docs/glossary.md` | 句内保留，脚本跳过后人工改写 |

**人工改写的文件要做什么**（spec 列为单独验收项）

- README ×4：页尾一行致谢（含上游链接）；「不要从 npm 安装 `@getpaseo/cli`，那是上游 Paseo」这类明确指上游的句子保留；其余 Paseo → Osuna。
- `docs/glossary.md`：**Paseo** 条目保留为"上游项目"；其余条目（Daemon、Forge、Worktree、Usage、Fork 等十余处）把产品名改为 Osuna；**Product discussion** 改指本仓库 Discussions。

**明确不是例外、随脚本改的**

- 上游 URL 全部替换：测试样例里的 `github.com/getpaseo/paseo` → `github.com/LFT-OXY/Osuna`；`app.paseo.sh` / `relay.paseo.sh` → Q7 域名；`paseo.sh/changelog`、`/download` → `osuna.chinhae.cc/...`；配置 `$schema` → `https://osuna.chinhae.cc/schemas/osuna.config.v1.json`（**官网必须实际托管该 schema 文件**，进 spec）；文档示例域名 `paseo.cafe`、`paseoapps.my.domain.com` → osuna 示例。`public-docs/` 内的 URL 由 10 号票一并处理。
- `skills/paseo-plugin`、`plugin-examples/**` 引用的 `@getpaseo/plugin` 是本产品自己的包 → `@osuna/plugin`；`e2e/support/fixtures/acp-chunks-plugin/paseo-plugin.json` → `osuna-plugin.json`、`requirements.osuna`。
- `.atw/spec/**`（15 个文件）是在用的编码规范，引用的路径与命令随改。
- `.github/**` 工作流与 issue / PR 模板、`.agents/skills/release-*`、Docker 镜像名与容器内用户目录 `/home/paseo`、nix 包名与 `paseo-desktop` 启动器名：全部随改，无例外。

**附带决定**

- `fastlane/metadata/`（68 个文件，三语）整目录删除，不改名保留；以后上 F-Droid 从 git 历史取回。
- 例外清单不写进 ADR 0006，只留本票与 prd。

**计数依据**：含 paseo 的文件约 2253；CHANGELOG 841 行（792 处上游 PR 链接）；`.atw/tasks/archive` 160；`.atw/spec` 15；fastlane 68。rg 默认跳过隐藏目录，统计 `.atw` / `.github` 需加 `--hidden`。
