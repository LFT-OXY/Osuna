const { sign } = require("app-builder-lib/out/codeSign/macCodeSign");

// 只由 CI 用 `-c.mac.sign=./scripts/mac-sign.js` 注入，electron-builder.yml 不引用它，
// 本地构建因此保持不签名（ADR 0001）。
//
// 自签证书在钥匙串里不受信任，electron-builder 的身份查找（`find-identity -v`）必然
// 找不到它：arm64 会静默退回 ad-hoc，x64 直接不签名。配了本钩子后 electron-builder
// 不再兜底，而是把 CSC_LINK 导入的临时钥匙串交过来，这里按证书的 SHA-1 指纹显式签名。
// 钩子拿不到指纹或钥匙串时必须报错，否则会出一个未签名的包。
exports.default = async function macSign(opts) {
  const identity = (process.env.OSUNA_MAC_SIGNING_SHA1 ?? "").replaceAll(":", "").trim();
  if (!/^[0-9A-Fa-f]{40}$/.test(identity)) {
    throw new Error(
      "OSUNA_MAC_SIGNING_SHA1 must be the SHA-1 fingerprint of the Osuna signing certificate",
    );
  }
  if (!opts.keychain) {
    throw new Error("No signing keychain: CSC_LINK and CSC_KEY_PASSWORD must be set");
  }
  // 复用 electron-builder 自己的 sign：它带重试，能扛住 Apple 时间戳服务的偶发失败。
  await sign({ ...opts, identity, identityValidation: false });
};
