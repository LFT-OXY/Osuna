# 01 — 本地两包互验：验证签名方案的核心假设

**What to build:** 在改动 CI 之前，先在本机证明 ADR 0001 的两条核心假设。第一条：electron-builder 能用一张自签名证书签出桌面包，而且签名结果不会回退成 ad-hoc。第二条：同一张证书签出的新包，能够满足旧包的 designated requirement；换一张证书签出的包则会被拒绝。实验只用临时钥匙串和一次性证书，不碰 login 钥匙串，也不生成正式证书。结论写进本票的 Comments，要附上可以原样复现的命令。如果任何一条假设被推翻，就停在这里，回到 ADR 0001 重新讨论。

**Blocked by:** None — can start immediately
**Status:** ready-for-agent
**Impl:** ready

- [ ] 一次性自签 code signing 证书只存在于临时钥匙串或 scratchpad 中，实验结束后清理干净，login 钥匙串没有任何变化
- [ ] 用 electron-builder 通过 `CSC_LINK` 并显式指定签名身份，签出两个内容不同的 macOS 包。`codesign -d -r-` 显示两个包的 designated requirement 都包含 `certificate leaf`，没有出现 `cdhash`
- [ ] 以包 A 的 designated requirement 作为要求，对包 B 执行 `codesign --verify --deep --strict -R=<DR>`，结果通过
- [ ] 换另一张一次性证书签出包 C，按同样的方式校验，结果被拒绝
- [ ] 记录 electron-builder 在什么条件下会把自签证书认作有效身份：是否需要在钥匙串里设置信任、需要哪些参数。这条记录是 02 的输入
- [ ] 结论与复现命令记在本票的 Comments 里
