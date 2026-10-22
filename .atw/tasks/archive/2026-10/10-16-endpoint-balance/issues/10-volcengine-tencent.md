# 10 — 火山方舟与腾讯云的套餐窗口

**What to build:** 火山方舟 Coding Plan（`ark.<region>.volces.com` 的 `/api/coding` 或 `/api/plan`）与腾讯云 Token Plan 企业版（`tokenhub(-intl).tencentmaas.com/plan`）的接口，用户在「高级」里填 AccessKey ID / Secret Access Key 或 SecretId / SecretKey 后，详情分区显示窗口；没填时分区写「需要 AccessKey」，按钮打开编辑窗口的这两栏。

**Blocked by:** 08, 06
**Status:** ready-for-agent
**Impl:** done

- [x] 新机密（两组云账号密钥）沿用 06 的存法：只在 daemon、打码、可读回、复制可沿用；两栏只在对应地址时出现。
- [x] 火山：POST `https://open.volcengineapi.com/?Action=…&Version=2024-01-01`，正文 `{}`，HMAC-SHA256 签名（签名头与 scope 同官方 SDK）；session / weekly / monthly 窗口。腾讯：POST `tokenhub.tencentcloudapi.com`，Version 2026-03-22，先列套餐再按团队查，TC3-HMAC-SHA256；一个月窗口。都写 Osuna User-Agent。
- [x] 两种签名是纯函数，用两家官方文档的示例向量做单元测试。
- [x] 401、403 或认证类错误码追加「检查 AK/SK 与权限」。
- [x] 端到端测试：本机假开放平台验证签名头、地址与正文，返回窗口；没填密钥时「需要 AccessKey」；回复与日志里没有密钥原文。测试 daemon 把两家开放平台地址注入成本机地址。
- [x] `docs/usage.md` 写进两家开放平台地址、所带签名、什么时候发；`docs/data-model.md` 写进新机密。
- [x] 9 种语言的新文字齐全。
- [x] UI：详情分区 / 需要 AccessKey 与有窗口 / 1280 与 390 — 按钮不是蓝色链接。

参考：prd 第 6、18 条，用户故事 41–43、65。

实现时凡本工单没写明的细节，先查 magpie `7597c132` 的做法并照做（出处见 `research/decisions.md`）；比 magpie 少做或更严一律不行，除非 prd 写明。
