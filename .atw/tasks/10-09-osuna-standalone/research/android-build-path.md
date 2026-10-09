# 安卓构建路径：EAS 云构建 vs GitHub Actions 裸跑 prebuild + gradle

对应工单：`map-issues/01-android-build-path.md`。调研日期 2026-10-09。判断标准来自 `research/interview-decisions.md` Q10：零成本优先，除非 B 的坑多到不可靠。

## 结论

**推荐 B：GitHub Actions 裸跑 `expo prebuild` + `gradlew assembleRelease`。**

- 仓库是公开仓库（`gh repo view LFT-OXY/Osuna` → `PUBLIC`），标准 GitHub 托管 runner 对公开仓库免费且不限分钟，2000 分钟/月的限额只针对私有仓库。
- A 的免费档在本仓库上有一个硬伤：`eas.json` 的 `production-apk` profile 用 `resourceClass: "large"`，而官方文档明文 "The `large` resource class is not available on the free plan"。退回 `medium`（4 vCPU / 16 GB）后，`docs/android.md` 记录过的 Hermes 打包 exit 137 风险就回来了——而 GitHub `ubuntu-latest` 恰好也是 4 vCPU / 16 GB。两条路在内存上是同一档，A 并没有用钱换到更稳。
- A 还要承担：每月 15 次安卓构建上限、低优先级队列（高峰可排 90 分钟以上）、45 分钟单次超时、注册新 Expo 账号与项目。B 没有这些外部配额。
- B 的"坑"经核查主要是环境匹配（JDK / NDK / 磁盘 / 内存）和签名注入，都是一次性配置；EAS 自己在 worker 上跑的也是同一条 `expo prebuild`（`eas.json` 文档：build engine 自动给 prebuild 加 `--platform` 和 `--non-interactive`），原生依赖层面 A、B 没有差别。

## 仓库现状（本地事实）

| 事实 | 位置 |
| --- | --- |
| 现有工作流走 EAS `production-apk`，仅 `workflow_dispatch`，依赖上游 `EXPO_TOKEN` | `.github/workflows/android-apk-release.yml` |
| `production-apk` profile：`resourceClass: large`、`buildType: apk`、`gradleCommand: :app:assembleRelease -x lint -x lintVitalAnalyzeRelease -x lintVitalRelease -x generateReleaseLintModel -x generateReleaseLintVitalModel` | `packages/app/eas.json` |
| EAS 构建前置钩子 `eas-build-post-install` = `npm --prefix ../.. run build:app-deps && npm run build:terminal-webview`；B 必须在 prebuild 前手动复刻这两步 | `packages/app/package.json` |
| `build:app-deps` = highlight + client + plugin + `expo-two-way-audio` 的 `tsc` 构建 | 根 `package.json` |
| `owner: "getpaseo"`、`extra.eas.projectId` 为上游值、`slug: "voice-mobile"`、`scheme: "paseo"`、包名 `sh.paseo` / `sh.paseo.debug` | `packages/app/app.config.js` |
| `expo-build-properties`：`minSdkVersion 29`、`kotlinVersion 2.1.20`；`expo-gradle-jvmargs`：`-Xmx4096m -XX:MaxMetaspaceSize=1024m` | `packages/app/app.config.js` |
| 本地原生模块 `@getpaseo/expo-two-way-audio`：标准 Expo Module（`expo-module.config.json` + `android/build.gradle` 用 `ExpoModulesCorePlugin`），`compileSdk` 由根项目 `safeExtGet` 覆盖；无特殊 NDK 需求 | `packages/expo-two-way-audio/` |
| 已有 F-Droid 源码构建配方：`PASEO_FDROID_BUILD=1 expo prebuild` + `./gradlew assembleRelease --no-daemon --max-workers=1`，并提示 medium worker 可能把 Hermes 打成 exit 137 | `docs/android.md` |
| 推送 token 走 Expo 推送服务：App 侧 `getExpoPushTokenAsync({ projectId })`，缺 projectId 只 `console.warn`；daemon 侧 POST `https://exp.host/--/api/v2/push/send` | `packages/app/src/push-notifications/internal/subscriptions.ts`、`packages/server/src/server/push/push-service.ts` |
| 缺 `googleServicesFile` 时 prebuild 不会注入 `com.google.gms.google-services` 插件，构建照常 | `node_modules/@expo/config-plugins/build/android/GoogleServices.js:111-126` |
| 工具链默认值：RN 0.81.5 `compileSdk 36 / targetSdk 36 / buildTools 36.0.0 / ndk 27.1.12297006`；expo-modules-core 默认 `compileSdk 36 / minSdk 24` | `node_modules/react-native/gradle/libs.versions.toml`、`node_modules/expo-modules-core/android/ExpoModulesCorePlugin.gradle` |
| 上游 `getpaseo/paseo` 的 Android APK Release 工作流最近 8 次全部成功，墙钟 25–35 分钟（含 EAS 排队 + large worker 构建 + 下载上传） | `gh run list -R getpaseo/paseo -w "Android APK Release"` |
| 根 `node_modules` 2.4 GB | `du -sh node_modules` |

## 对比表

| 维度 | A：EAS 云构建（免费档） | B：GitHub Actions 裸跑 | 来源 |
| --- | --- | --- | --- |
| 金钱成本 | $0；无需绑卡（Free 档注册页只要邮箱，绑卡只在 Upgrade 的 Checkout 步骤出现） | $0（公开仓库标准 runner 免费、不限分钟） | [expo.dev/pricing](https://expo.dev/pricing)、[docs.expo.dev/billing/manage](https://docs.expo.dev/billing/manage)、[GitHub Actions 计费](https://docs.github.com/en/billing/concepts/product-billing/github-actions) |
| 每月次数 | 15 次 Android + 15 次 iOS；用完即停到下月 1 日，不会产生超额费用 | 无上限（公开仓库）；私有仓库才是 2000 分钟/月 + 500 MB 产物存储 | [expo.dev/pricing](https://expo.dev/pricing)、[billing/faq](https://docs.expo.dev/billing/faq/)、[GitHub Actions 计费](https://docs.github.com/en/billing/concepts/product-billing/github-actions) |
| 并发 | 1 | 公开仓库标准 runner 并发限制宽松，本需求单 job 足够 | [expo.dev/pricing](https://expo.dev/pricing) |
| 排队 | 低优先级队列；高峰"90+ 分钟"等待，Expo 自己的 FYI 说北美工作日中段"经常一小时以上" | 一般几十秒内起 runner | [expo.dev/pricing](https://expo.dev/pricing)、[expo/fyi eas-build-queues](https://github.com/expo/fyi/blob/main/eas-build-queues.md) |
| 单次时长上限 | 45 分钟（付费档 2 小时） | 6 小时/job | [expo.dev/pricing](https://expo.dev/pricing)、[GitHub Actions limits](https://docs.github.com/en/actions/reference/limits) |
| 机器规格 | Free 档只能 `medium`：4 vCPU / 16 GB，`GRADLE_OPTS -Xmx4g`；`large`（8 vCPU / 32 GB）付费档专属 | `ubuntu-latest`：4 vCPU / 16 GB / 14 GB SSD | [EAS infrastructure](https://docs.expo.dev/build-reference/infrastructure/)、[eas.json 字段](https://docs.expo.dev/eas/json/)、[GitHub-hosted runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners) |
| 产物保留 | 官方安全页："logs and artifacts are stored for up to 90 days"；eas-cli issue 引用的控制台文案是"only for 30 days"。本工作流在同一 job 内立刻下载并挂到 GitHub Release，保留期无关紧要 | 直接上传 Release 资产，不经 Actions artifact | [expo.dev/security](https://expo.dev/security)、[eas-cli#2919](https://github.com/expo/eas-cli/issues/2919) |
| 账号与密钥 | 需注册 Expo 账号、`eas init` 新建项目、把 `EXPO_TOKEN` 存 Secrets；keystore 可托管在 EAS | 只需 GitHub Secrets（keystore base64 + 三个口令） | [local-app-production](https://docs.expo.dev/guides/local-app-production/) |
| 对现有 `eas.json` 的改动 | `production-apk` 必须去掉 `resourceClass: large` 否则免费档直接拒绝 | `eas.json` 不再被引用，可删 | [eas.json 字段](https://docs.expo.dev/eas/json/) |
| 原生依赖风险 | EAS 在 worker 上跑同一条 `expo prebuild`，再 gradle | 同上，差别只在 JDK/NDK/SDK 由 runner 镜像提供 | [eas.json 字段 `prebuildCommand`](https://docs.expo.dev/eas/json/) |
| 对外依赖 | 依赖 Expo 服务可用性与免费政策（2023-08 起才开始严格执行免费限额，政策可变） | 依赖 GitHub Actions | [Expo changelog 2023-08-01](https://expo.dev/changelog/2023-08-01-eas-free-plan-limits) |

## A 路径细节

必须改的配置：

1. `packages/app/app.config.js`：`owner` 改为自己的 Expo 用户名（文档："If not provided, the owner defaults to the username of the current user"，所以也可以直接删掉）；`extra.eas.projectId` 改为 `eas init` 生成的新值；`slug` 建议改 `osuna`。projectId 不换会把构建提交到上游 getpaseo 的项目下，`eas build` 会因无权限失败。
2. `packages/app/eas.json`：`production` 与 `production-apk` 删除 `resourceClass: "large"`。免费档拿不到 large。
3. Secrets：`EXPO_TOKEN`。

免费档的实际约束叠加本仓库：

- `medium` worker 与 `-Xmx4g` 配合本项目（全 ABI + Hermes 打包同一 Gradle 调用），`docs/android.md` 明确记录会触 exit 137。EAS 会以 `GRADLE_OPTS` 注入 JVM 参数，而本项目 `expo-gradle-jvmargs` 写入 `gradle.properties` 的 `-Xmx4096m`，二者等价，不构成额外加成。
- 45 分钟超时：上游用 large 的墙钟（含排队）是 25–35 分钟；换 medium 大约慢一倍以内，有撞 45 分钟线的可能，撞线即白耗一次配额。
- 15 次/月对"发版才构建"够用，但调试工作流本身（第一次通常要试 3–5 次）就会吃掉三分之一。

## B 路径细节：逐项核查

### 1. runner 环境与工具链匹配

`ubuntu-latest`（Ubuntu 24.04）预装（来源：[actions/runner-images Ubuntu2404-Readme](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md)）：

| 项 | runner 预装 | 本项目需要 | 结论 |
| --- | --- | --- | --- |
| JDK | 8 / 11 / 17（默认）/ 21 / 25，`JAVA_HOME_21_X64` 可直接用 | `.tool-versions` 钉 `java 21`；RN 0.81 要求 JDK 17+ | 用 `actions/setup-java` 选 temurin 21 与本地一致，或直接 `JAVA_HOME=$JAVA_HOME_21_X64` |
| Android SDK Platforms | android-34 … android-37 | compileSdk 36 | 已有 |
| Build-tools | 34.0.0 / 35.x / 36.0.0 / 36.1.0 / 37.0.0 | 36.0.0 | 已有 |
| NDK | 27.3.13750724（默认）/ 28.2 / 29.0 | RN 0.81.5 钉 `27.1.12297006` | **版本不完全一致**。AGP 会按 `ndkVersion` 通过 sdkmanager 自动补装（runner 的 `ANDROID_HOME` 可写、许可已接受），代价是首次多下载约 1 GB。如想省时间，可用 `expo-build-properties` 的 `android.ndkVersion` 钉到 `27.3.13750724`（Nitro 只要求 NDK ≥ 27），但这偏离 RN 官方默认，建议先不钉、让它自动下载，看耗时再决定 |
| CMake | 3.31.5 / 4.1.2 | Nitro / 新架构 C++ 构建 | 已有 |
| 磁盘 | 14 GB | `node_modules` 2.4 GB + Gradle 缓存 + NDK + 构建中间物 | **紧**。先跑一次看剩余；不够时在 job 开头删 runner 预装的 .NET / Haskell / CodeQL 等（常规做法） |
| 内存 | 16 GB | 与 EAS medium 相同 | 延续 `docs/android.md` 的保守做法：`--no-daemon --max-workers=2`（F-Droid 配方用 1，4 核 runner 可放到 2 试试）。Hermes 若仍 137，退回 `--max-workers=1` |

### 2. 原生依赖在裸 prebuild 下的已知坑

- **`@getpaseo/expo-two-way-audio`（本地 workspace 包）**：Expo autolinking 靠 `app.config.js` 的 `autolinking.searchPaths: ["../../node_modules", "./node_modules"]` 找到它；它的 `main` 指向 `build/index.js`，所以 **prebuild/gradle 之前必须先跑 `npm run build:app-deps`**，否则 Metro 打包阶段找不到 JS 入口。这正是 `eas-build-post-install` 钩子在 EAS 上替你做的事，B 要显式复刻。
- **`react-native-unistyles` 3.x**：要求新架构（本项目 `newArchEnabled: true`）、Expo SDK 53+、依赖 `react-native-nitro-modules`；Nitro 对安卓的要求是 `compileSdk ≥ 34`、`ndk ≥ 27`，均满足。来源：[Unistyles getting started](https://www.unistyl.es/v3/start/getting-started)、[Nitro minimum requirements](https://nitro.margelo.com/docs/getting-started/minimum-requirements)。
- **`expo-audio`、`expo-camera`、`expo-notifications`、`react-native-skia`、`keyboard-controller` 等**：均为 npm 发行的标准模块，SDK 53 起安卓默认使用预编译的 Expo 模块 AAR，减少源码编译量（来源：[Precompiled Expo Modules](https://docs.expo.dev/guides/prebuilt-expo-modules/)）。F-Droid 配方特意反向开启 `buildFromSource: [".*"]` 是为了满足 F-Droid 的可复现要求，侧载 APK 不需要，保持默认即可。
- **`expo-notifications` 没有 `google-services.json`**：`@expo/config-plugins` 的 `setClassPath` / `applyPlugin` 在 `googleServicesFile` 为空时直接返回，不会引入 `com.google.gms.google-services`，构建不受影响。运行时后果见第 5 条。
- **`expo prebuild` 的副作用**：它默认会执行 `npm install` 同步依赖，CI 里加 `--no-install` 跳过；`--non-interactive` 不在 `expo prebuild --help` 列表里，但 Expo CLI 在 `CI=1` 下自动非交互，EAS 也是这样加的，保留无害。`packages/app/android` 已在 `.gitignore`，每次 `--clean` 重新生成。
- **Lint 任务**：`eas.json` 里 `-x lint -x lintVitalAnalyzeRelease -x lintVitalRelease -x generateReleaseLintModel -x generateReleaseLintVitalModel` 是上游为省时间/避坑加的，B 原样带上。

### 3. `eas.projectId` / `owner` 不填会不会报错

- `expo prebuild` 与 gradle 不读取 `owner` 和 `extra.eas.projectId`，缺省不报错。Expo 文档对 `owner` 的定义是 EAS 账号归属，纯本地构建不涉及。
- `expo-constants` 会把 `extra` 原样打进包，App 侧 `getExpoProjectId()` 拿不到值时只 `console.warn("[PushNotifications] Missing EAS projectId...")`，不会崩。
- 建议 B 路径直接删掉 `owner` 与 `extra.eas`，避免把上游 projectId 打进 Osuna 包（否则 App 会拿上游 projectId 去 Expo 推送服务申请 token，这是在拿别人的项目 ID 做事）。

### 4. 签名 keystore 通过 Secrets 注入

`expo prebuild` 生成的 `android/app/build.gradle` 中 release 变体默认 `signingConfig signingConfigs.debug`（来源：[expo-template-bare-minimum sdk-54 分支 `android/app/build.gradle` 第 100–115 行](https://github.com/expo/expo/blob/sdk-54/templates/expo-template-bare-minimum/android/app/build.gradle)），所以必须注入 release `signingConfig`。两种做法：

- **推荐：仓库内 config plugin**（`packages/app/plugins/` 已有 `with-android-profileable.js` 等先例）：用 `withAppBuildGradle` 在存在 `OSUNA_ANDROID_KEYSTORE_PATH` 等环境变量时写入 `signingConfigs.release { storeFile file(System.getenv("…")) … }` 并把 `buildTypes.release.signingConfig` 指过去。优点：无 sed、与 F-Droid 插件风格一致、本地也能用同一套变量出正式签名包。
- 备选：按 React Native 官方文档把 `MYAPP_UPLOAD_STORE_FILE` 等写进 `android/gradle.properties` 再 sed `build.gradle`（来源：[reactnative.dev signed-apk-android](https://reactnative.dev/docs/signed-apk-android)）。prebuild 每次重生成文件，sed 脆弱，不推荐。

Secrets 名单沿用 09 号工单草案：`ANDROID_KEYSTORE_BASE64`、`ANDROID_KEYSTORE_PASSWORD`、`ANDROID_KEY_ALIAS`、`ANDROID_KEY_PASSWORD`。工作流里 `base64 -d` 到 `$RUNNER_TEMP`，路径通过环境变量交给 gradle，不落进 `android/` 目录以免被任何缓存/上传步骤带走。

### 5. 推送通知（两条路共同的隐含问题）

Paseo 的推送链是 App → Expo 推送服务拿 `ExponentPushToken` → daemon POST `exp.host/--/api/v2/push/send`。这条链需要：Expo 项目（projectId）+ 在该 Expo 项目上配置 FCM V1 凭据（即 Firebase 项目 + `google-services.json`）。

- B 路径没有 Expo 项目，推送天然不可用；App 已有 warn 兜底不会崩。
- A 路径即便有 Expo 项目，没有 Firebase 凭据同样收不到推送。
- 这是产品范围问题，不是构建路径问题：建议在 PRD 中单独决定"1.0.0 安卓包不支持推送"或"另开一票接 Firebase"。本工单不替它做决定。

### 6. 一次构建大约多少分钟

没有本仓库在 GitHub runner 上的实测数据，只有参照：

- 上游在 EAS large（8 vCPU）上的墙钟 25–35 分钟，其中含排队、`npm ci`、`build:app-deps`、prebuild、gradle、下载上传。
- GitHub 4 vCPU 对比 large 8 vCPU，gradle 原生编译阶段大致慢 1.5–2 倍；预编译 Expo 模块、单 job 顺序执行、首次 NDK 下载各自再加几分钟。
- 保守估计 **30–60 分钟/次**。公开仓库不计分钟，6 小时 job 上限远未触及；即便将来转私有，2000 分钟/月也够每月 30 次以上。
- 第一次落地时在 workflow 加 `timeout-minutes: 90` 并记录实际耗时，之后收紧。

## applicationId 改为 `com.chinhae.osuna` 的影响确认

Android 官方：application ID 唯一标识设备上与商店里的应用；改了就是另一个应用，升级必须同 ID + 同签名证书（来源：[developer.android.com configure-app-module](https://developer.android.com/build/configure-app-module)）。对 Osuna 的具体后果：

- **没有从 `sh.paseo` 升级的路径，这是预期且可接受的**：Osuna 从未发布过安卓包；上游 Paseo App 与 Osuna App 可以同机共存，互不读写数据。
- **必须一起改的东西**（否则两 App 共存时打架）：
  - `scheme: "paseo"` → `osuna`。两个 App 若都注册 `paseo://`，Android 打开配对链接时会弹选择器甚至落到上游 App。Q4 已决定改 `osuna://`，这里只是确认它与包名改动必须同一票落地。
  - `name`、`android.package`、`ios.bundleIdentifier`（`com.chinhae.osuna` / `com.chinhae.osuna.debug`）在 `app.config.js` 的 `variants` 表里一处改完；Kotlin 包路径、`namespace`、`MainActivity` 由 prebuild 按包名重新生成，不需要手改原生代码。
  - 产物文件名 `paseo-${TAG}-android.apk` → `osuna-…`；Release 标题 `Paseo $TAG` → `Osuna`。
- **签名密钥是第二个"不可变身份"**：APK 一旦有人安装，后续更新必须用同一 keystore 签名，丢失即所有侧载用户只能卸载重装。09 号工单要把 keystore 备份与 SHA-256 指纹写进 `docs/release.md`，这里确认其必要性。
- **与 Google Services 的耦合**：`google-services.json` 内含 `package_name`，将来若接 Firebase，必须用 `com.chinhae.osuna` 重新生成，不能复用上游文件。
- **侧载 UX**：Android 会提示"未知来源应用"与 Play Protect 对未知开发者的警告，这是所有非商店 APK 的通病，与包名无关；下载页需写明安装步骤。
- **版本号**：`versionCode` 由 `native-release-version.js` 从 `package.json` 推导，1.0.0 → `1000000`，与上游 `sh.paseo` 的号段无需协调（不同 applicationId 各自独立）。
- **未发现其他坑**：`fastlane/metadata/android/` 是按 locale 组织的商店文案，不含包名；`eas.json` 的 `submit` 段（`ascAppId`、Play track）在 B 路径下整体废弃。

## 推荐路径的最小工作流骨架

替换 `.github/workflows/android-apk-release.yml` 的 `publish-android-apk` job（`ensure-release` job 保留，仅把 `Paseo` 字样改掉）：

```yaml
  publish-android-apk:
    needs: [ensure-release]
    permissions:
      contents: write
    runs-on: ubuntu-latest
    timeout-minutes: 90          # 首次落地后按实测收紧
    env:
      CI: "1"
      APP_VARIANT: production
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
          ref: ${{ github.event_name == 'workflow_dispatch' && github.event.inputs.tag || github.ref }}

      - name: Resolve release tag
        run: node scripts/emit-release-env.mjs --source-tag "$SOURCE_TAG" >> "$GITHUB_ENV"

      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: "npm"

      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: "21"       # 与 .tool-versions 一致

      - name: Install JS dependencies
        run: node scripts/npm-retry.mjs ci

      # 复刻 eas-build-post-install：本地 workspace 包与终端 WebView 必须先构建
      - name: Build app dependencies
        run: |
          npm run build:app-deps
          npm --prefix packages/app run build:terminal-webview

      - name: Decode release keystore
        env:
          ANDROID_KEYSTORE_BASE64: ${{ secrets.ANDROID_KEYSTORE_BASE64 }}
        run: |
          echo "$ANDROID_KEYSTORE_BASE64" | base64 -d > "$RUNNER_TEMP/osuna-release.keystore"
          echo "OSUNA_ANDROID_KEYSTORE_PATH=$RUNNER_TEMP/osuna-release.keystore" >> "$GITHUB_ENV"

      - name: Expo prebuild (Android)
        working-directory: packages/app
        run: npx expo prebuild --platform android --clean --no-install

      - name: Gradle assembleRelease
        working-directory: packages/app/android
        env:
          OSUNA_ANDROID_KEYSTORE_PASSWORD: ${{ secrets.ANDROID_KEYSTORE_PASSWORD }}
          OSUNA_ANDROID_KEY_ALIAS: ${{ secrets.ANDROID_KEY_ALIAS }}
          OSUNA_ANDROID_KEY_PASSWORD: ${{ secrets.ANDROID_KEY_PASSWORD }}
        run: |
          ./gradlew :app:assembleRelease \
            -x lint -x lintVitalAnalyzeRelease -x lintVitalRelease \
            -x generateReleaseLintModel -x generateReleaseLintVitalModel \
            --no-daemon --max-workers=2

      - name: Upload APK to GitHub Release
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          asset="$RUNNER_TEMP/osuna-${RELEASE_TAG}-android.apk"
          cp packages/app/android/app/build/outputs/apk/release/app-release.apk "$asset"
          release_lookup="$(node scripts/github-release.mjs --repo "${{ github.repository }}" --tag "$RELEASE_TAG")"
          gh release upload "$release_lookup" "$asset" --clobber --repo "${{ github.repository }}"
```

配套改动（实现票范围，这里只列清单）：

1. 新增 `packages/app/plugins/with-android-release-signing.js`：读取 `OSUNA_ANDROID_KEYSTORE_PATH / _PASSWORD / KEY_ALIAS / KEY_PASSWORD`，存在时向 `app/build.gradle` 写 `signingConfigs.release` 并指给 `buildTypes.release`；缺任一变量则不动（本地 debug 流程不受影响）。在 `app.config.js` 的 `plugins` 中挂上。
2. `app.config.js`：删 `owner` 与 `extra.eas`；`slug` 改 `osuna`（与改名票合并）。
3. 删除 `packages/app/eas.json` 与 `eas-cli` devDependency、`eas-build-post-install` 脚本（B 路径不再有调用方）。`docs/android.md` 的"Cloud build + submit (EAS)"一节改写为 GitHub Actions 流程。
4. 磁盘不够时在 `Install JS dependencies` 之前加一步清理 runner 预装大件（`/usr/share/dotnet`、`/opt/ghc`、`/usr/local/lib/android/sdk/ndk` 之外的无关目录等）。

## 未解决 / 不确定

- **实际构建时长与磁盘余量**没有实测，上面的 30–60 分钟与"14 GB 可能紧"都是推算。第一次跑出来之前，不要把 `timeout-minutes` 收紧，也不要预先加磁盘清理步骤。
- **Hermes exit 137 在 GitHub 4 核 / 16 GB 上是否复现**不确定；`--max-workers=2` 是折中起点，复现就降到 1。
- **NDK 27.1 自动下载**依赖 AGP 在 runner 上能通过 sdkmanager 拉取；若被禁或太慢，用 `expo-build-properties` 的 `android.ndkVersion` 钉到预装的 `27.3.13750724`。
- **推送通知在 1.0.0 安卓包的去留**需要产品决定（见第 5 条），与构建路径无关但会被用户感知。
- EAS 产物保留期官方口径（90 天 vs 30 天）不一致，对本方案无影响，未再深究。
