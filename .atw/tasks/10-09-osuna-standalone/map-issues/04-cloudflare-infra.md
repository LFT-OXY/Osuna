# 04 — Cloudflare 基建：三个子域、Pages 项目、中继 Worker、Secrets

**Type:** task
**Blocked by:** None
**Status:** resolved

## Question

在用户的 Cloudflare 账号（托管 `chinhae.cc`）上准备远程连接与官网所需的基建。域名与别的东西共用，全部一级子域：官网 `osuna.chinhae.cc`、网页端 `osuna-app.chinhae.cc`、中继 `osuna-relay.chinhae.cc`。

HITL 清单（账号操作由用户做，命令与配置由本票给出）：

1. 账号信息：Account ID；创建一个 API Token，权限至少 Workers Scripts:Edit、Workers Routes:Edit、Pages:Edit、DNS:Edit、Durable Objects（中继用 `RelayDurableObject`，SQLite 存储）。确认免费计划是否允许 Durable Objects + SQLite（2025 年起免费档可用，请核实当前政策）。
2. 中继：`packages/relay/wrangler.toml` 的 `name` 改 `osuna-relay`、`account_id` 换成自己的、`routes` 改 `osuna-relay.chinhae.cc`（custom_domain）、删掉 `PASEO_RELAY_UPSTREAM`（那是上游迁移期的 cutover 代理，Osuna 不需要）。首次 `wrangler deploy` 由用户在本机登录后执行一次，之后走 CI。
3. 网页端：Cloudflare Pages 新建项目 `osuna-app`，绑定自定义域 `osuna-app.chinhae.cc`；`packages/app/package.json` 的 `deploy:web` 项目名随之改。
4. 官网：`packages/website` 用 `@cloudflare/vite-plugin` + `wrangler deploy` 作为 Worker 部署，绑定 `osuna.chinhae.cc`。
5. 仓库 Secrets：`CLOUDFLARE_API_TOKEN`；Account ID 从工作流硬编码改为 Secret 或 vars。

## Answer 要记录的事实

Account ID 放哪、Token 权限、三个域名的 DNS 记录类型、Durable Objects 免费档结论、首次部署是否成功及中继健康检查地址。

## Answer

**已完成（2026-10-09 10:33，Asia/Shanghai）。三个域名的基建全部就位，1.0.0 发布前置条件之一解除。**

- **账号**：Account ID `96459747319960a0cfc67a31d35e830f`，zone `chinhae.cc`（zone id `d84df9bfbbda457d559cc890ab6a34a8`，Cloudflare 注册，DNS 完全托管）。账号已有另一个 Worker `oxy-ip`（`ip.chinhae.cc`），免费档每天 10 万次请求与它合计。
- **Token**：模板「编辑 Cloudflare Workers」+ `Account · Cloudflare Pages · Edit` + `Zone · DNS · Edit`，Zone 限 `chinhae.cc`。原件在本机 `~/.config/osuna/cloudflare/api-token`（700/600）。新格式令牌以 `ccfut_` 开头、53 位；终端 `read -s` 粘贴会掺入 ESC 字节并丢字符，必须 `pbpaste >` 直写文件。
- **中继**：`osuna-relay` 已部署，自定义域 `osuna-relay.chinhae.cc`（Cloudflare 自动建了 `AAAA 100::` 代理记录），`https://osuna-relay.chinhae.cc/health` → `{"status":"ok"}`。DO `RelayDurableObject`（SQLite 类、无存储调用）在免费档可用。`packages/relay/wrangler.toml` 已改（名字、账号、路由，删 `PASEO_RELAY_UPSTREAM`）。
- **网页端**：Pages 项目 `osuna-app`（`osuna-app.pages.dev`），自定义域 `osuna-app.chinhae.cc` 通过 API 绑定；API 绑定不会自动建 CNAME，已手动建 `CNAME osuna-app → osuna-app.pages.dev`（代理）。验证 active，证书 pending（自动完成）。未部署内容。`packages/app/package.json` 的 `deploy:web` 项目名已改为 `osuna-app`。
- **官网**：KV namespace `WEBSITE_CACHE` id `191b7caebaa942dfbc49383669f7b7cc`。`packages/website/wrangler.toml` 已改为 `osuna-website` / 本账号 / 路由 `osuna.chinhae.cc` / 新 KV id。未部署；首次 `wrangler deploy` 会自动绑域名，`osuna.chinhae.cc` 当前无 DNS 记录，保持为空。wrangler 4.105 的 `kv namespace create` 报 Authentication error 而直接调 API 成功，原因未查，CI 里不依赖该命令。
- **GitHub**：Secret `CLOUDFLARE_API_TOKEN`、Variable `CLOUDFLARE_ACCOUNT_ID` 已写入 `LFT-OXY/Osuna`。决定：Account ID 用 Variable 不用 Secret（`wrangler.toml` 已明文、仓库公开）。
- **免费档结论**：DO 只允许 SQLite 后端，已满足；硬限 Workers 10 万请求/天（账号级）、DO 10 万请求/天 + 13,000 GB-s/天；每条入站 WebSocket 消息计一次 DO 请求。个人/小团队够用，1.0.0 后看一周用量再定是否升 Paid（$5/月）。

**留给 spec 的事项**：
- daemon 默认值 `relay.paseo.sh:443` / `https://app.paseo.sh`（`packages/server/src/server/config.ts:31-32`、`pairing-offer.ts:34-38`）改为 `osuna-relay.chinhae.cc:443` / `https://osuna-app.chinhae.cc`；TLS 判定 `endpoint === DEFAULT_RELAY_ENDPOINT` 随之生效。
- `packages/relay/src/cutover-proxy.ts` 及其测试、`cloudflare-adapter.ts:577-579` 的 `PASEO_RELAY_UPSTREAM` 分支删除。
- `packages/website/vite.config.ts` 的 `siteHost = "https://paseo.sh"` 改 `https://osuna.chinhae.cc`。
- `docs/architecture.md:174` 与 `docs/release.md:280` 说"Cloudflare 中继是 legacy、生产用 Elixir 中继"，Osuna 的生产中继就是这个 Worker，两段改写。
- 三个部署工作流的触发、`CLOUDFLARE_ACCOUNT_ID` 改读 `vars`、`--workspace` 名随改名走（见地图 Not yet specified「CI 工作流重接线」）。

## Comments

### 2026-10-09 AFK 核查与 HITL 清单（已认领，等用户做账号操作后结票）

**仓库现状（本地事实）**

| 事实 | 位置 |
| --- | --- |
| 中继 Worker：`name = "paseo-relay"`，`account_id` 为上游账号，`routes = relay.paseo.sh`（custom_domain），`[vars] PASEO_RELAY_UPSTREAM` 指向 Fly，DO 绑定 `RELAY` → `RelayDurableObject`，迁移 `new_sqlite_classes` | `packages/relay/wrangler.toml` |
| Worker 入口：`env.PASEO_RELAY_UPSTREAM` 存在时整站代理到上游，否则自己服务 `/health`（返回 `{"status":"ok"}`）与 `/ws?serverId=…&v=1|2`；DO 用 `acceptWebSocket` / `webSocketMessage`（Hibernation API），**没有任何 `state.storage` 调用**，是无存储 DO | `packages/relay/src/cloudflare-adapter.ts:575-614`、`:322`、`:373`、`:448` |
| 网页端：`deploy:web` = `expo export` 后 `wrangler pages deploy dist --project-name paseo-app --branch main`；CI 把 `CLOUDFLARE_ACCOUNT_ID` 硬编码为上游账号 | `packages/app/package.json:37`、`.github/workflows/deploy-app.yml` |
| 官网 Worker：`name = "paseo-website"`，`routes = paseo.sh + www.paseo.sh`，绑定 KV `WEBSITE_CACHE`（上游 namespace id）；代码里 KV 缺失时回退 `null`，不会崩，只是每次请求都直打 GitHub API | `packages/website/wrangler.toml`、`packages/website/src/cloudflare-cache.ts` |
| daemon 默认值：`relay.paseo.sh:443`、`https://app.paseo.sh`，可被 `PASEO_RELAY_ENDPOINT` / `PASEO_APP_BASE_URL` 覆盖；TLS 判定 `endpoint === DEFAULT_RELAY_ENDPOINT` | `packages/server/src/server/config.ts:31-32,302-314`、`pairing-offer.ts:34-38` |
| 文档现状：`docs/architecture.md:174` 与 `docs/release.md:280` 说"Cloudflare 中继是 legacy、生产用 Elixir 中继（getpaseo/paseo-relay）"。Osuna 没有 Elixir 中继，Cloudflare Worker 就是生产中继，这两段要在 spec 里改写 | — |

**Cloudflare 免费档结论（2026-10-09 官方文档）**

- Durable Objects 在 Workers Free 可用，**只允许 SQLite 后端**；本仓库迁移已是 `new_sqlite_classes`，直接可用。中继 DO 不写存储，5 GB 账号存储 / 行读写配额与我们无关。来源：developers.cloudflare.com/durable-objects/platform/pricing、…/limits。
- 免费档硬限：Workers 请求 **10 万次/天**（账号级，所有 Worker 共享，含 Pages Functions）；DO 请求 **10 万次/天**、DO 时长 **13,000 GB-s/天**；单次 Worker CPU 10 ms。超限当天直接报错（Error 1027），00:00 UTC 重置。
- 中继流量怎么计：每条 WebSocket 建连算 Worker 1 次请求 + DO 1 次请求；**每条入站 WebSocket 消息算 DO 请求**（文档只说计费按 20:1 折算，免费档是否同样折算未明说，按最坏 1:1 估）；出站消息与协议 ping 不计。DO 用了 Hibernation API，空闲时不计时长；活跃时按 128 MB 计，13,000 GB-s ≈ 每天 29 小时活跃 DO 时间。
- 结论：**个人 / 小团队远程使用在免费档内**。风险点是消息数：一次长的 agent 会话走中继可能有数千条入站消息，若多人全天挂着远程，10 万/天会碰到。建议 1.0.0 发布后在 Cloudflare 面板看一周用量再决定是否升 Workers Paid（$5/月，1000 万请求）。
- `chinhae.cc` 与别的东西共用：若该账号已有其他 Worker，10 万/天是**合计**。请在清单第 0 步确认。
- Pages：静态资源请求免费不限量；`wrangler pages deploy` 直传不计入 500 次/月构建额度。Pages 自定义子域要在面板里"Set up a domain"，同账号 zone 会自动建 CNAME；手工先建 CNAME 会 522。
- Workers 自定义域（`custom_domain = true`）：首次 deploy 自动建 DNS 记录与证书，**要求该主机名在 zone 里没有任何已存在的 DNS 记录**。Universal SSL 免费证书覆盖一级子域，三个域名都是一级，无需 ACM。

**Token 权限（官方 Workers 授权文档 + Pages 直传指南）**

| 操作 | 最低权限 |
| --- | --- |
| 新建 Worker（首次 deploy） | Account › Workers Scripts › Edit |
| 绑定 / 改自定义域 | Zone › Workers Routes › Edit（限定 `chinhae.cc`） |
| KV namespace（官网缓存） | Account › Workers KV Storage › Edit |
| Pages 直传 | Account › Cloudflare Pages › Edit |
| wrangler 自检 `whoami` | Account › Account Settings › Read、User › User Details › Read、User › Memberships › Read |
| DNS 记录（Pages CNAME / 清理旧记录） | Zone › DNS › Edit（限定 `chinhae.cc`） |

最省事的做法：面板里从模板 **Edit Cloudflare Workers** 起步（已含 Workers Scripts / KV / Routes / Account Settings Read / User Details / Memberships），再加 **Cloudflare Pages: Edit** 与 **DNS: Edit**，Zone Resources 限定 `chinhae.cc`。Durable Objects 没有单独权限项，跟随 Workers Scripts。

**决定：Account ID 放仓库变量 `vars.CLOUDFLARE_ACCOUNT_ID`，不放 Secret。** 理由：`wrangler.toml` 两处已明文写 account_id 且仓库公开，再放 Secret 是自欺；Cloudflare 自己的 CI 指南也只要求 Token 保密。`CLOUDFLARE_API_TOKEN` 放 Secret。

**顺序决定：本票只部署中继。** 中继代码与品牌无关，改 `wrangler.toml` 即可上线；网页端与官网代码里还满是 Paseo 字样，本票只建 Pages 项目、绑域名、留空主机名，内容在 1.0.0 实现阶段随改名一起首发。

---

#### 给用户的清单（账号操作由你做，命令照抄）

**0. 账号前提**
- [ ] 登录 Cloudflare 面板，确认 `chinhae.cc` zone 在这个账号下，记下 **Account ID**（Workers & Pages 总览右侧，或 zone 总览右下）。
- [ ] 看 Workers & Pages 列表：这个账号是否已有别的 Worker / Pages 在跑？有的话告诉我名字（共享 10 万/天）。
- [ ] DNS 页确认 `osuna`、`osuna-app`、`osuna-relay` 三个主机名**没有**任何记录。有就删掉或换名。
- [ ] 确认计划是 Workers Free（面板 Workers & Pages → Plans）。要升 Paid 另说。

**1. API Token**
- [ ] 面板 → My Profile → API Tokens → Create Token → 模板 **Edit Cloudflare Workers** → Permissions 里再加两行：`Account · Cloudflare Pages · Edit`、`Zone · DNS · Edit`；Zone Resources 改成 `Include · Specific zone · chinhae.cc`；Account Resources 选本账号。
- [ ] 复制 Token（只显示一次）。本机保存到 `~/.config/osuna/cloudflare/api-token`（`chmod 700 ~/.config/osuna/cloudflare && chmod 600` 该文件），与 mac 签名材料同一套存放约定。
- [ ] 本机自检：

```bash
export CLOUDFLARE_API_TOKEN=$(cat ~/.config/osuna/cloudflare/api-token)
export CLOUDFLARE_ACCOUNT_ID=<你的 Account ID>
cd packages/relay && npx wrangler whoami
```

应打印你的账号名与 Account ID，以及 token 权限列表。

**2. 中继（我改配置，你执行 deploy）**

把 Account ID 告诉我后，我把 `packages/relay/wrangler.toml` 改成：

```toml
name = "osuna-relay"
account_id = "<你的 Account ID>"
main = "src/cloudflare-adapter.ts"
compatibility_date = "2024-12-01"

routes = [{ pattern = "osuna-relay.chinhae.cc", custom_domain = true }]

[observability]
enabled = true

[[durable_objects.bindings]]
name = "RELAY"
class_name = "RelayDurableObject"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["RelayDurableObject"]
```

（删掉整段 `[vars] PASEO_RELAY_UPSTREAM`。`cutover-proxy.ts` 与它的测试随 spec 的清理票删。）然后你跑：

```bash
cd packages/relay && npx wrangler deploy
curl -s https://osuna-relay.chinhae.cc/health
```

期望：deploy 输出里有 `Custom Domain: osuna-relay.chinhae.cc` 与 `RELAY (RelayDurableObject)`；`curl` 返回 `{"status":"ok"}`。证书签发可能要等 1–5 分钟，`curl` 先 526 / 525 属正常，再试。

- [ ] 把 deploy 输出的 Worker URL（`osuna-relay.<subdomain>.workers.dev`）和 `/health` 结果贴给我。

**3. 网页端 Pages 项目**

```bash
cd packages/app && npx wrangler pages project create osuna-app --production-branch main
```

- [ ] 面板 → Workers & Pages → `osuna-app` → Custom domains → Set up a domain → `osuna-app.chinhae.cc`（同账号 zone，CNAME 自动建）。
- [ ] 不做 `pages deploy`。首个内容由 1.0.0 实现阶段 CI 推。

**4. 官网 Worker**
- [ ] 建 KV namespace（官网缓存 GitHub Release 数据，5 分钟 TTL，免费档 1,000 写/天够用）：

```bash
cd packages/website && npx wrangler kv namespace create WEBSITE_CACHE
```

把输出的 `id` 贴给我，写进 `packages/website/wrangler.toml`。
- [ ] 不做 `wrangler deploy`。首次 deploy（1.0.0 实现阶段）会自动把 `osuna.chinhae.cc` 绑成自定义域，所以第 0 步留空主机名就够。

**5. 仓库 Secrets / Variables**（GitHub → Settings → Secrets and variables → Actions）
- [ ] Secret `CLOUDFLARE_API_TOKEN` = 第 1 步的 Token。
- [ ] Variable `CLOUDFLARE_ACCOUNT_ID` = Account ID。

**回报给我的事实（写进 `## Answer`）**：Account ID；是否已有其他 Worker；Token 权限集与保存路径；中继 workers.dev URL 与 `/health` 结果；Pages 项目名与自定义域状态；KV namespace id；Secrets / Variables 是否建好。
