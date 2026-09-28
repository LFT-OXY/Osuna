# 01 — 本地两包互验：验证签名方案的核心假设

**What to build:** 在改动 CI 之前，先在本机证明 ADR 0001 的两条核心假设。第一条：electron-builder 能用一张自签名证书签出桌面包，而且签名结果不会回退成 ad-hoc。第二条：同一张证书签出的新包，能够满足旧包的 designated requirement；换一张证书签出的包则会被拒绝。实验只用临时钥匙串和一次性证书，不碰 login 钥匙串，也不生成正式证书。结论写进本票的 Comments，要附上可以原样复现的命令。如果任何一条假设被推翻，就停在这里，回到 ADR 0001 重新讨论。

**Blocked by:** None — can start immediately
**Status:** ready-for-agent
**Impl:** done

- [x] 一次性自签 code signing 证书只存在于临时钥匙串或 scratchpad 中，实验结束后清理干净，login 钥匙串没有任何变化
- [x] 用 electron-builder 通过 `CSC_LINK` 并显式指定签名身份，签出两个内容不同的 macOS 包。`codesign -d -r-` 显示两个包的 designated requirement 都包含 `certificate leaf`，没有出现 `cdhash`
- [x] 以包 A 的 designated requirement 作为要求，对包 B 执行 `codesign --verify --deep --strict -R=<DR>`，结果通过
- [x] 换另一张一次性证书签出包 C，按同样的方式校验，结果被拒绝
- [x] 记录 electron-builder 在什么条件下会把自签证书认作有效身份：是否需要在钥匙串里设置信任、需要哪些参数。这条记录是 02 的输入
- [x] 结论与复现命令记在本票的 Comments 里

## Comments

### 2026-09-27 实验结论（electron-builder 26.8.1、@electron/osx-sign 1.3.3、Electron 44.2.0、macOS 26 / arm64）

**第二条假设（同证书互验通过、异证书被拒）成立。第一条假设（electron-builder 能用自签证书签出且不回退 ad-hoc）只在 PRD 没写过的路径下成立：按 PRD 写的 `identity` / `CSC_NAME` 显式指定、不设信任时，会静默退回 ad-hoc；改用自定义 `mac.sign` 钩子才成立；PRD 提到的「必要时在临时钥匙串里设置信任」这条路未实测。走哪条路交用户决定后再进入 02。**

| 包 | 证书 | 内容 | designated requirement | 以包 A 的 DR 校验 |
|---|---|---|---|---|
| A | 一次性证书 A | 1.0.0 | `identifier "com.chinhae.osuna.drexp" and certificate leaf = H"28f2…591b"` | —（自身 `--deep --strict` 通过） |
| B | 一次性证书 A | 1.0.1，`main.js` 不同 | 与 A 相同 | **通过**（exit 0，`explicit requirement satisfied`） |
| C | 一次性证书 B | 1.0.1 | `… certificate leaf = H"5a1b…c883"` | **拒绝**（exit 3，`failed to satisfy specified code requirement(s)`） |
| 对照 | 证书 A 经默认流程 | 1.0.0 | `cdhash H"a4a3…"`（退回了 ad-hoc） | **拒绝**（exit 3） |

三个签名包各自的 `codesign --verify --deep --strict` 都通过。DR 里同时绑了 `identifier`（即 appId），所以 appId 改动与证书更换一样会断更新链，与 PRD「不可逆的点」一致。

说明：
- 实验用的是最小 Electron 工程，签名配置与桌面端一致（`hardenedRuntime: false`、同一对 entitlements 文件），不是完整的 Osuna 包；只签了 arm64。真实包（原生模块、`bin/paseo` shim）和 x64 的签名结果由 02 的 CI 断言验证。
- `codesign --verify --deep --strict -R` 对应 Squirrel.Mac 的 `kSecCSCheckNestedCode | kSecCSStrictValidate`；`kSecCSCheckAllArchitectures` 在单架构包上没有被真正考验。
- 互验时两张证书都不在用户钥匙串搜索列表里（electron-builder 的临时钥匙串已删除，探测用钥匙串未加入搜索列表），与用户机器上「本机没有这张证书」的情形一致：校验只依赖签名里内嵌的证书链。

**给 02 的输入：electron-builder 何时把自签证书认作有效身份**

1. **不设信任时，自签证书不是有效身份**（PRD 里「自签证书不一定被列为有效」应改为「不设信任就一定无效」）。 导入后 `security find-identity -p codesigning` 显示 `CSSMERR_TP_NOT_TRUSTED`，`-v` 下 0 个有效身份。electron-builder 只从 `find-identity -v` 的结果里挑身份（`codeSign/macCodeSign.js` `getValidIdentities`），所以即使给了 `CSC_LINK` + `CSC_NAME`，也找不到身份：arm64 **静默退回 ad-hoc**（只打一条 warn，构建成功，DR 为 `cdhash`）；按源码 x64 会直接不签名。这就是 02 必须加 DR 断言的原因。
2. **`codesign` 本身不要求信任。** 只要证书所在钥匙串在用户搜索列表里，`codesign -s <SHA-1 指纹>` 就能签出 `certificate leaf` 型 DR；钥匙串不在搜索列表里时报 `no identity found`（`--keychain` 参数不够）。
3. **推荐做法：自定义 `mac.sign` 钩子，不设信任。** 配了 `sign` 钩子后，`macPackager.js` 里 `noIdentity = !options.sign && identity == null` 为 false，不再退回 ad-hoc，而是把 `CSC_LINK` 导入的临时钥匙串（`opts.keychain`，已被加入搜索列表）交给钩子。钩子调用 `@electron/osx-sign` 的 `signAsync({ ...opts, identity: <SHA-1 指纹>, identityValidation: false })` 即可。需要的参数：`CSC_LINK`、`CSC_KEY_PASSWORD`、指纹（实验里用 `EXP_IDENTITY` 环境变量传入）。
4. **设信任（`security add-trusted-cert … -p codeSign`）这条路未实测。** 用户域需要图形授权，管理员域需要 sudo，都要改系统信任设置，本地实验没有走；方案 3 已经足够，02 不需要它。
5. **钩子必须在拿不到身份时报错。** 配了钩子后 electron-builder 不再兜底，钩子若静默跳过就会出未签名包。另外钩子写进 `electron-builder.yml` 会影响本地构建（PRD 要求本地构建保持不签名），若选钩子路线，只在 CI 通过 `-c.mac.sign=` 注入，本地配置不变。
6. **时间戳很慢。** osx-sign 默认对每个文件加 `--timestamp`，每个文件都要请求 Apple 时间戳服务器；最小工程一个包约 5 分钟，真实包文件更多，CI 超时要留余量。自签证书拿时间戳没有问题（`codesign -dvv` 显示 `Timestamp=`）。
7. **electron-builder 会永久改用户钥匙串搜索列表。** 它把自带的 `electron-builder-root-certs.keychain` 加进 `list-keychains -d user` 且不移除（`bundledCertKeychainAdded`）。CI 无所谓，本地跑时要记得还原。

**清理结果：** 临时钥匙串已 `delete-keychain`，electron-builder 的临时钥匙串由它自己删除；搜索列表已还原。与实验前基线对照：用户搜索列表、login 钥匙串证书列表、用户域信任设置全部一致，`find-certificate -c "Osuna DR Experiment"` 无结果。一次性证书、`.p12` 和构建产物所在目录已整体删除。

**复现命令**（在仓库根目录执行，只需改第一行 `W=`，指向任意一次性目录。在装了 CC Safety Net 的 agent 会话里跑时，要先把该目录加进 secret_protection 的 allow_paths，并把脚本里所有 `$W` 展开成字面路径，因为钩子按命令文本匹配、看不到变量的值；人在自己的终端里跑则不受影响。Electron 本体仍会下载到 `~/Library/Caches/electron`，这是共享缓存，不属于实验残留）：

```bash
W=/path/to/throwaway-dir; mkdir -p $W/app $W/eb-cache $W/eb-tmp
security list-keychains -d user > $W/search-list.before
security find-certificate -a -Z ~/Library/Keychains/login.keychain-db | grep SHA-1 | sort > $W/login-certs.before
security dump-trust-settings > $W/trust.before 2>&1

# 1. 两张一次性自签证书（macOS 的 security 读不了 OpenSSL 3 默认的 p12 加密，必须用 SHA1-3DES）
for L in A B; do
  openssl req -x509 -newkey rsa:2048 -nodes -days 30 -config <(printf '[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=Osuna DR Experiment %s\n[ext]\nbasicConstraints=critical,CA:false\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=critical,codeSigning\nsubjectKeyIdentifier=hash\n' $L) -keyout $W/cert$L.key -out $W/cert$L.pem
  openssl pkcs12 -export -certpbe PBE-SHA1-3DES -keypbe PBE-SHA1-3DES -macalg sha1 -inkey $W/cert$L.key -in $W/cert$L.pem -name "Osuna DR Experiment $L" -passout pass:exp-pass -out $W/cert$L.p12
  rm $W/cert$L.key
done
FP_A=$(openssl x509 -in $W/certA.pem -noout -fingerprint -sha1 | cut -d= -f2 | tr -d :)
FP_B=$(openssl x509 -in $W/certB.pem -noout -fingerprint -sha1 | cut -d= -f2 | tr -d :)

# 2. 最小 Electron 工程，签名配置与桌面端一致
cd $W/app
echo '{ "name": "osuna-dr-exp", "version": "1.0.0", "main": "main.js", "description": "x", "author": "x" }' > package.json
echo 'require("electron").app.whenReady().then(() => { console.log("dr-exp"); require("electron").app.quit(); });' > main.js
cat > builder.yml <<YML
appId: com.chinhae.osuna.drexp
productName: OsunaDrExp
electronVersion: 44.2.0
npmRebuild: false
mac:
  hardenedRuntime: false
  notarize: false
  entitlements: $OLDPWD/packages/desktop/build/entitlements.mac.plist
  entitlementsInherit: $OLDPWD/packages/desktop/build/entitlements.mac.inherit.plist
  target: dir
YML
cat > sign-hook.js <<JS
const { signAsync } = require("$OLDPWD/node_modules/@electron/osx-sign");
exports.default = async function sign(opts) {
  const identity = process.env.EXP_IDENTITY;
  if (!identity) throw new Error("EXP_IDENTITY 未设置");
  await signAsync({ ...opts, identity, identityValidation: false });
};
JS
EB=$OLDPWD/node_modules/electron-builder/cli.js
export CSC_KEY_PASSWORD=exp-pass APP_BUILDER_TMP_DIR=$W/eb-tmp ELECTRON_BUILDER_CACHE=$W/eb-cache

# 3. 对照：默认流程（不设信任）→ 退回 ad-hoc
CSC_LINK=$W/certA.p12 CSC_NAME="Osuna DR Experiment A" node $EB --mac --arm64 -c builder.yml -c.directories.output=out-notrust
# 4. A、B（证书 A，内容不同）与 C（证书 B），走 sign 钩子
CSC_LINK=$W/certA.p12 EXP_IDENTITY=$FP_A node $EB --mac --arm64 -c builder.yml -c.directories.output=out-A -c.mac.sign=./sign-hook.js -c.extraMetadata.version=1.0.0
sed -i '' 's/"dr-exp"/"dr-exp-B"/' main.js
CSC_LINK=$W/certA.p12 EXP_IDENTITY=$FP_A node $EB --mac --arm64 -c builder.yml -c.directories.output=out-B -c.mac.sign=./sign-hook.js -c.extraMetadata.version=1.0.1
CSC_LINK=$W/certB.p12 EXP_IDENTITY=$FP_B node $EB --mac --arm64 -c builder.yml -c.directories.output=out-C -c.mac.sign=./sign-hook.js -c.extraMetadata.version=1.0.1

# 5. 互验（-R 与要求文本分成两个参数，文本以 = 开头表示内联要求）
for x in notrust A B C; do codesign -d -r- out-$x/mac-arm64/OsunaDrExp.app 2>&1 | grep designated; done
DR_A=$(codesign -d -r- out-A/mac-arm64/OsunaDrExp.app 2>&1 | sed -n 's/^designated => //p')
for x in B C notrust; do codesign --verify --deep --strict -v -R "=$DR_A" out-$x/mac-arm64/OsunaDrExp.app; echo "$x exit=$?"; done
# 预期：B exit=0；C、notrust exit=3

# 6. 清理并对照基线
security list-keychains -d user -s $(sed 's/"//g' $W/search-list.before)
diff <(security list-keychains -d user) $W/search-list.before && echo "search list restored"
diff <(security find-certificate -a -Z ~/Library/Keychains/login.keychain-db | grep SHA-1 | sort) $W/login-certs.before && echo "login keychain unchanged"
diff <(security dump-trust-settings 2>&1) $W/trust.before && echo "trust settings unchanged"
cd / && rm -rf $W
```

### 2026-09-27 决定（用户确认）

- 02 走自定义 `mac.sign` 钩子路线：按证书 SHA-1 指纹签名，不设钥匙串信任；钩子只在 CI 用 `-c.mac.sign=` 注入，`electron-builder.yml` 不引用。PRD「macOS 签名」一节已同步改写。
- 以 PRD 为准：本地构建不签名。ADR 0001 原文「local and CI 都签名」已改为只在 CI 签名。
