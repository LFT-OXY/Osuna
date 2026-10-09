# 10 — 官网文档页取舍

**Type:** interview
**Blocked by:** 06, 07
**Status:** resolved

## Question

`public-docs/` 有约 30 篇顶层文档加 `hub/`、`plugins/`、`sdk/` 三个子目录，全部是上游英文文档。官网第一版文档区（Q9）要决定：

1. 哪些页保留并改写为 Osuna（预期：index、why、cli、configuration、connectivity、docker、providers、supported-providers、claude-code、codex、custom-providers、workspaces、worktrees、web-ui、updates、troubleshooting、security、skills、mcp、orchestration）；哪些删除（`hub/` 整目录随 06；`metadata-generation`、`community` 等上游社区向内容）；`plugins/`、`sdk/` 是否保留（插件清单已改名、不兼容上游插件，文档要同步改写）。
2. 语言：Q9 定简体中文为主。是全部翻译成中文，还是第一版先中文首页 + 下载页、文档暂留英文改名版？推荐后者，翻译量放到后续版本。
3. 文档里引用的截图、`paseo.sh` 链接、`npx skills add` 命令等一并替换。

产出：保留 / 删除 / 改写清单，供 spec 切票。

## Answer

访谈 2026-10-09，8 问全按推荐。产出是保留 / 删除 / 改写清单，直接供 spec 切票。

**查到的事实（决策依据）**

- 文档导航由 frontmatter `category` + `order` 自动生成（`packages/website/src/docs.ts`），子目录自动成组，删文件即删导航。
- `public-docs/` 实有 28 篇顶层 + `hub/` 21 篇 + `plugins/` 7 篇 + `sdk/` 9 篇，共 11297 行；0 张图片。voice、browser×3、agent-profiles、schedules×3、orchestration×2、skills、metadata-generation 都对应本仓库真实功能。
- `plugins/` 的"v0.7 当前 / v0.8 测试版"分版是上游 0.8 时代遗留；内部 `docs/plugins.md` 只链 v0.8 三篇；`plugin-docs-navigation.test.ts` 钉死双版本导航与旧 URL 重定向。
- `sdk/` 文档的是 `@getpaseo/client`（→ `@osuna/client`，Q5 定不发公网）；文档首页"Server / CLI"的 `npm install -g @getpaseo/cli` 在 Osuna 没有可用等价物（无 npm 发布权限，见 `docs/release.md`「Fork 分发」）。
- 官网非文档页：约 45 个按代理名的 SEO 落地页（`src/data/agent-pages.ts` + `src/routes/<slug>.tsx`）、`/agents` 索引、7 篇替代品对比页（`src/content/alternatives/`）、博客 2 篇 + 草稿、赞助页（上游作者自述）、首页 9 条上游用户推荐语（`public/social-proof/`）、`llms.txt` 生成器含 agents / alternatives 两节。页眉页脚链到 blog / sponsor / hub / agents。
- 首页英雄区截图（`hero-mockup.png`、`homepage-hero.png`、`phone-1~3.*`、`iphone-mockup-left.png`、`mobile-mockup.png`）全是上游 Paseo 界面图。
- 外链 60 余处：`github.com/getpaseo/paseo/...`（`plugin-examples/`、`skills/` 目录本仓库都存在）、`hub.paseo.sh`、`paseo.sh/schemas`、`app.paseo.sh`、`paseo.cafe`、4 个第三方社区插件仓库。`problems/unauthorized` 只出现在 `hub/api.md`。
- 网站代码三处硬编码上游仓库：`docs-source-footer.tsx`（在 GitHub 上编辑）、`downloads.tsx`（下载链接）、`latest-release.ts`（Release API）。

**决策**

1. **顶层文档**：只删 `community.md` 与 `hub/`（06 已定），其余 27 篇全部保留改写（含票里原先漏列的 voice、browser×3、schedules×3、agent-profiles、orchestration-workflows、metadata-generation）。
2. **插件文档去分版**：删 `plugins/v0.7/` 整目录与 `plugins/v0.8/migration.md`；v0.8 的 index / reference / providers 上提为 `plugins/index.md`、`plugins/reference.md`、`plugins/providers.md`；删版本选择页、`legacyPluginDocRedirects` 与 `plugin-docs-navigation.test.ts` 的双版本断言；`docs/plugins.md` 的链接随改；requirements 键 `paseo` → `osuna` 随 Q4。
3. **SDK 文档整删**：`sdk/` 9 篇删除；不发布的包不留公开安装文档。重新补回的前提是 `@osuna/client` 有可安装渠道，在 1.0.0 之外，记入范围外。
4. **安装路径重写**：首页三条安装方式改为桌面端（GitHub Releases `LFT-OXY/Osuna`）、Docker（`ghcr.io/lft-oxy/osuna`）、服务器 / 无头（克隆仓库 → `npm ci` → `npm run build:server` → 运行 CLI）；`web-ui.md`、`updates.md`、`docker.md` 的 npm 安装语句同改；不开"CLI 发布包"等新分发渠道。
5. **非文档页**：只留首页、下载页、文档、更新日志（`CHANGELOG.md` 生成）、隐私、条款。整删：代理 SEO 落地页 + `/agents`、替代品对比页、博客（含 `posts/`）、赞助页、推荐语跑马灯与头像、`/hub`（06）。页眉页脚对应链接随删。`llms.txt` 保留，前言改 Osuna，删 agents 与 alternatives 两节。
6. **语言**：第一版中文首页 + 中文下载页；文档区保留英文，只做改名与内容订正（删 Hub 引用、改安装路径、改链接），导航分类名保留英文。中文翻译在 1.0.0 之外，记入范围外。
7. **链接与命令替换**：(a) `github.com/getpaseo/paseo/...` → `github.com/LFT-OXY/Osuna/...`；(b) `app.paseo.sh` → `osuna-app.chinhae.cc`，`paseo.sh/download` → `osuna.chinhae.cc/download`，`paseo.sh/schemas/...` 按 07；(c) `npx skills add getpaseo/paseo` → `npx skills add LFT-OXY/Osuna`，skills 名随 Q4；(d) 4 个第三方社区插件仓库、`paseo.cafe`、`labels/plugins` 随上游社区内容删；(e) 网站代码三处硬编码仓库地址改 `LFT-OXY/Osuna`，属改名实现。
8. **首页与下载页做法**：沿用 `packages/website` 现有版式，不开原型票。首页文案换中文、英雄区截图换 Osuna 自己的、删推荐语与上游专属段落；下载页换文案与 Release 源。视觉改版在 1.0.0 之外。
