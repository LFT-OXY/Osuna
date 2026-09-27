# 02 — 正式证书与 CI 签名，外加签名断言

**What to build:** 让 CI 发出的每一个 macOS 包（arm64 和 x64）都用同一张长期有效的自签名证书签名。万一签名退化成 ad-hoc 或者没签上，CI 要直接失败，不能悄悄发版。按照 01 的结论，生成有效期 30 年的正式证书，把 `.p12` 和密码存到本机 `~/.config/osuna/codesign/`；目录权限设为 700，密码文件权限设为 600。然后把证书写入仓库的 Secrets。CI 的 macOS 作业用这张证书签名，签名身份要显式指定：按 01 的结论，CI 通过 `-c.mac.sign=` 注入自定义 sign 钩子，按证书 SHA-1 指纹签名，不设钥匙串信任，钩子拿不到指纹时报错；`electron-builder.yml` 不引用这个钩子。打包完成、清单上传之前，断言 designated requirement 是基于证书的，并且签名完整性校验通过。`hardenedRuntime` 继续保持关闭，本地构建不做任何改动。同时更新发版文档里和签名相关的说明。

**Blocked by:** 01 — 本地两包互验：验证签名方案的核心假设
**Status:** ready-for-agent
**Impl:** doing

- [ ] 正式证书按约定的路径和权限存放在本机，有效期 30 年
- [ ] 执行 `gh secret set` 写入 `CSC_LINK` 和 `CSC_KEY_PASSWORD` 之前，先单独征得用户确认（这是写入外部服务的操作）
- [ ] 手动触发一次 Desktop Release，且不发布：arm64 和 x64 两个作业都完成签名，都通过 DR 断言（包含 `certificate leaf`，不是 `cdhash`）以及 `codesign --verify --deep --strict`
- [ ] 删掉 secret 之后，DR 断言会让作业失败，并且失败发生在清单上传之前。可以在分支上临时去掉注入来验证，验证完恢复
- [ ] 发版文档写明：证书存放在哪里、需要备份到云盘、证书丢失会导致所有人必须手动重装；删除「自动更新装上的新版本也不会再问」这句与事实不符的说法；更新关于 afterSign 的描述，使其与现状一致

## Comments

### 2026-09-27 进度（代码与文档完成，等证书）

已完成：
- `packages/desktop/scripts/mac-sign.js`：CI 专用 sign 钩子，按 `OSUNA_MAC_SIGNING_SHA1` 调 app-builder-lib 自带（带重试）的 `sign`；指纹非法或没有 `CSC_LINK` 导入的钥匙串时报错。
- `scripts/verify-mac-signature.mjs`（+ 单测 7 个）：校验 `release/mac*/*.app` 与每个更新 zip 用 ditto 解出的 `.app`；DR 必须是 `certificate leaf = H"<钉住的指纹>"`，出现 `cdhash`（含 ad-hoc 时 codesign 打印的 `# designated => cdhash …` 隐式 DR）即失败，另跑 `codesign --verify --deep --strict`。本机用自建 ad-hoc bundle 端到端验证过会失败。
- `desktop-release.yml`：macOS 作业注入 `CSC_LINK`/`CSC_KEY_PASSWORD` 与 `-c.mac.sign=./scripts/mac-sign.js`，构建后、任何上传前加 `Verify macOS signature`（无 `if`，publish=false 也跑）。指纹作为公开值钉在作业 env 的 `OSUNA_MAC_SIGNING_SHA1`。
- `docs/release.md` 新增「macOS 签名证书」，删掉「自动更新装上的新版本也不会再问」；`docs/testing.md` 改正 afterSign 说法（26.8.1 的 `macPackager.signApp` 恒返回 true，afterSign 在 macOS 总会执行，冒烟没跑是因为没设 `PASEO_DESKTOP_SMOKE`）；`electron-builder.yml` 过时注释已改。

与验收条目的偏差：
- 「删掉 secret 之后，DR 断言会让作业失败」——实际是构建步骤先失败（`CSC_LINK=""` 不为 null，electron-builder 照样去导入证书并报错），同样在上传前。能让**断言**失败的场景是「去掉钩子注入」（退回 ad-hoc / 不签名），验证按本票括号里的做法走这条。
- 「上传前失败」限于单个架构作业：矩阵 `fail-fast: false`，另一架构仍会把产物传到草稿 Release，但收尾作业不会转正。

证书与 secret（用户在自己终端生成证书；Safety Net 关闭后由 agent 核对并写 secret）：
- 正式证书 `CN=Osuna Code Signing, O=Osuna`，RSA 3072，有效期至 2056-09-27，SHA-1 指纹 `41:B3:6E:DD:C9:E9:15:B7:A4:57:C0:A0:86:73:AC:5D:F0:DA:F7:7B`。`~/.config/osuna/codesign/` 权限 700，`.p12` / `.p12.password` / `.pem` 权限 600，无残留私钥文件；`.p12` 内证书指纹与 `.pem` 一致，用途为 Code Signing。云盘备份由用户自行同步。
- 用户确认后 `gh secret set` 写入 `CSC_LINK`（`.p12` 的单行 base64）与 `CSC_KEY_PASSWORD`。

审查（atw-code-review，两轴）已处理：文档去重（冒烟事实归 `docs/testing.md`）、脚本只在 CLI 边界校验指纹、去掉边界后的 `??`、命名与 Density。保留未改：`mac-sign.js` 深引用 `app-builder-lib/out/codeSign/macCodeSign`（依赖提升 + electron-builder 钉在 26.8.1，升级时需复核）；指纹格式校验在 CJS 钩子与 ESM 脚本各有一份；`verifyMacRelease` 的产物发现逻辑只有端到端手测，没有单测（需要 codesign，只能在 macOS 上跑）。
