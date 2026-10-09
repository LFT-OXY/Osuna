# 01 — 安卓构建路径：EAS 云构建 vs GitHub Actions 裸跑 gradle

**Type:** research
**Blocked by:** None
**Status:** resolved

## Question

Osuna 安卓包只做 GitHub Release APK 侧载，判断标准是零成本优先、除非 B 的坑多到不可靠。对比两条路并给出推荐：

A. 注册自己的 Expo 账号、新建 EAS 项目，沿用 `.github/workflows/android-apk-release.yml` 的 EAS 云构建（`production-apk` profile，见 `packages/app/eas.json`）。查清：免费档每月构建次数与并发、排队等待、单次构建时长上限、产物保留期、是否要求绑卡、`owner` / `projectId` 字段换成自己的影响。

B. 在 GitHub Actions 里跑 `npx expo prebuild --platform android` + `./gradlew assembleRelease`，不依赖 EAS。查清：本仓库 `packages/app` 的原生依赖（`expo-two-way-audio` 本地包、`react-native-unistyles`、`expo-audio` 等）在裸 prebuild 下的已知坑；JDK / NDK / SDK 版本要求与 ubuntu runner 的匹配；`app.config.js` 里 `eas.projectId` 与 `owner` 不填会不会报错；签名 keystore 如何通过 Secrets 注入 gradle；一次构建大约多少分钟（GitHub 免费 2000 分钟/月够不够）。

两条路都要回答：改 applicationId 为 `com.chinhae.osuna` 后，与上游 `sh.paseo` 是两个独立应用，用户侧没有升级路径——这是否可接受（Osuna 从未发过安卓包，预期可接受，请确认没有遗漏的坑）。

产出 `research/android-build-path.md`：对比表 + 推荐 + 推荐路径的最小工作流骨架。

## Answer

- **推荐 B：GitHub Actions 裸跑 `expo prebuild --platform android --clean --no-install` + `./gradlew :app:assembleRelease`。** 仓库公开，标准 runner 免费不限分钟（2000 分钟/月只约束私有仓库）。
- A 在本仓库有硬伤：免费档不能用 `large` resourceClass，而 `production-apk` 正依赖它；退回 medium（4 vCPU/16 GB）与 GitHub `ubuntu-latest` 同规格，还要受 15 次/月、低优先级排队（高峰 90+ 分钟）、45 分钟超时约束。
- B 的坑都是一次性配置：JDK 用 21；runner 预装 build-tools 36 / platform 36 / CMake，NDK 27.3 与 RN 钉的 27.1 不一致由 AGP 自动补装；14 GB 磁盘偏紧；内存按 `docs/android.md` 经验用 `--no-daemon --max-workers=2` 起步。
- prebuild 前必须复刻 `eas-build-post-install`（`build:app-deps` + `build:terminal-webview`）；`owner` / `extra.eas.projectId` 删掉不报错，但别把上游 projectId 打进包。
- 签名：Expo 模板 release 默认用 debug keystore，需新增 config plugin 注入 `signingConfigs.release`，keystore 走 Secrets base64（名单沿用 09 号票）。
- 包名改 `com.chinhae.osuna`：与 `sh.paseo` 为两个独立应用、无升级路径，Osuna 未发过安卓包，可接受；必须同票把 `scheme` 改为 `osuna://`，否则两 App 共存时抢深链。
- 副产品：推送链依赖 Expo 项目 + FCM 凭据，两条路都收不到推送，需产品层单独决定。
- 未实测：单次构建时长（推算 30–60 分钟）、磁盘余量、Hermes exit 137 是否复现。
- 详见 `research/android-build-path.md`（对比表、来源 URL、工作流 YAML 骨架、配套改动清单）。
