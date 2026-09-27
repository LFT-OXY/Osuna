# 07 — 更新与外链只指向本仓库

**What to build:** 应用和 CLI 里不再有任何地方把用户引向上游，具体包括：
- Rosetta 提示里的「下载 Apple Silicon 版」拿到的是本仓库 Releases 里的 Osuna 包，失败时的回退地址也指向本仓库的 Releases。
- 应用内更新日志显示本仓库主分支的 CHANGELOG。
- CLI onboard 里的下载链接指向本仓库。
- 「反馈问题」、Issue 和仓库链接指向 `LFT-OXY/Osuna`。
- 删除赞助链接。
- 删除应用和 CLI 里所有指向上游文档站的链接，以及只为承载这些链接而存在的「了解更多」元素。

**Blocked by:** None — can start immediately
**Status:** ready-for-agent
**Impl:** done

- [x] desktop-updates 的测试断言 Rosetta 下载地址指向本仓库
- [x] 应用内打开更新日志时，内容来自本仓库
- [x] 在产品代码（不含测试夹具）中搜索上游仓库地址、上游作者赞助页、上游文档站，没有剩余命中。hub、relay、app 的服务端点默认值不属于本票范围，这类命中要单独列出并注明原因
- [x] 删除文档链接后，相关页面的布局没有留下空白或孤立的分隔元素（附截图）
- [x] typecheck 与 lint 通过

## Comments

**实现结论（2026-09-27）**

- **Rosetta**：`desktop-updates.ts` 的下载基址由已有的 `DESKTOP_RELEASES_URL` 推导为 `https://github.com/LFT-OXY/Osuna/releases/download`，文件名改为 `Osuna-<版本>-arm64.dmg`，与 `electron-builder.yml` 的 mac `artifactName` 一致。取不到版本时，`rosetta-callout-source.tsx` 调用现有的 `openDesktopReleasesPage()`，不再回退到 `paseo.sh/download`。测试先红后绿。
- **更新日志**：`changelog-source.ts` 改为读取 `raw.githubusercontent.com/LFT-OXY/Osuna/main/CHANGELOG.md`，e2e 夹具拦截的地址同步修改。仓库是公开的，该地址已确认返回 200。弹窗头部指向 `paseo.sh/changelog` 的「完整更新日志」按钮已删除。
- **反馈 / 仓库 / 赞助 / Discord**：侧栏帮助菜单和启动失败页的 Issue 链接改为指向 `LFT-OXY/Osuna/issues/new`；CommunityLinks 的 Star 改为指向本仓库。Sponsor 与 Discord 入口删除，Discord 是经用户确认后追加的。
- **文档链接（App）**：以下链接连同承载它们的按钮或链接一起删除：
  - Agent skills
  - daemon「高级设置」
  - CLI 文档
  - relay 原理
  - worktree 的 setup / teardown
  - 元数据生成
  - 计划任务空状态
  - 启动失败页的 Docs 按钮
  - 欢迎页（仅移动端）的 `paseo.sh`
- **文档链接（CLI）**：
  - `daemon pair` 的两处「Learn …」已删除。
  - `onboard` 的桌面端下载改为指向本仓库的 `releases/latest`，删除 Docs 一行，后续条目重新编号。
  - `plugin scaffold` 模板的按钮改为打开 `https://github.com/LFT-OXY/Osuna`，经用户确认。
- **插件报错**：protocol 的 `plugin-requirements.ts` 与 server 的 `plugins/runtime.ts` 删掉了迁移指南 URL（经用户确认），相关的 6 处测试断言同步更新；protocol 需要重建 dist，app 与 server 的测试才能读到新文案。
- **孤儿清理**（只清理本次改动产生的）：
  - 组件：`components/ui/external-link.tsx`、`components/icons/discord-icon.tsx`。
  - 样式：`settingsStyles.sectionHeaderLinkText`。
  - i18n：9 个语言文件中的 `sidebar.help.discord`、`changelog.openWebsite`、`desktop.daemon.{advancedSettings,openAdvancedSettings}`、`settings.integrations.docs`、`settings.host.skills.{docs,openDocs}`、`pairing.device.{relayDocs,relayDocsAccessibility}`、`settings.project.worktree.{docs,docsTooltip}`、`settings.metadataGeneration.docs`、`schedules.screen.seeDocs`。
  - e2e：helper `openRelaySecurityDocs`，以及 desktop 中只调用它的 e2e 用例 `opens relay security documentation through the desktop opener`。

**搜索结果中保留的命中**

在 `packages/`（不含 website 和测试）中搜索 `getpaseo/paseo`、`github.com/getpaseo`、`sponsors/boudra`、`paseo.sh`、`discord.gg`，剩余的命中及保留原因如下：

- **服务端点默认值（不在本票范围）**：
  - `relay.paseo.sh`：`protocol/daemon-endpoints.ts`、`server/config.ts`、`server/bootstrap.ts`、`server/pairing-offer.ts`、`relay/wrangler.toml`，以及 `app/.../host-picker.tsx` 里的注释。
  - `app.paseo.sh`：`server/config.ts`、`server/bootstrap.ts`、`server/pairing-offer.ts`、`server/persisted-config.ts`、`protocol/connection-offer.ts` 里的注释、`app/.../pair-link-modal.tsx` 的占位符，以及 CLI `onboard` 的「Web app」一行（配对 web app 仍借用上游）。
  - `hub.paseo.sh`：CLI 的 `hub/authority.ts`、`hub/help.ts`、`hub/init.ts`。research 表把后两处列为文档链接，实际上它们是 hub 端点，不改。
- **包元数据和开发文档（PRD / research 划出范围）**：两个 iOS podspec 的 `homepage`、`packages/desktop/package.json` 的 `homepage` / `repository` / `author`、`packages/client/README.md`。

**截图**

截图只保存在本地，未入库，路径为本会话 scratchpad 下的 `shots/`。每张图的检查结果都是：没有留下空白、孤立的分隔线或空的 trailing。

- Web（Playwright，1280×900）：
  - 侧栏帮助菜单：反馈区只剩 GitHub Issue
  - 更新日志弹窗：头部只剩关闭按钮
  - 关于页的 CommunityLinks：只剩 Star
  - host Agents 页的编排 skills 区块
  - 元数据生成
  - 配对设备的 relay 确认框
  - 项目 worktree 的 setup / teardown
  - 计划任务空状态
- 桌面 dev（Electron，通过 CDP）：
  - host 概览里的 Daemon 区块
  - 集成页
- 未截图：启动失败页（很难触发）。这一处只删掉了三个按钮中的 Docs，剩下的两个按钮仍在同一行 flex 容器里。

**验证**

- typecheck：app、cli、server、protocol 均通过。
- 改动文件：oxlint 通过，oxfmt 通过。
- 单测：app 受影响目录共 725 个，全部通过；cli 的 scaffold、daemon、onboard 通过；protocol 与 server 的插件测试通过。
- e2e：
  - app `sidebar-help.spec.ts`：5 个通过。
  - app `pair-device-relay.spec.ts`：通过。
  - desktop `pair-device-relay.spec.ts`：10 个通过。
- 全量 `npm run test`：本票相关的失败都已修复。server 剩下的 `bootstrap-provider-availability`、`workspace-service-port-allocator` 各 1 个失败，与 08 号工单记录的基线失败相同；`workspace-git-service.observation` 单独运行能通过，属于不稳定用例。
