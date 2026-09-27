# 02 — 正式证书与 CI 签名，外加签名断言

**What to build:** 让 CI 发出的每一个 macOS 包（arm64 和 x64）都用同一张长期有效的自签名证书签名。万一签名退化成 ad-hoc 或者没签上，CI 要直接失败，不能悄悄发版。按照 01 的结论，生成有效期 30 年的正式证书，把 `.p12` 和密码存到本机 `~/.config/osuna/codesign/`；目录权限设为 700，密码文件权限设为 600。然后把证书写入仓库的 Secrets。CI 的 macOS 作业用这张证书签名，签名身份要显式指定：按 01 的结论，CI 通过 `-c.mac.sign=` 注入自定义 sign 钩子，按证书 SHA-1 指纹签名，不设钥匙串信任，钩子拿不到指纹时报错；`electron-builder.yml` 不引用这个钩子。打包完成、清单上传之前，断言 designated requirement 是基于证书的，并且签名完整性校验通过。`hardenedRuntime` 继续保持关闭，本地构建不做任何改动。同时更新发版文档里和签名相关的说明。

**Blocked by:** 01 — 本地两包互验：验证签名方案的核心假设
**Status:** ready-for-agent
**Impl:** ready

- [ ] 正式证书按约定的路径和权限存放在本机，有效期 30 年
- [ ] 执行 `gh secret set` 写入 `CSC_LINK` 和 `CSC_KEY_PASSWORD` 之前，先单独征得用户确认（这是写入外部服务的操作）
- [ ] 手动触发一次 Desktop Release，且不发布：arm64 和 x64 两个作业都完成签名，都通过 DR 断言（包含 `certificate leaf`，不是 `cdhash`）以及 `codesign --verify --deep --strict`
- [ ] 删掉 secret 之后，DR 断言会让作业失败，并且失败发生在清单上传之前。可以在分支上临时去掉注入来验证，验证完恢复
- [ ] 发版文档写明：证书存放在哪里、需要备份到云盘、证书丢失会导致所有人必须手动重装；删除「自动更新装上的新版本也不会再问」这句与事实不符的说法；更新关于 afterSign 的描述，使其与现状一致
