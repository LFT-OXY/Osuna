# 10 — 离线配对链接为 null：`appBaseUrl` 留空的连带后果没有收尾

**What to build:** 决定「没有配置 app base URL 时，`osuna daemon pair` 应该给出什么」，
然后让代码与测试一致。现在两者矛盾：代码返回 `url: null`，测试断言 `url` 里含 `offer=`。

**Impl:** ready
**Status:** ready-for-agent

**Blocked by:** None — 与改名的其余批次无依赖

## 这不是来历不明的遗留，是批次 1 的连带后果

`git log -S` 定位到 `62d0e9a52 refactor(server)!: relay 与 app 地址不再默认指向上游`：

- `packages/server/src/server/config.ts:552` 现在是
  `appBaseUrl: env.OSUNA_APP_BASE_URL ?? persisted.app?.baseUrl ?? null`，
  改名前这里兜底到上游的 app 地址。
- `packages/server/src/server/pairing-offer.ts:37,52` 把这个值直接交给
  `encodeOfferToFragmentUrl({ offer, appBaseUrl })`，没有 base URL 就产不出链接。

prd 对「留空」这条决定写得很清楚，理由也成立（「指向一个不存在的域名比报错更难排查」）。
**缺的是这条决定的下游收尾**：配对链接是这个值唯一的真实消费方，它从「总是有链接」变成了
「可能没有链接」，而没有任何一处承接这个新状态。

## 现在的失败

`packages/cli/src/commands/daemon/pair.test.ts:19`

```
AssertionError: the given combination of arguments (null and string) is invalid
for this assertion.
  17|  const offer = await resolveLocalPairingOffer({ paseoHome: home, enableRelay: true });
  19|  expect(offer.url).toContain("offer=");
```

在 clean tree 上复现一致（已用 `git stash` 验证过，与票 08 的改动无关）。
它在 `npm test` 的默认路径里，也就是说**仓库当前的全量测试是红的**。

## 需要先做的决定（不要机械改测试）

把断言改成 `toBeNull()` 是最省事的做法，但那会把一个**产品行为问题**记录成「测试期望更新」。
真正要回答的是：一个刚装好、没配 `OSUNA_APP_BASE_URL` 的用户跑 `osuna daemon pair`，
应该得到什么？三个方向，取舍不同：

- **A. 承认 `url: null` 是正常状态**，让 CLI 在没有链接时输出可操作的替代路径
  （二维码、裸 offer 串、或者「设置 `OSUNA_APP_BASE_URL` 后重试」），测试跟着改。
  代价：配对这条新手路径上多一个岔口。
- **B. 让它明确报错**，与 prd 对 relay/Hub 的口径一致（「要求显式配置」而不是静默降级）。
  代价：没配 app 地址就完全配不了对，即使本地 app 能手工粘 offer。
- **C. 给 app base URL 一个本仓库自己的默认值**。**与 prd 冲突**，除非先有域名，
  不建议，列出仅为完整。

选 A 或 B 都要同步 `packages/cli/src/commands/onboard.ts:282,295` —— 它是
`resolveLocalPairingOffer` 的另一个调用方，同样没处理 `url` 为 null。

## 范围

- [ ] 定方向（A / B），记进 prd 的相应位置
- [ ] 改 `pair.ts` / `onboard.ts` 的行为，让 `url: null` 有明确承接
- [ ] 改 `pair.test.ts` 的断言以匹配选定行为，并补一个「未配置 app base URL」的用例
- [ ] 验收：`npx vitest run packages/cli/src/commands/daemon/pair.test.ts`，单文件 `--bail=1`
- [ ] 验收：手工跑一次 `osuna daemon pair`，确认没配 `OSUNA_APP_BASE_URL` 时的输出是可操作的
- [ ] `npm run typecheck`、`npm run lint` 通过
