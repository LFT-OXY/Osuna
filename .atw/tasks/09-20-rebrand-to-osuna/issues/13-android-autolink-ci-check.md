# 13 — 安卓改名的 CI 验证：runner 上跑 Gradle 确认 autolink，并删掉走不通的发布路径

**What to build:** 让票 09 的原生模块改名第一次获得自动验证。票 05 的发布演练
证明现有的 `android-apk-release.yml` 做不到这件事 —— 它只是
`eas build --platform android --profile production-apk` 的包装，Gradle 跑在 EAS
服务器上，日志永远不出现在 Actions 里，而且没有 `EXPO_TOKEN` 和已连接的 EAS 项目
时直接死在 `An Expo user account is required to proceed`。

决定是把两件事拆开：**验证改名** 和 **分发 APK**。票 09 真正需要的是前者，它不需要
Expo 账号、不需要 keystore、也不需要签名。分发留作后续独立任务。

**Impl:** done
**Status:** ready-for-human

**Blocked by:** 05

## 为什么值得单独做

票 09 改了四个本地 Expo 模块，每个模块有七处彼此之间没有类型系统的站点（Gradle 工程名
来自 `package.json` 的 `name` 而不是目录名、`namespace`/`group`、Kotlin 源码路径与
`package` 声明、`expo-module.config.json` 的类清单、podspec **文件名**决定 Swift
module 名、CMake target 与 `System.loadLibrary`、JNI `METHOD` 宏前缀）。改错任何一处，
**JS 侧照样编译通过，装到设备上才崩**。详见
`.atw/spec/guides/cross-layer-thinking-guide.md` 的 Product Identity Literals。

目前这四个模块的改名**没有任何 CI 验证**：typecheck 和单测都看不见 Gradle。

## 范围

- [x] `ci.yml` 加一个安卓 job：`npx expo prebuild --platform android` +
      `./gradlew assembleRelease`（或 `assembleDebug`，够用即可）。**不签名**，
      不产出发布资产 —— 目的只是让 Gradle 真的跑一遍 autolinking。
      参考 `docs/android.md` 已有的源码构建命令；注意那里记的两条约束：
      `--no-daemon --max-workers=1 -Dorg.gradle.parallel=false`（并行会爆内存），
      以及 prebuild 和 Gradle 两步都要带同样的环境变量。
- [x] 断言构建日志里出现 `:osuna-word-stream`、`:osuna-native-trace`、
      `:osuna-diff-prototype` 三个 Gradle 工程，且**不出现任何 `:paseo-*`**。
      只有三个不是四个：`osuna-hardware-keyboard` 只有 `ios/` 目录、没有 `android/`
      （票 05 核对过）。断言要写成会失败的检查，不是靠人看日志。
- [x] 删掉 `.github/workflows/android-apk-release.yml` —— 它依赖一个不存在的 EAS
      项目，留着只会让每个 `v*` tag 多一条红叉。
- [x] 删掉 `packages/app/eas.json` 的 `submit` 段（Play 轨道 `production`、
      `releaseStatus: completed`）—— 没有商店身份，它描述的动作不可能发生。
      `build` 段的 profile 保留，是将来配发布时的起点。
- [x] `docs/android.md` 与 `docs/release.md` 再改一次：安卓只有 CI 验证、没有分发。
      票 05 已按「workflow 是 EAS 包装」的事实改过一轮，这次是按「已删除」改。
      注意 `docs/release.md#mobile-builds` 是这条事实的 owner，`docs/android.md`
      链过去而不是重述（票 05 评审在这里被判过一次 One fact, one doc）。
- [x] `npm run typecheck`、`npm run lint` 通过

## 明确不含

- **安卓分发**。没有 keystore、没有签名约定、没有商店身份，全部留给后续独立任务。
  真要做时的三条路与各自代价记在票 05 的「硬发现」一节。
- **iOS**。没有任何发布路径，也没有 CI 构建。
- **装到设备的功能回归**（word-stream 淡入、native trace、iOS 硬件键盘提交）。
  CI 给不了，需要真机或模拟器，仍是独立的后续事项。

## 风险

安卓 CI job 会明显拉长 CI 时间（Expo 源码构建要编译所有原生模块，`docs/android.md`
记了它在并行时会耗尽内存）。如果太慢，可以只在 `packages/app/modules/**` 或
`packages/app/app.config.js` 变化时触发，而不是每次 push 都跑 —— 但要注意这样一来
改名回归就只在碰到那些路径时才守得住。

## 结果

`ci.yml` 新增 `android-autolink` job：`expo prebuild --platform android --no-install` +
`./gradlew projects` + `./gradlew :app:assembleDebug -PreactNativeArchitectures=arm64-v8a`，
串行、无 daemon、不签名。断言落在 `scripts/validate-android-autolink.mjs`（5 个单测），
要求三个 `:osuna-*` 工程**既被 link 又被 compile**，且 `projects` 输出和构建日志里都
不出现 `:paseo-*`。只 link 不 compile 也判失败 —— 那说明模块没进 `:app` 的依赖图。

gating 走 `.github/ci-paths.yml` 新增的 `android` 契约（四个本地模块、config plugins、
`app.config.js`、`native-release-version.js`、`packages/app/package.json`），
并按仓库惯例由 `full` 覆盖非 PR 事件。

连带删除：`android-apk-release.yml`、`eas.json` 的 `submit` 段、
`release-version-utils.mjs` 里已无 workflow 可触发的 `android-v*` tag 前缀
（补了一条拒绝该 tag 的测试钉住）。文档按「已删除」改了 `docs/release.md#mobile-builds`
（事实 owner）、`docs/android.md`（链过去 + 新增 CI verification 节）、
`CLAUDE.md` 文档索引行、`public-docs/updates.md` 的 Mobile 段、`docs/docker.md`。

### 硬发现

1. **`| tee` 会吞掉 Gradle 的退出码。** GitHub Actions 在 Linux 上的默认 shell 是
   `bash -e`，**没有** `-o pipefail`；只有显式写 `shell: bash` 才有。两个 Gradle 步骤
   都靠这一行才能在构建失败时真的红。已在 `ci-workflow.test.mjs` 加断言钉住：
   删掉 `shell: bash` 会让契约测试失败（已实测确认非空转）。

2. **本地无法验证这个 job。** 这台机器没有 Android SDK、`mise` 未安装、只有 Java 8。
   断言脚本的解析格式（`projects` 的 `+--- Project ':x'` 树形输出、`--console=plain` 的
   `> Task :x:y`）是按 Gradle 已知输出写的单测，**没有跑过真实 Gradle**。
   NDK 版本是否在 runner 镜像上、prebuild 在 CI 环境是否干净，都只能靠第一次 CI 跑出来。

3. **网站的安卓路由是抛错，不是空链接。** `packages/website/src/server-entry.ts:93` 的
   `/android-version.txt` 调用 `latest-release.ts:149`，找不到 `osuna-<tag>-android.apk`
   资产时 `throw`。这在本票之前就已经是事实（那个 workflow 从未成功过），本票只是让它
   变成设计上的长期状态。`packages/website` 在 npm workspaces 之外、无 CI job、无域名，
   其 vitest 现在连启动都失败（Cloudflare vite 插件与 `resolve.external` 冲突），
   且 `latest-release.test.ts:20` 的 fixture 还在造 `paseo-${tag}-android.apk`
   —— 属票 12 的改名残留，不在本票范围内。

4. **成本。** `full` 对所有非 PR 事件恒为 true，所以每次 `main` push 和每次 merge queue
   入队都会跑这个源码构建。票面 风险 一节预见了这点；当前实现按仓库既有惯例走，
   若嫌贵，改法是把 job 的 `if` 从 `full` 里摘出来、只认 `android` 契约。
