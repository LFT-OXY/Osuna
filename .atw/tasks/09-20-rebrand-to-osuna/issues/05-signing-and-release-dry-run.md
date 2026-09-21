# 05 — 签名配置与发布演练：去公证、改 workflow、推测试 tag 走一遍 Release

**What to build:** 在没有 Apple 开发者账号的前提下让桌面发布链路真正跑通，并用一次
真实的 GitHub Release 验证前四票的成果。不采用「有 secrets 才签名」的条件化方案：
那会让同一条发布流程在有无 secret 时产出行为不同的包，差异只在用户装不上时才暴露。

**Impl:** done
**Status:** ready-for-agent

**Blocked by:** 08

- [x] `packages/desktop/electron-builder.yml`：去掉 `notarize: true`、
      `hardenedRuntime: true` 与 `entitlements` / `entitlementsInherit` 两行；
      ~~相应清理 `scripts/after-sign.js` 里已无意义的公证逻辑~~ —— 票面写错，见下
- [x] `.github/workflows/desktop-release.yml`：去掉 Apple secrets 引用。实际是**五行**
      不是四行（票面漏了 `CSC_KEY_PASSWORD`）
- [x] `README.md` 写明 macOS 首次打开需右键→打开（未签名包会被 Gatekeeper 拦下）
- [x] `docs/release.md` 更新为本 fork 的实际发布路径
- [x] 验收：推一个测试 tag，CI 产出可下载的 mac/win/linux 包；electron-updater 能从
      `LFT-OXY/Osuna` 的 Release 识别到版本。**达成** —— 见下「重建后的最终状态」。
      「本地装上」这一步仍需你自己点一次（CI 的打包冒烟已证明 bundle 能启动）
- [x] **验收（从票 09 并过来）→ 已移交票 13**。并过来的前提被演练推翻：
      `android-apk-release.yml` 只是 EAS 的包装，Gradle 不在 Actions 日志里跑，
      所以「推一个 tag 就能看到 Gradle 工程名」根本不成立。
      落地时核对过的部分仍然有效：模块是**四个**，但 `osuna-hardware-keyboard` 只有
      `ios/` 目录、没有 `android/`，所以安卓侧确实只应出现
      `:osuna-word-stream`、`:osuna-native-trace`、`:osuna-diff-prototype` 三个
      Gradle 工程，不应出现任何 `:paseo-*` —— 这份清单原样交给票 13。
      **装到设备确认功能可用（word-stream 淡入、native trace、iOS 硬件键盘提交）
      CI 给不了，仍需一台真机或模拟器**，那部分两张票都不含，留给后续的设备回归。
- [x] `npm run typecheck`、`npm run lint` 通过

## 落地时确认下来的事实（票面写错或没写的）

- **`after-sign.js` 里没有公证逻辑可清。** 文件里只有 macOS 打包冒烟
  （`OSUNA_DESKTOP_SMOKE=1` 时跑 `smokePackagedDesktopApp`），所以**不动**。
  连带确认的一件事：electron-builder 在没发生签名时会**跳过 `afterSign` 钩子**
  （`platformPackager.js` `doSignAfterPack`：`didSign` 为假就只打一行 warn）。
  mac arm64 仍会跑冒烟，因为 electron-builder 对 arm64 有 ad-hoc 签名兜底
  （`macPackager.js` `fallBackToAdhoc`）；**x64 不跑**。这是本 fork 没有 secrets 时
  的既有状态，不是去公证造成的回归 —— 去掉 `CSC_LINK` 之前它就已经这样了。
  Linux/Windows 的冒烟走 `after-pack.js`，不受影响。
  **没有把冒烟挪到 `afterPack`**：`afterPack` 跑在 ad-hoc 签名之前，此时 arm64 的
  bundle 签名已被打包改动破坏，根本起不来。

- **`release:*` 整条链路原本是断的。** `package.json` 的 `version` 生命周期还在调
  `npm run fdroid:changelogs`，而该脚本与 `fastlane/` 已在前面的票里删掉。
  `version:all:*` 内部走 `npm version`，会触发这个钩子直接 "Missing script" 失败。
  已从钩子里摘掉。

- **`IS_SMOKE_TAG` / `gha-smoke` 是死路，不可达。**
  `emit-release-env.mjs` 用 `sourceTag.includes("gha-smoke")` 判定，但
  `normalizeReleaseTag` → `parseReleaseVersion` 只接受 `beta.N` 形式的预发布号，
  任何含 `gha-smoke` 的 tag 在解析阶段就抛错。所以「推个冒烟 tag 只验构建、不建
  Release」这条路走不通，演练只能推真 tag。**本票未修**，见「遗留」。

## 落地时做的决定：本 fork 不发 npm

`@osuna/*` 在 npm 上不存在（`npm view @osuna/cli` 为 404），本机也未登录。
`release:patch` 里的 `release:publish` 必然失败。用户决定**不发 npm**，据此：

- `package.json`：删掉 `release:publish`、`release:publish:beta` 与两条 `:dry-run`，
  八条 `release:*` 链路不再经过 npm。`release:check` 保留 —— `npm pack --dry-run`
  在 `private: true` 下仍然工作，它验的是 `files`/`exports` 打包面。
- 七个包（highlight / relay / protocol / client / plugin / server / cli）加
  `"private": true`，把「不发 npm」从散文变成机制：`npm publish` 会跳过并 warn。
  `publishConfig.access` 保留，记录将来恢复发布时的意图。
- `README.md`、`public-docs/index.md`、`public-docs/sdk/{index,quickstart}.md`、
  `packages/client/README.md` 的 npm 安装指引改成源码构建路径。
- CLI 的真实安装入口是桌面端 **Settings → Integrations → Command line → Install**
  （按 glossary「UI label wins」核对过 `en.ts` 的实际文案）。

## 评审查出并修掉的

- `docs/docker.md:214` 有一句「without rebuilding desktop, APK, or **EAS mobile release
  artifacts**」，是 `release.md` 里那句的孪生，跟着修。
- `docs/android.md` 我原先写「EAS profiles 留作本地 `eas build` 用」是**错的**：
  prd 批次 1 已删掉 `owner` 与 `extra.eas.projectId` 且不填替代值，`eas build` 会直接
  报错。改成如实陈述。三个 `.eas/workflows/*.yml` 一并删除 —— 它们正是 EAS GitHub app
  在 `v*` tag 上会读的文件，留着与「没有 EAS 项目」自相矛盾。
- `docs/release.md` 的 **Website behavior** 整段是虚构：它说站点由 `Deploy Website`
  （Cloudflare Workers）部署，但 `.github/workflows/` 下没有这个 workflow，
  `packages/website` 也已移出 workspace、无域名。整段改写，并清掉散落的
  `/download` Stable/Beta 开关、Homebrew、「changelog 显示在 Osuna 主页」等断言。
- `public-docs/updates.md` 的「App stores」段承诺 App Store / Play Store 发布，改写。
- 新增的打包回归原本四条都是 `not.toContain`，整个 `mac:` 块被删时也会通过；
  补了 `mac:` 与 icon 行的锚点断言。

## 刻意不做

- **`packages/website` 的 442 处 `paseo` 残留不扫**（55 个文件）。票 07 已把它列进
  排除清单：「已移出 workspace，随 website 去留一起定」。半扫一个被有意留白的包，
  正是票 07 自己写下的「半改的标识符比两端都糟」。
- **八条 `release:*` 脚本去掉 publish 后只剩 mode 不同，不合并。** 命令名是对外契约，
  合并会波及文档里所有引用点。
- `docs/mobile-testing.md:388` 仍按「App Store 安装」推理 —— 属测试文档，留给设备回归。

## 发布演练结果（tag `v0.8.1-beta.1`，2026-09-21）

推的是裸 tag（`git tag` + `git push`），没走 `release:beta:*` —— 后者会先 `npm version`
改版本号，而演练的目的是验 CI，不是真发版。这个选择本身带出一条结论，见 Docker 一行。

| workflow | 结果 | 原因 |
|---|---|---|
| Release Notes Sync | ✅ | — |
| Desktop / Linux | ✅ | deb / rpm / AppImage / tar.gz 齐全 |
| Desktop / macOS arm64 | ✅ | 见下，本票的核心验证 |
| Desktop / macOS x64 | ❌ → 已修 | `expo export --platform web` JS 堆 OOM（5138 模块，~2GB 上限）。与签名无关，发生在 electron-builder 之前。macOS job 加 `NODE_OPTIONS=--max-old-space-size=8192`；arm64 runner 默认堆更大所以没撞上 |
| Desktop / Windows | ❌ | 下载 `nsis-3.0.4.1.7z` 时 GitHub 返回 **500**。瞬时故障，重推即可 |
| finalize-rollout | ❌ | 两个平台失败 → Release 如设计般停在 draft |
| Docker | ❌ | Dockerfile 断言 `package.json` 版本 == tag 版本（0.8.0 ≠ 0.8.1-beta.1）。**裸 tag 方法的产物，不是仓库缺陷** —— 真实路径先 `version:all:beta:*` 再打 tag 就会过 |
| Android APK | ❌ | 见下，**推翻了票面前提** |

**macOS arm64 日志验证了本票的全部论断**：

```
• falling back to ad-hoc signature for macOS application code signing
• signing  file=release/mac-arm64/Osuna.app identityName=- identityHash=none
• skipped macOS notarization  reason=`notarize` options were unable to be generated
Packaged desktop smoke passed: real renderer and preload loaded;
  renderer-started desktop daemon pid 38940, listen 127.0.0.1:49225;
  CLI shim daemon status and terminal smoke succeeded
```

即：ad-hoc 兜底签名触发、公证跳过、`afterSign` 确实触发、**未签名的包能正常启动**
（渲染进程 + preload 加载、daemon 起来、CLI shim 与终端都通）。

**prd 批次 5 的 Linux 产物核对通过**：`Maintainer: chinhae <autuhae@gmail.com>`、
`Vendor: Osuna`、`Package: osuna`、`Homepage: .../LFT-OXY/Osuna#readme`。

### 重建后的最终状态（`desktop-macos-v0.8.1-beta.1` / `desktop-windows-v0.8.1-beta.1`）

- macOS **两个架构都通过**，`NODE_OPTIONS=--max-old-space-size=8192` 解决了 x64 的
  Expo 打包 OOM。
- Windows 通过 —— 之前那次确实只是 GitHub 返回 500 的瞬时故障。
- **Release 已自动从 draft 转为已发布的 prerelease**，23 个资产齐全：mac arm64/x64 的
  dmg+zip、Windows x64/arm64 的 exe+zip、Linux 的 deb/rpm/AppImage/tar.gz，以及三条
  channel manifest（`beta-mac.yml`、`beta-linux.yml`、`beta.yml`）。
- `beta-mac.yml` 内容核对无误：`version: 0.8.1-beta.1`、两架构已由
  `merge-mac-manifest.mjs` 合并、`minimumSystemVersion: 22.0.0`（macOS 13 的 Darwin
  内核版本，与 `docs/release.md` 的双版本域约定一致）、`rolloutHours: 36` 已打戳。

一个需要知道的坑：**两个单平台重建 tag 并行推会让 `finalize-rollout` 竞态**。
Windows 那跑的 finalize 先执行，此时 `beta-mac.yml` 还没上传，于是报
`Missing updater manifests: beta-mac.yml` 失败；随后 macOS 那跑的 finalize 拿到完整
三份并成功发布。最终状态正确，但那条红色是误导性的。要么串行重推，要么重推后以
Release 的实际资产为准而不是看 finalize 的结论。

### 硬发现：`android-apk-release.yml` 不在本地构建，它是 EAS 的包装

job 跑的是 `eas build --platform android --profile production-apk --wait`，然后下载产物。
Gradle 在 EAS 服务器上跑，**永远不会出现在 Actions 日志里**。两个后果：

1. 没有 `EXPO_TOKEN` 和已连接的 EAS 项目，job 直接死在
   `An Expo user account is required to proceed`。而 prd 批次 1 已删掉 `eas.json` 的
   `owner` 与 `extra.eas.projectId`，所以**本 fork 目前没有任何可用的安卓发布路径**。
2. **从票 09 并过来的那条验收无法通过这条 workflow 达成** —— 「构建日志里应出现
   `:osuna-word-stream` 等三个 Gradle 工程」需要 Gradle 真的在 runner 上跑。
   要么本地 `./gradlew assembleRelease`，要么把 workflow 改成在 runner 上构建。

**已决定：只加 CI 验证、不做安卓发布。** 把「验证改名」和「分发 APK」拆开 ——
票 09 真正要的是前者。落地归**票 13**：在 `ci.yml` 里跑不签名的 `expo prebuild` +
`gradlew` 确认 autolink，同时删掉 `android-apk-release.yml` 与 `eas.json` 的
`submit` 段。不需要 Expo 账号，也不需要 keystore。

文档（`docs/release.md`、`docs/android.md`）已按事实改正，不再声称 workflow 自己
构建 APK；票 13 落地后需再改一次，说明安卓只有 CI 验证、没有分发。

## 遗留（不属本票，需另行决定）

- `IS_SMOKE_TAG` / `gha-smoke` 不可达（见上）。要么让 `normalizeReleaseTag` 接受这类
  tag，要么把这条死路删掉。现状是一段永远不会真的保护任何东西的分支。
- `packages/website` 的去留，以及随之而来的 442 处改名。
- `.github/workflows/desktop-release.yml` 的 `setup-node` 仍带上游的
  `registry-url: npm.pkg.github.com` + `scope: "@boudra"`。全仓已无 `@boudra` 依赖，
  属无害残留，但既然不发 npm 了，这两行可以一并去掉。
