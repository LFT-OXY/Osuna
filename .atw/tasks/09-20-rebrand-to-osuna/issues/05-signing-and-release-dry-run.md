# 05 — 签名配置与发布演练：去公证、改 workflow、推测试 tag 走一遍 Release

**What to build:** 在没有 Apple 开发者账号的前提下让桌面发布链路真正跑通，并用一次
真实的 GitHub Release 验证前四票的成果。不采用「有 secrets 才签名」的条件化方案：
那会让同一条发布流程在有无 secret 时产出行为不同的包，差异只在用户装不上时才暴露。

**Impl:** ready
**Status:** ready-for-agent

**Blocked by:** 04

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
- [ ] `npm run typecheck`、`npm run lint` 通过
