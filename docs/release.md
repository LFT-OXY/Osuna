# Release

All workspaces share one version and release together.

## Two steps

A release has exactly two steps. The agent does the first, the user authorizes the second.

**Preparation** (local, reversible — agent does this):

- format, lint, typecheck all green
- resolve the release source to one commit and confirm that commit's existing CI is green
- classify the diff from the previous stable to the release source as patch or minor, then show the
  target version and rationale to the user
- draft the changelog, show it to the user, wait for review
- run the pre-release sanity check, surface findings to the user

**Go-ahead** (user says "go ahead"):

- commit the approved release inputs locally
- run the release, which publishes npm and pushes the prepared branch and tag
- create the release heartbeat immediately and babysit it to completion

Rules that apply to both steps:

- Last-minute changes always need approval. Every time.
- No code changes bundled into the changelog commit or the release commit. Code shims live in their own commit, reviewed on their own merits.
- A sanity-check finding is information, not a directive. The agent surfaces it; the user decides.
- Invoking a release skill is intent to start the flow, not blanket authorization to publish.
- If the user asks for a release preview, show the prospective changelog/release contents and answer questions, but do not commit, tag, publish, or run release commands until they explicitly authorize the release.

## Release source and CI

The default release source is `origin/main`. Fetch `origin`, then record the
resolved commit. The default release checkout is a clean local `main` whose
`HEAD` equals `origin/main`.

An explicit user instruction can select another ref, such as a hotfix commit or
tag. Resolve that ref once and apply every source, diff, and CI check to that
commit instead of `origin/main`.

Before making release-preparation commits, confirm the existing CI run for the
resolved commit is green. Pending CI is watched to completion. Release
preparation then stays local through the changelog, any explicitly requested ACP
catalog update, lockfile preparation, and the version commit. After approval,
commit the prepared inputs locally and run the release command. Its branch and
tag push is the one remote release batch and starts CI for the complete release
commit.

## Release branch discipline

While you finalize a release on `main`, use a temporary `next` branch for work intended for the following
release. This applies to both beta and stable releases.

- Create each new `next` from freshly fetched `origin/main`. Reuse it while active.
- "This goes to next" means create the PR against `next` or retarget an existing
  PR, and keep that destination through delivery.
- Keep `next` current by merging `origin/main` into it as release fixes land.
  Avoid rebasing this shared branch because agents and open PRs depend on its history.
- After the release ships, bring `next` up to date and open a `next` → `main` PR.
  Pass CI and merge without squashing away the individual PR commits needed for
  the changelog. Retarget remaining PRs based on `next` to `main` and delete the integrated
  `next`. Create it fresh when needed again.

**Setup still needed:** PR checks run for every base branch, but CI, Docker, and Nix
push runs target only `main`, and GitHub permits only squash merges. Enable
required-check protection for `next`, CI on its pushes, and merge commits for the
integration PR. Handle PR
base changes (`edited` events) so retargeting runs checks against the new base;
GitHub's default PR events do not cover this. Deployment triggers stay unchanged.

### Hotfix from a release tag

If `main` contains changes you do not want to release, branch from the affected
release tag and cherry-pick only the required fixes. Run CI on that branch, then
use the normal release flow with it as the explicit source, choosing a new patch
or beta version. Ensure the fixes and changelog also reach `main` and any active
`next`, preserving newer development and version changes there. This is a
short-lived hotfix branch, not another maintained release track.

## ACP catalog updates

ACP catalog work enters a release through an explicit user request:

- **Check ACP drift** — run `npm run acp:version-drift:check`. When drift exists,
  run `npm run acp:version-drift:update`, verify the catalog, and include the
  update in the local release-preparation commits.
- **Update ACP** — run `npm run acp:version-drift:update`, verify the catalog, and
  include the update in the local release-preparation commits.

The release authorization covers the requested ACP commit. It ships in the same
release push as the changelog and version commit.

## Fork 分发（LFT-OXY/Osuna）

本仓库是 `getpaseo/paseo` 的 fork，桌面端只发给内部小团队。fork 没有 `@getpaseo`
的 npm 发布权限，也没有 Apple Developer 账号，因此走这条独立的发版路径。上游的新版本
靠合并拿进来，见[从上游同步](#从上游同步)。

### 发版

先在 `CHANGELOG.md` 顶部加本次版本的条目，格式是 `## X.Y.Z - YYYY-MM-DD`——`npm version`
的生命周期钩子会跑 F-Droid changelog 同步，查不到条目就直接中断。`CHANGELOG.zh-CN.md` 是从上游
原样收下的，只为官网代码能编译，Osuna 不往里写条目：[Changelog translations](#changelog-translations)
与发版清单里提交中文条目的要求在 fork 下不适用。再把 `npm run format`、
`npm run lint`、`npm run typecheck` 跑绿并提交——`version:all:*` 底下是 `npm version`，
工作区不干净同样会中断。major 不在这条路径里：按本文「Release
version decision」，agent 不自选 major，需要时手工改版本号再走 `npm run release:push`。

```bash
# 二选一，对应本次发布的版本跨度：
npm run release:fork:patch
npm run release:fork:minor
```

它只做三件事：改所有工作区的版本号、打 tag、把分支和 tag 推到 `origin`。不碰 npm。
tag 推上去之后由 `Desktop Release` 工作流接管，构建 macOS（arm64 + x64）与 Windows
（x64 + arm64）产物，上传到 GitHub Release 并在清单齐全后把草稿转正。

`Android APK Release`、`Deploy App`、`Deploy Website`、`Deploy Relay` 依赖上游的 EAS 与
Cloudflare 账号，在 fork 下只保留手动触发，推 tag、推 main、发布 Release 都不会跑它们。
工作流文件留着，自建时把触发加回来即可。

想先出产物自己试装而不发布：在 Actions 里手动派发 `Desktop Release`，填已存在的
tag 并把 `publish` 设为 `false`，产物会留在 workflow artifacts 里。

某个平台构建失败时，收尾作业会在上传清单之前就退出，Release 留在草稿。重跑用
`desktop-vX.Y.Z` 这类全平台 tag，或手动派发时把 `platform` 留成 `all`：单平台重跑
只有在该 Release 上已经存在其余平台的清单时才补得齐。

### 从上游同步

上游的新版本用 `git merge` 合进来，保留上游的提交历史，下一次从上一次的同步点接着合。
当前已同步到上游 v0.13.0（`d34d17a90`）。每次并入 main 后更新这一句，并在下表加一行；
`git merge-base --is-ancestor <同步点> main` 应当成功。

| 同步到  | 分段：上游发布点 → merge commit                                                                                                                                                                                                                                                                                           | 冲突裁决摘要                                       |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| v0.9.0  | v0.9.0-beta.1 `7c1958f5b` → `503a3e7cb`，v0.9.0-beta.2 `e9d32a17d` → `0798c61c8`，v0.9.0 `7f7e60bcb` → `e0373b2ff`                                                                                                                                                                                                        | [PR #13](https://github.com/LFT-OXY/Osuna/pull/13) |
| v0.9.2  | v0.9.1 `818658520` → `2887a73f6`，v0.9.2 `c67b7158b` → `381896b91`                                                                                                                                                                                                                                                        | [PR #14](https://github.com/LFT-OXY/Osuna/pull/14) |
| v0.10.3 | v0.10.0-beta.1 `52d345db7` → `0535af41b`，v0.10.0 `c481ecf3e` → `6cac3ad8b`，v0.10.1 `c5236c00d` → `260c79631`，v0.10.2 `919c737c1` → `a36ecb8de`，v0.10.3 `b4af508e2` → `e8738aa16`                                                                                                                                      | [PR #15](https://github.com/LFT-OXY/Osuna/pull/15) |
| v0.11.2 | v0.11.0-beta.1 `4aa2f2817` → `9c56f066e`，v0.11.0-beta.2 `8498c7416` → `1fb78eb97`，v0.11.0-beta.3 `6166a7aca` → `64f2b95a3`，v0.11.0-beta.4 `6b00310f7` → `1d1dc7545`，v0.11.0-beta.5 `15d774d4a` → `5e5ea92c6`，v0.11.0 `22488d450` → `e57639e38`，v0.11.1 `ab10a6694` → `9ad8ac890`，v0.11.2 `759532509` → `d7800df9a` | [PR #16](https://github.com/LFT-OXY/Osuna/pull/16) |
| v0.13.0 | v0.12.0-beta.1 `e2f4948f9` → `f65422084`，v0.12.0-beta.2 `c517d07d6` → `16d847b51`，v0.12.0-beta.3 `cc748dfe1` → `a5eb7c89a`，v0.12.0 `cafe4b01c` → `80515069f`，v0.13.0-beta.1 `3fa625701` → `f44be7529`，v0.13.0-beta.2 `30d8cb044` → `7e2a7ef83`，v0.13.0 `d34d17a90` → `c644c42f6`                                    | [PR #33](https://github.com/LFT-OXY/Osuna/pull/33) |

#### 抓取与引用

- `upstream` remote 指向 `https://github.com/getpaseo/paseo.git`，并配成不抓 tag：
  `git config remote.upstream.tagOpt --no-tags`。Osuna 自己发过 `v0.9.0`、`v0.10.0`
  等版本，与上游的同名 tag 指向不同的提交，抓进来会相撞。
- 上游的发布点用提交 SHA 引用。`git ls-remote --tags upstream 'v0.10*'` 列出 tag 与
  提交的对应。上游打的是附注 tag：带 `^{}` 后缀的那一行是提交，另一行是 tag 对象。
- 有了 `upstream` remote，`gh` 会把默认仓库解析成 `getpaseo/paseo`。`gh` 命令带上
  `--repo LFT-OXY/Osuna`。

#### 上游的补丁分支

上游的补丁版本有的在它的 main 上，有的不在，合之前逐个看：
`git merge-base --is-ancestor <发布点> upstream/main`。v0.10.1 – v0.10.3 在从 v0.10.0 分出的
`release/0.10.1`、`release/0.10.2`、`hotfix/0.10.3` 上；v0.11.2（`759532509`）、v0.11.3、v0.11.4 在从
v0.11.1 分出的同一条补丁分支上，上游只给它们打了 tag；v0.13.0（`d34d17a90`）在 main 上。
不在 main 上的补丁版本照常按 SHA 合并。合过之后：

- `git merge-base main upstream/main` 给出的是分叉点，不是同步点。合 v0.13.0 之前它是 v0.11.1
  （`ab10a6694`）；合完 v0.13.0 回到 `d34d17a90`，下一次合并没有分叉处要重解。
- 下一次合上游主线的版本时，补丁分支与主线分叉的地方会再冲突一次。补丁分支上的修复在主线上
  有内容等价的提交，git 仍把它们当成两边各改了一遍。裁决固定：上游的部分取主线一侧，Osuna
  的改动保留。
- 分叉处的重解都落在下一次合并的第一段。第一段合完，合并基点回到上游主线上，后面各段的基点
  是上一段的发布点。合 v0.13 时是 16 个文件，全在第一段：`CHANGELOG.md`、`package-lock.json`、
  13 个 `package.json` 按[版本号与发版元数据](#版本号与发版元数据)处理，`scripts/postinstall-patches.mjs`
  取主线一侧。
- 主线已有等价提交的后续补丁版本不用单独合（v0.11.3、v0.11.4 随 v0.12.0-beta.1 进来）。用
  `git cherry` 或比对 patch-id 确认每个修复在要合的发布点之前都有对应。
- 模拟出的清单是上限：合 v0.11 时，上游自己的 v0.10.3 对 v0.11.0 模拟出 10 个文件，6 个在第一段
  报冲突，另外 4 个 git 自己合对了。动手前对要合的版本重算：
  `git merge-tree --write-tree --name-only --no-messages <同步点> <上游发布点>`。

#### 分段与并入

- 从 main 开一条合并分支，按上游自己的发布点（各个 beta、正式版）分段，每段一个
  merge commit。出问题时能看出是哪一段带进来的，并只退回那一段。
- 上游的新代码要占用 Osuna 已有的路径或类名时，合并之前先在合并分支上单独提交，把 Osuna 的那
  一份挪开，只改位置与引用。上游的路径与命名不动，以后上游再改那一块就不会撞。v0.11 时做过
  一次：[ADR 0006](adr/0006-usage-in-code-is-upstream-plan-usage.md)。
- 每段的 merge commit 本身要通过 typecheck、lint 和该段冲突文件对应的测试。冲突之外
  的适配（文案、外观、`COMPAT` 标签）紧跟在后面单独提交，进入下一段之前做完。
- 全部段在本机做完再开一个 PR，CI 只在开 PR 时跑一次。本机每段只跑改到的测试，整套测试只在
  CI 上跑。往 PR 分支再推送会让整套 CI 重跑，偶发失败只重跑失败的作业。
- 并入 main 用 merge commit。squash 和 rebase 都会丢掉上游的祖先关系，下一次合并会
  重新遇到已经解过的冲突。
- 合并期间 main 有新提交，就把 main 合进合并分支，不对合并分支做 rebase，原因同上。

#### 版本号与发版元数据

这些文件两边都会改，内容归 Osuna：

| 文件                                                          | 处理                                                                                                                                                          |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 各工作区的 `package.json`                                     | 版本号（本包版本与 `@getpaseo/*` 内部依赖）保持 Osuna 的。只取版本号那一块：整个文件取 Osuna 一侧会丢掉上游对依赖项和 `exports` 的改动                        |
| `package-lock.json`                                           | 不手工合并。各 `package.json` 解完后用 `npm install --package-lock-only --ignore-scripts` 重新生成                                                            |
| `CHANGELOG.md`                                                | 只留 Osuna 的条目。上游带来的内容写进 Osuna 下次发版的条目。冲突块取 Osuna 一侧之后，文件仍可能多出上游在冲突块之外改的行：解完与合并前 `cmp`，不同就整份恢复 |
| 安卓商店说明（`fastlane/metadata/android/en-US/changelogs/`） | 与上游同名的文件留 Osuna 的。文件名由版本号算出，两边版本号重叠就会同名                                                                                       |
| `README.md`                                                   | 冲突块取 Osuna 的                                                                                                                                             |
| `nix/npm-deps.hash`                                           | 不追。Nix 与 Nix Update Hash 两项检查在本仓库是已知红灯                                                                                                       |

上游在某一段里没有改外部依赖时，解完的 `package.json` 与 `package-lock.json` 与合并前
逐字节相同，拿这一点自检。

上游升了依赖时，在合并前的锁上跑 `npm install --package-lock-only` 会报「已是最新」，却把与
`package.json` 不符的版本原样留着（v0.13.0-beta.1 的 Expo 57 留在 54），本机装好的
`node_modules` 骗过了它。改在只放各 `package.json` 的临时目录里重做：以上游那个发布点的锁为底，
补上 Osuna 独有的顶层包条目（沿用合并前锁里的版本），跑一次 `npm install --package-lock-only`
规整，再跑一次结果不变才算好。用 `npm ls --package-lock-only --all` 对比上游自己的锁，不能多出
invalid。

#### 冲突裁决

按顺序适用，前一条优先：

1. Osuna 有意做的产品决定原样保留：桌面身份与数据目录、macOS 签名与签名断言、更新源、
   外链只指向本仓库、设置界面文案走翻译键（都在[合并后核对](#合并后核对)里），以及
   设置页外观（[design.md](design.md)）。
2. 两边重复实现同一功能时，以上游写法为底，补回 Osuna 多出的行为，并用测试证明行为
   没丢。以 Osuna 的写法为底，上游以后每次改这块都要重新解一次冲突。
3. 其余冲突两边都保留。

规则裁决不了时停下来问维护者：两条规则互相矛盾，或保留两边会改变用户可见的行为。

Osuna 原有的测试不删除、不跳过、不放宽断言。上游带来的测试与 Osuna 的决定矛盾时改
上游的测试，并在 PR 里写明是哪条决定。

#### 合并后核对

每段合完逐项核对。这些地方自动合并成功时也可能已经变了。

- **更新源**：`packages/desktop/electron-builder.yml` 的 `publish` 段
  （[更新源](#更新源)）。
- **桌面身份与数据目录**：`electron-builder.yml` 的 `appId`、`productName` 是 Osuna
  的；`packages/desktop/src/main.ts` 仍把 userData 固定在 `Paseo` 目录
  （[ADR 0002](adr/0002-rename-stops-at-app-identity.md)）。
- **签名与签名断言**：`desktop-release.yml` 里的 `mac-sign.js` 签名钩子、
  `OSUNA_MAC_SIGNING_SHA1`、上传前的 `Verify macOS signature` 都在，上游的 Apple
  公证变量没有收进来（[macOS 签名证书](#macos-签名证书)）。
- **只手动触发的部署工作流**：`android-apk-release.yml`、`deploy-app.yml`、
  `deploy-website.yml`、`deploy-relay.yml` 的 `on:` 只有 `workflow_dispatch`
  （[发版](#发版)）。
- **外链只指向本仓库**：应用与 CLI 源码里指向上游站点的链接数不增加，合并前后对
  `packages/app/src` 与 `packages/cli/src` 各数一次。上游新代码里的固定链接，本仓库
  有对应内容就指过来，没有就连同承载它的按钮一起去掉。把关的是非测试数；上游测试里
  用作配对链接样例的假地址会让全部数变多，记下出处，不改上游的测试。

  ```bash
  PAT='(https?://|www\.)[^"'"'"'`\s)]*(paseo\.sh|getpaseo|discord\.gg|discord\.com|github\.com/sponsors|opencollective)|(^|[^@/\w.-])(app\.|docs\.)?paseo\.sh'
  rg -n -i "$PAT" packages/app/src | wc -l                                   # 全部
  rg -n -i "$PAT" packages/app/src -g '!*.test.*' -g '!*.spec.*' | wc -l     # 非测试
  ```

- **翻译键**：上游新增的键九种语言齐全，zh-CN 是真实翻译，由
  `packages/app/src/i18n/resources.test.ts` 守着。上游在设置界面新增的硬编码英文改走
  翻译键（[i18n.md](i18n.md)）。
- **`COMPAT(...)` 标签**：上游新带进来的标签写的是上游的版本号，改写成合并后的首个
  Osuna 版本号，日期不动，清理兼容代码时才能按 Osuna 的版本线判断
  （[protocol-compatibility.md](protocol-compatibility.md#every-shim-is-tagged-and-dated)）。
  用 `git diff <合并前> <merge commit> | rg '^\+.*COMPAT\('` 列出；标签名在合并分支开出时的
  main 上不存在的才是上游新带来的，Osuna 已有的不动。分段合并时也和那个 main 比，不和上一段的
  分支头比：前一段改写过的名字，后一段还会带进新的出现处（v0.13.0-beta.2 的
  `plugins/evaluate.ts`）。v0.9.0 那次写的是 `v0.15.0`，
  发版时版本号若不同，统一改掉。

#### 踩过的坑

规划分段时：

- 上游的 beta 里有它到正式版就删掉的中间设计。v0.11.0 的前五个 beta 把套餐用量做成占用
  `/usage` 的独立页面，正式版换成弹窗。分段之前拿最后一个发布点对一遍：只在中间段存在的东西，
  适配做到这一段通过检查为止，面向最终形态的适配放到上游删掉它的那一段之后。
- 模拟合并的冲突清单是各发布点分别对合并前的 main 算的。前面的段解过之后，后面的段会少报
  （v0.11.1 少了 3 个）；自动合并进来的功能不在清单里，不能按「某个文件在哪一段第一次冲突」
  推断功能落在哪一段（Codex 速度菜单在第 1 段就进来了，到第 5 段才第一次冲突）。

git 不报冲突、结果却不对的：

- 两边各加了一个同名字段，自动合并后重复一份。lint 的 `no-dupe-keys` 会报。
- zh-CN 的翻译区块是展开写的，上游删掉的旧键会留在里面。连同 `zhCNEnglishAllowlist`
  里对应的条目一起删。
- 上游的新测试不知道 Osuna 的默认值，例如 Explorer 标签列表里的会话历史。按 Osuna 的
  行为改预期。
- 上游改旧用例的断言不会报冲突。用 `git diff <合并前> -- <测试文件>` 找被删掉的断言行。
- 两边原先各写了一模一样的行，上游删掉时不报冲突，Osuna 那一份跟着消失。v0.11.0 里上游删掉
  自己的 `/usage` 页面，`app/_layout.tsx` 与 `utils/host-routes.ts` 里 Osuna 的 Usage 页的路由
  接线一起没了。上游删掉一个与 Osuna 同名的东西时，用
  `git diff <合并前> -- <Osuna 仍在用的入口文件>` 看被删的行。
- 上游的新用例拿会话级的 `listCommands()` 当「确保进程在」用，在 Osuna 里它不启动进程
  （[ADR 0003](adr/0003-command-list-never-spawns.md)），换成 `setModel(null)`。上游按顺序读订阅
  事件的用例会被 Osuna 在每个 init 之后发的 `commands_changed` 挤错位，让读事件的辅助函数略过它。
- 上游的 e2e 按名字点内置文件面板，名字里带上游的应用名（“Markdown — Paseo”“Source — Paseo”）；
  Osuna 的内置面板提供者是 Osuna，这些用例只在 CI 上挂。合完 `rg "— Paseo" packages/app/e2e`，
  改成 Osuna 或 `markdown-file-panel-plugin.ts` 里的常量。
- 上游的 e2e 写死上游主题的色值，差 1 也会挂。合并后 `rg toHaveCSS packages/app/e2e`，
  对照 `packages/app/src/styles/theme.ts` 重算。
- 上游新增的设置界面里，说明文字与操作菜单按钮要对回 `settingsStyles` 和设置页已有的
  写法（[design.md](design.md)）。
- 上游新增的确认类对话框把操作按钮放在正文里、等宽。挪进 `AdaptiveModalSheet` 的 `footer`，
  按自身宽度靠右，`testID` 不动（[design.md](design.md)；v0.10.3 的
  `hosts/host-confirmation-sheet.tsx`，对照 `screens/settings/host-page.tsx` 的移除确认）。
- `packages/app/src/i18n/resources.test.ts` 的「已迁移英文字面量」守卫按 `"文字"` 与
  `` `文字 `` 开头扫描源码，注释也算。上游注释里的 `` `BackHandler` `` 会被当成 `Back`。
  改写上游那句注释，不放宽守卫。每段合完单独跑这个文件。
- server 与 desktop 的 typecheck 不含测试文件。上游删掉一个导入或构造选项后，Osuna 仍在
  用它的测试只有跑了才挂；上游的新用例调用 Osuna 改过签名的函数也一样。每段合完，把这一段
  新增或改动过的测试文件逐个跑一遍：
  `git diff <合并前> --name-only --diff-filter=AM -- 'packages/**/*.test.ts' 'packages/**/*.test.tsx'`。
- 上游改了 `storage/validated-persist-storage.ts` 这类共用模块后，Osuna 用它的测试会因时序挂。
  v0.13.0-beta.1 起存储读取期间的写入被丢掉，Osuna「新建 store 立刻写入、再新建一个读回」的用例要先
  `await store.persist.rehydrate()`。`rg -l <模块名> packages/app/src` 找出用到它的 Osuna 测试逐个跑。
- 上游给某个提供方的客户端套了一层新的包装时，Osuna 加在 `AgentClient` 上的可选方法
  （`discoverCommands`、`resolveInstalledVersion`、`resolveCliLaunch`）不转交也不报类型
  错，功能只是静默消失。对照接口逐个补上（`opencode/runtime-client.ts`）。
- 上游修某个提供方取指令列表、读提供方目录的行为时，改的是会话级的 `listCommands()`。Osuna 的草稿菜单走
  客户端级的 `discoverCommands()`（[ADR 0003](adr/0003-command-list-never-spawns.md)），上游的修复落不到它
  上面。对照上游的改动给 `discoverCommands()` 补上同样的行为并加用例（v0.10.1 的 #5450：Codex 按提供方自己的
  `CODEX_HOME` 读提示词与技能）。
- 上游整套新写的提供方路径按原样收下时，它的会话级 `listCommands()` 不会冲突，但上游的写法是先重连再取列表，
  服务退出后会为取列表重新拉起进程，违反 ADR 0003。逐个打开看，改成服务不在就返回 `null` 并加用例
  （v0.10.2 时核实的 OpenCode 2.x：`opencode/v2/session.ts`）。
- 两边各往同一个函数里加一个分支，合起来超过 lint 的复杂度上限。动 Osuna 自己加的那一行，
  不动上游的。
- 两边都改过的共用组件，要跑引用它的 Osuna 页面测试，不只跑冲突文件自己的测试。
  `components/ui/alert.tsx` 取了上游的 `import` 行后少了 `import React`，typecheck 与 lint
  都过，三个页面的 jsdom 测试到 CI 才挂。`rg -l "<组件路径>" packages/app/src --glob '*.test.tsx'`
  找出来逐个跑。

解冲突时：

- 打包产物冲突时重新生成，不手工合并。
  `packages/app/src/terminal/webview/terminal-emulator-webview-html.ts` 在
  `packages/app` 下用 `npm run build:terminal-webview` 生成，再过一遍格式化。
  不报冲突的生成产物也会过期：两边都给配置加了字段时，
  `packages/website/public/schemas/paseo.config.v1.json` 要用
  `npm run generate:config-schema --workspace=@getpaseo/server` 重新生成，
  `persisted-config-json-schema.test.ts` 守着它。
- 两边都留的冲突块，git 写进文件的块常比 diff3 视图短：两边相同的结尾几行在块外只出现一次。
  用脚本拼「Osuna 段 + 上游段」时，这几行会被写两遍或被吃掉。v0.12.0-beta.1 时历史回放里
  `historyEvents.push` 写了两遍，时间线每次刷新多出一份，typecheck 与 lint 都过，只有
  `agent-manager.test.ts` 抓到。合完对冲突文件扫一遍新出现的相邻重复行，再跑对应测试。
- Osuna 已删除、上游又改了的东西：上游的新代码需要它才恢复（`ExternalLink` 组件），
  否则保持删除（`publish-linux` 作业）。
- 两边各做了一遍的功能，除了源码还要逐条对两边的测试。同一场景下两边用例结论相反时，
  动手前问维护者。
- 调研阶段写「哪一边加了什么」要对照合并基点。只比两边的差异，会把基点原有、Osuna 有意
  删掉的东西认成上游新加的，据此定出「两边都留」的裁决（v0.10.0-beta.1 的新会话指令查询键）。
  `git show $(git merge-base HEAD <上游提交>):<文件>` 看基点。
- 已定的裁决也要拿 Osuna 自己的旧用例对一遍。问题卡片那次定了「多选题两者都保留」，
  Osuna 有一条标题里没写多选的用例断言的正相反，解冲突时才发现。
- Osuna 把组件里的状态挪进了纯逻辑模块、上游又改了组件里那段状态时，冲突块取 Osuna 的，
  上游的行为改在纯逻辑模块里，用上游带来的测试证明（`question-form-card-core.ts`）。
- 两边各做了一遍的发版设置（构建的 Node 堆上限）取上游的写法。数值留 Osuna 的话，
  在那一行写注释说明；上游再改那一行时会再冲突一次。
- 上游整份重译一种语言时（v0.11.0 的 `fr.ts`，57 个冲突块），冲突块先取上游，再把基点、
  Osuna、上游三份资源摊平成键值，按键做三方合并并逐键比对。合完查自动合并出来的重复键。
- 上游新加一条带豁免名单的 lint 规则、名单注释写「只许移出」时（v0.12.0 的
  `paseo/no-raw-pressable`），Osuna 自己报错的文件在 `.oxlintrc.json` 里另起一块豁免，注明加入
  时机与迁移计划，不混进上游的名单：上游以后从名单里移出文件时不会撞上 Osuna 加的行。

本机复核时：

- 先挪开 `packages/app/.expo` 与 `packages/app/node_modules/.vite`。前者放宽类型检查，
  后者是旧的预构建缓存，都会掩盖 CI 上会挂的问题。
- 这一段改了 `patches/` 下的依赖补丁，就先 `npm install` 再跑测试。本机装的还是旧补丁，
  相关用例会假失败（v0.12.0 的 enriched-markdown 补丁：`renderer.test.ts` 的句末句点用例）。
  `scripts/postinstall-patches.mjs` 遇到旧补丁会让安装失败并删掉那个包，再装一次即可。
- `chat-find.spec.ts`、`pane-find.spec.ts` 各有一条涉及 Control+F 的用例在 macOS 本机
  会挂，以 CI（Linux）为准。
- `plugins/antigravity-provider/server/provider.test.ts` 的「reports startup auth…」在 macOS
  本机报 `kill EPERM`，以 CI 为准。`packages/cli/tests/e2e/plugin-lifecycle.test.ts` 在 macOS 上
  要 `TMPDIR="$(cd "$TMPDIR" && pwd -P)"`：`/var` 是 `/private/var` 的软链接。
- `packages/server/src/server/daemon-client.e2e.test.ts` 会启动本机真实的提供方，也不在 CI 的
  测试脚本里。不要整份跑。
- 上游新增的 `*.e2e.test.ts` 不一定在 CI 的测试脚本里（看 `packages/server/package.json` 的
  `test:integration`）。本机挂了先在纯上游代码上复现：`git archive <发布点> | tar -x -C <临时目录>`，
  在那里 `npm ci --ignore-scripts`、`npm run build:server` 后跑同一个文件。同样挂就是上游自己的
  问题（v0.13.0-beta.1 的 `mcp-parity.e2e.test.ts` 4 条结束通知用例）。
- 测试跑法因目录而异，按错的方式跑会报「No test files found」或「No test suite found」，
  不是失败：`packages/cli/tests/*.test.ts` 是脚本，用 `npx tsx tests/<文件>` 跑；
  `packages/app` 的 `*.browser.test.ts(x)` 要 `--project browser`，其余用 `--project unit`。
- 官网包的 vitest 像 CI 一样从仓库根目录跑：`npx vitest run packages/website/src/...`。在
  `packages/website` 里跑会被 Cloudflare 的 Vite 插件挡住。
- 上游新增的打包资源要核对进包。CI 只在 Linux 包上冒烟（Desktop Packages），macOS 包没有。v0.11.0 的内置插件（两个新提供方与全部
  套餐用量来源）要在 asar 之外，留在 asar 里插件进程读不到，功能静默缺失。
  [本地出一个 macOS 包](#本地出一个-macos-包)，看 `Osuna.app/Contents/Resources/builtin-plugins`
  下的目录与 `plugins/` 一致，打开后 `daemon.log` 里每个插件有一行 `Loaded plugin`。Osuna 的发版
  工作流调的是同一条 `npm run build:desktop`。

### 更新源

`packages/desktop/electron-builder.yml` 的 `publish` 段指向 `LFT-OXY/Osuna`。
electron-builder 把它烘进安装包内的 `app-update.yml`，客户端据此查更新。**从上游
同步代码时必须保住这个值**——指回 `getpaseo/paseo` 会让团队成员被静默升级成官方版，
二次开发的功能全部消失，而且没有任何提示。

### macOS 签名证书

CI 发出的 macOS 包（arm64 与 x64）都用同一张长期固定的自签名证书签名（ADR 0001）。
这张证书就是更新身份：Squirrel.Mac 只安装满足当前应用 designated requirement 的新包，
而 DR 绑的是这张证书（`certificate root = H"<SHA-1 指纹>"`：证书带 `O=` 字段时 codesign
写 `root`，否则写 `leaf`，自签证书两者是同一张）和 appId。

- **存放位置**：本机 `~/.config/osuna/codesign/`（目录权限 700），里面是
  `osuna-codesign.p12`、导出密码 `osuna-codesign.p12.password`（权限 600）和公开的
  `osuna-codesign.pem`。仓库 Secrets 里有一份：`CSC_LINK`（`.p12` 的 base64）和
  `CSC_KEY_PASSWORD`。有效期 30 年。
- **必须备份**：把整个目录同步到云盘。Secrets 写进去就读不出来，不算备份。
- **丢失或更换的后果**：之后发的包不再满足已装版本的 DR，所有人的自动更新都会失败，
  每个人都得手动重装一次。改 `appId` 的后果相同。
- **指纹钉在工作流里**：`desktop-release.yml` 的 `OSUNA_MAC_SIGNING_SHA1`。签名钩子
  `packages/desktop/scripts/mac-sign.js` 按它签名，`scripts/verify-mac-signature.mjs`
  在上传前断言产物的 DR 绑的正是它。secret 缺失或配错、换了一张证书、签名退化成
  ad-hoc，该架构的作业都会在上传产物之前失败（前三种在构建步骤就失败，退回 ad-hoc 由
  断言拦下），Release 留在草稿，而不是发出一个打断所有人更新链的版本。**轮换证书就意味着所有人重装一次**，
  改这个值之前先想清楚。

### macOS 首次打开

包用自签名证书签名，但没有公证。团队成员把应用拖进「应用程序」后首次打开会被
Gatekeeper 拦住，提示「无法验证开发者」或「已损坏，无法打开」。按顺序试：

1. 在「应用程序」里右键点 Osuna → 打开 → 在弹窗里再点一次「打开」。
2. 如果提示的是「已损坏」，先去掉隔离属性再打开：

   ```bash
   xattr -dr com.apple.quarantine /Applications/Osuna.app
   ```

3. 仍被拦就去 系统设置 → 隐私与安全性，在底部点「仍要打开」。

每次手动下载安装都要做一遍，之后正常启动。

### Windows 首次安装

安装包同样没有代码签名，SmartScreen 会弹「已阻止运行无法识别的应用」。点「更多信息」
→「仍要运行」。这是预期行为，不是文件损坏。

### 本地出一个 macOS 包

```bash
CSC_IDENTITY_AUTO_DISCOVERY=false npm run build:desktop -- --publish never --mac --arm64
```

产物在 `packages/desktop/release`。本地构建不接触签名证书：关掉签名身份自动发现，
结果就不依赖本机钥匙串里恰好有什么证书，arm64 包会退回 ad-hoc 签名，x64 包不签名。
这样的包不能自动更新到 CI 发的版本，只用来自己试装。macOS 包没有自动冒烟（见
[testing.md 的 Packaged desktop smoke](testing.md#packaged-desktop-smoke)），装一次
亲自点开是这条路径上唯一的验证。

正式版开着时（agent 就跑在正式版里），不要直接打开这个包：它与正式版共用 userData 与
`~/.paseo`。给它单独的数据目录和端口。`packages/desktop/e2e/packaged-app-smoke.js` 用的是同
一组变量，它另外换了 `HOME`：

```bash
env -u PASEO_CLI -u PASEO_AGENT_ID -u PASEO_AGENT_CWD \
  PASEO_HOME=/tmp/osuna-pkg/home PASEO_LISTEN=127.0.0.1:6783 \
  PASEO_ELECTRON_USER_DATA_DIR=/tmp/osuna-pkg/user-data \
  PASEO_ELECTRON_FLAGS="--remote-debugging-address=127.0.0.1 --remote-debugging-port=9347" \
  packages/desktop/release/mac-arm64/Osuna.app/Contents/MacOS/Osuna
```

- daemon 的设置写在 `$PASEO_HOME/config.json` 里：`daemon.listen`，关掉 `relay` 与 `mcp`。
  桌面端启动它管理的 daemon 时会去掉环境里的 daemon 设置变量（`config-environment.ts` 的
  `DAEMON_SETTING_ENV_KEYS`，`PASEO_LISTEN` 也在内），只设变量不起作用。
- `HOME` 没有换，这个 daemon 会问本机真实的 CLI 的版本与模型，并只读地读它们的登录去查套餐
  用量。启动前问维护者。
- 它一启动就往 `$PASEO_HOME/models` 下载约 1G 语音模型。`PASEO_DICTATION_ENABLED=false`、
  `PASEO_VOICE_MODE_ENABLED=false` 属于被去掉的那批变量。看完删掉整个目录。
- 退出应用时它管理的 daemon 一起停。停完确认 6767 仍在监听。

### 加回 Linux

Linux 构建已从发布工作流中移除。`electron-builder.yml` 的 Linux 目标配置一直保留着，
不用改；要动的全在 `.github/workflows/desktop-release.yml`：

- 顶层 `DESKTOP_RELEASE_PLATFORMS` 加上 `linux`
- `on.push.tags` 加回 `desktop-linux-v*`，`workflow_dispatch` 的 `platform` 选项加回 `linux`
- `create-release` 的 `if` 条件加回 `!startsWith(github.ref_name, 'desktop-linux-v')`
- 恢复 `publish-linux` 作业
- `finalize-rollout` 的 `needs` 加回 `publish-linux`，恢复 Linux 清单下载步骤
- 收尾脚本的对账 `case` 补 `linux` 分支（构建结果判定在同一个循环里，不用另外加）
- 收尾脚本补上把新清单并入 `files` 的那行：
  `cp "linux-manifest/${RELEASE_CHANNEL}-linux.yml" "$manifests_dir/"`。漏了它，
  Linux 作业会正常构建，校验却报 `missing updater manifests for: linux`

反过来从集合里去掉一个平台时，该平台遗留在既有 Release 上的清单不会被自动清掉——
对账循环只遍历 `DESKTOP_RELEASE_PLATFORMS`。要清就手动 `gh release delete-asset`。
本仓库 `v0.8.1-beta.1` 上就留着一份 `beta-linux.yml`。

## Two paths

> 本仓库是 fork，内部分发走 **Fork 分发（LFT-OXY/Osuna）**，不走本节。以下是上游的
> 发布路径，需要 `@getpaseo` 的 npm 发布权限。

There are two supported release paths:

1. **Direct stable release**: you are ready to ship the resolved release source to everyone immediately (default `origin/main`).
2. **Beta flow**: release candidates on the `beta` channel. Each beta folds into the series' single changelog entry, publishes npm only on the explicit `beta` dist-tag, and stays behind the Stable/Beta switch on `/download`.

Paseo has one linear release track even though npm dist-tags are independent
pointers. The npm invariant is:

- A beta release moves only `beta`; `latest` remains on the newest stable.
- A stable release moves both `latest` and `beta` to that stable version. This
  keeps users who install `@getpaseo/cli@beta` on the newest Paseo release after
  a beta is promoted or superseded by a direct stable release.

## Release version decision

Every fresh release starts by classifying the full diff from the previous
stable to the resolved release source. The highest-impact change determines the
version:

- **Minor** — a user would experience the release as a significant upgrade. This
  includes substantial new workflows, providers, forges, platforms, integrations,
  or meaningful expansions of existing capabilities. Foundational internal work
  also qualifies when it materially changes reliability, performance,
  compatibility, deployment, or operation; diff size alone does not.
- **Patch** — fixes, polish, small enhancements, and reliability or performance
  improvements within existing capabilities. Follow-up corrections to a minor
  release are patches.

The release agent selects patch or minor during preparation and presents the
target version with the changelog for approval. Agents never select a major
version autonomously. A major release requires an explicit user instruction and
approval; Paseo remains on major version zero until that deliberate decision.

Version bumps are never used to retry a failed build. Retry the existing version
as described in **Fixing a failed release build**.

## Standard release (stable)

Before running any stable release command:

- Make sure the resolved release source passed CI, the approved release inputs are committed locally on the intended branch, and the working tree is clean.
- **Run `npm run format`, `npm run lint`, and `npm run typecheck` and commit any resulting changes BEFORE you start any `release:*` command.** `release:check` runs `npm install --workspaces --include-workspace-root` as part of `release:prepare`, which can mutate `package-lock.json` (e.g. churning `"dev": true` markers on optional deps). The next step, `version:all:*`, runs `npm version` which aborts when the working tree is dirty. If this happens mid-flight you have to commit the lockfile churn before retrying — and the pre-commit format hook will reject a lockfile-only commit because oxfmt internally skips `package-lock.json` while lefthook's glob still matches it. Avoid the whole mess by running format/lint/typecheck first, then `release:prepare` once on its own to absorb any lockfile churn into a normal commit, then start the release.
- Do not use a release command as a substitute for checking whether the current commit is actually ready.

```bash
# Run exactly one, matching the approved decision:
npm run release:patch
npm run release:minor
```

This bumps the version across all workspaces, runs checks, publishes to npm, and pushes the branch + tag. The tag push triggers `Desktop Release`, `Android APK Release`, `Docker`, and `Release Notes Sync` on GitHub Actions. The workflows create the GitHub Release as a draft while builds and release-note sync run. EAS picks up the same tag via the EAS GitHub app and starts the iOS + Android store builds in parallel (see "Mobile builds (EAS)" below) — there is no mobile-release workflow under `.github/workflows`.

After the stable release succeeds, move npm's `beta` pointer to the new stable
version for every published package. This changes dist-tags only; do not
republish the packages:

```bash
PASEO_VERSION=$(node -p "require('./package.json').version")
for package in highlight relay protocol client plugin server cli; do
  npm dist-tag add "@getpaseo/$package@$PASEO_VERSION" beta
done
```

Verify both npm tags now resolve to `PASEO_VERSION` before considering the
stable release complete.

The Docker workflow builds images from the checked-out source tree on pull requests and on `main` as non-publishing checks. Stable `vX.Y.Z` tag pushes publish `ghcr.io/getpaseo/paseo:X.Y.Z` and `ghcr.io/getpaseo/paseo:latest`; beta `vX.Y.Z-beta.N` tag pushes publish only `ghcr.io/getpaseo/paseo:X.Y.Z-beta.N` and never move `latest`.

The production relay is the Elixir service in [getpaseo/paseo-relay](https://github.com/getpaseo/paseo-relay), with its own deployment process. Paseo releases and pushes to this repository do not deploy it. The Cloudflare relay code and workflow in this repository are legacy and are not used in production.

**Stable means stable.** If the user says "stable" or "ship stable", do not ask whether they want a beta first. They picked stable; treat it as a direct stable release. Only run the beta flow when the user explicitly says "beta".

## Manual step-by-step

```bash
npm run typecheck            # Verify the exact commit you intend to release
npm run release:check        # Typecheck, build, dry-run pack
# Run exactly one approved version command:
npm run version:all:patch
npm run version:all:minor
npm run release:publish      # Publish to npm
npm run release:push         # Push HEAD + tag (triggers CI workflows)
# Then move npm's beta dist-tag to this stable version using the command above.
```

## Beta flow

```bash
npm run release:beta:patch       # Start the next patch beta line
npm run release:beta:minor       # Start the next minor beta line
# ... test desktop and APK prerelease assets from GitHub Releases ...
npm run release:beta:next        # Optional: cut X.Y.Z-beta.2, beta.3, ...
npm run release:promote          # Promote X.Y.Z-beta.N to stable X.Y.Z
```

- Beta tags are published GitHub prereleases like `v0.1.41-beta.1`
- Betas publish npm packages with `--tag beta`, so `npm install @getpaseo/cli@beta` opts in while plain `npm install @getpaseo/cli` stays on `latest`
- Betas publish desktop assets and APKs for testing. They also build iOS, upload it to TestFlight, add it to the `Paseo Beta` external group, and submit it for Beta App Review. They do not submit mobile builds to the production stores.
- `release:promote` creates a fresh stable tag like `v0.1.41`; the final release never reuses the beta tag
- Desktop assets now come from the Electron package at `packages/desktop`
- The Linux artifact CI checks with both restricted and usable user namespaces run on pull requests that touch `packages/desktop`; see [packaged desktop smoke](testing.md#packaged-desktop-smoke). Keep the installed-package and AppImage checks together. They no longer gate publication: this fork ships no Linux artifacts.
- Beta releases use Electron's `beta` update channel. Users on the stable channel only receive stable releases; users on the beta channel receive beta releases and the final stable release when it is published.
- **A beta series has one changelog entry.** Each beta folds into it and renames its heading to the new `## X.Y.Z-beta.N`, which `Release Notes Sync` mirrors into that prerelease body. Promotion renames it to the stable heading. See the Changelog policy section.

Use the beta path when you need to:

- smoke a build yourself before promoting it to everyone
- test a build manually in a Linux or Windows VM
- send a build to a user who is hitting a specific problem
- iterate on `beta.1`, `beta.2`, `beta.3`, and so on before deciding to ship broadly

## Staged rollout (stable channel)

Stable desktop releases go out via a linear time-based rollout for automatic update checks: 0% admitted when the updater manifests appear, 100% admitted 36 hours later, linear ramp in between. Manual checks bypass the rollout so a user can install immediately when they click **Check**. Beta releases bypass the rollout entirely — beta users always receive updates immediately.

The rollout is driven by a `rolloutHours` field stamped into the GitHub Release manifests (`latest-mac.yml`, `latest.yml`) by the `finalize-rollout` job in `desktop-release.yml`.

Desktop release builds now publish in two phases:

- The GitHub Release stays a draft while platform build jobs upload the installers/packages (`.dmg`, `.zip`, `.exe`, `.AppImage`, etc.).
- The final job merges and stamps every channel manifest, uploads them with the final `releaseDate` and `rolloutHours`, then publishes the GitHub Release.

Drafts do not appear in GitHub's releases feed. Updater clients continue to see the previous complete release until every manifest named by `DESKTOP_RELEASE_PLATFORMS` is available. If a desktop build or manifest upload fails, the new release stays a draft.

### Default behavior

`npm run release:patch` or `npm run release:minor` → tag push → 36h ramp. No extra action needed.

The `rollout_hours` input on `desktop-release.yml` is **only read on `workflow_dispatch`** — tag-push runs always default to 36. To get any other rollout duration on a fresh release, use the post-publish flip below.

### Instant-admit release (rollout_hours=0 from publish)

For a fresh release that should admit everyone immediately (low-risk change, doc-only, hotfix, or just a release you want out fast), cut the release normally and queue the rollout flip immediately after:

```bash
# 1. Cut and publish (default 36h ramp from tag push).
npm run release:patch

# 2. Immediately queue the flip — runs as soon as finalize-rollout completes.
gh workflow run desktop-rollout.yml \
  -f tag=v0.1.64 \
  -f rollout_hours=0
```

**Why this is gap-free:** `desktop-release.yml`'s `finalize-rollout` job and `desktop-rollout.yml` share the concurrency group `desktop-rollout-<tag>`. Dispatching `desktop-rollout.yml` while the tag-push pipeline is still running queues it safely behind `finalize-rollout`. The first public manifests already carry `rolloutHours=36`, then `desktop-rollout.yml` flips them to `rolloutHours=0` shortly afterward. The renderer polls every 30 minutes, so active stable users pick up the new manifest on their next check.

Run the dispatch right after `release:patch` or `release:minor` returns. Don't wait for the tag-push CI to finish.

### Adjusting an already-published release

To change the rollout duration on a release that's already shipped — e.g. flip a hotfix to instant admit, or slow a release down — use the dedicated `desktop-rollout.yml` workflow. It edits the manifests in place on the GitHub release without rebuilding anything. It only rewrites `rolloutHours`; `releaseDate` is preserved, so the rollout clock keeps ticking from the original publish time.

**Hotfix (instant admit) on an already-shipped release:**

```bash
gh workflow run desktop-rollout.yml \
  -f tag=v0.1.42 \
  -f rollout_hours=0
```

`rollout_hours=0` admits 100% of stable users on their next update check (within ~30 min for active clients).

**Slow a rollout down** (e.g. extend total duration to 72h since the original release):

```bash
gh workflow run desktop-rollout.yml \
  -f tag=v0.1.42 \
  -f rollout_hours=72
```

`rollout_hours` is **total duration since the original release date**, not "extend by N more hours from now." If `v0.1.42` was published 2h ago and you set `rollout_hours=72`, the ramp finishes 70h from now.

The dispatch is idempotent and shares the `desktop-rollout-<tag>` concurrency group with `desktop-release.yml`'s `finalize-rollout` job, so it serializes safely against an in-flight tag-push pipeline targeting the same release.

### Custom ramp on a manually-dispatched build

`desktop-release.yml` accepts `rollout_hours` only on `workflow_dispatch`, which is the path used to **rebuild an existing tag** (retry a failed release, force a rebuild on a different ref). When you go that route, you can stamp a non-default ramp directly:

```bash
gh workflow run desktop-release.yml \
  -f tag=v0.1.43 \
  -f rollout_hours=6
```

This does **not** apply to fresh releases cut via `npm run release:patch` or `npm run release:minor` — those paths always tag-push and stamp 36. For a fresh release with a custom ramp, cut normally and then dispatch `desktop-rollout.yml` (same pattern as the instant-admit flow above, with your chosen `rollout_hours`).

### Releasing during an active rollout

If you ship N+1 while N is still ramping, N+1 starts a fresh rollout from its own publish timestamp. N's rollout effectively ends — the newer manifest supersedes it. Rollout-aware clients revalidate the manifest for up to five seconds before installing a downloaded update on quit. If N+1 has replaced N but the client is not admitted to N+1 yet, it skips the downloaded N and waits rather than installing two updates in succession. If revalidation times out, the app exits without installing the cached update.

If N+1 is a hotfix for a bug in N, dispatch `desktop-rollout.yml -f tag=v0.1.<N+1> -f rollout_hours=0` after N+1 publishes so the users who already got N reach the fix fast.

### macOS system floor

The desktop app requires macOS 13 or newer. Keep both release guards when the floor changes:

- `packages/desktop/electron-builder.yml` writes the macOS version to `LSMinimumSystemVersion` for new installs.
- `scripts/merge-mac-manifest.mjs` writes the matching Darwin kernel version to `minimumSystemVersion` in the update manifest. Existing clients check this before downloading an update.

macOS 13 maps to Darwin 22. The two values use different version domains; do not copy the macOS version into the update manifest.

### Limitations

- **No pause / kill switch.** To stop new admissions, ship a superseding release. Clients revalidate on quit and will not install the superseded download, but a client that already completed installation cannot be recalled; ship a hotfix `+1` patch.
- **No rollback.** `allowDowngrade = false`. Bad release = ship a hotfix.
- **Bootstrap caveat.** Clients running a build older than the rollout feature ignore `rolloutHours` and admit immediately. Rollout protection only applies to clients running the rollout-aware version or later.
- **Up to ~30 min automatic admission latency.** Renderer polls every 30 minutes, so a stable user may take up to that long to be evaluated against the rollout window. Clicking **Check** is manual and bypasses rollout admission.

## Mobile builds (EAS)

iOS and Android store builds are not in `.github/workflows`. They are triggered by the EAS GitHub app the moment the `v*` tag is pushed:

- **Android (Play Store)** — EAS builds with profile `production` and auto-submits to the Play Store via `eas submit` (EAS-managed credentials, no Fastlane).
- **iOS (TestFlight + App Store)** — EAS builds with profile `production`, uploads once through a `testflight` job, distributes the build to the `Paseo Beta` external group with Beta App Review submission, and a Fastlane lane submits that same build for App Store review.
- **Android APK (GitHub Release asset)** — separate, via `.github/workflows/android-apk-release.yml`. This is the only Android-related workflow that lives in this repo.

EAS uses the local app version source. `packages/app/app.config.js` derives the native version from the package version. Android `versionCode` is `major * 1_000_000 + minor * 1_000 + patch`. iOS reserves 1,000 build slots per app version: beta `N` uses slot `N`, and stable uses slot `999`. For example, `0.2.6-beta.2` appears in App Store Connect as version `0.2.6` build `2006002`; stable uses build `2006999`. Rebuilding the same tag produces the same native build number; if a store has already accepted a binary and you need a different binary, cut the next beta or patch instead of relying on EAS remote auto-increment.

Stable tags run `Release Mobile`; beta tags run `Release iOS Beta`. Both distribute to the persistent `Paseo Beta` external group and submit for Beta App Review, so testers receive stable releases as well as betas. Testers, the group, and required TestFlight test information are managed once in App Store Connect.

Stable iOS releases use one binary for two Apple review paths: Beta App Review for external TestFlight distribution and App Store review. [Apple says](https://developer.apple.com/help/app-store-connect/test-a-beta-version/invite-external-testers) the first submitted build requires a full TestFlight review; later builds for the same version might not. Do not assume a stable patch skips review.

There is no mobile-release workflow under `.github/workflows`. The EAS GitHub app reads the workflows under `packages/app/.eas/workflows` and handles tag triggering directly.

### Watching mobile builds from the terminal

Use the EAS CLI from `packages/app/`:

```bash
cd packages/app

# Recent builds (newest first). Pipe to jq for status only.
npx eas build:list --limit 8 --non-interactive --json | jq '.[] | {platform, status, appVersion, gitCommitHash}'

# Recent EAS workflow runs. This is the source of truth for submit/review jobs.
npx eas workflow:runs --json | jq '.[] | {status, workflowName, trigger, gitCommitHash, startedAt, finishedAt}'

# Filter by platform.
npx eas build:list --platform ios --limit 5 --non-interactive --json
npx eas build:list --platform android --limit 5 --non-interactive --json

# Inspect a specific build.
npx eas build:view <build-id>

# Inspect the full release workflow, including distribute_ios, submit_android,
# and submit_ios_for_review.
npx eas workflow:view <workflow-run-id> --json

# Read failed submit/review job logs.
npx eas workflow:logs <workflow-job-id> --all-steps --non-interactive

# Stream logs for a build.
npx eas build:view <build-id> --json | jq '.logFiles[]'
```

A build's `gitCommitHash` must match the release tag commit. `status` walks through `NEW` → `IN_QUEUE` → `IN_PROGRESS` → `FINISHED` (or `ERRORED`/`CANCELED`). The EAS workflow run's `gitCommitHash` and `trigger` must also match the release tag.

Once a build is `FINISHED`, EAS still has release-critical work to do: Android must submit to the Play Store, and iOS must distribute to the external TestFlight group with Beta App Review submission **and** submit the same build for App Store review. The release is not done until all platforms are on their way through the stores.

For the `Release Mobile` EAS workflow, these jobs must pass:

- `build_ios` — iOS binary built
- `distribute_ios` — iOS binary uploaded once, added to `Paseo Beta`, and submitted for Beta App Review
- `submit_ios_for_review` — iOS build submitted for App Store review via Fastlane
- `build_android` — Android store binary built
- `submit_android` — Android binary submitted to the Play Store

Do not treat `build_ios: SUCCESS` or `distribute_ios: SUCCESS` as a completed iOS release. `submit_ios_for_review: FAILURE` means the iOS release is blocked even if the build is visible in TestFlight.

To confirm the submission landed, inspect the EAS workflow with `npx eas workflow:view <workflow-run-id> --json`. App Store Connect (review state for the matching version/build) and the Play Console track are the final ground truth.

## Release completion and heartbeat

A release is **in progress** after npm publication and tag push. Report it as
**shipped** only after every applicable build, publication, asset, manifest, and
store submission passes the completion checklist.

Immediately after every beta, stable, or promotion tag push, create a heartbeat
that resumes the release in the current conversation. Create it automatically
with `create_heartbeat`. The heartbeat owns the release until it either reaches
the completion checklist or finds a failure that needs new user authority.

Each heartbeat checks the release tag commit, all GitHub Actions runs for the
release branch and tag, npm dist-tags, the GitHub Release body and assets,
desktop updater manifests, the published Docker image, and the applicable EAS
workflow. Inspect the GitHub Release itself and confirm that the macOS, Windows,
and Android APK assets are present along with the channel manifests
(`latest-mac.yml` and `latest.yml` for stable; `beta-mac.yml` and `beta.yml` for
beta).

For stable releases, also confirm every required mobile build, external
TestFlight distribution, Beta App Review submission, and store submission job
for the release commit. For betas, confirm
the beta EAS workflow completed its TestFlight distribution and Beta App Review
path. Delete the heartbeat only after every applicable checklist item passes,
then report the release as shipped.

Pattern:

```jsonc
// mcp__paseo__create_heartbeat arguments
{
  "name": "vX.Y.Z release babysit heartbeat",
  "cron": "*/10 * * * *",
  "timezone": "UTC",
  "maxRuns": 120,
  "expiresIn": "24h",
  "prompt": "Resume the vX.Y.Z release babysit for commit <sha>. Check npm tags; every GitHub Actions run for the release branch and tag; the published GitHub Release body, expected desktop/APK assets, and channel manifests; the Docker image; and the matching EAS workflow. Completion requires every applicable checklist item. For stable, require build_ios, distribute_ios (Paseo Beta external distribution and Beta App Review submission), submit_ios_for_review, build_android, and submit_android to succeed. For beta, require the beta TestFlight distribution and Beta App Review path. If work is pending, wait for the next heartbeat. If a failure can be retried safely for the same version, follow the failed-release procedure; otherwise report the blocker. When every applicable completion-checklist item passes, delete THIS heartbeat, report shipped, and stop.",
}
```

Run an immediate status check after creating the heartbeat. The heartbeat handles
later transitions and stops itself when the release is complete.

## Release notes on GitHub

The GitHub Release body is populated automatically by the `Release Notes Sync` workflow (`.github/workflows/release-notes-sync.yml`). It triggers on every `v*` tag push and on any push to `main` that touches `CHANGELOG.md`, then runs `scripts/sync-release-notes-from-changelog.mjs` to mirror the matching changelog entry into the release body. You don't need to write release notes on GitHub manually — keep `CHANGELOG.md` correct and the workflow will sync it. To force a re-sync, dispatch the workflow with the tag input.

## Website behavior

- The website download page defaults to GitHub's latest published **stable** release.
- A published beta prerelease is offered behind the Stable/Beta switch on `/download` (`?channel=beta`), never as the default. The switch only appears while the newest prerelease leads stable on its core version, so promoting `X.Y.Z-beta.N` to `X.Y.Z` retires the beta channel from the page until the next beta line opens.
- Homebrew, the Play Store, the App Store, and `app.paseo.sh` have no beta. The Beta view drops those rows, and the whole Web section, rather than showing an inert "stable only" placeholder. When a surface gains a beta path — say a public TestFlight link — add its row back in `packages/website/src/routes/download.tsx`.
- The default download target only moves when you publish the final stable release tag like `v0.1.41`.
- The public `/changelog` page renders `CHANGELOG.md` as-is, so the in-flight `-beta.N` entry shows there once it lands on `main` — that's intended, it's where beta users check what's coming. Only the **default download target** stays pinned to the latest stable; the download links read GitHub's releases API, not the changelog, so a `-beta.N` heading on top never affects them.
- The download page's "What's new" link deep-links the **minor group** anchor (`/changelog#release-0.3`), not the exact entry: the beta entry is renamed on each beta and on promotion, so the minor group remains the durable target. A version with no entry in the bundled changelog — a tag whose changelog commit hasn't redeployed the site yet — links the plain `/changelog` instead of a dead anchor.
- The website itself is deployed by `Deploy Website` (Cloudflare Workers), which redeploys on the `release: published` event emitted when a stable draft is published and on pushes to `main` that touch `CHANGELOG.md` or `packages/website/**`. Its job condition excludes beta prereleases.

## Fixing a failed release build

**NEVER bump the version to fix a build problem.** New versions are reserved for meaningful product changes (features, fixes, improvements). Build/CI failures are fixed on the current version.

**Do not rely on `workflow_dispatch` for tagged code fixes.** The `workflow_dispatch` trigger runs the workflow file from the default branch but checks out the code at the tag ref (`ref: ${{ inputs.tag }}`). That means fixes committed to `main` won't change the tagged source tree being built. `workflow_dispatch` only helps when the fix lives in the workflow file itself.

For Docker-only retries, **do not push or force-push a `v*` release tag**.
`v*` tag pushes rebuild desktop assets, the Android APK, Docker, release notes,
and EAS mobile release builds. Use the Docker workflow dispatch instead:

```bash
gh workflow run docker.yml \
  --ref main \
  -f paseo_version=X.Y.Z-beta.N \
  -f publish=true
```

This replaces `ghcr.io/getpaseo/paseo:X.Y.Z-beta.N` in place without touching
desktop, APK, or EAS release builders. The Docker exception is safe because the
dispatch runs from `--ref main` and uses the explicit `paseo_version`; it does
not check out or move the `v*` release tag.

To retry a failed non-Docker release workflow, push a retry tag on the commit
you want to build. Reusing the same tag name is expected: move it with
`git tag -f ...` and push it with `--force` so the workflow rebuilds the commit
you actually want.

A failed desktop build leaves the GitHub Release as a draft. `finalize-rollout`
uploads manifests from successful platforms before it fails. A later
single-platform retry reuses those manifests, stamps the complete set with one
release date, and publishes the draft. Use `desktop-vX.Y.Z` when more than one
platform failed. A `workflow_dispatch` rebuild with publishing enabled follows
the same path against the existing draft.

Prefer a tag push over `workflow_dispatch` when rebuilding desktop or APK
release assets. Prefer Docker workflow dispatch when rebuilding only the Docker
image.

The retry tag patterns below still work and remain the supported way to rebuild specific release targets:

```bash
# Desktop (all platforms)
git tag -f desktop-v0.1.28 HEAD && git push origin desktop-v0.1.28 --force

# Desktop (single platform)
git tag -f desktop-macos-v0.1.28 HEAD && git push origin desktop-macos-v0.1.28 --force
git tag -f desktop-windows-v0.1.28 HEAD && git push origin desktop-windows-v0.1.28 --force

# Android APK
git tag -f android-v0.1.28 HEAD && git push origin android-v0.1.28 --force

# Beta
git tag -f v0.1.29-beta.2 HEAD && git push origin v0.1.29-beta.2 --force
```

This ensures the checkout ref matches the actual code on `main` with the fix included.

- `vX.Y.Z` or `vX.Y.Z-beta.N` rebuilds the full tagged release
- `desktop-vX.Y.Z` rebuilds desktop for all desktop platforms only
- `desktop-macos-vX.Y.Z` and `desktop-windows-vX.Y.Z` rebuild only that desktop platform
- `android-vX.Y.Z` rebuilds the Android APK release only

If you decide to publish a release without working desktop builds, inspect its
assets first, then publish it manually:

```bash
RELEASE_LOOKUP=$(node scripts/github-release.mjs --repo getpaseo/paseo --tag vX.Y.Z)
gh release view "$RELEASE_LOOKUP" --json isDraft,isPrerelease,assets
gh release edit "$RELEASE_LOOKUP" --tag vX.Y.Z --draft=false

# Keep a beta marked as a prerelease:
RELEASE_LOOKUP=$(node scripts/github-release.mjs --repo getpaseo/paseo --tag vX.Y.Z-beta.N)
gh release edit "$RELEASE_LOOKUP" --tag vX.Y.Z-beta.N --draft=false --prerelease
```

This bypasses the updater-manifest guarantee. Use it only when the release is
intentionally unavailable to desktop updater clients.

## Notes

- `version:all:*` bumps root + syncs workspace versions and `@getpaseo/*` dependency versions
- The npm `version` lifecycle regenerates F-Droid changelog files from `CHANGELOG.md` for stable releases only (`npm run fdroid:changelogs`) and stages them, so the release tag carries them. Betas are a no-op. A stable run **aborts the release** if `CHANGELOG.md` has no entry for the version being cut — commit the changelog entry first. See [docs/android.md](android.md) for why these files are generated per ABI.
- `release:prepare` refreshes workspace `node_modules` links to prevent stale types
- `npm run dev:desktop` and `npm run build:desktop` target the Electron desktop package in `packages/desktop`
- If `release:publish` partially fails, re-run it — npm skips already-published versions
- If `release:publish:beta` partially fails, re-run it — npm skips already-published versions and keeps prereleases off `latest` because every publish uses `--tag beta`
- The website uses GitHub's latest published release API for download links, so published beta prereleases do not replace the stable download target.

## Changelog format

Release notes depend on the changelog heading format. The heading **must** be strictly followed:

```
## X.Y.Z - YYYY-MM-DD
## X.Y.Z-beta.N - YYYY-MM-DD
```

No prefix (`v`), no extra text. `Release Notes Sync` matches the `## X.Y.Z` (or `## X.Y.Z-beta.N`) line for the pushed tag to extract the version. A malformed heading breaks the release-notes sync for that tag.

`CHANGELOG.md` on `main` is also what the app's **What's new** sheet fetches and renders, so the file is a shipped product surface, not just a release input. `##` starts a release and `###` starts a section; the app reads section titles from the document, so renaming or adding one needs no app change. Everything under a section is rendered as Markdown: prose, lists, links, inline code, fenced code, block quotes, tables, and images. Raw HTML does not render — the shared Markdown parser runs with `html: false`, so a `<video>`, `<iframe>` or `<embed>` tag reaches the reader as visible markup. Keep media out of the changelog, or link to it. A GitHub callout renders as a block quote with its `[!NOTE]` marker still in the text. A release entry is what a user reads on a phone the moment they are offered the update — write it for them.

## Changelog policy

- `CHANGELOG.md` holds stable releases and at most one entry for the current beta series.
- The first beta of a version inserts a top entry like `## 0.1.60-beta.1 - YYYY-MM-DD`.
- Each subsequent beta rewrites that entry in place: the heading becomes the new beta number and date, and the body describes the full change from the previous stable release to this beta. Never add a second beta entry.
- The entry is a list of changes, not of PRs. When a later beta reverts, reworks, or follows up on something an earlier beta added, rewrite the bullet to the current behavior or delete it. A stable user never saw the earlier beta behavior, so fixes to it are not "Fixed" bullets.
- Anything that already shipped to stable through a patch release on an older line stays out of the beta entry.
- Stable promotion renames the entry to `## 0.1.60 - YYYY-MM-DD` after a final review.

Older prerelease bodies on GitHub keep the notes they were synced with; `Release Notes Sync` only writes the release whose tag matches the top entry.

## Changelog translations

`CHANGELOG.zh-CN.md` holds the Chinese notes for `paseo.sh/zh-CN/changelog`. Only the website reads it; the app's **What's new** sheet, GitHub release bodies and F-Droid read `CHANGELOG.md`.

- The release agent writes the Chinese entry in the changelog commit, after the English entry is approved. Every beta that rewrites the English entry rewrites the Chinese one too, and promotion renames both. `packages/website/e2e/i18n.spec.ts` fails CI on the release commit when any entry has no current translation.
- A translated entry uses the English heading unchanged: `## X.Y.Z - YYYY-MM-DD`. The website uses it only while the version and date both match the English entry. Otherwise it shows that release whole in English under a notice. Delete Chinese entries whose English entry was renamed.
- Keep the English sections, bullets and links one to one. Section titles: Added 新增, Improved 改进, Changed 变更, Fixed 修复, Security 安全, Breaking 破坏性变更, Plugins 插件, Notes 说明. Wording follows [website-i18n.md](website-i18n.md#chinese-style).

## Changelog ownership

- **The agent running the release writes the changelog entry — beta or stable.** The release context and final wording stay with that agent.
- **Commit history is only an index of the changes. Never draft the changelog from commit subjects or diffs alone.** For every PR in the release range, read the full PR description and every issue it links to before deciding what changed, why users care, or how changes should be grouped. Use the implementation only to verify the resulting understanding.
- Every entry, beta or stable, is drafted from the previous stable release to the release source. For a later beta, read the PRs since the previous beta tag, then rework the existing entry so each bullet still describes current behavior. Review the result against the changelog policy below, show it to the user, and wait for approval before committing it.

## Changelog wording

The changelog is shown on the Paseo homepage. Each bullet is a compact factual record of
product behavior that changed.

- **Name the exact change.** Prefer `Added <capability>`, `Removed <behavior>`,
  `Changed <behavior>`, or `Fixed <failure> when <condition>`.
- **Keep the scope exact.** A conditional bug is not a general reliability problem. Do not
  broaden one failure into claims that Paseo is now faster, smoother, responsive, or reliable.
- **Use concrete product and runtime terms.** Git polling, persisted cache, provider catalog,
  and WebSocket reconnects can identify the affected behavior. Component names, internal
  modules, code symbols, and implementation techniques cannot: omit `WorkingIndicator`,
  `reconcileAndEmitWorkspaceUpdates`, remounts, memoization, and controlled inputs.
- **State the consequence only when the change itself is unclear.** Keep the condition that
  makes the consequence true. Do not replace a precise change with a broad benefit claim.
- **Do not invent context.** Mention an upgrade, platform, workload, or user action only when
  the PR or linked issue establishes that scope.

| Avoid                                                        | Write                                                 |
| ------------------------------------------------------------ | ----------------------------------------------------- |
| Paseo stays responsive with many idle Git workspaces         | Removed periodic Git polling for idle workspaces      |
| Incompatible saved app data no longer crashes after upgrades | Fixed crash when persisted cache was incompatible     |
| Splitting layouts no longer remounts the active agent        | Fixed scroll position resetting when splitting a pane |
| Mobile model selector is faster and more straightforward     | Added search to the mobile model selector             |

Test each bullet against the source PR and issue: can a reviewer point to the exact behavior
that changed, the failure that was fixed, or the capability that was added? If the bullet only
claims a general improvement, rewrite it with the concrete change.

- **Use the entry's release scope.** Include changes within the matching range in **Changelog scope**.
- **Collapse internal iterations within that scope.** Present a feature added and fixed in one range as working.
- **Cut low-signal entries.** "Toolbar buttons have consistent sizing" is too granular. Combine small polish items or drop them.

## Changelog conciseness

Every bullet must be scannable at a glance. The changelog is not release documentation — it's a list.

- **One sentence per bullet, max.** If a bullet contains two sentences, the second one is doing work that belongs in product docs, not the changelog. Cut it.
- **No trailing periods.** Bullets are list items, not prose. Drop the period at the end of every bullet, including the period inside any bolded lead-in. `**Configurable terminal scrollback**` not `**Configurable terminal scrollback.**`.
- **One line per bullet.** If a bullet wraps to three lines in a narrow column, it's too long.
- **Split bullets that pack multiple distinct changes.** If a bullet uses "and", "plus", a comma list, or an em-dash to chain several independent improvements, break them into separate bullets — even when they share a theme or author. One bullet = one user-facing change.
- **Trim qualifying clauses.** Drop "with a hint shown when…", "matching the CLI's behaviour", "across common install shapes". If the detail doesn't change whether a user cares, cut it.
- **Stop after identifying the change.** Do not explain LAN/WAN topology, TLS handshakes, IPC, or other architecture in a changelog bullet. Put necessary background in product docs.
- **Attribution follows the split.** When you split a dense bullet, move each PR/author to the bullet it belongs to. Never duplicate the same PR across multiple bullets.

## Changelog attribution

Every changelog bullet must credit contributors and link to the PR(s) that delivered the change. This is not one-PR-per-line — a single bullet describes a user-facing change and may reference multiple PRs.

Format: append `([#123](https://github.com/getpaseo/paseo/pull/123) by [@user](https://github.com/user))` at the end of each bullet. For changes spanning multiple PRs or contributors:

```markdown
- Voice mode now works on tablets with proper microphone permissions. ([#210](https://github.com/getpaseo/paseo/pull/210), [#215](https://github.com/getpaseo/paseo/pull/215) by [@alice](https://github.com/alice), [@bob](https://github.com/bob))
```

Rules:

- **Always link the PR number** as `[#N](https://github.com/getpaseo/paseo/pull/N)`.
- **Always link the contributor's GitHub profile** as `[@user](https://github.com/user)`.
- **One bullet = one user-facing change**, regardless of how many PRs went into it. Group related PRs on the same bullet.
- **De-duplicate contributors.** If the same person authored multiple PRs in one bullet, list them once.
- **Only credit external contributors.** Skip attribution for [@boudra](https://github.com/boudra). The changelog credits community contributions — core team work is the default.
- **Credit the commit author, not the PR opener.** A maintainer often opens a PR that lands work authored by someone else (cherry-pick, rebase of a contributor's branch, manual extraction from a stacked PR). The squash commit preserves the original commit's author, but `gh pr view N --json author` returns the PR opener — using that field will silently mis-credit the work to the maintainer (and then the "skip @boudra" rule drops the attribution entirely). Always resolve attribution from commit authors.

  Use this command to get the GitHub logins for each PR:

  ```bash
  gh pr view N --json commits --jq '[.commits[].authors[].login] | unique | .[]'
  ```

  This returns every distinct GitHub login that authored or co-authored a commit in the PR. Use those logins for attribution. Fall back to `gh pr view N --json author` only if the commits command returns nothing (which should not happen for merged PRs).

  When listing PR numbers, `git log --format='%H %s' v<previous>..<release-source-sha> | grep -E '\(#[0-9]+\)$'` pulls the PR number out of squash commit subjects.

## Changelog ordering

Entries within each section (Added, Improved, Fixed) are ordered by user impact:

1. **User-facing features and changes first** — things users will notice, want to try, or that change their workflow.
2. **Quality-of-life improvements** — polish, performance, smoother interactions.
3. **Internal/infra changes last** — only include if they have a tangible user benefit (e.g. "faster startup" is user-facing even if the fix was internal).

## Pre-release sanity check

Before cutting a **stable** release, the release agent reviews the diff as a last line of defence against shipping bugs. Skip this for betas — the beta itself is the smoke test, and gating each beta on a code review defeats the point of using betas as fast release candidates.

Review the diff between the latest release tag and the resolved release source. Focus on:

1. **Breaking changes** — especially in the WebSocket protocol, agent lifecycle, and any server↔client contract.
2. **Backward compatibility** — the important direction is old app clients talking to newly updated daemons. Users update desktop and daemon first, then keep running the old app for a while. Flag anything that breaks old clients against new daemons or requires both sides to update in lockstep.
3. **Regressions** — anything that looks like it could break existing functionality.

Use `git diff <latest-release-tag>..<release-source-sha>` as the review input. This is a deep sanity check, not a full code review. If anything looks risky, investigate before proceeding and surface the finding to the user.

## Changelog scope

Changelog scope follows the release being described:

Every entry covers `previous stable release → release source`: first beta, later beta, direct stable release, and promotion alike. The beta entry always reads as the stable entry would if the beta were promoted today.

## Completion checklist

### Beta release

- [ ] The resolved release source is the intended commit (default `origin/main`) and its existing CI is green
- [ ] Every PR in the release range has been opened, and its full description and every linked issue have been read before drafting the changelog
- [ ] Fold this beta into the series' single `CHANGELOG.md` entry (heading `## X.Y.Z-beta.N - YYYY-MM-DD`, previous stable → release source), review it against the changelog policy, get approval, and commit it with its [`CHANGELOG.zh-CN.md` translation](#changelog-translations) before cutting the release
- [ ] The diff from the previous stable to the resolved release source is classified as patch or minor, with the target version and rationale approved
- [ ] Release preparation stayed local until the approved release command pushed the complete branch and tag
- [ ] `npm run release:beta:patch`, `npm run release:beta:minor`, or `npm run release:beta:next` completes successfully
- [ ] Every GitHub Actions run for the complete release commit and tag is green
- [ ] npm shows the version under the `beta` dist-tag, not `latest`
- [ ] The GitHub prerelease was published only after both beta manifests were uploaded, and it has the changelog body and every expected macOS, Windows, and Android APK asset
- [ ] GitHub `Desktop Release` workflow for the `v*-beta.N` tag is green
- [ ] The GitHub prerelease contains `beta-mac.yml` and `beta.yml`
- [ ] GitHub `Android APK Release` workflow for the same tag is green
- [ ] GitHub `Docker` workflow is green and the versioned beta image is published without moving `latest`
- [ ] GitHub `Release Notes Sync` mirrored the beta entry into the prerelease body
- [ ] EAS `Release iOS Beta` completed its build, TestFlight distribution, external beta group, and Beta App Review path
- [ ] The release heartbeat was created after the tag push and deleted only after every item above passed

### Stable release (or promotion)

- [ ] Run the pre-release sanity check (see above) and address any findings
- [ ] The diff from the previous stable to the resolved release source is classified as patch or minor, with the target version and rationale approved
- [ ] The resolved release source is the intended commit (default `origin/main`) and its existing CI is green
- [ ] Every PR in the release range has been opened, and its full description and every linked issue have been read before drafting the changelog
- [ ] Ensure the approved release inputs are committed locally and the git worktree is clean before running any release command
- [ ] Ensure local `npm run typecheck` passes on that exact commit before running any release command
- [ ] Update `CHANGELOG.md` with user-facing release notes (features, fixes — not refactors). Promotion renames the series' `## X.Y.Z-beta.N` entry to `## X.Y.Z - YYYY-MM-DD` and re-checks it covers the full release. Commit the matching [`CHANGELOG.zh-CN.md` entry](#changelog-translations) with it
- [ ] Refresh the bundled price snapshot with `npm run usage:pricing:refresh` and include it in the release-preparation commits
- [ ] Verify the changelog heading follows strict `## X.Y.Z - YYYY-MM-DD` format
- [ ] Release preparation stayed local until the approved release command pushed the complete branch and tag
- [ ] `npm run release:patch`, `npm run release:minor`, or `npm run release:promote` completes successfully
- [ ] Every GitHub Actions run for the complete release commit and tag is green
- [ ] Move npm's `beta` dist-tag to the new stable version for every published package and verify both `latest` and `beta` resolve to it
- [ ] The GitHub Release was published only after both stable manifests were uploaded, and it has the changelog body and every expected macOS, Windows, and Android APK asset
- [ ] GitHub `Desktop Release` workflow for the `v*` tag is green
- [ ] The GitHub Release contains `latest-mac.yml` and `latest.yml`
- [ ] `latest-mac.yml` contains the current `minimumSystemVersion` guard
- [ ] GitHub `Android APK Release` workflow for the same tag is green
- [ ] GitHub `Docker` workflow is green and both the versioned and `latest` images are published
- [ ] GitHub `Release Notes Sync` is green and the release body matches the stable changelog entry
- [ ] EAS `Release Mobile` workflow for the same tag is green
- [ ] EAS iOS `build_ios` completes for the same tag
- [ ] EAS iOS `distribute_ios` succeeds, uploading the binary once, distributing it to `Paseo Beta`, and submitting it for Beta App Review
- [ ] EAS iOS `submit_ios_for_review` succeeds, putting the build into App Store review
- [ ] EAS Android `build_android` completes for the same tag
- [ ] EAS Android `submit_android` succeeds, putting the build on its Play Store track
- [ ] The release heartbeat was created after the tag push and deleted only after every item above passed
