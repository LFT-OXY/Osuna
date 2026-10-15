# 02 — daemon 现有的 HTTP 服务能不能直接挂中转站

Type: research
Status: resolved
Blocked by: None

## Question

决策是中转站挂在 daemon 现有 HTTP 服务上、不单开端口，Agent 配置文件写 Osuna 生成的随机口令当 API key。要查清（全部在本仓库）：

1. `packages/server/src/server/bootstrap.ts` 的 express 服务：监听地址与端口怎么来（`PASEO_LISTEN`、dev 的 6769、正式 6767）、有没有 Host / Origin 校验或 DNS rebinding 防护（`SECURITY.md`）会拒掉 CLI 发来的 `127.0.0.1:<port>` 请求、`express.json()` 的大小限制对几 MB 的对话请求体是否够、现有路由里哪些已经做流式转发（服务代理 `docs/service-proxy.md`）可复用、WebSocket 升级与普通 HTTP 共用监听的方式。
2. 端口变化：daemon 换端口（配置改动、端口被占自动换）时现有代码有没有「重写 Agent 配置」的钩子；`PASEO_HOME` 与端口的对应关系。
3. 远程：手机经中继（`packages/relay`）连 daemon 时，中转站只需本机可达；确认中继不会把 HTTP 路径暴露出去。
4. 已有的 `api-endpoints/upstream-connection.ts`、`upstream-models.ts` 现在如何向上游发请求（fetch？代理？超时？），能否作为中转站向上游转发的基础。
5. 现有 `private-files.ts` 的 0600 写法，口令文件放哪。

产出 `research/daemon-http-host.md`：每条附文件行号；给出「可直接挂 / 需改哪几处」的判断，不写方案偏好。

## Answer

- 监听、Host 白名单、服务代理分类、CORS 都不会拒掉 CLI 发来的 `127.0.0.1:<port>`；HTTP 与 `/ws` 共用一个 `http.Server`，新增普通 HTTP 路由不冲突。
- 不能原样挂：daemon 设密码时 bearer 中间件（`auth.ts:77-113`）会 401 Osuna 口令，须仿 `/mcp/agents` 列入免检并自校验；全局 `express.json()`（`bootstrap.ts:816`）100 kb 且整体缓冲，路由要挂在它之前或自带流式处理。
- 现有转发都不是流式：`upstream-*.ts` 用 `response.text()` 缓冲，服务代理只按 Host 转本机 http 端口；可借 header/超时/脱敏工具与 pipe 写法，转发层要新写。
- 端口变化没有重写 Agent 配置的钩子；`daemon.listen` 改动需重启，端口被占直接退出；真值在 `$PASEO_HOME/paseo.pid` 的 `listen`，unix socket/pipe 模式下无可写入的 HTTP 地址。
- 中继只承载 WebSocket 协议会话，不暴露 HTTP 路径；中转站可达范围等于 daemon 监听的可达范围。
- 0600 写法与 `$PASEO_HOME/api-endpoints/` 现成；口令每次运行重生成还是持久保存，决定是否每次启动都要重写 CLI 配置。

报告：`research/daemon-http-host.md`
