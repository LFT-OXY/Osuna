# 10 — 安卓 GitHub Actions 构建与签名

**What to build:** 维护者给一个标签跑一次工作流，就能在 GitHub Release 上拿到用 Osuna 自己的 keystore 签名的 `osuna-<tag>-android.apk`，零成本、不依赖 EAS；安卓用户能用文档里的指纹校验包（spec 决策 G，骨架见 `research/android-build-path.md`）。

**Blocked by:** 02, 04
**Status:** ready-for-agent
**Impl:** done

- [x] `android-apk-release.yml` 的发布 job 改为 ubuntu-latest 上 `expo prebuild --platform android --clean --no-install` + gradle `assembleRelease`：JDK 21、prebuild 前构建 app 依赖与终端 WebView、跳过 lint 任务、`--no-daemon --max-workers=2`、磁盘不够先清 runner 预装大件；`ensure-release` job 只改字样
- [x] 新增 config plugin：从 `OSUNA_ANDROID_KEYSTORE_PATH / _PASSWORD / KEY_ALIAS / KEY_PASSWORD` 读取并注入 `signingConfigs.release`，缺任一变量则不改 gradle（本地 debug 流程不受影响）；工作流从 Secret `ANDROID_KEYSTORE_BASE64` 解码到 `$RUNNER_TEMP`，四个 Secrets 名与 09 号地图票一致
- [x] 应用配置删 `owner` 与 `extra.eas`；删 `eas.json`、`eas-cli` 依赖与 post-install 脚本；不把上游 projectId 打进包
- [ ] 产物命名 `osuna-<tag>-android.apk` 并上传到对应 Release；`timeout-minutes` 首次跑通后按实测收紧
- [x] `docs/android.md` 的 EAS 云构建一节改写为 GitHub Actions 流程，注明 APK 无推送但桌面通知与应用内提醒照旧
- [ ] CI：在测试标签上 workflow_dispatch 跑通，`apksigner verify --print-certs` 的 SHA-256 等于 `docs/release.md` 记录值；运行时行为（首次连主机不弹权限）免验收，以依赖删除为准
