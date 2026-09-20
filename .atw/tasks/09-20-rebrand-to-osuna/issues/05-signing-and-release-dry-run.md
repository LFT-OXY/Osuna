# 05 — 签名配置与发布演练：去公证、改 workflow、推测试 tag 走一遍 Release

**What to build:** 在没有 Apple 开发者账号的前提下让桌面发布链路真正跑通，并用一次
真实的 GitHub Release 验证前四票的成果。不采用「有 secrets 才签名」的条件化方案：
那会让同一条发布流程在有无 secret 时产出行为不同的包，差异只在用户装不上时才暴露。

**Impl:** ready
**Status:** ready-for-agent

**Blocked by:** 08

- [ ] `packages/desktop/electron-builder.yml`：去掉 `notarize: true`、
      `hardenedRuntime: true` 与 `entitlements` / `entitlementsInherit` 两行；
      相应清理 `scripts/after-sign.js` 里已无意义的公证逻辑
- [ ] `.github/workflows/desktop-release.yml:157-161`：去掉 `CSC_LINK`、`APPLE_ID`、
      `APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID` 四个 secrets 引用
- [ ] `README.md` 写明 macOS 首次打开需右键→打开（未签名包会被 Gatekeeper 拦下）
- [ ] `docs/release.md` 更新为本 fork 的实际发布路径：只发桌面，GitHub Release
      承载更新；移动端上架与 F-Droid 相关段落删除或标注为后续任务
- [ ] 验收：推一个测试 tag，CI 产出可下载的 mac/win/linux 包；本地装上后应用名为
      Osuna，且 electron-updater 能从 `LFT-OXY/Osuna` 的 Release 识别到版本
- [ ] **验收（从票 09 并过来）**：同一个 tag 会触发 `android-apk-release.yml`
      （触发条件 `v*` / `android-v*`）。确认这一跑产出 APK，且票 09 改名后的四个原生模块
      被 autolink 到位 —— 构建日志里应出现 `:osuna-word-stream`、`:osuna-native-trace`、
      `:osuna-diff-prototype` 三个 Gradle 工程，不应出现任何 `:paseo-*`。
      并过来的理由：09 的这项验收本来就需要一次 tag 构建，而推 tag 是本票的动作，
      为它单独搭一套安卓工具链不划算。**装到设备确认功能可用（word-stream 淡入、
      native trace、iOS 硬件键盘提交）CI 给不了，仍需一台真机或模拟器**，那部分不在
      本票，留给后续的设备回归。
- [ ] `npm run typecheck`、`npm run lint` 通过
