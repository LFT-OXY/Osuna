# 差距清单 · 共享、同步、资料库、联网搜索与其他

范围：magpie 的局域网共享与远程、Docker 与后台服务、镜像、同步与备份、资料库、联网搜索、图片与视频、插件给 Agent 的工具、安装更新与运行形态、外观与操作、系统集成、隐私及其他杂项。
由子代理通读两边源码得出（2026-10-16）：magpie HEAD `7597c132`，Osuna HEAD `21a4f721d`。引用为各自仓库内的 `文件:行号`；文中的「你」指派活的主会话。只记事实，不做取舍。

---

我把 magpie 在我负责范围内的功能都过了一遍（HEAD `7597c132`，路径 `/Users/oxy/Documents/Configuration/dev-environment/demo/agent客户端源码/magpie`），每条都对照 Osuna（`/Users/oxy/.paseo/worktrees/0x9u2djy/curvy-bullfrog`，HEAD `21a4f721d`）实际打开或搜过的文件核实。整体结论：

- **全缺**：共享网关、同步备份、联网代搜、生图生视频、隐私打码，Osuna 都没有。
- **只管自己写的那份**：资料库方向上，Osuna 只管理自己的东西：自带的编排技能、自己的终端活动钩子、注入会话的 Paseo MCP，再加一段主机级追加提示词。用户自己的指令、MCP、技能、钩子、子代理没有统一管理的地方。
- **形态不同，不能简单判没有**：远程访问、Docker、Web 界面、外观、快捷键这几块 Osuna 有对应物，但做法不同，表里写清了对应关系。

**缩写**
- magpie 侧：`README`=README.zh-CN.md，`ref`=docs/reference.md，`lib.md`=docs/subsystems/library.md，`gr.md`=gateway-routing.md，`sb.md`=sync-backup.md，`gs.md`=gui-shell.md，`pt.md`=plugin-tools.md，`app.js`=internal/gui/assets/app.js，`set.go`=internal/settings/settings.go，`idx`=internal/gui/assets/index.html。
- Osuna 侧：`gw.ts`=packages/server/src/server/api-endpoints/gateway/gateway.ts，`pc.ts`=packages/server/src/server/persisted-config.ts，`ss.tsx`=packages/app/src/screens/settings-screen.tsx，`hp.tsx`=packages/app/src/screens/settings/host-page.tsx，`dm.md`=docs/data-model.md，`ADR7`=docs/adr/0007-…md，`ADR4`=docs/adr/0004-…md；`map.md`、`prd.md`、`decisions.md` 指归档任务目录里的文件。

**判「没有」用到的搜索**（`rg`，都排除了 node_modules、dist、.expo、*.gen.ts、package-lock）
- 搜①（共享）：`callerKey|caller-key|gateway key|gatewayKey|allowIps|allowedIps|ipAllow|cidr|spend limit|token limit|budget`，范围 server/api-endpoints、app/api-endpoints、protocol/api-endpoint，只命中思考预算 `translation/ir.ts:406 budgetOf`。
- 搜②（内置 HTTPS）：`tls-cert|tlsCert|https\.createServer|createSecureServer|certFile|keyFile`，范围 server/src、cli/src，0 条。
- 搜③（同步备份）：`webdav|nextcloud|jianguoyun|坚果云|passphrase|pbkdf2|aes-256-gcm|S3Client|aws-sdk|sigv4|settings backup|config backup`，范围 packages 与 docs，0 条；protocol 里也没有导出、导入、备份类 RPC。
- 搜④（资料库）：
  - `CLAUDE\.md|AGENTS\.md|GEMINI\.md` 只命中注释和 Codex 内置说明。
  - `\.mcp\.json|claude\.json|context_servers|disableAllHooks|hooks\.json|mcp_servers` 只命中 Osuna 自己的钩子安装器、Agent 启动配置、接口接管记录。
  - `\brtk\b|rtk-ai`、`skills\.sh|registry\.modelcontextprotocol|smithery|mcp\.so` 都是 0 条。
  - `registration_endpoint|oauth-protected-resource|mcpauth` 只命中 Osuna 自家 MCP 的令牌。
- 搜⑤（联网搜索）：
  - `tavily|brave search|exa\.ai|firecrawl|searxng|you\.com` 只命中一个测试。
  - `web_search|web_fetch|websearch|webfetch` 只命中工具调用的显示解析和 WebSearch deny。
- 搜⑥（生图）：`images/generations|generate_image|generate_video|videos/generations|imagine|dall-e|gpt-image|seedance`，只命中价格快照 `usage/pricing/snapshot.json`。
- 搜⑦（桌面集成）：
  - `openAtLogin|launchAtLogin|loginItem|autostart|start at login` 只命中一个 e2e 测试的变量名。
  - `powerSaveBlocker|preventSleep|keepAwake|caffeinate` 只命中客户端语音模式。
  - `new Tray|Tray\b|setLoginItemSettings|globalShortcut`（desktop/src）0 条。
  - `omarchy|hyprland|niri`、`colorblind|Okabe` 都是 0 条。
  - CHANGELOG 里搜 sleep、tray、login 只有无关的修复。
- 搜⑧（隐私）：
  - `redact|scrub|mask` 只命中日志、诊断和报错里的 key 打码。
  - `posthog|DO_NOT_TRACK|sentry|amplitude|mixpanel|install-id|telemetry` 只命中一个本地日志标签。
  - `hideAccounts|privacy mode|blur.*email` 0 条。
- 搜⑨（镜像与代理）：`npmmirror|mirror|gh-proxy|jsdelivr` 只命中无关注释；`setGlobalDispatcher|EnvHttpProxyAgent|ProxyAgent|NODE_USE_ENV_PROXY|HTTPS_PROXY` 0 条。
- 搜⑩（服务安装）：`launchd|systemd|LaunchAgents|launchctl|systemctl` 只命中 `nix/module.nix` 的 systemd 服务、网站夹具和翻译文案。
- 搜⑪（运行形态）：`\bwsl\b|wsl\.exe` 只命中一处注释（`claude/project-dir.ts:41`）；`termux` 0 条；CLI 里 `"ink"|blessed|tui\b` 0 条；`portable` 只命中无关代码。
- 搜⑫（设置与货币）：settings-screen 里的 `search` 只有 `searchable={false}`；`CNY|exchange rate|currency` 只看到 `usage/format.ts:50` 写死 USD。
- 搜⑬（插件工具）：packages/plugin/src 里 `registerTool|registerMcp|mcp` 只命中 provider 会话的 mcpServers 配置。
- 搜⑭（图标）：插件代码里 `iconUrl|icon_url|https://.*icon` 0 条。

**上一轮态度的引文**（表里用简称）
- 不做①：map.md:42「magpie 的六种排序策略、路由组、中间件/插件系统、局域网共享、代替厂商联网搜索、并发与频率上限、OTLP 导出。」
- 不做②：decisions.md:91「T4 联网搜索 → 保留 WebSearch deny + 翻译时剔服务端工具，不代搜（magpie 代搜已在图外）。」；prd.md:128 R-C4「联网搜索：翻译时剔除服务端工具、解码时跳过 server_tool_use，不代搜。」
- 不做③：map.md:38「订阅账号轮换……涉及改写登录文件与厂商条款边缘」
- 不做④：map.md:49「中转站另记转发用量并与 Agent 自报用量去重：05 票定为不做。」
- 不做⑤：map.md:53「……预设中转站清单……08 票定为第一版不做」

---

## 1. 功能清单

### A 共享（局域网、远程、隧道、Docker、后台服务、镜像）

| 编号 | magpie 功能 | magpie 出处 | Osuna 现状 | Osuna 证据 | 差在哪 | 上一轮的态度 |
|---|---|---|---|---|---|---|
| A1 | 打开「在局域网共享」后，网关监听所有网卡；页面显示本机局域网地址（可切 OpenAI/Anthropic 格式、一键复制），同时自动建一把叫 Magpie 的默认 key | README:244；ref:413、487-490、2197-2198；app.js:21632-21700 | 没有 | 中转站只认回环来源，带转发头的一律拒：gw.ts:55-56、683-690；ADR7:9「only accepted from a loopback source」，ADR7:21「The relay never exposes it」；搜① | 整块缺。daemon 自己可以用 `daemon.listen` 绑 0.0.0.0（pc.ts:254），但中转站仍只认回环 | 不做① |
| A2 | 给每个客户端发一把命名的网关 key：复制、改名、停用、轮换（名字和历史保留）、删除；可以填「自己的 key」，从别的网关无缝迁过来 | ref:487-525 | 没有 | 每个 Agent 只有一个自动生成的中转站口令（dm.md:77、735）；daemon 访问只有一个共享密码，所有客户端都按 owner 放行（packages/server/src/server/session-admission-auth.ts:11-36）；搜① | 没有按客户端命名的 key。docs/permissions.md 写了按设备的身份和吊销，但代码还没实现 | 不做① |
| A3 | 每把 key 的用量上限：token 和/或估算花费，按天、周、月、每 N 天或每 N 小时；一把 key 最多 5 个窗口同时生效；超限回 429 并带 Retry-After；能重置用量，能选是否计缓存读 | README:244；ref:527-574；internal/access/limit.go:13-39、92-99 | 没有 | 搜① | 整块缺 | 不做①（属于局域网共享） |
| A4 | 每把 key 只能用部分模型（provider/model、provider/*、路由组），/v1/models 只列允许的，其余回 403 | ref:576-587 | 没有 | 搜① | 整块缺 | 不做① |
| A5 | 每把 key 只能用部分订阅账号或上游 key | ref:589-610 | 没有 | 搜① | 整块缺 | 不做① |
| A6 | 受限 key 默认看不到本机账号；主人可以让它看到自己能用部分的额度卡片（Quotas 徽章） | ref:1792-1811 | 没有 | 搜① | 整块缺 | 不做① |
| A7 | 用量页按网关 key 分组，CSV 带调用方 key 的 id 和名字，删掉的 key 保留历史 | ref:722-726 | 没有 | 用量只读 CLI 自己的日志；ADR7:34「Record the gateway's own usage. Rejected」 | 整块缺 | 不做④ |
| A8 | 允许地址名单：只放行列出的 IP 或 CIDR（MAGPIE_ALLOW_IPS 优先）；被拒时说出来源地址并能一键加入；本机永远放行 | ref:679-693；set.go:113-119；app.js:21561-21630 | 没有 | daemon 只有 Host 头白名单 `hostnames` 和 `trustedProxies`（pc.ts:255-257）；搜① | 没有按来源 IP 放行 | 不做① |
| A9 | 网页和浏览器扩展的跨域白名单：列进去的页面才能带 key 从浏览器调网关 | set.go:105-112；app.js:21489-21560 | 没有 | daemon 有 `cors.allowedOrigins`（pc.ts:283-288），但管的是 daemon 的 API，不是中转站 | 中转站不对网页开放 | 没提到 |
| A10 | 经本机隧道或反代（cloudflared、ngrok、Tailscale serve、Caddy、nginx）进来的请求当作「别的机器」：要 key；代理自己做认证时可设 MAGPIE_TRUST_PROXY=1 | ref:654-677、1664-1675 | 部分 | 中转站同样认出转发头，但一律拒绝（gw.ts:56、683-690）；daemon 有 `trustedProxies`（pc.ts:257） | 只有「拒」，相当于 magpie 没开共享时的行为；没有「带 key 放行」 | 不做① |
| A11 | 内置 HTTPS：serve、web、daemon install 带 --tls-cert/--tls-key，证书续期后自动换 | ref:695-717 | 没有 | 搜②；Osuna 推荐由反代做 HTTPS（docs/docker.md:180），远程访问走中继（SECURITY.md:65） | 整块缺 | 没提到 |
| A12 | MAGPIE_PUBLIC_URL：在容器或反代后面时，显示「别的机器该用的地址」 | ref:1652-1659、2205-2212 | 没有 | `PASEO_HOSTNAMES` 只做 Host 校验（docs/docker.md:167-173）；`serviceProxy.publicBaseUrl` 只管工作区服务（pc.ts:305-307） | 中转站本来就不对外 | 不做① |
| A13 | 别的电脑上的 Codex 把共享 magpie 设成 model provider，从 /v1/codex/models 读模型目录 | ref:632-652 | 没有 | Codex 模型目录是写给本机 Codex 的文件 `codex-models.json`（dm.md:76） | 整块缺 | 不做① |
| A14 | 远程 magpie：笔记本把台式机的 magpie 加成一个 provider，用它的 provider、账号、路由组、图像视频、System One、embedding/rerank/语音转文字；本机照样配置自己的 Agent；额度卡片带远程名字，可远程刷新，价格两边一致 | README:245；ref:412-450；site/public/docs/zh/remote.html | 没有（有不同形态） | Osuna 的对应物是「一个客户端连多台 daemon」（SSH、中继、Tailscale，public-docs/connectivity.md:9-20）：在远端主机上开 Agent，用那台的第三方接口 | 本机 Agent 不能借另一台 daemon 的接口用 | 没提到（局域网共享已不做） |
| A15 | 远程 magpie 的命令行和 TUI 添加方式：`magpie provider add remote-magpie …`，TUI 里按 a、w、m | ref:414-418 | 没有 | 同 A14 | — | 没提到 |
| A16 | `magpie gateway-key add/list/rotate/remove/limit/models/accounts/quotas` 命令 | ref:503-525 | 没有 | packages/cli/src/commands 下没有对应命令；搜① | — | 不做① |
| A17 | 网关端口可改，已接入的 Agent 跟着改 | app.js:21431-21475；set.go:120-122 | 有 | 中转站跟 daemon 端口走，每次启动比对写进 CLI 的地址，不同就重写（ADR7:22；api-endpoints/service.ts:296-310；packages/server/src/server/bootstrap.ts:282-291） | 端口在 daemon 配置里改，不在接口页 | 已做 |
| A18 | Docker 镜像：服务器或 NAS 上跑，非 root，一个配置卷，有健康检查 | README:246；ref:2173-2235；Dockerfile:30-63 | 有 | 镜像 `ghcr.io/lft-oxy/paseo`（README.md:76-89）；非 root；`/home/paseo` 存状态和 Agent 登录，`/workspace` 放代码（docs/docker.md:11-20、118-121）；HEALTHCHECK（docker/base/Dockerfile:102-103）；多架构（docs/docker.md:229）；有 Compose 示例 | Agent CLI 不在基础镜像里，要自己做子镜像（docs/docker.md:83-100） | 没提到 |
| A19 | 容器外（含宿主机）调用容器里的网关必须带启用的 key，否则 401 | ref:2189-2204 | 没有 | 中转站只认回环（gw.ts:683-690） | 容器只能服务容器里 daemon 自己启动的 Agent | 不做① |
| A20 | Docker 的 Web 管理：链接带 key（?k=），可固定 MAGPIE_WEB_KEY、浏览器保持登录 400 天；没带 key 打开时说明原因并让你填 | ref:2213-2226 | 有 | 镜像默认开 Web UI，API 和 WebSocket 用 PASEO_PASSWORD 保护（docs/docker.md:16、186-188；public-docs/web-ui.md:23-47） | 认证方式不同（密码而不是链接 key） | 没提到 |
| A21 | 在容器里登录订阅：把浏览器回调地址粘进 Callback URL，或者 `docker exec … accounts add` | ref:2226-2233 | 部分 | `docker exec -it --user paseo paseo codex/claude` 在容器里登录 CLI（docs/docker.md:104-111） | 没有网页里的登录；Osuna 不管订阅账号 | 订阅账号部分：不做③ |
| A22 | NAS「网关模式」：Web 页只显示 Providers/Gateway/Routing/Usage/Plugins/Settings，可设自动、开、关 | ref:2236-2255；app.js:19127-19143 | 不适用 | Osuna 容器里的 daemon 自己跑 Agent，没有「只当网关、Agent 在别处」这种角色 | — | 没提到 |
| A23 | 别处的 Agent 经防火墙或 VPN（Tailscale、WireGuard）带 key 访问 NAS 上的网关 | ref:2240-2244、2284-2291 | 没有 | Osuna 的远程是「客户端连 daemon」（中继端到端加密、SSH、Tailscale：SECURITY.md:16-30），不是「Agent 连网关」 | 中转站不对外 | 不做① |
| A24 | 后台服务：`magpie daemon install/status/restart/stop/start/uninstall`（Linux systemd 用户服务、Mac launch agent），登录或开机自启、失败自动重启 | ref:2102-2172；internal/daemon/daemon.go:1-7 | 部分 | `paseo daemon start/run/status/stop/restart`（packages/cli/src/commands/daemon/index.ts:14-25）以后台进程跑，supervisor 负责重拉崩溃的 worker（docs/architecture.md:471-477）；NixOS 有 systemd 模块（nix/module.nix:223-235）；桌面端有「退出后保持守护进程运行」（packages/desktop/src/settings/desktop-settings.ts:13-17） | 没有 macOS launchd 或普通 Linux systemd 的安装器，即没有「登录或开机自动起 daemon」 | 没提到 |
| A25 | 服务继承安装时的 PATH、代理、Agent 目录变量，还补上 nvm 的 Node；服务文件权限 0600 | ref:2155-2172 | 部分 | 桌面端启动时抓登录 shell 的完整环境给 daemon（packages/desktop/src/login-shell-env.ts:491-498） | 没有独立服务，「服务文件」这部分不适用 | 没提到 |
| A26 | `daemon install --web`：服务同时提供浏览器页面，链接重启后不变 | ref:2116-2129 | 有 | `features.webUi.enabled` 让 daemon 同端口提供 Web UI（public-docs/web-ui.md:23-47；pc.ts:344） | — | 没提到 |
| A27 | `magpie web`（--lan、--addr、--no-open、--gateway、--tls），旁边已有服务时不抢端口 | ref:2131-2137、2319 | 有 | 同 A26；另有托管 Web 端经中继连 daemon（SECURITY.md:20-24） | — | 没提到 |
| A28 | Plugins 页「国内镜像」开关：npm、Bun、插件清单先走国内镜像，并按原文件校验 | ref:2670-2684；set.go:479-483 | 没有 | 插件只能从注册表、Git、npm 装，可用 `PASEO_PLUGIN_REGISTRY` 换注册表（docs/plugins.md:118-138）；搜⑨ | 没有镜像开关 | 没提到 |
| A29 | MAGPIE_MIRRORS=on：官方源失败（网络错误、429、5xx、GitHub 限速）才回退镜像；带凭据的请求永不走镜像 | ref:2686-2712 | 没有 | 搜⑨ | — | 没提到 |

### B 同步与备份

| 编号 | magpie 功能 | magpie 出处 | Osuna 现状 | Osuna 证据 | 差在哪 | 上一轮的态度 |
|---|---|---|---|---|---|---|
| B1 | 备份成加密文件 `magpie backup`（口令输两次，AES-256-GCM + PBKDF2）：provider（可 --no-keys）、图标、设置、方案、各 Agent 的模型、资料库、网关 key | README:247；ref:2388-2412；internal/backup/backup.go:1-7 | 没有 | 搜③ | 没有任何导出 | 没提到 |
| B2 | 设置页 Export / Import 同一个加密文件 | app.js renderSync（19213 起） | 没有 | 搜③ | — | 没提到 |
| B3 | 换机恢复 `magpie restore`（--no-agents、--no-library）：同 id 替换、其余新增；没带 key 的保留本机 key；只给本机装了的 Agent 设模型；列出要重新登录的订阅；自动装 npm/git 插件 | ref:2388-2425 | 没有 | 数据都在 `$PASEO_HOME`（dm.md:43-90），只能手动拷目录 | — | 没提到 |
| B4 | WebDAV 同步（坚果云、Nextcloud、群晖），默认每 3 分钟 | README:247；ref:2426-2440 | 没有 | 搜③ | — | 没提到 |
| B5 | S3 同步（AWS、R2、B2、MinIO、NAS），可设 path-style；服务器不支持条件写时先比 ETag，下次同步补合并 | ref:2450-2474 | 没有 | 搜③ | — | 没提到 |
| B6 | GitHub 私有仓库同步：每次变化一个 commit，拒绝公开仓库，token 和资料库的分开存 | ref:2441-2497；internal/davsync/github.go（README 没写，以代码为准） | 没有 | 搜③ | — | 没提到 |
| B7 | 口令只在本机，服务器上只有密文 | ref:2443-2447 | 没有 | 搜③ | — | 没提到 |
| B8 | 冲突处理：五个部分各自比上次的哈希；只一边改就单向同步；两边都改「新的赢」，被替换的留一份；条件写冲突时重新合并 | ref:2445-2447；sb.md:53-66 | 没有 | 搜③ | — | 没提到 |
| B9 | 每台电脑自留的设置不被同步覆盖（窗口、字体、代理、端口、局域网共享、允许地址、Dock、唤醒、轻量模式、WSL、账号发现等） | sb.md:34-51 | 没有 | 搜③（Osuna 的客户端设置按设备存本地 dm.md:754，桌面设置在 desktop-settings.json，本来就不同步） | — | 没提到 |
| B10 | 同步内容开关：provider 的 key、Agent 的模型、资料库、本机用量 | internal/davsync/davsync.go:65-93 | 没有 | 搜③ | — | 没提到 |
| B11 | 自动同步间隔（关、3、15、30、60 分钟）、立即同步、状态行写「几时同步、被谁更新了哪些部分」 | davsync.go:90-100 | 没有 | 搜③ | — | 没提到 |
| B12 | 「从服务器恢复」「用本机覆盖服务器」，都先封存一份，可撤销 | sb.md:63-71 | 没有 | 搜③ | — | 没提到 |
| B13 | 服务器上的文件坏了（空、截断、HTML、别家格式）就停下说明原因，可以覆盖 | sb.md:63-67 | 没有 | 搜③ | — | 没提到 |
| B14 | 本机配置文件读不出就整次失败，不把默认值推给别的电脑 | sb.md:69-79 | 没有 | 搜③ | — | 没提到 |
| B15 | 多台电脑共享用量：每台的用量按天单独加密上传 | davsync.go:82-84；internal/davsync/usage.go | 没有 | 用量只读本机 CLI 日志（docs/usage.md） | — | 没提到 |
| B16 | 切换 WebDAV、S3、GitHub 时保留另外几家的设置，一次只同步一家 | ref:2496-2497；sb.md:81-87 | 没有 | 搜③ | — | 没提到 |
| B17 | 同步时合并网关 key；默认共享 key 跟着同步，但「是否开共享」每台各管各的 | sb.md:43-51 | 没有 | 搜③、搜① | — | 不做① |
| B18 | （仅 S3）请求存档：每个网关请求的头和正文（去掉密钥）存进同一个桶 | set.go:125-131 | 没有 | 中转站只写 daemon 日志（ADR7:20-24） | 细节归网关组 | 没提到 |

### C 资料库

| 编号 | magpie 功能 | magpie 出处 | Osuna 现状 | Osuna 证据 | 差在哪 | 上一轮的态度 |
|---|---|---|---|---|---|---|
| C0 | 总览：指令、MCP、技能、钩子、子代理只写一次，按每个 Agent 的格式写进它的文件，删除时只删自己写的部分 | README:251；lib.md:1-10 | 部分 | Osuna 只管自己的东西：<br>• 自带编排技能写进 ~/.agents/skills、~/.claude/skills、~/.codex/skills，用清单只删自己写的（orchestration-skills/internal/paths.ts:17-24、sync.ts:19、58-87）<br>• 自己的终端活动钩子按标记写进 Claude、Codex、OpenCode（terminal/agent-hooks/agent-hook-installer.ts:17-60）<br>• Paseo MCP 只在启动会话时注入、不写文件（agent/runtime-mcp-config.ts:29-58） | 没有用户自己的库 | 没提到 |
| C1 | 共享指令写进各 Agent 的用户级指令文件，magpie 的部分在两行标记之间，其余是用户的 | lib.md:21 | 部分 | 主机级「追加系统提示词」只附加给 Osuna 启动的会话（hp.tsx:309、1007-1065；pc.ts:280；agent-manager.ts:5373-5384）；搜④ | 不写文件；终端里直接跑的 CLI 看不到；不能按 Agent 区分 | 没提到 |
| C2 | 多套命名指令，可以切换 | lib.md:21 | 没有 | 搜④ | — | 没提到 |
| C3 | 指令存在用户自己的文件（如 ~/.agents/AGENTS.md），每 30 秒查改动；和 Agent 指令文件是同一个文件时不会自我嵌套 | lib.md:21 | 没有 | 搜④ | — | 没提到 |
| C4 | 只给某个 Agent 的额外指令 | internal/library/setup.go:21-27 | 没有 | 搜④ | — | 没提到 |
| C5 | 把 Agent 已有的指令搬进共享文本 | lib.md:21 | 没有 | 搜④ | — | 没提到 |
| C6 | 指令目标覆盖很多 Agent（10-13 后又加了 Qwen、Kimi、Qoder、Alma 等） | lib.md:21 | 没有 | 搜④；Osuna 本身只支持 7 个 Agent（CLAUDE.md「Supported agents」） | — | 没提到 |
| C7 | MCP 服务器（命令或 http/sse）只写一次，勾给哪些 Agent，按各家格式写并保留用户字段；Agent 不支持的不写并说明原因 | lib.md:22、48 | 没有 | 会话配置虽然有 mcpServers 字段（dm.md:135），但只用来注入 Paseo 自己的 MCP；搜④ | 没有用户能管的 MCP 列表 | 没提到 |
| C8 | MCP 健康检查：像 Agent 一样连一次，列出工具；超时说明卡在哪一步 | lib.md:22 | 没有 | 搜④ | — | 没提到 |
| C9 | 单个 MCP 工具开关，写进支持的 Agent（Codex、Gemini、Claude Code、OpenCode 等），只收回自己加的 | lib.md:22、50-58 | 没有 | 搜④ | — | 没提到 |
| C10 | 需要 OAuth 的 MCP 在 magpie 里登录一次，Agent 经网关 /mcp/<name> 使用；可以填 OAuth app | lib.md:22、47 | 没有 | 搜④ | — | 没提到 |
| C11 | MCP 的头和环境变量写成 ${NAME}，按各 Agent 的语法写出去 | lib.md:49 | 没有 | 搜④ | — | 没提到 |
| C12 | MCP 市场（精选 + 官方 MCP Registry），粘贴 README 里的 JSON 自动填表 | internal/library/market.go:225-240 | 没有 | 搜④ | — | 没提到 |
| C13 | 把 Agent 已有的 MCP 导入资料库 | lib.md:22 | 没有 | 搜④ | — | 没提到 |
| C14 | 「Copy config…」：按某 Agent 的项目文件格式复制配置 | lib.md:22 | 没有 | 搜④ | — | 没提到 |
| C15 | 技能：从 GitHub、本机文件夹（链接）、市场安装；给每个 Agent 链接或复制，可按 Agent 设 | lib.md:19、23 | 部分 | 只装自带的 Paseo 编排技能，可选、可自动更新、可卸载（orchestration-skills/index.ts:13-26；public-docs/skills.md:20-25） | 不能装第三方技能；不能选链接或复制；不能按 Agent 选 | 没提到 |
| C16 | 技能市场（skills.sh 热门与搜索、官方精选） | lib.md:24 | 没有 | 搜④ | — | 没提到 |
| C17 | 在 Agent 里改了技能副本会收回资料库；两边都改时新的赢，输的进备份 | lib.md:19、43 | 没有 | 编排技能只有「已偏离」这个状态（operations.ts:13），不收回改动 | — | 没提到 |
| C18 | 技能更新：每 12 小时问 GitHub；本机改过的不覆盖；用 GitHub token 提额 | lib.md:27 | 部分 | 编排技能随 Osuna 版本自动更新（controller.ts:166） | 没有第三方来源的更新与改动保护 | 没提到 |
| C19 | 来源仓库新增了技能时提醒（加入或忽略） | lib.md:25 | 没有 | 搜④ | — | 没提到 |
| C20 | 技能按来源仓库分组，可折叠 | lib.md:26 | 没有 | — | — | 没提到 |
| C21 | Agent 自带的技能：导入资料库，或批量从所有 Agent 移除 | lib.md:23 | 没有 | 搜④ | — | 没提到 |
| C22 | 大仓库按技能文件夹单独下载，超 200 MB 的单个技能跳过 | lib.md:23 | 没有 | — | — | 没提到 |
| C23 | 钩子：命令 + 事件 + 匹配器 + 超时 + 勾选 Agent，写进 Claude Code、Codex、Gemini、Cursor、Grok；可写任何语言的描述；用户改过的归用户 | lib.md:28、67 | 部分 | 只写 Osuna 自己的活动钩子（agent-hook-installer.ts:17-60；claude/claude.ts:21-25；codex/codex.ts:22-26；开关在 pc.ts:279） | 没有用户自定义钩子 | 没提到 |
| C24 | 子代理：一次定义（名字、说明、提示词、用到的技能和 MCP），写成各 Agent 自己的子代理文件 | lib.md:29、69；README:251 | 没有 | 搜④（另搜 `\.claude/agents|droids` 也是 0 条） | — | 没提到（10-15 新增） |
| C25 | 项目：给某个项目文件夹配部分技能和 MCP，写进项目里的配置，生成的东西加进 .gitignore | lib.md:20 | 没有 | 搜④ | — | 没提到 |
| C26 | RTK（压缩 shell 输出省 token）：为各 Agent 一键开关，安装、升级、加 PATH，显示省了多少 | lib.md:31、66 | 没有 | 搜④ | — | 没提到 |
| C27 | 每次改 Agent 文件前备份（留最近 30 次），有 Backups 和 Library folder 按钮 | lib.md:30 | 部分 | 第三方接口第一次接管 CLI 配置前存一份字节副本（dm.md:79 `api-endpoints/backups/`） | 只限接管的那两个文件；没有按钮 | 已做（仅接口接管） |
| C28 | 只拿走自己写的；用户改过的归用户；卸载了 CLI 的 Agent 不再写入 | lib.md:18、42、67、69 | 部分 | 同样原则只用在 Osuna 自己的写入：ADR4:7、11、16；技能清单 sync.ts:19 | 范围只有 Osuna 自己写的几处 | 已做（接口部分） |
| C29 | 批量操作：多选、全部开/关、全部移除、按 Agent 看 | lib.md:35 | 没有 | — | — | 没提到 |
| C30 | WSL 发行版里的 Agent 也写 | lib.md:18、23 | 没有 | 搜⑪ | — | 没提到 |
| C31 | 资料库命令行 `magpie library …` | internal/cli/library_cli.go:17-38 | 没有 | packages/cli/src/commands 里没有 | — | 没提到 |
| C32 | Claude Desktop（含 3p、Cowork、MSIX 包路径）也是写入目标 | lib.md:18、65；internal/desktopdir/desktopdir.go:1-8 | 不适用 | Osuna 不支持 Claude Desktop 这个 Agent | — | 没提到 |
| C33 | 方案（Profile）一并记住「哪些 Agent 拿到资料库的哪些内容」 | setup.go:12-19 | 没有 | Osuna 的 Agent profiles 是启动预设（pc.ts:282），不含这些 | — | 没提到 |
| C34 | 网络页的 GitHub token：资料库查更新、装私有仓库技能用 | app.js:20086-20110；set.go:75-79 | 不适用 | Osuna 没有从 GitHub 装技能的功能 | — | 没提到 |
| C35 | 资料库随备份和同步带走（钩子、子代理暂不带） | ref:2398-2412；lib.md:68-69 | 没有 | 搜③ | — | 没提到 |

### D 联网搜索

| 编号 | magpie 功能 | magpie 出处 | Osuna 现状 | Osuna 证据 | 差在哪 | 上一轮的态度 |
|---|---|---|---|---|---|---|
| D1 | 不能搜索的模型由 magpie 代搜：Claude Code 的 WebSearch、Codex 的 web_search/web.run 交给能搜的 provider 或搜索 API | README:252；gr.md:31、257-275；internal/cli/search_cli.go:39-45 | 没有（做法相反） | Claude Code 接管时写 `permissions.deny: ["WebSearch"]`（claude-settings-patch.ts:18-19、33；ADR4:20）；翻译时剔掉搜索工具（ADR7:25；translation/responses.test.ts:427-430；chat.test.ts:844） | 用第三方接口时 Agent 没法联网搜索 | 不做①、不做② |
| D2 | 选谁来搜：自动、指定 provider 或具体模型、关掉（只用搜索 API）；搜索模型的思考档位 | set.go:291-301；gr.md:368-400 | 没有 | 搜⑤ | — | 不做② |
| D3 | 搜索 API：Tavily、Brave、Exa、Firecrawl、You.com（不填 key 每天 100 次）、SearXNG（自建） | internal/provider/search_api.go:55-63 | 没有 | 搜⑤ | — | 不做② |
| D4 | 每个搜索 API 可填自建的 base URL，key 只发给这个地址 | gr.md:401-431 | 没有 | 搜⑤ | — | 不做② |
| D5 | 先用搜索 API 还是先用 provider | set.go:302-306 | 没有 | 搜⑤ | — | 不做② |
| D6 | 拖动排序（或 Alt+↑/↓），按顺序调用 | gr.md:433-461 | 没有 | 搜⑤ | — | 不做② |
| D7 | 每个 API 单独关掉，不删 key | gr.md:433-461 | 没有 | 搜⑤ | — | 不做② |
| D8 | 一个 API 填多个 key：默认轮流，pick=order 按顺序；被拒的 key 歇一阵排最后 | gr.md:463-480；internal/gateway/search_keys.go:109 | 没有 | 搜⑤ | — | 不做②（prd 里「同一接口多 key」说的是第三方接口） |
| D9 | Tavily 每个 key 的额度，设置页和 `magpie search` 都显示 | gr.md:491-500；search_quota.go:55 | 没有 | 搜⑤ | — | 不做② |
| D10 | 搜索词按隐私设置打码后再发 | gr.md:482-489 | 没有 | 搜⑤、搜⑧ | — | 不做② |
| D11 | 自动选的搜索者没搜到就换下一个（最多 3 个）并在路由页说明 | gr.md:335-366 | 没有 | 搜⑤ | — | 不做② |
| D12 | 搜索 MCP 服务器 /mcp/magpie/web-search，任何 Agent 挂上就有 `web_search` | README:252；gr.md:515-536；search_mcp.go:30-36 | 没有 | 搜⑤ | — | 不做② |
| D13 | 同一个 MCP 的 `web_fetch`：按网址读网页，只读公网，最多 5 MiB，HTML 转 Markdown | gr.md:538-552；search_fetch.go:36 | 部分 | 桌面端给自己启动的 Agent 注入 browser_* 工具（开标签、读页面快照、截图：public-docs/browser-tools.md:9-35），要开浏览器工具（hp.tsx:308） | 不是轻量的按网址抓正文；终端里的 CLI 用不上 | 没提到 |
| D14 | `magpie search` 命令：列出、添加、开关、排序、删除，显示额度 | search_cli.go:16-80 | 没有 | CLI 里没有 | — | 不做② |
| D15 | 搜索是一个可以整体关掉的内置插件 | plugins/search/search.go:1-11 | 没有 | — | — | 不做② |
| D16 | Kimi Code、WorkBuddy 等套餐用自家搜索服务替自己的模型搜 | gr.md:276-292 | 没有 | — | — | 不做② |

### E 图片与视频

| 编号 | magpie 功能 | magpie 出处 | Osuna 现状 | Osuna 证据 | 差在哪 | 上一轮的态度 |
|---|---|---|---|---|---|---|
| E1 | Magpie Image MCP：从资料库给任何 Agent；`generate_image` 用设置里选的模型（自动、指定、关），图存进项目的 generated-images/；超过 20 秒先回任务 id | README:253；internal/imagemcp/imagemcp.go:1-43、97-110；app.js:20545-20600 | 没有 | 搜⑥ | — | 没提到 |
| E2 | `generate_video`：用 Grok 订阅的 Grok Imagine、火山方舟 Seedance、远程 magpie 生成短视频，存 mp4 | imagemcp.go:66-84；internal/gateway/video.go:30-56 | 没有 | 搜⑥ | — | Grok 订阅部分：不做③ |
| E3 | 网关提供 OpenAI 格式的生图、改图、视频接口 | set.go:285-290；video.go:30-35 | 没有 | 中转站只应答 messages、count_tokens、responses、models、hello（gw.ts:53、66-67、107-112） | — | 没提到 |
| E4 | 设置的图片页说明生图工具从资料库来，资料库关着时一键打开 | app.js:20563-20585 | 没有 | 搜⑥ | — | 没提到 |
| E5 | 图像识别：模型看不见图时，换一个模型先描述（可关、可选模型和档位） | set.go:276-284 | 没有 | 搜⑥；prd.md:126 R-C2 只做图片原样转发 | 细节归网关组 | 没提到 |
| E6 | 图像识别 MCP `analyze_image`（传文件路径、网址或 data URL） | gr.md:571-596 | 没有 | 搜⑥ | — | 没提到 |
| E7 | Codex 原生生图工具的回退模型 | ref:452-458 | 没有 | — | — | 没提到 |

### F 插件给 Agent 的工具

| 编号 | magpie 功能 | magpie 出处 | Osuna 现状 | Osuna 证据 | 差在哪 | 上一轮的态度 |
|---|---|---|---|---|---|---|
| F1 | 社区插件的工具经 /mcp/magpie/tools 给任何 Agent，插件页可复制地址 | pt.md:3、12、22-35；internal/gateway/tools_mcp.go:31 | 没有 | Osuna 插件能加 provider、用量来源、侧栏、按钮、时间线、斜杠命令、附件、设置、主题（docs/plugins.md:408-674），但不能给 Agent 提供工具；搜⑬ | — | 不做①（中间件/插件系统） |

### G 安装、更新与运行形态

| 编号 | magpie 功能 | magpie 出处 | Osuna 现状 | Osuna 证据 | 差在哪 | 上一轮的态度 |
|---|---|---|---|---|---|---|
| G1 | 一行安装脚本 `curl … install.sh \| sh` | README:48-52；site/public/install.sh | 没有 | 只能从 GitHub Releases 下载（README.md:64-66），或者 Docker、Nix | — | 没提到 |
| G2 | 安装和更新可加 `--proxy`、`--mirror`，校验和永远来自官方 | ref:2053-2066；install.sh:12-60；set.go:269-275 | 没有 | 搜⑨；桌面更新走 electron-updater（auto-updater.ts:155-165） | — | 没提到 |
| G3 | Mac 版签名并公证；Windows、Linux 没签 | ref:2068-2069 | 部分 | Mac 用自签证书，不能公证，首次打开 Gatekeeper 会问（docs/adr/0001-macos-self-signed-certificate.md）；安装包有 Windows NSIS + zip、Linux AppImage/deb/rpm（electron-builder.yml:65-113） | 没有公证 | 没提到 |
| G4 | 自动更新：后台下载，重启或退出时装；命令行 `magpie update` | ref:2069-2073；internal/update/update.go:1-9 | 部分 | 每 30 分钟自动查（desktop-app-updater.ts:47、546-557）；点了才下载，下好后「安装并重启」或退出时装（auto-updater.ts:155-163；ss.tsx:604-700）；Stable 分 36 小时放量（public-docs/updates.md:43） | 不自动下载；CLI 没有 update 命令 | 没提到 |
| G5 | 更新渠道 | update.go:38-48（magpie 只有一个更新源） | 有（比 magpie 多） | Stable、Beta 可切（ss.tsx:604-680；desktop-settings.ts:46） | — | 没提到 |
| G6 | 关于页：自动更新开关、检查间隔、自动下载开关、无请求在途时自动重启、Update 按钮显示或对某版本隐藏、下载源（镜像） | app.js:19062-19104；set.go:244-275 | 部分 | 固定 30 分钟检查，固定点了才下载（auto-updater.ts:156-157）；更新提示能「本次运行隐藏」（resolve-update-callout.test.ts:33） | 这些都不能设；没有自动重启和跳过某个版本 | 没提到 |
| G7 | 从源码构建（go install、make） | ref:2075-2096 | 有 | 仓库构建命令（CLAUDE.md、docs/development.md） | — | — |
| G8 | Termux 构建（Android 终端里跑），用 Termux:Boot 自启 | ref:2097-2100 | 没有 | 搜⑪；Osuna 的 Android 只有客户端 App | — | 没提到 |
| G9 | 菜单栏托盘图标 + 下拉面板（`magpie tray`） | README:42；gs.md:3-10；ref:2317 | 没有 | 搜⑦ | 托盘上的额度显示归用量组 | 没提到 |
| G10 | 点托盘图标打开面板还是窗口 | set.go:45；idx:182-185 | 没有 | 同 G9 | — | 没提到 |
| G11 | Mac「在 Dock 中显示」：从不、窗口开着时、总是 | set.go:63-69 | 不适用 | Osuna 是普通窗口应用，一直在 Dock，有 Dock 角标（main.ts:662；window-manager.ts:181-185） | — | — |
| G12 | 轻量模式：关窗一分钟后释放网页内存，网关照跑 | set.go:335-339 | 不适用（推测） | Osuna 关窗是真关，daemon 是独立进程（window-manager.ts:314 只在关闭时存状态，没有拦截隐藏） | — | — |
| G13 | TUI：终端里有全部功能（六页），没别的 magpie 时它自己起网关 | ref:2318、2373-2384；internal/tui/pages.go:32-40 | 没有 | 搜⑪ | Osuna 只有命令行 | 没提到 |
| G14 | Web 界面，和窗口同一套页面，手机上有自己的底部标签 | gs.md:16 | 有 | daemon 自带 Web UI（public-docs/web-ui.md）、托管 Web 端、手机 App | — | — |
| G15 | 命令行覆盖几乎所有操作 | ref:2313-2370 | 有（范围不同） | `paseo` CLI（agent、daemon、provider、plugin、schedule……） | 本范围里的 search、library、backup、gateway-key、daemon install、autostart、update 命令都没有 | — |
| G16 | 无界面构建，跑在服务器上 | gs.md:19 | 有 | daemon + CLI 本身无界面；Docker、NixOS | — | — |
| G17 | Windows 开始菜单快捷方式（单个 exe 没有安装器时自己建） | internal/shortcut/shortcut.go:1-8 | 有（推测） | 用 NSIS 安装器（electron-builder.yml:101-113） | — | — |
| G18 | 便携模式：程序旁边有 data 文件夹就把一切存在里面 | internal/appdir/appdir.go:1-8 | 没有 | 搜⑪；数据固定在 $PASEO_HOME（docs/architecture.md:457） | — | 没提到 |
| G19 | 把 CLI 加进 PATH：按 shell 逐个显示「这里跑的是哪个 magpie」，一键加 | app.js:18802-18850 | 有 | 设置 › 集成 › 命令行 › 安装（README.md:70-72；desktop/src/integrations/cli-install/shell-rc.ts:22-40） | 不逐个 shell 显示 | — |
| G20 | `magpie healthcheck` 健康检查 | ref:2228-2232 | 有 | `/api/health` + 镜像 HEALTHCHECK（docker/base/Dockerfile:102-103）、`paseo daemon status` | — | — |
| G21 | 第二次启动交给已在跑的实例；`magpie://` 链接 | gs.md:13 | 有 | 单实例锁（main.ts:876-882） | — | — |
| G22 | Windows 缺 WebView2 时提示 | gs.md:25 | 不适用 | Electron 自带 Chromium | — | — |
| G23 | 开发模式：热重载、独立端口、临时 HOME、强制深浅色、调试输出 | ref:2292-2311 | 有 | `npm run dev`，开发用独立的 `.dev/paseo-home`（CLAUDE.md） | — | — |
| G24 | 数据文件说明：扁平目录、.lock 和 .bak、密钥文件 0600、缓存目录、遵守 XDG | ref:2714-2794 | 部分 | $PASEO_HOME 目录说明（dm.md:43-90）；接口文件全是 0600（dm.md:70、725）；原子写（dm.md:90） | 不遵守 XDG；没有 .bak 和跨进程锁 | 已做（接口文件） |
| G25 | 关于页：打开配置文件夹、显示网关地址和对外地址、社区链接 | app.js:19087-19104 | 部分 | 关于页有版本、更新说明、渠道、已连主机版本、社区链接（ss.tsx:460-488）；主机页能看和打开 daemon 日志 | 没有「打开数据目录」；中转站地址按设计不露面（docs/glossary.md:46） | 不露面：已做（设计如此） |
| G26 | 更新说明（What's new），可以「今天不再显示」 | app.js:19065-19069；ref:2776 | 有 | 设置 › 关于 › 更新说明（ss.tsx:490-517） | 没核实升级后会不会自动弹 | — |

### H 外观与操作

| 编号 | magpie 功能 | magpie 出处 | Osuna 现状 | Osuna 证据 | 差在哪 | 上一轮的态度 |
|---|---|---|---|---|---|---|
| H1 | 浅色、深色、跟随系统 | README:256；set.go:39 | 有（比 magpie 多） | 十余套内置主题、深浅色各配一套自动跟随、插件主题（appearance-section.tsx:724-751；styles/theme.ts:1638-1720；docs/plugins.md:674） | — | — |
| H2 | Omarchy：跟随它当前主题的颜色、字体、圆角；栏上图标；Hyprland、niri 下把面板摆到栏下 | README:256；internal/omarchy/omarchy.go:1-10；idx:147-150、186-189 | 没有 | 搜⑦ | — | 没提到 |
| H3 | 色盲模式（换配色、曲线加虚线） | set.go:40-43；gs.md:150 | 没有 | 搜⑦ | — | 没提到 |
| H4 | 语言：英、简中、繁中（台湾用语）、日、德；托盘菜单和通知跟着变 | app.js:18328；gs.md:16 | 部分 | 9 种：en、ar、es、fr、ja、ko、pt-BR、ru、zh-CN（docs/i18n.md:5-17）；桌面原生菜单只有英文（desktop/src/features/menu.ts:105-140） | 缺繁体中文、德语 | 接口页文案九种语言已做（prd.md:144） |
| H5 | 文字大小（Ctrl/Cmd 加减号和 0） | set.go:484-487；app.js:18364-18378 | 有 | 界面、正文、代码、终端字号分开调（appearance-section.tsx:767-845）；菜单里能放大缩小（menu.ts:121-141） | — | — |
| H6 | 界面字体、代码字体：从系统字体里选字体和具体字重、样式 | gs.md:34-70；internal/fonts/fonts.go:1-3 | 部分 | 界面、代码、终端字体可选，会探测系统里装了哪些（appearance/font-probe.ts:30-77） | 不能选字重和样式 | — |
| H7 | 快捷键（Cmd+, 开设置、⌃⌘S 切侧栏、Alt+方向键排序、TUI 按键表） | app.js:18380-18388、23129-23136 | 有（比 magpie 多） | 快捷键可查、可改、可还原（screens/settings/keyboard-shortcuts-section.tsx；keyboard/shortcut-override-store.ts） | — | — |
| H8 | 设置页搜索框 | idx:142 | 没有 | 搜⑫ | — | 没提到 |
| H9 | 侧栏和顶部标签两种布局，可切换 | gs.md:17 | 部分 | 侧栏条目可隐藏、排序（screens/settings/sidebar/sidebar-nav-section.tsx:176-208） | 没有顶部标签布局 | — |
| H10 | 打开时回到上次看的页面 | gs.md:17 | 有 | 启动时恢复上次的工作区（docs/expo-router.md:37-42） | — | — |
| H11 | 记住窗口大小和是否最大化 | gs.md 运行路径第 6 条 | 有 | packages/desktop/src/settings/window-state.ts:14-20（连位置也记） | — | — |

### I 系统集成

| 编号 | magpie 功能 | magpie 出处 | Osuna 现状 | Osuna 证据 | 差在哪 | 上一轮的态度 |
|---|---|---|---|---|---|---|
| I1 | 开机自启（Mac、Windows、Linux、Termux 各有做法），`magpie autostart`，和后台服务互斥 | internal/autostart/autostart.go:1-7；ref:2167-2171 | 没有 | 搜⑦ | — | 没提到 |
| I2 | 保持唤醒：有请求在途、等工具结果或最后一个请求结束 10 分钟内不让电脑自动睡，可选屏幕也常亮 | README:256；internal/awake/awake.go:1-27；app.js:18940-18948 | 没有 | 只有客户端语音模式让设备屏幕常亮（app/src/contexts/voice-context.tsx:10、142-146）；搜⑦ | 主机睡着会打断 Agent | 没提到 |
| I3 | Windows 上检测 WSL 里的 Agent（可关） | README:255；set.go:344-347 | 没有 | 搜⑪ | 细节归 Agent 组 | 没提到 |
| I4 | 会话终端（Mac 上选用哪个终端恢复会话） | ref:2365-2370 | 归会话组 | — | — | — |

### J 隐私

| 编号 | magpie 功能 | magpie 出处 | Osuna 现状 | Osuna 证据 | 差在哪 | 上一轮的态度 |
|---|---|---|---|---|---|---|
| J1 | 用户计数：正式版每天向 PostHog 发一次随机 ID、版本、系统 | README:272；ref:2795-2803；internal/stats/stats.go:1-8 | 不适用 | Osuna 不上报使用统计（搜⑧），没东西要关；daemon 自己发的请求只有两个公开文件（docs/usage.md:122-148） | — | 没提到 |
| J2 | 「分享我用的 agent、provider、模型」可单独关；合作伙伴计数 | ref:2805-2826 | 不适用 | 同上 | — | — |
| J3 | 全部关掉：设置开关、DO_NOT_TRACK=1、MAGPIE_NO_STATS=1；源码构建从不发 | ref:2824-2830 | 不适用 | 同上 | — | — |
| J4 | 隐私页列出 magpie 自己发出的所有请求和关法 | site/public/docs/zh/privacy.html | 部分 | docs/usage.md:122-160 列出 daemon 的自发请求和开关 `features.usage.pricing.autoUpdate` | 没覆盖桌面端的更新检查；不是给用户看的页面 | 没提到 |
| J5 | 打码密钥：API key、私钥、token、连接串密码换成占位符发给厂商，回复里再换回来（含流式） | set.go:80-95；internal/redact/redact.go:1-16；internal/masking/masking.go:1-5 | 没有 | 只有日志打码（logger.ts:49-62）、诊断报告打码（session/daemon/diagnostics.ts:543-568）、报错里替换 key（upstream-models.ts:62）；直通原则是「只换模型名与认证」（prd.md:129 R-C5）；搜⑧ | 不改发给厂商的正文 | 没提到 |
| J6 | 打码个人信息：邮箱、电话、身份证、银行卡，另有 10 类可单独开关 | app.js:21117-21128、21191-21208 | 没有 | 搜⑧ | — | 没提到 |
| J7 | 自定义打码词、打码规则（前缀或正则） | set.go:80-95；app.js:21213-21222 | 没有 | 搜⑧ | — | 没提到 |
| J8 | 打码是内置插件，出错时宁可不发；工具定义里不打码；模型改写过的占位符也能还原 | plugins/redact | 没有 | 搜⑧ | — | 不做①（magpie 里它挂在中间件点上） |
| J9 | 隐藏账号：截图时模糊用量页、路由页上的邮箱和账号名 | app.js:21209-21211 | 没有 | 搜⑧ | — | 没提到 |
| J10 | 图标代理：插件、导入链接、资料库的图标经 usemagpie.ai 中转，图标主机看不到用户 IP | README:272；internal/iconproxy/iconproxy.go:1-7 | 不适用 | Osuna 应用不从作者主机拉图标：插件图标是包里的文件或 Lucide 图标名（docs/plugins.md:237、487）；搜⑭ | — | — |
| J11 | 订阅账号发现开关 | README:70-71；set.go:231-237 | 归提供方组 | — | — | — |

### K 其他

| 编号 | magpie 功能 | magpie 出处 | Osuna 现状 | Osuna 证据 | 差在哪 | 上一轮的态度 |
|---|---|---|---|---|---|---|
| K1 | 合作伙伴和赞助商展示（README 赞助、添加页排在最前、跳转计数） | README:16-17；ref:2833-2842 | 不适用 | 添加接口弹窗只填连接（map.md:27） | — | 不做⑤ |
| K2 | 金额显示美元或人民币，人民币按实时汇率（离线用上次的） | set.go:50-55；internal/fx/fx.go:1-7 | 没有 | usage/format.ts:50 只有 USD | 归用量组 | — |
| K3 | 中文大数用万、亿 | set.go:56-62 | 没有 | 搜⑫ | 归用量组 | — |
| K4 | 「为你调优」（按历史调用算最省 token 的设置） | internal/tune/tune.go:1-10 | 归用量组 | 没核对 | — | — |
| K5 | 任务完成提醒（回合超过 N 秒才提醒） | set.go:384-388 | 部分 | 有桌面通知和手机推送，Agent 完成或需要处理时提醒（desktop-notifications-section.tsx；docs/agent-lifecycle.md:160） | 没有「超过 N 秒才提醒」 | — |

### 设置页逐项索引（magpie 设置页的 8 个标签，idx:133-142）

- **通用**：外观见 H1、H2；色盲 H3；语言 H4；网关模式 A22；文字大小 H5；字体 H6；托盘点击 G10；栏图标 H2；开机启动 I1；Dock G11；轻量模式 G12；防休眠 I2；WSL I3；会话终端 I4。「模型名带 provider」「Codex 子代理」「长对话压缩」「Codex 标题/描述/输入预测/自动审查/记忆模型」归网关组和 Agent 组。
- **额度**：菜单栏显示几项、额度显示方式和读取时机、提醒、Codex 自动用重置次数、预热与签到归用量组和提供方组；货币见 K2，单位 K3，任务完成提醒 K5。
- **网络与共享**：GitHub token 见 C34；网关端口 A17；局域网共享 A1；允许地址 A8；网页白名单 A9。「代理（含测试按钮）」归网关组，Osuna 没有（搜⑨）；「不带 provider 的模型 id」归网关组。
- **模型**：图片见 E1、E5、E6；联网搜索 D1 到 D12。「回复」三项和「禁用模型」归网关组。
- **隐私**：J5 到 J9、J1、J2；订阅账号发现见 J11。
- **可观测性（OTLP）**：不做①。
- **同步与备份**：B1 到 B17。
- **关于**：G4、G6、G18、G19、G25、G26。

## 2. 10-13 之后 magpie 新加或大改的功能（只算我负责的目录）

这些目录 10-13 以后的提交数：internal/library 34、davsync 11、backup 4、access 3、redact 3、update 3、autostart 2、daemon 5、settings 23、gui 272、cli 55、tui 14；plugins 下的 search、tools、redact、library 合计 5。

| 功能 | 提交 | Osuna 有没有 |
|---|---|---|
| 同步到 GitHub 私有仓库（拒绝公开仓库，空仓库自动初始化） | 1af32680、f82aba09、cdfe7629（10-13） | 没有 |
| 导入或同步时自动装 npm/git 插件，并列出要在本机重新登录的订阅 | b8e23db4（10-13）、fad96ea0（10-15） | 没有 |
| 加入同步的电脑保留本机网关 key；局域网共享开关不随同步走 | eb22f635（10-14）、758a4084（10-15） | 没有 |
| 本机 settings.json 读不出就停止备份、导出、同步 | 707fbb24（10-15） | 没有 |
| 后台服务安装器、服务带终端里的 PATH、`--web` 长期有效的链接 | 5617281f、05edac2c（10-13）、82f3befd（10-14） | 部分（daemon start + supervisor + NixOS；没有 launchd/systemd 安装器） |
| 内置 HTTPS | d9ca84a2（10-14） | 没有 |
| 网关 key：每 N 小时周期、一把 key 同时多个上限、受限 key 的额度可见性 | f70c0525（10-14）、f299faef、3d3a834d（10-15）、12ecb6d8（10-13） | 没有 |
| 允许地址被拒时说出来源地址并能一键加入 | e855272c、bda27199（10-14） | 没有 |
| magpie web 端口被占时等待；cookie 被清后不掉登录 | a39e675d、b6cf5e3e（10-14） | 不适用（Osuna 用密码） |
| 资料库：子代理 | 0dbb1a84（10-15） | 没有 |
| 资料库：钩子覆盖 Claude Code 全部事件、Grok 钩子、钩子描述 | 45e77b61、8f34bbcd、17d4283a（10-14） | 没有 |
| 资料库：指令存自己的文件、防自我嵌套、新增约十个 Agent 的指令 | 692a779d、3cf39f53、cefdbfd4、3d92b61d、43d8a563（10-13）；0fe78923、5ca89769（10-15） | 没有 |
| 资料库：项目级技能和 MCP 覆盖更多 Agent、行内删除、变量导致的 MCP「未检查」 | a894559e（10-13）；6d606a75、b9e5c289（10-15） | 没有 |
| 资料库：大仓库按技能下载、超大技能跳过、下载缓存清理、更新检查用 GitHub token | 4794de39、776c255f、38bd14db、43170794（10-13）；aa6a0d6b（10-14）；01c41e8b（10-15） | 没有 |
| 资料库：卸载了 CLI 的 Agent 不再写入 | e413512d、03eb0633（10-15） | 没有 |
| RTK 支持 Antigravity、OpenCode 2、cargo 升级 | 0c0231b8、3c921835、fb3ceac2（10-15） | 没有 |
| 搜索 API 多 key 轮换、被拒的歇一阵、Tavily 额度 | a5d72a09（10-14） | 没有 |
| 搜索 API 拖动排序、单独关闭不删 key | ec13d116（10-15） | 没有 |
| 搜索 MCP 加 web_fetch | 92ac1c87（10-15） | 部分（browser_* 工具） |
| 搜索变成可关的内置插件；插件可原样收到 web_search | 9d97fd07（10-15）、77f90fd8（10-14） | 没有 |
| 插件工具经 /mcp/magpie/tools 给所有 Agent | 6ac7032b（10-15） | 没有 |
| 设置的图片页指向资料库，可一键开资料库 | 258b4ff1（10-14） | 没有 |
| 打码：改写过的占位符也还原、工具定义不打码、出错时不放行、心跳照常 | 2362bfce、62390fe9（10-13）；4ac4d9ba、1d9fbeaf（10-15） | 没有 |
| 更新：无请求在途时自动重启；可关掉自动下载 | fbb7e2cb（10-14）、ff670797（10-15） | 部分（Osuna 固定点了才下载，没有自动重启） |
| 开机自启的修复 | e1b70c13、c31dcb88（10-13） | 没有（没有开机自启） |
| 隐私页 | f64d9312（10-13） | 部分（docs/usage.md） |
| 代理「测试」按钮 | 536b15a8（10-14） | 没有 |
| 托盘和菜单栏的若干改进 | 52ee8476、49d60394、5ca37ef8、e5d4c492（10-15）；b2d558db（10-14）；164e026d（10-16） | 没有（没有托盘） |
| 资料库、搜索、打码可在 Plugins › Built-in 里单独关 | 3ccbe6bc（10-13）、8da30476（10-14） | 不适用（Osuna 的内置插件常开：docs/plugins.md:105） |

## 3. 需要用户拍板的取舍点

1. **要不要把中转站开到局域网或隧道上**：A1 到 A16、A19、A23 都取决于这一条。现在 ADR7:9 规定只认回环，上一轮明确不做（map.md:42）。做的话，你的 key 和额度会给别的机器用。
2. **同步做到哪一层**：只做本机加密文件导出，还是同步到 WebDAV、S3、GitHub。后者会把 keys.json（dm.md:72）加密后放到第三方存储，口令丢了就打不开（ref:2443-2447）。
3. **要不要做资料库**：要往用户 Agent 自己的指令、MCP、钩子、子代理文件里写，超出了 ADR4:7「只写自有键」的现有边界，需要新的规则文档。Osuna 只支持 7 个 Agent，能覆盖的面也小。
4. **技能/MCP 市场和 RTK**：会从 GitHub、skills.sh、MCP Registry 下载第三方代码，并让 Agent 去运行（lib.md:23-24、31；market.go:225）。
5. **要不要推翻「不代搜」**：decisions.md:91 定了保留 WebSearch deny、不代搜。做的话要管搜索 API 的 key、搜索词外发、要不要打码（gr.md:482-489）。
6. **web_fetch**：让 daemon 替 Agent 抓任意公网网址，要做公网限制和防内网探测（gr.md:538-552）；而且和已有的 browser_* 工具功能重叠。
7. **生图和视频**：Grok 视频依赖 Grok 订阅（imagemcp.go:66-70），和 map.md:38 不碰订阅账号的态度冲突。
8. **隐私打码**：会改发给上游的正文，和 prd.md:129 R-C5「同协议直通只换模型名与认证」冲突。magpie 默认关，出错时不放行。
9. **遥测**：Osuna 现在不上报任何统计。是否保持现状，决定 J1 到 J3 是否一直不适用。
10. **安装脚本、更新镜像、插件国内镜像**：要从第三方镜像下载安装包或插件代码（ref:2053-2066、2670-2684），而 Osuna 是 electron-updater + 自签证书（ADR 0001），镜像下来的包怎么校验要另定。
11. **托盘、开机自启、保持唤醒、后台服务安装器**：都是桌面端新形态。后台服务安装器和桌面端「内置守护进程管理」（docs/architecture.md:481）怎么并存要定，magpie 自己是让两者互斥的（ref:2167-2171）。
12. **以上新设置都只能在桌面端或 Web 端管理**：官方 Paseo 手机 App 不改（map.md:51；ADR7:35）。
13. **内置 HTTPS**：还是继续「远程访问走中继」（SECURITY.md:65）。
14. **要不要补繁体中文、德语**：每加一种语言都要维护全部文案和翻译守卫（docs/i18n.md）。

## 4. 拿不准的地方

- **推测，未核实**：
  - Osuna 镜像 `ghcr.io/lft-oxy/paseo` 是否真的已经发布。README.md:86 写了，`.github/workflows/docker.yml:60-61` 按仓库 owner 命名，但我没联网查。
  - G17：NSIS 默认会建开始菜单快捷方式，我没读 nsis 的全部配置。
  - G12：只看到 Osuna 没拦截关窗，因此判它没有「隐藏的网页占内存」的问题。
  - G26：Osuna 升级后会不会自动弹更新说明，没查。
- **只读了文档、没逐一读源码**：
  - 远程 magpie 的细节（System One、embedding、视频、额度卡片）：只看了 ref:412-450 和网站的中文页。
  - 钩子、子代理、项目写进各 Agent 的具体格式：只读了 lib.md。
  - install.sh 只读到第 60 行（确认了 --proxy 和 --mirror），Termux 分支没读完。
- **看过源码确认**：
  - Osuna 的 docs/permissions.md 写了按设备的身份、凭据和吊销，但 session-admission-auth.ts:11-36 目前一律按 owner 放行，属于文档先写、代码没做。
  - Osuna 中转站只认回环、拒带转发头的请求（gw.ts:55-56、683-690）。
- **magpie 文档和代码不一致，表里已按代码写**：
  - README:247 说同步只有 WebDAV、S3，代码还有 GitHub（internal/davsync/github.go）。
  - README:244 说上限只有天、周、月，代码还有每 N 天、每 N 小时、最多 5 个（access/limit.go:13-39、92-99）。
  - sb.md 说 `webdav_cli.go` 在根目录，实际在 internal/cli/webdav_cli.go:146-152。
  - README:246 说 Docker「用 Web 界面管理」，但镜像默认命令是 serve（Dockerfile:62-63），要换成 web（ref:2213-2216）。
- **范围划界**：K2 到 K4、I3、I4、J11 和索引里标「归某组」的设置项只做了粗查，以对应组的清单为准。internal/tune 和用量相关，我没给结论。magpie 的 `internal/shortcut` 指的是 Windows 开始菜单快捷方式，不是键盘快捷键，两者我都列了（G17、H7）。
