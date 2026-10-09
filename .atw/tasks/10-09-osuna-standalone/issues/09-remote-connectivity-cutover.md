# 09 — 远程连接切换到 chinhae.cc

**What to build:** 远程使用者在 1.0.0 里扫到的配对二维码打开 `osuna-app.chinhae.cc`，中继默认走 `osuna-relay.chinhae.cc` 并自动 TLS；推 main 后网页端、中继、官网由三个 deploy 工作流部署到 Osuna 自己的 Cloudflare 账号（spec 决策 D，基建已就位）。

**Blocked by:** 04
**Status:** ready-for-agent
**Impl:** ready

- [ ] daemon 默认中继端点 `osuna-relay.chinhae.cc:443`、默认网页端基址 `https://osuna-app.chinhae.cc`，TLS 判定随默认端点生效；配对 offer URL 指向新网页端；config 与 relay 配置的现有测试改为断言新默认值
- [ ] 中继的 cutover 代理分支及其测试删除（Osuna 没有上游要代理）
- [ ] 官网站点主机改 `https://osuna.chinhae.cc`，canonical URL 测试随改
- [ ] `deploy-app` / `deploy-relay` / `deploy-website` 改读 Variable `CLOUDFLARE_ACCOUNT_ID` 与 Secret `CLOUDFLARE_API_TOKEN`，项目名 `osuna-app` / `osuna-relay` / `osuna-website`，`--workspace` 名随改名
- [ ] pair-device-relay e2e 断言 offer URL 落在 `osuna-app.chinhae.cc`
- [ ] 推 main 后 `osuna-relay.chinhae.cc/health` 200，`osuna-app.chinhae.cc` 与 `osuna.chinhae.cc` 可访问（内容由后续票换皮）
