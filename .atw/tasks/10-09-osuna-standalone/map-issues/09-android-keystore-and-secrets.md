# 09 — 安卓签名 keystore 与仓库 Secrets

**Type:** task
**Blocked by:** 01
**Status:** resolved

## Question

按 01 号票选定的构建路径，准备安卓签名材料（HITL：私钥由用户生成并保管）：

- 若走 GitHub Actions 裸跑 gradle：用户本机 `keytool` 生成 `osuna-release.keystore`（alias、密码），base64 后存 Secrets `ANDROID_KEYSTORE_BASE64`、`ANDROID_KEYSTORE_PASSWORD`、`ANDROID_KEY_ALIAS`、`ANDROID_KEY_PASSWORD`；原件与密码放本机 `~/.config/osuna/android/`（权限 700/600，与 mac 签名材料同一套存放约定，见 `docs/release.md`）。
- 若走 EAS：注册 Expo 账号、创建项目、把 `EXPO_TOKEN` 存 Secrets，keystore 交 EAS 托管或本地生成后上传。

## Answer 要记录的事实

keystore 存放位置、alias、Secrets 名单、SHA-256 指纹（写进 `docs/release.md` 供用户校验 APK）。

## Answer

**已完成（2026-10-09），走 01 号票选定的 GitHub Actions 路径，不注册 Expo。**

- **keystore**：`~/.config/osuna/android/osuna-release.keystore`，PKCS12，RSA 4096，
  SHA384withRSA，DN `CN=Osuna Release, O=chinhae, C=CN`，有效期 10950 天（2026-10-09 → 2056-10-01）。
  用 JDK 17 的 keytool 生成（本机默认 JDK 8 的 keytool 对 PKCS12 支持不全）。
- **alias**：`osuna-release`。
- **口令**：`~/.config/osuna/android/osuna-release.keystore.password`（48 位 hex，`openssl rand -hex 24`）。
  PKCS12 不支持 store 与 key 两套口令，所以 `ANDROID_KEY_PASSWORD` 与 `ANDROID_KEYSTORE_PASSWORD` 值相同；
  两个 Secret 都写了，gradle `signingConfigs` 两个字段都要填。
- **公开证书**：`~/.config/osuna/android/osuna-release.pem`。目录 700、文件 600，布局与 `codesign/` 一致。
- **Secrets（LFT-OXY/Osuna）**：`ANDROID_KEYSTORE_BASE64`（单行 base64，已做解码往返校验 sha256 一致）、
  `ANDROID_KEYSTORE_PASSWORD`、`ANDROID_KEY_ALIAS`、`ANDROID_KEY_PASSWORD`。未新增 `EXPO_TOKEN`。
- **指纹**：
  SHA-256 `39:16:AF:AB:5B:A3:EB:34:BF:71:58:43:30:0A:30:42:BC:A9:86:07:9E:8D:33:D0:38:D6:C5:C1:78:63:4E:A9`，
  SHA-1 `B5:B8:41:13:5F:61:C1:17:27:91:E7:08:A0:88:01:59:BC:73:B3:77`。
  已写进 `docs/release.md` 的「安卓签名 keystore」一节（与 macOS 签名证书并列），含用户校验命令。
- **留给用户的手工步骤（HITL）**：把 `~/.config/osuna/android/` 同步到云盘。Secrets 读不出来，不算备份。
- **留给 spec 的实现事实**：工作流 `base64 -d` 到 `$RUNNER_TEMP`，通过 `OSUNA_ANDROID_KEYSTORE_PATH /
  _PASSWORD / KEY_ALIAS / KEY_PASSWORD` 环境变量交给新增的 config plugin
  `with-android-release-signing.js`（见 `research/android-build-path.md` 第 4 节与工作流骨架）。
  CI 工作流重接线的前置条件至此全部就绪。
