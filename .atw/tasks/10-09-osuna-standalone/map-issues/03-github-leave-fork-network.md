# 03 — GitHub 仓库脱离 fork 网络

**Type:** task
**Blocked by:** None
**Status:** resolved

## Question

把 `LFT-OXY/Osuna` 从 `getpaseo/paseo` 的 fork 网络中自助脱离（GitHub 文档《Detaching a fork》，Settings → Danger Zone → Leave fork network）。仓库满足条件：公开、约 280 MB、0 个子 fork。HITL：按钮必须由仓库所有者点。

给用户的精确清单：

1. 脱离前备份：`gh release download` 把全部 Release 资产与说明拉到本地（`gh release list` 当前有 v0.12.0 … v0.14.2）。
2. 记下现有 Secrets 名单：`CSC_LINK`、`CSC_KEY_PASSWORD`（原件在本机 `~/.config/osuna/codesign/`）。
3. 在网页点 Leave fork network，输入仓库名确认。
4. 脱离后核对：`gh repo view --json isFork,parent` 应为 `false` / `null`；Releases 是否还在，不在则用备份重新创建；Secrets 是否还在，不在则补回；Actions 是否仍启用。
5. 本地所有 clone / worktree 不需要改 remote（URL 不变）。

## Answer 要记录的事实

脱离时间、哪些元数据实际丢了、是否重传了 Releases、Secrets 是否重建。

## Answer

**已脱离，无任何元数据丢失，无需重传。**

- 脱离时间：2026-10-09 约 10:10（Asia/Shanghai），由仓库所有者在 Settings → Danger Zone 点 Leave fork network。API 在点击后约 60 秒内从 `fork: true, parent: getpaseo/paseo` 变为 `fork: false, parent: null`；公开页面「forked from」标记消失。
- 实际保留（逐项核对，与脱离前一致）：
  - Releases 12 个全在，资产数不变（11×18 + beta 23），`releases/latest` 仍指向 v0.14.2，`releases/download/v0.14.2/latest-mac.yml` HTTP 200。桌面端自动更新链路不受影响。
  - Secrets `CSC_LINK`、`CSC_KEY_PASSWORD` 仍在，未重建。
  - Actions 仍 enabled、allowed_actions = all，12 个 workflow 全部 active。
  - PR 11 个（含 CLOSED 的 #2）仍可访问。官方文档警告"不保留 pull requests"，实测保留了；不要依赖这一点，备份仍留着。
  - 标签 14 个、分支 `main`、stars 1、description / homepage、协作者均未变。
- 本地 clone / worktree 的 remote URL 不变，`git ls-remote` 正常，无需改动。
- 备份目录 `~/osuna-detach-backup-2026-10-09/`（PR、Release 元数据、v0.14.2 全部资产 1.6 GB）暂留，1.0.0 发布后可删。

## Comments

### 2026-10-09 脱离前备份（AFK 部分已做）

脱离前实况（`gh repo view`）：`isFork: true`，parent `getpaseo/paseo`，公开，diskUsage 280705 KB，0 子 fork，满足自助脱离条件。

GitHub 官方《Detaching a fork》原文：不保留 issues、pull requests、wikis、stars、watchers、comments、child forks 及"其他元数据"；git 提交元数据保留；不可逆。Releases 与 Secrets 未明说，按会丢准备。

会受影响的东西盘点：
- Releases 12 个（v0.8.1-beta.1 … v0.14.2），每个 18 个资产（beta 23 个），资产合计约 19.5 GB。
- PR 11 个，全部 MERGED / CLOSED（#2 改名 PR 为 CLOSED）。Issues 功能关闭；无 wiki 内容、无分支保护、无 ruleset、无 webhook、无 deploy key、无 environment。stars 1、watchers 0。
- Secrets 2 个：`CSC_LINK`、`CSC_KEY_PASSWORD`；原件在 `~/.config/osuna/codesign/`（`osuna-codesign.p12`、`.p12.password`、`.pem`）。
- Actions：enabled，allowed_actions = all。

备份目录 `~/osuna-detach-backup-2026-10-09/`：
- `repo.json`、`actions-permissions.json`、`secrets-names.txt`
- `releases/releases.json` + 每个 tag 一份 `vX.Y.Z.json`（说明、资产名/大小/URL）
- `prs/pr-N.json`（正文、评论、review、commits、files）+ `pr-N.diff`（#1/#2/#4 diff 为空，分支已删或超限，提交都在 main 历史里）
- `assets/v0.14.2/`：最新稳定版全部资产（1.6 GB，桌面自动更新与下载页唯一依赖的版本）。其余 11 个版本只备元数据，不拉二进制。
- git 标签 14 个已 `git fetch --tags` 到本地，脱离不影响。
