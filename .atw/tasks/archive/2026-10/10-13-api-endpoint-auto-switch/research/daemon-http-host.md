# daemon 现有 HTTP 服务能不能直接挂中转站

地图票 `map-issues/02-daemon-http-host.md` 的调研报告。全部结论来自本仓库源码与文档，路径相对仓库根目录；行号以 2026-10-13 的工作树为准。未启动、未重启任何 daemon。

依赖版本（`node_modules/*/package.json`）：express 4.22.1、body-parser 1.20.4、ws 8.20.0。

## 1. express 服务：监听、校验、请求体、流式、WS 共用

### 1.1 监听地址与端口怎么来

- 默认端口常量 `DEFAULT_PORT = 6767`：`packages/server/src/server/config.ts:39`。
- 优先级 `cli.listen` > `PASEO_LISTEN` > `config.json` 的 `daemon.listen` > `127.0.0.1:${PORT ?? 6767}`：`config.ts:472-483`。`PASEO_LISTEN` 与 `PORT` 都在 daemon 设置环境变量清单里：`config-environment.ts:18,65`。
- 监听串解析（`host:port` / 纯数字 → `127.0.0.1:<n>` / `unix://` 与绝对路径 → socket / `pipe://` → 命名管道）：`bootstrap.ts:43-82`。
- 真正绑定：`httpServer.listen(listenTarget.port, listenTarget.host)`，`bootstrap.ts:1863`；绑定后用 `httpServer.address()` 回读实际端口（端口写 0 时由系统分配）：`bootstrap.ts:20-40`、`1705`。
- 开发环境：根 `package.json:40` 的 `dev:server` 固定 `PASEO_LISTEN=127.0.0.1:6768`；`scripts/dev-daemon.sh:9` 同值；`scripts/dev-home.sh:66-82` 还会把这个 listen 写进 `.dev/paseo-home/config.json` 的 `daemon.listen`。`docs/development.md:17,30,63-69` 记的也是 6768 / 6767。**仓库里没有 6769**；6769 是本机自己传的 `PASEO_LISTEN`（见用户记忆），不是代码约定。
- 持久配置的默认 listen 字面量 `"127.0.0.1:6767"`：`persisted-config.ts:366`。

### 1.2 中间件顺序（决定新路由挂在哪一行之前/之后）

`bootstrap.ts` 里按注册顺序：

| 行 | 中间件/路由 | 对中转站的影响 |
| --- | --- | --- |
| 686-690 | `express()`、`trust proxy` | — |
| 744 | 服务代理 `serviceProxy.middleware()` | 按 Host 分类，IP Host 直接放行（见 1.3） |
| 748-756 | Host 白名单（仅 TCP 监听时启用） | `127.0.0.1:<port>` 放行（见 1.3） |
| 760-794 | CORS | 只加响应头，不拒绝；`OPTIONS` 直接 204（788） |
| 796-800 | `POST /api/terminal-activity`，自带 `express.json()`，只认回环地址 + 终端 token，**绕过 daemon 密码** | 「本机、token 门禁、免 daemon 密码」路由的现成样板（处理器在 309-357） |
| 806 | 内置 Web UI 静态文件 | — |
| 810-814 | daemon 密码 bearer 中间件 | 见 1.4 |
| 816 | **全局** `express.json()` | 见 1.5 |
| 822 / 826 | `/api/health`、`/api/status` | — |
| 887 | `/api/files/download`（自带下载 token） | — |
| 892 | `createHTTPServer(app)` | HTTP 与 WS 共用的 `http.Server` |
| 897 | 服务代理的 `upgrade` 监听（`passthroughUnknown: true`） | 见 1.7 |
| 1661-1663 | `/mcp/agents`（POST/GET/DELETE） | 挂在 816 之后，依赖 `req.body`（1639-1643） |
| 1758 | `new VoiceAssistantWebSocketServer(httpServer, …)`，在监听成功之后创建 | WS 挂 `/ws`（见 1.7） |

### 1.3 Host / Origin / DNS rebinding 会不会拒掉 CLI 的 `127.0.0.1:<port>`

- Host 校验：`hostnames.ts:57-78`，默认放行 `localhost`、`*.localhost`、任意 IP 字面量（`net.isIP`，`hostnames.ts:41-46`）；解析时先剥掉端口（`hostnames.ts:9-27`）。所以 `Host: 127.0.0.1:6767`、`localhost:6767`、`[::1]:6767` 都通过。只有 `hostnames` 配置成别的且 Host 是域名时才会 403（`bootstrap.ts:751-754` 返回 `{"error":"Invalid Host header"}`）。`SECURITY.md:69-73` 与之一致。
- 服务代理分类：`service-proxy.ts:622-643`。Host 剥端口后不是注册的服务主机名、不是 `xx--yy.localhost`、不是 publicBaseUrl 子域 → `{type:"daemon"}` → `next()`（`757-776`）。IP Host 走 daemon 分支。
- Origin：HTTP 侧 CORS 中间件 `bootstrap.ts:780-794` 只在 Origin 命中白名单时加头，不命中也不拒绝；CLI 不带 Origin，不受影响。Origin 拒绝只发生在 WebSocket 升级（`websocket-server.ts:936-968`），与普通 HTTP 路由无关。
- 非 TCP 监听（unix socket / pipe）时 Host 校验整段跳过（`bootstrap.ts:748`）。

结论：现有防护不会拒掉 CLI 对 `127.0.0.1:<port>` 的请求。

### 1.4 daemon 密码（bearer）会不会挡住 Agent 配置里写的 Osuna 口令

- `auth.ts:77-113`：配置了 `auth.password`（`config.json` 或 `PASEO_PASSWORD`，bcrypt 存储，`config.ts:485-495`）时，每个 HTTP 请求必须带 `Authorization: Bearer <daemon 密码>`，否则 401。例外只有 `OPTIONS`、`/api/health`、`/api/files/download`、`/mcp/agents`（`auth.ts:115-124`）。`/api/status` 另外接受本次运行的 local-credential（`auth.ts:91`）。
- Claude Code 在 `ANTHROPIC_AUTH_TOKEN` 模式下发的是 `Authorization: Bearer <token>`（仓库内依据：`upstream-connection.ts:42-46` 的注释和测试连接实现；`claude-settings-patch.ts:66-72` 写的就是 `ANTHROPIC_AUTH_TOKEN`）。Codex 走 `model_providers.<id>.auth.command` 读 key 文件（`service.ts:605-616`、`codex-auth-command.ts`），仓库里没写它最终用哪个 header。
- 因此：daemon **设了密码**时，挂在 `bootstrap.ts:810` 之后的中转站路由会把 Osuna 口令当 daemon 密码比对而 401；daemon **没设密码**时 bearer 中间件对所有请求放行（`auth.ts:80-83`），口令校验必须由中转站路由自己做，否则本机任何进程都能借 daemon 的真实 key 发请求（`SECURITY.md:49`）。
- 现成样板：`/mcp/agents` 被列入免检路由，再在处理器里用每次运行随机的 capability token 自行校验（`auth.ts:136-155`；`bootstrap.ts:676-682` 生成 token，`1588-1598` 校验），token 通过内存注入 Agent 配置（`runtime-mcp-config.ts:29-56`）。
- 另注：bearer 比对是 bcrypt cost 12（`auth.ts:6,35-37`），每个请求一次；中转站若走这条中间件，每次对话请求都会多一次 bcrypt。

### 1.5 `express.json()` 的大小限制

- `bootstrap.ts:816` 的全局 `express.json()` 不带参数；body-parser 1.20.4 默认 `limit` 为 `'100kb'`（`node_modules/body-parser/lib/types/json.js:56-58`），超限回 413 `request entity too large`（`json.js:163`、`260`）。只对 `Content-Type: application/json` 生效（`json.js:62`），且会把整个 body 读完、解析成对象再交给路由。
- Claude Code / Codex 的对话请求体就是 `application/json`，几 MB 的上下文会被 413 拒掉；即使放大 limit，也是整体缓冲 + JSON.parse，不是流。
- 挂在 816 之前的路由不受影响（`/api/terminal-activity` 就是在 796 行自带解析器）；仓库里没有其他 `express.json`/`express.raw` 用法（只有 hub 测试工具）。

### 1.6 现有流式转发能否复用

- 服务代理 `service-proxy.ts:318-356`（`proxyHttpRequest`）：`http.request` 到 `127.0.0.1:<route.port>`，`req.pipe(proxyReq)`、`proxyRes.pipe(res)`，首字节前上游不可达回 502。配套 `stripHopByHopHeaders`（247-259）和 `buildForwardedHeaders`（273-316）。
  - 它只会被 Host 命中注册服务主机名时触发（`757-776`），目标固定是本机 http 端口，不支持 https 上游、不改路径、不按路径路由。作为「中转站转发上游」不能直接拿来用；pipe/去 hop-by-hop 头的写法可以借。
- WebSocket 升级转发 `service-proxy.ts:358-401`：裸 socket 对接，同样是本机端口。
- 仓库 `packages/server/src` 里没有 `text/event-stream` 的手写 SSE；唯一的流式响应是 `/mcp/agents` 交给 `StreamableHTTPServerTransport` 处理（`bootstrap.ts:1557-1563`，并关闭了 SDK 自带的 Host 校验，理由是 daemon 已在应用层校验）。
- `api-endpoints/upstream-*.ts` 用 `fetch` 后 `response.text()` 整体缓冲（见第 4 节），没有流式。

### 1.7 WebSocket 升级与普通 HTTP 共用监听的方式

- 一个 `http.Server`（`bootstrap.ts:892`）承载 express 与所有 `upgrade` 事件。
- `upgrade` 监听顺序：先服务代理（`897`，非注册服务 Host 时不处理、不销毁 socket），后 `ws` 的 `WebSocketServer({ server, path: "/ws" })`（`websocket-server.ts:871-893`，879 行 path）。
- `ws` 8.20.0 对不等于 `/ws` 的升级请求直接 `abortHandshake(socket, 400)`（`node_modules/ws/lib/websocket-server.js:217-225`、`271-274`）。普通 HTTP 请求不受影响；中转站若只做 HTTP + SSE（Anthropic Messages / OpenAI Chat / Responses 都是），无需碰 upgrade；若将来需要 WebSocket 路径，必须在 897 行之前自己注册 upgrade 处理器并抢先处理。
- WS 升级时的 Host / Origin 校验：`websocket-server.ts:936-968`；通过中继进来的连接不走升级，直接 `attachExternalSocket`（`1057-1066`）。

## 2. 端口变化：有没有「重写 Agent 配置」的钩子；`PASEO_HOME` 与端口的关系

### 2.1 现有「端口已知后才能生成的 URL」怎么下发

- 绑定成功后才算出 `boundListenTarget`，随即 `agentManager.setMcpBaseUrl(...)`（`bootstrap.ts:1705-1709`）；URL 拼法在 `bootstrap.ts:269-289`（`0.0.0.0` → `127.0.0.1`、`::` → `::1`，`259-267`）。非 TCP 监听返回 `null`，即 unix socket / pipe 模式下没有可写进 Agent 配置的 HTTP 地址。
- MCP 地址与 token 每次启动 Agent 时注入内存里的会话配置（`runtime-mcp-config.ts:29-56`，`agent-manager.ts:5447-5452`），不落盘。
- 终端活动上报地址每次开终端时注入环境变量 `PASEO_TERMINAL_ACTIVITY_URL`（`terminal-manager.ts:337-345`），同样不落盘。
- 落盘的只有第三方接口：`ApiEndpointService` 在启用 / 编辑 / 切回官方时改写 `~/.claude/settings.json`（`service.ts:446-490`）与 `~/.codex/config.toml`（`service.ts:528-598`，其中 `572-598` 是编辑时的刷新）。它在 `bootstrap.ts:943-959` 构造，早于监听，构造参数里没有端口；回调 `onActiveEndpointChanged`（`service.ts:118`）只刷新提供方快照。

结论：**没有**任何「daemon 端口变了就重写 Agent 配置文件」的钩子；也没有「启动时校验配置文件里的地址是否还是本 daemon」的步骤。

### 2.2 端口被占 / 配置改动时的行为

- 被占：`httpServer.listen` 失败走 `onError` 直接 reject（`bootstrap.ts:1697-1700`），worker 记 fatal 后抛出（`daemon-worker.ts:336-338`）。没有自动换端口。`EADDRINUSE` 只在测试工具（`test-utils/paseo-daemon.ts:276`）和工作区服务端口分配（`utils/worktree.ts:593`）里处理。`findFreePort`（`service-proxy.ts:1020-1039`）只给工作区服务用。
- 唯一的「自动端口」是 listen 写 `:0` 由系统分配（`bootstrap.ts:20-40`）。
- `config.json` 改 `daemon.listen`：不在可热加载清单 `RELOADABLE_PATHS`（`daemon-config-store.ts:172-195`），会被记为 `restartRequiredPaths`（`451-458`），要重启才生效；有 `PASEO_LISTEN` 或 CLI 参数时 `daemon.listen` 被标为「由启动参数控制」（`config.ts:728-730`）。
- 桌面端不选端口，只读 worker 上报的 `listen`（`packages/desktop/src/daemon/daemon-manager.ts:77,168,273`）。

### 2.3 `PASEO_HOME` 与端口的对应关系

- `PASEO_HOME` 默认 `~/.paseo`（`paseo-home.ts:14-18`）；`config.json`（含 `daemon.listen`）、`paseo.pid`、`local-credential`、`api-endpoints/` 都在它下面（`docs/architecture.md:459-471`）。
- 实际端口由 supervisor 在 worker 就绪后写进 `paseo.pid` 的 `listen`（`daemon-worker.ts:325-335` 发 `paseo:ready` → `packages/server/scripts/supervisor-entrypoint.ts:172-176` → `pid-lock.ts:348-376`），重启 worker 前清空（176）。
- CLI 按 home 找 daemon 时只信 `paseo.pid` 里的 `listen`（`daemon-instance.ts:60-82`；目标选择 `packages/cli/src/utils/daemon-target.ts:5-36`），`docs/architecture.md:470-476` 明确「配置表达期望、不作为端点回退」。
- `local-credential` 也绑定到这个 `listen`：读取方只在 `paseo.pid.listen` 与连接目标一致时才用它（`local-credential.ts:68-80`）。

结论：一个 home 在任一时刻对应一个活的 listen，且可从 `$PASEO_HOME/paseo.pid` 读到；若中转站地址需要端口，这是现成的「真值来源」，但读取发生在 daemon 外部（CLI/桌面），daemon 内部用的是 `boundListenTarget`。

## 3. 远程：中继不会把 HTTP 路径暴露出去

- daemon 侧中继只建 WebSocket：控制连接与每个客户端一条数据连接都是 daemon **主动外连**（`relay-transport.ts:345-392`），再做 E2EE 握手（`416-470`），最后交给 `wsServer.attachExternalSocket`（`websocket-server.ts:1057-1066`）成为协议会话。没有任何代码把中继上的流量映射到 express 路由。
- 仓库内的 Cloudflare 中继实现只处理 `/health` 和 `/ws`（`packages/relay/src/cloudflare-adapter.ts:584-592`），且已是遗留代码，生产中继在外部仓库（`docs/architecture.md:183`）。
- App 侧对 daemon HTTP 的唯一用法是文件下载，它只在存在 `directTcp` 连接时才拼 URL，中继连接下为 `null`（`packages/app/src/stores/download-store.ts:246-250, 288-300`），从客户端角度也印证 HTTP 路径走不了中继。
- Hub：daemon 外连 HTTP 注册 + 外连 WebSocket（`docs/hub.md:11-14`；`hub/relationship-remote.ts:99-150`），无入站。
- 威胁模型：`SECURITY.md:16-45`；本机边界 `SECURITY.md:47-67`。

结论：中转站挂在 daemon HTTP 上时，可达范围 = daemon 监听的可达范围。默认 `127.0.0.1` 只有本机；用户若配 `0.0.0.0`、反向代理或 Docker 发布端口（`SECURITY.md:59`），中转站同样暴露，届时只靠口令（以及是否过 bearer 中间件）防护。服务代理的专用监听（`serviceProxy.listen`）只挂服务路由不挂 daemon 路由（`service-proxy.ts:936-947`），与此无关。

## 4. `upstream-connection.ts` / `upstream-models.ts` 现在怎么发请求

- 都用 Node 全局 `fetch`（undici）：`upstream-connection.ts:100-110`、`upstream-models.ts:104`。仓库里没有 `ProxyAgent` / `setGlobalDispatcher` / `HTTPS_PROXY` 处理，即不走系统代理。
- 超时：`AbortSignal.timeout` 与调用方取消信号 `AbortSignal.any` 合并（`connection.ts:78-79`、`models.ts:50-51`）；默认 15 s（列模型）/ 30 s（测试连接）：`service.ts:68-70`。超时 / 取消 / 网络错误分别映射为 `upstream_timeout` / `cancelled` / `upstream_unreachable`（`connection.ts:112-123`、`models.ts:58-74`）。
- 响应：`await response.text()` 整体读完再判断（`connection.ts:111`、`models.ts:105`），没有流式。
- 协议细节：Claude 走 `<base>/v1/messages`，只带 `Authorization: Bearer` + `anthropic-version`（`connection.ts:38-50`）；列模型时额外带 `x-api-key`（`models.ts:81-89`）；Codex 走 `<base>/responses`（`connection.ts:52-62`）。baseUrl 只做 trim + 去尾斜杠（`connection.ts:80`、`models.ts:53`）。
- 错误体解析与 key 脱敏、300 字截断：`upstream-http.ts:1-50`。

可复用：header 组装、超时 + 取消合并、错误归类与脱敏、baseUrl 归一化。不可直接复用：请求体是固定的探测体而非透传，响应是缓冲而非流（中转站需要 `response.body` 流式 pipe 到 `res`，或改用 `http(s).request`）。

## 5. `private-files.ts` 的 0600 写法与口令文件位置

- `writePrivateFileAtomicSync`（`private-files.ts:26-41`）：先 `ensurePrivateDirectory` 建 0700 目录（17-20），同目录写 `.<name>.<pid>.<uuid>` 临时文件、mode 0600，`rename` 覆盖，再 `chmod` 一次；失败删临时文件。Windows 跳过 chmod（8-15）。
- 现有私有文件：
  - `$PASEO_HOME/local-credential`：每次运行 `randomBytes(32)` base64url（43 字符），`wx` + 0600 写入（`local-credential.ts:12-26`），启动时写（`bootstrap.ts:1679`）、失败与关闭时删（`1879`、`1894`）；`SECURITY.md:53`。
  - `$PASEO_HOME/daemon-keypair.json`（`daemon-keypair.ts:65`）、`config.json`（`persisted-config.ts:586`）。
  - `$PASEO_HOME/api-endpoints/`（`api-endpoints/store.ts:9-18` 列表，`214-216` 统一写入）：`endpoints.json`、`keys.json`（真实 key）、`takeover-claude.json`、`takeover-codex.json`、`codex-api-key`（`161-173`；Codex `auth.command` 用 `/bin/cat` 读它，`service.ts:605-616`）、`backups/`。
- Claude 侧的 key 不在 Osuna 目录里，而是写进 `~/.claude/settings.json` 的 `env.ANTHROPIC_AUTH_TOKEN`（`claude-settings-patch.ts:66-72`；ADR `docs/adr/0004-api-endpoint-rewrites-cli-config.md` 「On Claude, write …」）。中转站方案下写进去的会是 Osuna 口令。
- 两种现成模式的差别：
  - 每次运行重生成（local-credential 模式）：daemon 每次启动都得重写 `settings.json` / `config.toml`，否则上次口令失效；
  - 持久保存（keys.json / codex-api-key 模式）：一次写入长期有效，同用户进程可读（`SECURITY.md:53` 的同一限制）。
  两者都不需要新的文件写法。

## 判断清单

### 可直接挂（不改现有代码即可依赖）

1. Host 白名单放行 `127.0.0.1` / `localhost` / 任意 IP 带端口：`hostnames.ts:41-46`。
2. 服务代理把 IP Host 归为 daemon 自身请求：`service-proxy.ts:622-643`。
3. CORS 不拒绝无 Origin 的请求：`bootstrap.ts:780-794`。
4. HTTP 与 `/ws` 共用监听，新增普通 HTTP 路由不与 WS 冲突：`websocket-server.ts:879`。
5. 0600 原子写与 `$PASEO_HOME/api-endpoints/` 目录现成：`private-files.ts:26-41`、`store.ts:214-216`。
6. 上游 header 组装 / 超时取消 / 错误脱敏工具可复用：`upstream-http.ts`、`upstream-connection.ts:38-62,78-79`、`upstream-models.ts:81-89`。
7. 绑定后端口可用时机与 URL 拼法：`bootstrap.ts:259-289`、`1705-1709`。
8. 「免 daemon 密码 + 自带 token 校验」的路由样板：`/api/terminal-activity`（`bootstrap.ts:309-357,796-800`）、`/mcp/agents`（`auth.ts:115,136-155`；`bootstrap.ts:1589-1600`）。

### 需改哪几处

1. **鉴权层**：路由挂在 `bootstrap.ts:810` 之后会被 bearer 中间件按 daemon 密码比对（`auth.ts:77-113`）；要么加入 `SELF_AUTHENTICATING_ROUTES`（`auth.ts:115`）并在路由内比对 Osuna 口令，要么挂在 810 之前。无密码时中间件放行一切，口令校验无论如何都要路由自己做。
2. **请求体**：全局 `express.json()` 100 kb 且整体缓冲（`bootstrap.ts:816`；`body-parser/lib/types/json.js:56-58`）；中转站路由要挂在 816 之前，或自带解析器 / 原样流式转发。
3. **流式转发**：现有 `upstream-*.ts` 缓冲整包、服务代理只按 Host 转本机 http；需新写上游流式转发（`service-proxy.ts:247-259,318-356` 的 hop-by-hop 与 pipe 写法可借）。
4. **端口变动**：没有钩子；`settings.json` / `config.toml` 里的地址只在启用/编辑时写（`service.ts:446-490,572-598`），`ApiEndpointService` 构造时不知端口（`bootstrap.ts:943-959` vs `1705`）；需新增「绑定后写入/校验 CLI 配置地址」的步骤。`daemon.listen` 改动要重启（`daemon-config-store.ts:172-195,451-458`），端口被占直接退出（`bootstrap.ts:1697-1700`；`daemon-worker.ts:336-338`）。
5. **非 TCP 监听**：unix socket / pipe 下 `createAgentMcpBaseUrl` 为 `null`（`bootstrap.ts:269-273`），中转站地址无从生成；需定义该模式下的行为。
6. **网络暴露**：`0.0.0.0` / 反向代理 / Docker 下中转站随 daemon 一起暴露（`SECURITY.md:59`），口令强度与文档（`SECURITY.md:47-67`）需同步考虑。
7. **口令生命周期**：每次运行重生成（需每次启动重写 CLI 配置）还是持久（`keys.json` 模式），两条路径对第 4 点的要求不同；Claude 侧口令会落在 `~/.claude/settings.json`（`claude-settings-patch.ts:66-72`）。
8. **WebSocket 路径**（仅当中转站需要 WS 时）：`ws` 对非 `/ws` 的升级回 400（`node_modules/ws/lib/websocket-server.js:217-225,271-274`），需在 `bootstrap.ts:897` 之前注册自己的 upgrade 处理器。当前三种协议都是 HTTP + SSE，不触发。

## 未查清

- 仓库里只有 6767 / 6768，没有 6769；票里的「dev 的 6769」是本机 `PASEO_LISTEN` 的取值，不是代码约定。
- Claude Code 实际发 `Authorization: Bearer` 还是 `x-api-key` 只来自仓库注释（`upstream-connection.ts:42-46`），Codex 用 `auth.command` 后的 header 形式仓库未写；按记忆不在本机跑 CLI 验证。
- `/mcp/agents` 关闭 SDK 自带 Host 校验的注释（`bootstrap.ts:1559-1562`）说明 SDK 要求精确匹配 Host；若中转站借用 MCP SDK 之外的流式库，需另看其 Host 处理。
