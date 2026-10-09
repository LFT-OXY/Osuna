# Release

All workspaces share one version and release together.

A release is a `vX.Y.Z` tag pushed to `origin`. GitHub Actions builds the desktop apps and the Docker image from the tag and publishes the GitHub Release. Osuna publishes nothing to npm.

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
- run the release command, which pushes the prepared branch and tag
- dispatch the Android APK build for the new tag
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

**Setup still needed:** CI, Docker, and Nix PR checks currently target only `main`,
and GitHub permits only squash merges. Enable checks and required-check protection
for `next`, CI on its pushes, and merge commits for the integration PR. Handle PR
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

## Two paths

There are two supported release paths:

1. **Direct stable release**: you are ready to ship the resolved release source to everyone immediately (default `origin/main`).
2. **Beta flow**: release candidates on the `beta` channel. Each beta carries its own changelog entry, is published as a GitHub prerelease, and stays behind the Stable/Beta switch on `/download`.

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
approval.

Version bumps are never used to retry a failed build. Retry the existing version
as described in **Fixing a failed release build**.

## Standard release (stable)

Before running any stable release command:

- Make sure the resolved release source passed CI, the approved release inputs are committed locally on the intended branch, and the working tree is clean.
- **Run `npm run format`, `npm run lint`, and `npm run typecheck` and commit any resulting changes before the release command.** `version:all:*` runs `npm version`, which aborts when the working tree is dirty.
- Do not use a release command as a substitute for checking whether the current commit is actually ready.

```bash
# Run exactly one, matching the approved decision:
npm run release:fork:patch
npm run release:fork:minor
```

Each one runs `version:all:<bump>` and then `release:push`: it bumps the version in every workspace, commits, tags `vX.Y.Z`, and pushes the branch and the tag to `origin`. The `fork` in the script names dates from when Osuna shipped as a fork. They are the release commands.

A major release has no wrapper script. After explicit approval, run the two halves yourself:

```bash
npm run version:all:major && npm run release:push
```

Do not run `release:patch`, `release:minor`, `release:major`, `release:promote`, or any `release:beta:*` script. They call `npm publish` before they push.

The push starts these workflows:

| Workflow                                       | Runs on                                                                           | Result                                                                                                                                                      |
| ---------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Desktop Release`                              | the `v*` tag                                                                      | Builds macOS (arm64, x64) and Windows (x64, arm64), uploads them to a draft GitHub Release, and publishes the draft once every updater manifest is uploaded |
| `Docker`                                       | the `v*` tag                                                                      | Publishes `ghcr.io/lft-oxy/osuna:X.Y.Z`. A stable tag also moves `latest`; a beta tag publishes only its exact version                                      |
| `Release Notes Sync`                           | the `v*` tag                                                                      | Mirrors the matching changelog entry into the release body                                                                                                  |
| `Deploy App`, `Deploy Website`, `Deploy Relay` | the release commit reaching `main`, see [Cloudflare deploys](#cloudflare-deploys) | Redeploys the web app, the website, and the relay                                                                                                           |

`Android APK Release` has no tag trigger. Dispatch it once the tag is on `origin`:

```bash
gh workflow run "Android APK Release" -f tag=vX.Y.Z
```

It attaches `osuna-vX.Y.Z-android.apk` to that tag's GitHub Release. [android.md](android.md#release-apk-github-actions) covers the build. There is no iOS build and no store submission.

To build desktop artifacts without publishing them, dispatch `Desktop Release` with an existing tag and `publish` set to `false`. The installers stay in the workflow artifacts.

**Stable means stable.** If the user says "stable" or "ship stable", do not ask whether they want a beta first. They picked stable; treat it as a direct stable release. Only run the beta flow when the user explicitly says "beta".

## Beta flow

```bash
npm run version:all:beta:patch && npm run release:push   # Start the next patch beta line
npm run version:all:beta:minor && npm run release:push   # Start the next minor beta line
# ... test the desktop prerelease assets from GitHub Releases ...
npm run version:all:beta:next && npm run release:push    # Optional: cut X.Y.Z-beta.2, beta.3, ...
npm run version:all:promote && npm run release:push      # Promote X.Y.Z-beta.N to stable X.Y.Z
```

- Beta tags are published GitHub prereleases like `v0.1.41-beta.1`
- Betas publish desktop assets and a Docker image under the exact version tag. Dispatch `Android APK Release` for the beta tag when testers need an APK.
- `version:all:promote` creates a fresh stable tag like `v0.1.41`; the final release never reuses the beta tag
- Desktop assets now come from the Electron package at `packages/desktop`
- The Linux artifact CI checks with both restricted and usable user namespaces run on pull requests that touch `packages/desktop`; see [packaged desktop smoke](testing.md#packaged-desktop-smoke). Keep the installed-package and AppImage checks together. They do not gate publication: the release workflow builds no Linux artifacts (see [加回 Linux](#加回-linux)).
- Beta releases use Electron's `beta` update channel. Users on the stable channel only receive stable releases; users on the beta channel receive beta releases and the final stable release when it is published.
- **Each beta carries its own changelog entry.** `Release Notes Sync` mirrors the matching `## X.Y.Z-beta.N` entry into that prerelease body. Promotion collapses every beta entry for the version into one final stable entry. See the Changelog policy section.

Use the beta path when you need to:

- smoke a build yourself before promoting it to everyone
- test a build manually in a Windows VM
- send a build to a user who is hitting a specific problem
- iterate on `beta.1`, `beta.2`, `beta.3`, and so on before deciding to ship broadly

## Staged rollout (stable channel)

Stable desktop releases go out via a linear time-based rollout for automatic update checks: 0% admitted when the updater manifests appear, 100% admitted 36 hours later, linear ramp in between. Manual checks bypass the rollout so a user can install immediately when they click **Check**. Beta releases bypass the rollout entirely — beta users always receive updates immediately.

The rollout is driven by a `rolloutHours` field stamped into the GitHub Release manifests (`latest-mac.yml`, `latest.yml`) by the `finalize-rollout` job in `desktop-release.yml`.

Desktop release builds now publish in two phases:

- The GitHub Release stays a draft while platform build jobs upload the installers (`.dmg`, `.zip`, `.exe`).
- The final job merges and stamps every channel manifest, uploads them with the final `releaseDate` and `rolloutHours`, then publishes the GitHub Release.

Drafts do not appear in GitHub's releases feed. Updater clients continue to see the previous complete release until every manifest named by `DESKTOP_RELEASE_PLATFORMS` is available. If a desktop build or manifest upload fails, the new release stays a draft.

### Default behavior

`npm run release:fork:patch` or `npm run release:fork:minor` → tag push → 36h ramp. No extra action needed.

The `rollout_hours` input on `desktop-release.yml` is **only read on `workflow_dispatch`** — tag-push runs always default to 36. To get any other rollout duration on a fresh release, use the post-publish flip below.

### Instant-admit release (rollout_hours=0 from publish)

For a fresh release that should admit everyone immediately (low-risk change, doc-only, hotfix, or just a release you want out fast), cut the release normally and queue the rollout flip immediately after:

```bash
# 1. Cut and publish (default 36h ramp from tag push).
npm run release:fork:patch

# 2. Immediately queue the flip — runs as soon as finalize-rollout completes.
gh workflow run desktop-rollout.yml \
  -f tag=v0.1.64 \
  -f rollout_hours=0
```

**Why this is gap-free:** `desktop-release.yml`'s `finalize-rollout` job and `desktop-rollout.yml` share the concurrency group `desktop-rollout-<tag>`. Dispatching `desktop-rollout.yml` while the tag-push pipeline is still running queues it safely behind `finalize-rollout`. The first public manifests already carry `rolloutHours=36`, then `desktop-rollout.yml` flips them to `rolloutHours=0` shortly afterward. The renderer polls every 30 minutes, so active stable users pick up the new manifest on their next check.

Run the dispatch right after `release:fork:patch` or `release:fork:minor` returns. Don't wait for the tag-push CI to finish.

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

This does **not** apply to fresh releases cut via `npm run release:fork:patch` or `npm run release:fork:minor` — those paths always tag-push and stamp 36. For a fresh release with a custom ramp, cut normally and then dispatch `desktop-rollout.yml` (same pattern as the instant-admit flow above, with your chosen `rollout_hours`).

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
- **No rollback.** `allowDowngrade = false`. Bad release = ship a hotfix. The one manual way back is from 1.0.0 to 0.14.x, see [回滚到 0.14.x](#回滚到-014x).
- **Bootstrap caveat.** Clients running a build older than the rollout feature ignore `rolloutHours` and admit immediately. Rollout protection only applies to clients running the rollout-aware version or later.
- **Up to ~30 min automatic admission latency.** Renderer polls every 30 minutes, so a stable user may take up to that long to be evaluated against the rollout window. Clicking **Check** is manual and bypasses rollout admission.

## 分发细节

### 更新源

`packages/desktop/electron-builder.yml` 的 `publish` 段指向 `LFT-OXY/Osuna`。
electron-builder 把它烘进安装包内的 `app-update.yml`，客户端据此查更新。改这个值会改变
此后每个安装包查更新的地址。

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

### 安卓签名 keystore

GitHub Release 上的 APK 用一把长期固定的 PKCS12 keystore 签名。Android 把签名证书当作
应用身份：已装用户只接受同一证书签出的更新，换 keystore 等于让所有侧载用户卸载重装。

- **存放位置**：本机 `~/.config/osuna/android/`（目录权限 700），里面是
  `osuna-release.keystore`、口令 `osuna-release.keystore.password`（权限 600；PKCS12 不支持
  store 与 key 两套口令，两者相同）和公开的 `osuna-release.pem`。alias 是 `osuna-release`。
  仓库 Secrets 里有一份：`ANDROID_KEYSTORE_BASE64`、`ANDROID_KEYSTORE_PASSWORD`、
  `ANDROID_KEY_ALIAS`、`ANDROID_KEY_PASSWORD`。有效期 30 年，到 2056-10-01。
- **必须备份**：与 macOS 证书相同，整个目录同步到云盘。
- **证书指纹**，用户校验下载到的 APK 是否出自本仓库：

  ```text
  SHA-256: 39:16:AF:AB:5B:A3:EB:34:BF:71:58:43:30:0A:30:42:BC:A9:86:07:9E:8D:33:D0:38:D6:C5:C1:78:63:4E:A9
  SHA-1:   B5:B8:41:13:5F:61:C1:17:27:91:E7:08:A0:88:01:59:BC:73:B3:77
  ```

  ```bash
  keytool -printcert -jarfile osuna-vX.Y.Z-android.apk
  ```

  `apksigner verify --print-certs` 打出的是同一串字节，小写、无冒号。

### macOS 首次打开

包用自签名证书签名，但没有公证。用户把应用拖进「应用程序」后首次打开会被
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

## 0.14.x 数据迁移

1.0.0 首次启动时把 0.14.x 的数据搬到新名字下。成功不提示，每层只记一条 info 日志。

- 读旧布局的代码都带同一个标签：`COMPAT(paseoDataMigration): added in v1.0.0, remove after 2027-10-09 or in 2.0.0, whichever first`。期限比[默认的六个月](protocol-compatibility.md#every-shim-is-tagged-and-dated)长，因为迁的是用户数据。
- **daemon home**：`~/.paseo` 改名为 `~/.osuna`，原位留符号链接（Windows 用 junction）。代码在 `packages/server/src/server/legacy-home-migration.ts`，由会读写 home 的一方在动手之前调用：CLI 的每条命令（`packages/cli/src/cli.ts` 的 `preAction` 钩子，连别的主机的命令也会把 `cli-client-id` 写进默认 home）、桌面端启动 daemon 之前、直接启动的 supervisor。daemon 进程自己不迁移。设了 `OSUNA_HOME` 或传了 `--home` 时跳过。
- **Electron userData**：appData 下的 `Paseo` 目录改名为 `Osuna`，不留链接。代码在 `packages/desktop/src/settings/user-data-migration.ts`，调用点在 `main.ts` 写第一条日志之前。
- **渲染层存储**：`paseo://app` 这个 origin 的 localStorage 与 IndexedDB 导入 `osuna://app`，旧 origin 不清空。代码在 `packages/desktop/src/settings/renderer-origin-migration/`，完成标记是 `desktop-settings.json` 的 `migrations.legacyRendererOriginImported`。
- 残留的 `PASEO_*` 环境变量不生效，daemon 与 CLI 启动时逐个点名：`packages/server/src/server/legacy-env.ts`。
- 迁移测试用的旧版样本在 `packages/desktop/e2e/fixtures/legacy-paseo/`。
- 清理：`rg "COMPAT\(paseoDataMigration"` 列出全部位置。到期后把这些代码、上面的样本目录、`scripts/rename-guard.mjs` 里放行这个标签的规则、`MIGRATION_FILES` 登记表和本节在 `DOC_PASSAGE_EXCEPTIONS` 里的那一行一起删掉。

到期只删代码。`~/.paseo` 这个链接是用户数据，留在磁盘上：工作区记录、git worktree 的
`gitdir` 指针和 `agents/` 目录名都还指着 `~/.paseo`。删掉迁移代码的那个版本要在发布说明里写明：
还停在 0.14.x 的用户须先升到带迁移的 1.x 版本。

排查用户报告时要知道的两点：

- home 改名失败（比如跨分区）时退回复制。复制成功后旧目录原样留着，不建链接，已记录的
  worktree 路径仍指向旧目录里的那一份。
- userData 搬不动时 macOS 与 Windows 弹错误框后退出。Linux 没有错误框，只写 stderr。

### 回滚到 0.14.x

回滚是整版退回：桌面端连同它自带的 daemon 一起换回 0.14.x。更新器不降级
（`allowDowngrade = false`），所以是用户从 Release 页下载 0.14.x 的安装包覆盖安装。

1. 退出 Osuna，用 `osuna daemon status` 确认 daemon 已停。两个版本的 pid 锁文件名不同
   （`osuna.pid` 与 `paseo.pid`）。1.0.0 认得还活着的 `paseo.pid`，不会在 0.14.x 的 daemon
   旁边再起一个；0.14.x 不认得 `osuna.pid`，1.0.0 的 daemon 没停它也照样启动，两个一起写
   同一个 home。
2. 要带回主机列表与设置，在第一次打开 0.14.x 之前把 userData 目录从 `Osuna` 改回 `Paseo`。
   它在 macOS 的 `~/Library/Application Support/Osuna`、Windows 的 `%APPDATA%\Osuna`、
   Linux 的 `~/.config/Osuna`。不改回去，0.14.x 以空的主机列表和默认设置启动。
3. 安装并打开 0.14.x。

回去之后能看到什么：

- **daemon 数据**：0.14.x 读写 `~/.paseo`。它现在是指向 `~/.osuna` 的链接，两个版本用的是
  同一份数据，不用任何操作。走了复制回退的机器没有链接，`~/.paseo` 还是升级那一刻的旧目录，
  0.14.x 看到的就是它。
- **渲染层存储**：旧 origin 的数据停在升级那一刻。1.0.0 里新加的主机、改过的设置和草稿
  写在新 origin，0.14.x 读不到。

## Release completion and heartbeat

A release is **in progress** after the tag push. Report it as **shipped** only
after every applicable build, publication, asset, and manifest passes the
completion checklist.

Immediately after every beta, stable, or promotion tag push, create a heartbeat
that resumes the release in the current conversation. Create it automatically
with `create_heartbeat`. The heartbeat owns the release until it either reaches
the completion checklist or finds a failure that needs new user authority.

Each heartbeat checks the release tag commit, all GitHub Actions runs for the
release branch and tag, the dispatched `Android APK Release` run, the GitHub
Release body and assets, desktop updater manifests, and the published Docker
image. Inspect the GitHub Release itself and confirm that the macOS, Windows,
and Android APK assets are present along with the channel manifests
(`latest-mac.yml` and `latest.yml` for stable; `beta-mac.yml` and `beta.yml` for
beta).

Delete the heartbeat only after every applicable checklist item passes, then
report the release as shipped.

Pattern:

```jsonc
// mcp__osuna__create_heartbeat arguments
{
  "name": "vX.Y.Z release babysit heartbeat",
  "cron": "*/10 * * * *",
  "timezone": "UTC",
  "maxRuns": 120,
  "expiresIn": "24h",
  "prompt": "Resume the vX.Y.Z release babysit for commit <sha>. Check every GitHub Actions run for the release branch and tag, including the dispatched Android APK Release run; the published GitHub Release body, expected desktop/APK assets, and channel manifests; and the Docker image. Completion requires every applicable checklist item. If work is pending, wait for the next heartbeat. If a failure can be retried safely for the same version, follow the failed-release procedure; otherwise report the blocker. When every applicable completion-checklist item passes, delete THIS heartbeat, report shipped, and stop.",
}
```

Run an immediate status check after creating the heartbeat. The heartbeat handles
later transitions and stops itself when the release is complete.

## Release notes on GitHub

The GitHub Release body is populated automatically by the `Release Notes Sync` workflow (`.github/workflows/release-notes-sync.yml`). It triggers on every `v*` tag push and on any push to `main` that touches `CHANGELOG.md`, then runs `scripts/sync-release-notes-from-changelog.mjs` to mirror the matching changelog entry into the release body. You don't need to write release notes on GitHub manually — keep `CHANGELOG.md` correct and the workflow will sync it. To force a re-sync, dispatch the workflow with the tag input.

## Cloudflare deploys

The relay, the web app, and the website deploy from `main`, not from release tags.

| Workflow         | Deploys                                                                         | Runs on pushes to `main` that touch                                                             |
| ---------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `Deploy Relay`   | Worker `osuna-relay` at `osuna-relay.chinhae.cc`. This is the production relay. | `packages/relay/**`                                                                             |
| `Deploy App`     | Pages project `osuna-app`, the web app at `osuna-app.chinhae.cc`                | `packages/app/**`, the workspace packages bundled into it, the root package files, `patches/**` |
| `Deploy Website` | Worker `osuna-website` at `osuna.chinhae.cc`                                    | `CHANGELOG.md`, `public-docs/**`, `packages/website/**`, the root package files, `patches/**`   |

Each one also runs when its own workflow file changes and on manual dispatch. `Deploy Website` additionally subscribes to `release: published` and skips prereleases.

All three read the `CLOUDFLARE_API_TOKEN` secret and the `CLOUDFLARE_ACCOUNT_ID` repository variable. The account id is a variable because `wrangler.toml` already carries it in the clear.

A release commit bumps the version in every workspace `package.json`, so pushing one to `main` runs all three, relay included.

## Website behavior

- The website download page defaults to GitHub's latest published **stable** release.
- A published beta prerelease is offered behind the Stable/Beta switch on `/download` (`?channel=beta`), never as the default. The switch only appears while the newest prerelease leads stable on its core version, so promoting `X.Y.Z-beta.N` to `X.Y.Z` retires the beta channel from the page until the next beta line opens.
- The web app at `osuna-app.chinhae.cc` has no beta. The Beta view drops the whole Web section rather than showing an inert "stable only" placeholder.
- The default download target only moves when you publish the final stable release tag like `v0.1.41`.
- The public `/changelog` page renders `CHANGELOG.md` as-is, so the in-flight `-beta.N` entry shows there once it lands on `main` — that's intended, it's where beta users check what's coming. Only the **default download target** stays pinned to the latest stable; the download links read GitHub's releases API, not the changelog, so a `-beta.N` heading on top never affects them.
- The download page's "What's new" link deep-links the **minor group** anchor (`/changelog#release-0.3`), not the exact entry: promotion collapses the beta entries into one stable entry, so the minor group remains the durable target. A version with no entry in the bundled changelog — a tag whose changelog commit hasn't redeployed the site yet — links the plain `/changelog` instead of a dead anchor.
- The website itself is deployed by `Deploy Website`; see [Cloudflare deploys](#cloudflare-deploys).

## Fixing a failed release build

**NEVER bump the version to fix a build problem.** New versions are reserved for meaningful product changes (features, fixes, improvements). Build/CI failures are fixed on the current version.

**Do not rely on `workflow_dispatch` for tagged code fixes.** The `workflow_dispatch` trigger runs the workflow file from the default branch but checks out the code at the tag ref (`ref: ${{ inputs.tag }}`). That means fixes committed to `main` won't change the tagged source tree being built. `workflow_dispatch` only helps when the fix lives in the workflow file itself.

For Docker-only retries, **do not push or force-push a `v*` release tag**.
`v*` tag pushes rebuild desktop assets, Docker, and release notes. Use the
Docker workflow dispatch instead:

```bash
gh workflow run docker.yml \
  --ref main \
  -f osuna_version=X.Y.Z-beta.N \
  -f publish=true
```

This replaces `ghcr.io/lft-oxy/osuna:X.Y.Z-beta.N` in place without touching
the desktop release builders. The Docker exception is safe because the
dispatch runs from `--ref main` and uses the explicit `osuna_version`; it does
not check out or move the `v*` release tag.

To retry a failed desktop release workflow, push a retry tag on the commit
you want to build. Reusing the same tag name is expected: move it with
`git tag -f ...` and push it with `--force` so the workflow rebuilds the commit
you actually want.

A failed desktop build leaves the GitHub Release as a draft: `finalize-rollout`
exits before it uploads any manifest. Retry every platform with
`desktop-vX.Y.Z`, or dispatch with `platform` left at `all`. A single-platform
retry completes the release only when the other platform's manifest is already
on the Release.

Prefer a tag push over `workflow_dispatch` when rebuilding desktop release
assets. Prefer Docker workflow dispatch when rebuilding only the Docker image.

The retry tag patterns below remain the supported way to rebuild specific release targets:

```bash
# Desktop (all platforms)
git tag -f desktop-v0.1.28 HEAD && git push origin desktop-v0.1.28 --force

# Desktop (single platform)
git tag -f desktop-macos-v0.1.28 HEAD && git push origin desktop-macos-v0.1.28 --force
git tag -f desktop-windows-v0.1.28 HEAD && git push origin desktop-windows-v0.1.28 --force

# Beta
git tag -f v0.1.29-beta.2 HEAD && git push origin v0.1.29-beta.2 --force

# Android APK: no workflow listens for this tag, so pushing it builds nothing. Dispatch with it.
git tag -f android-v0.1.28 HEAD && git push origin android-v0.1.28 --force
gh workflow run "Android APK Release" -f tag=android-v0.1.28
```

This ensures the checkout ref matches the actual code on `main` with the fix included.

- `vX.Y.Z` or `vX.Y.Z-beta.N` rebuilds the full tagged release
- `desktop-vX.Y.Z` rebuilds desktop for all desktop platforms only
- `desktop-macos-vX.Y.Z` and `desktop-windows-vX.Y.Z` rebuild only that desktop platform
- `android-vX.Y.Z` names the commit the dispatched APK build checks out; the APK still lands on the `vX.Y.Z` Release. When the tagged source is fine, dispatch with `vX.Y.Z` itself.

If you decide to publish a release without working desktop builds, inspect its
assets first, then publish it manually:

```bash
RELEASE_LOOKUP=$(node scripts/github-release.mjs --repo LFT-OXY/Osuna --tag vX.Y.Z)
gh release view "$RELEASE_LOOKUP" --json isDraft,isPrerelease,assets
gh release edit "$RELEASE_LOOKUP" --tag vX.Y.Z --draft=false

# Keep a beta marked as a prerelease:
RELEASE_LOOKUP=$(node scripts/github-release.mjs --repo LFT-OXY/Osuna --tag vX.Y.Z-beta.N)
gh release edit "$RELEASE_LOOKUP" --tag vX.Y.Z-beta.N --draft=false --prerelease
```

This bypasses the updater-manifest guarantee. Use it only when the release is
intentionally unavailable to desktop updater clients.

## Notes

- `version:all:*` bumps root + syncs workspace versions and `@osuna/*` dependency versions
- `release:prepare` refreshes workspace `node_modules` links to prevent stale types
- `npm run dev:desktop` and `npm run build:desktop` target the Electron desktop package in `packages/desktop`
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

- `CHANGELOG.md` includes stable releases and every entry in the current beta series.
- The first beta of a version inserts a top entry like `## 0.1.60-beta.1 - YYYY-MM-DD`.
- Each subsequent beta inserts a new top entry with the next beta number. Its notes cover the changes since the previous beta tag.
- Stable promotion replaces every beta entry for that version with one `## 0.1.60 - YYYY-MM-DD` entry.
- The promoted stable entry covers the full diff from the previous stable tag and collapses internal iterations across the beta series.

## Changelog ownership

- **The agent running the release writes the changelog entry — beta or stable.** The release context and final wording stay with that agent.
- **Commit history is only an index of the changes. Never draft the changelog from commit subjects or diffs alone.** For every PR in the release range, read the full PR description and every issue it links to before deciding what changed, why users care, or how changes should be grouped. Use the implementation only to verify the resulting understanding.
- For the first beta or a direct stable release, draft from the previous stable tag to the release source. For later betas, draft from the previous beta tag to the release source. Promotion replaces the beta series with one entry drafted from the previous stable tag to the release source. Review the result against the changelog policy below, show it to the user, and wait for approval before committing it.

## Changelog wording

The changelog is shown on the website's `/changelog` page and in the app's **What's new** sheet. Each bullet is a compact factual record of
product behavior that changed.

- **Name the exact change.** Prefer `Added <capability>`, `Removed <behavior>`,
  `Changed <behavior>`, or `Fixed <failure> when <condition>`.
- **Keep the scope exact.** A conditional bug is not a general reliability problem. Do not
  broaden one failure into claims that Osuna is now faster, smoother, responsive, or reliable.
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
| Osuna stays responsive with many idle Git workspaces         | Removed periodic Git polling for idle workspaces      |
| Incompatible saved app data no longer crashes after upgrades | Fixed crash when persisted cache was incompatible     |
| Splitting layouts no longer remounts the active agent        | Fixed scroll position resetting when splitting a pane |
| Mobile model selector is faster and more straightforward     | Added search to the mobile model selector             |

Test each bullet against the source PR and issue: can a reviewer point to the exact behavior
that changed, the failure that was fixed, or the capability that was added? If the bullet only
claims a general improvement, rewrite it with the concrete change.

- **Use the entry's release scope.** Include changes within the matching range in **Changelog scope**.
- **Collapse internal iterations within that scope.** Present a feature added and fixed in one range as working. A later beta can describe a fix to behavior delivered in an earlier beta; promotion folds the complete beta series into the final stable behavior.
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

Format: append `([#123](https://github.com/LFT-OXY/Osuna/pull/123) by [@user](https://github.com/user))` at the end of each bullet. For changes spanning multiple PRs or contributors:

```markdown
- Voice mode now works on tablets with proper microphone permissions. ([#210](https://github.com/LFT-OXY/Osuna/pull/210), [#215](https://github.com/LFT-OXY/Osuna/pull/215) by [@alice](https://github.com/alice), [@bob](https://github.com/bob))
```

Rules:

- **Always link the PR number** as `[#N](https://github.com/LFT-OXY/Osuna/pull/N)`.
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

- **First beta**: `previous stable tag → release source`
- **Later beta**: `previous beta tag → release source`
- **Direct stable release**: `previous stable tag → release source`
- **Stable promotion**: replace the full beta series with one entry covering `previous stable tag → release source`

Each beta entry records what its testers receive. Promotion produces the single stable record for the full jump from one stable version to the next.

## Completion checklist

### Beta release

- [ ] The resolved release source is the intended commit (default `origin/main`) and its existing CI is green
- [ ] Every PR in the release range has been opened, and its full description and every linked issue have been read before drafting the changelog
- [ ] Add a new `CHANGELOG.md` entry for this beta (heading `## X.Y.Z-beta.N - YYYY-MM-DD`), review it against the changelog policy, get approval, and commit it before cutting the release
- [ ] The diff from the previous stable to the resolved release source is classified as patch or minor, with the target version and rationale approved
- [ ] Release preparation stayed local until the approved release command pushed the complete branch and tag
- [ ] The `version:all:beta:*` command followed by `npm run release:push` completes successfully
- [ ] Every GitHub Actions run for the complete release commit and tag is green
- [ ] The GitHub prerelease was published only after both beta manifests were uploaded, and it has the changelog body and every expected macOS, Windows, and Android APK asset
- [ ] GitHub `Desktop Release` workflow for the `v*-beta.N` tag is green
- [ ] The GitHub prerelease contains `beta-mac.yml` and `beta.yml`
- [ ] GitHub `Android APK Release` was dispatched for the same tag and is green
- [ ] GitHub `Docker` workflow is green and the versioned beta image is published without moving `latest`
- [ ] GitHub `Release Notes Sync` mirrored the beta entry into the prerelease body
- [ ] The release heartbeat was created after the tag push and deleted only after every item above passed

### Stable release (or promotion)

- [ ] Run the pre-release sanity check (see above) and address any findings
- [ ] The diff from the previous stable to the resolved release source is classified as patch or minor, with the target version and rationale approved
- [ ] The resolved release source is the intended commit (default `origin/main`) and its existing CI is green
- [ ] Every PR in the release range has been opened, and its full description and every linked issue have been read before drafting the changelog
- [ ] Ensure the approved release inputs are committed locally and the git worktree is clean before running any release command
- [ ] Ensure local `npm run typecheck` passes on that exact commit before running any release command
- [ ] Update `CHANGELOG.md` with user-facing release notes (features, fixes — not refactors). Promotion replaces every `## X.Y.Z-beta.N` entry in the series with one `## X.Y.Z - YYYY-MM-DD` entry covering the full release
- [ ] Refresh the bundled price snapshot with `npm run usage:pricing:refresh` and include it in the release-preparation commits
- [ ] Verify the changelog heading follows strict `## X.Y.Z - YYYY-MM-DD` format
- [ ] Release preparation stayed local until the approved release command pushed the complete branch and tag
- [ ] `npm run release:fork:patch`, `npm run release:fork:minor`, or `npm run version:all:promote && npm run release:push` completes successfully
- [ ] Every GitHub Actions run for the complete release commit and tag is green
- [ ] The GitHub Release was published only after both stable manifests were uploaded, and it has the changelog body and every expected macOS, Windows, and Android APK asset
- [ ] GitHub `Desktop Release` workflow for the `v*` tag is green
- [ ] The GitHub Release contains `latest-mac.yml` and `latest.yml`
- [ ] `latest-mac.yml` contains the current `minimumSystemVersion` guard
- [ ] GitHub `Android APK Release` was dispatched for the same tag and is green
- [ ] GitHub `Docker` workflow is green and both the versioned and `latest` images are published
- [ ] GitHub `Release Notes Sync` is green and the release body matches the stable changelog entry
- [ ] The release heartbeat was created after the tag push and deleted only after every item above passed
