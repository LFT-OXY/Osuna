# 联网搜索按接口放行：事实调研

只记事实和后果，不做取舍、不写推荐。每条标核实级别：

- **源码核实**：读过源码（压缩 JS 给能 grep 到的原样字符串）。
- **文档所说**：官方文档原文。
- **推断，未核实**：从源码或文档推出，没有实际运行验证。

没有启动过 Claude Code 或 Codex 会话，没有读写 `~/.claude`、`~/.codex`、magpie 的用户数据目录里的配置。外部源码都下载到新建的空临时目录，只当文本读，没有执行。有一处要说明：这个环境里的 `grep` 是 Claude Code 自带的 shell 函数，会以 ugrep 模式调用 Claude Code 可执行文件做文本搜索（不开会话、不碰登录）。调研前期的 `grep`（包括子任务的）都走了它，发现后改用 `/usr/bin/grep`。

## 读过的来源

| 来源 | 版本 |
| --- | --- |
| Osuna | `main` @ `d8948dad2` |
| magpie | `7597c13237c6eaecba89b478771f2f1d244108e4` |
| Codex | `openai/codex` `main` @ `ce0323f2f2d3b25e82806cd555237da3db4e1897`（2026-10-17，浅克隆） |
| Claude Code | `@anthropic-ai/claude-code@2.1.302`（npm `latest`；`stable` 标签是 2.1.292）。包里只有原生二进制的占位和安装脚本，没有 `cli.js`；源码读自平台包 `@anthropic-ai/claude-code-darwin-arm64@2.1.302` 的二进制 `package/claude`（Bun 编译，内嵌明文 JS，`// Version: 2.1.302`，`GIT_SHA:"2ef144e6…"`，构建时间 2026-10-16） |
| Claude Agent SDK | 子任务读了 `@anthropic-ai/claude-agent-sdk@0.3.302` 的 `sdk.mjs`、`sdk.d.ts`；我另外核对了 Osuna 装的 `0.3.246`（`node_modules/@anthropic-ai/claude-agent-sdk`） |
| 文档（2026-10-17 抓取） | Claude Code：<https://code.claude.com/docs/en/tools-reference>、`/permissions`、`/settings`、`/env-vars`、`/hooks`、`/prompt-caching`、`/llm-gateway`、`/llm-gateway-protocol`、`/llm-gateway-connect`、`/feature-availability`、`/agent-sdk/claude-code-features`；Anthropic API：<https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool>；旁证 GitHub issue anthropics/claude-code#82693（用户抓包，v2.1.220） |

压缩 JS 的出处写作 cc@2.1.302 `<能 grep 到的原样字符串>`；在二进制里用 `LC_ALL=C /usr/bin/grep -a -F '<字符串>' claude` 能搜到。二进制里约 97 MB 处是字节码常量池副本，约 211 MB 之后是 JS 源码。

## Claude Code

### 1. WebSearch 怎么工作

**另发一次请求**（源码核实，已在二进制里复核）

- WebSearch 是 Claude Code 的客户端工具（主对话请求里是一个带 `input_schema` 的普通工具，参数 `query`、`allowed_domains`、`blocked_domains`）。模型调用它时，`call()` 另起一次模型查询，走和主循环同一条管线、同一个 `ANTHROPIC_BASE_URL`，流式（子任务查到最终是 `beta.messages.create({...,stream:!0})`，流式失败有非流式回退）。
- 这次子请求的构造，原文：cc@2.1.302 `let R=Ae({content:"Perform a web search for the query: "+b}),O={type:"web_search_20250305",name:"web_search",allowed_domains:r.allowed_domains,blocked_domains:r.blocked_domains,max_uses:8,...w&&{search_profile:w}},A=k("tengu_plum_vx3",!1)?VE():h.mainLoopModel();`，随后（中间有省略）`aIt({messages:[R],systemPrompt:bi(["You run a web search for another Claude model, which is waiting on the result and can search again. Search once, then reply with a brief summary of the results."]),thinkingConfig:{type:"disabled",mechanical:!0},tools:[],…,options:{…model:A,toolChoice:{type:"tool",name:"web_search"},…extraToolSchemas:[O],querySource:"web_search_tool",enablePromptCaching:!1,…,...h.helperEffortFor(A)}})`。
  - 工具：只有这一个服务端工具，`type:"web_search_20250305"`、`name:"web_search"`、`max_uses:8`；`allowed_domains` / `blocked_domains` 直接用主模型传的值，没传就不出现，两者同时传会被拦下（cc@2.1.302 `Cannot specify both allowed_domains and blocked_domains`）。没有 `user_location`。整个程序里只有 `web_search_20250305` 这一个搜索工具类型。
  - `search_profile` 只在 `yft()` 为真时出现，而 cc@2.1.302 `function yft(){if(!Ma())return null;`、`function Ma(){return Pe()==="firstParty"&&Pi()}`：自定义 `ANTHROPIC_BASE_URL` 时不出现。
  - `tool_choice` 强制调用 `web_search`，思考关闭，不打缓存标记。
  - system：前面是归属头块和 CLI 身份句（交互式 “You are Claude Code, Anthropic's official CLI for Claude.”，SDK 有别的变体），后面接上面那句 “You run a web search for another Claude model…”。user：`"Perform a web search for the query: "+查询词`。
  - beta 头：没有专为这次请求加的；`web-search-2025-03-05` 只在 vertex 的新模型和 foundry 上加，其余 beta 与主循环同一套（子任务源码核实）。
- 旁证：magpie 的测试按 Claude Code 2.1.285 写的这次子请求是 system 第二段 “You are an assistant for performing a web search tool use”、tools `[{"type":"web_search_20250305","name":"web_search","max_uses":8}]`（`magpie:internal/gateway/claude_code_websearch_test.go:42-93`）。2.1.302 的 system 句子已经换了（上面那句），工具定义一样。

**用哪个模型**（源码分支已核实；运行时走哪条未核实）

- `A=k("tengu_plum_vx3",!1)?VE():h.mainLoopModel()`。`k` 是 GrowthBook 远端开关，默认 false。
  - 开关为 false：用这次查询的主循环模型（主对话就是会话模型；在子代理里就是子代理的模型）。
  - 开关为 true：用 `VE()`（中间有省略）：cc@2.1.302 `function VE(){let e=a.ANTHROPIC_SMALL_FAST_MODEL;if(e!==void 0)return ov(fR(e));if(!lht()){…return et()}return a.ANTHROPIC_DEFAULT_HAIKU_MODEL!==void 0?ov(u1()):cv(u1())}`，其中 cc@2.1.302 `function lht(){if(a.ANTHROPIC_SMALL_FAST_MODEL!==void 0)return!0;return a.ANTHROPIC_DEFAULT_HAIKU_MODEL!==void 0||dht()||Pe()==="gateway"&&Yr(u1())}`、`function dht(){let e=Pe();return e==="firstParty"&&(Pi()||IWs())||JH(e)}`，`IWs()` 在设了 `ANTHROPIC_AUTH_TOKEN` 时直接为假，`Pi()` 在 `ANTHROPIC_BASE_URL` 不是 `api.anthropic.com` 时为假（除非 `_CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL` 或远端客户端数据另说）。
  - 推断，未核实：Osuna 的写法（`ANTHROPIC_BASE_URL` 是本机中转站、有 `ANTHROPIC_AUTH_TOKEN`、`settings.json` 里的 `ANTHROPIC_SMALL_FAST_MODEL` / `ANTHROPIC_DEFAULT_HAIKU_MODEL` 已被拿掉）下 `lht()` 为假，`VE()` 落到 `et()`（会话选定的模型），所以**不论远端开关怎么取，WebSearch 子请求的模型名都是会话模型**（在子代理里是子代理的模型）。用户进程环境里自己设了那两个变量时例外。
- 没有专门指定这次子请求模型的设置或环境变量（子任务源码核实）。
- 旁证（issue #82693，v2.1.220 抓包）：直连时子请求是 `claude-haiku-4-5-20251001`；设了 base URL 后是会话模型，并带 `output_config.effort`，在思考关闭时被上游 400 拒。

**期望收到的块，怎么解析**（源码核实，已复核）

- 流里 `server_tool_use` 只用来显示进度（读 `input_json_delta` 里的 `"query"`），`web_search_tool_result` 只取 `content_block_start` 给的完整 content（子任务核了流组装代码）。
- 解析函数原文（中间有省略）：cc@2.1.302 `` function fs(e,r,n){let s=[],p="",h=0,y=0;for(let b of e){if(b.type==="server_tool_use"){…}if(b.type==="web_search_tool_result"){if(y++,!Array.isArray(b.content)){let v=`Web search error: ${b.content.error_code}`;…s.push(v);continue}let w=b.content.map((v)=>({title:v.title,url:v.url}));s.push({tool_use_id:b.tool_use_id,content:w})}if(b.type==="text")p+=b.text}… ``。结果项只取 `title` 和 `url`；`text` 块累积成字符串结果；其他块忽略。不需要 `encrypted_content`、`page_age`、引用。
- 给主模型的 tool_result 是一段字符串：`Web search results for query: "<查询词>"`，然后每条结果（文字原样；链接组是 `Links: ` 加 JSON 数组；空组 `No links found.`），结尾 `REMINDER: You MUST include the sources above in your response to the user using markdown hyperlinks.`（cc@2.1.302 `mapToolResultToToolResultBlockParam(e,r){` 一段）。子请求本身的块不进主对话历史，只有这段字符串进去。

**失败或没有搜索块时，主模型看到什么**（源码核实，已复核）

| 情况 | 主模型收到的 tool_result |
| --- | --- |
| 子请求 API 报错（管线内重试过） | `is_error: true`，内容是错误文本（`API Error` 开头）。代码：`if(Q!==null&&Oe.results.length===0)throw new x(Q,"web-search-side-query-api-error")`。流开始后断掉是 “The search was cut off before any results arrived. Try again.” |
| 200，只有文字、没有搜索块（上游忽略了服务端工具、或工具被中转站剔掉） | **不报错**：那段文字当作搜索结果，即「标题行 + 模型写的文字 + REMINDER」，没有链接 |
| 200，内容为空 | 不报错：只有标题行和 REMINDER |
| 上游回 `web_search_tool_result_error` | 结果里一行 `Web search error: <error_code>`，不是 `is_error` |
| 会话搜索次数用完 | 文字结果 `Web search was not performed: …`；上限 `CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION`，默认 200 |

- 文档所说（tools-reference「WebSearch tool behavior」）：“When the search request hits an overloaded API, Claude Code retries it with backoff; a call that still fails returns an error result. Before v2.1.212, the API error text could reach Claude as if it were search results.” 同节还说 “The search backend is not configurable. To search with a different provider, add an MCP server that exposes a search tool.”
- 子任务注明：报错后到底走无包装的 `content:Mi` 分支还是外层的 `<tool_use_error>Error calling tool …` 分支，没有运行验证。

**上游真的执行了搜索时，Claude Code 这边还要什么**（源码核实，按子请求构造与 `fs()` 推出）

- 上游要接受上面那份请求：`web_search_20250305`、`max_uses:8`、强制 `tool_choice`、思考关闭、可能带 `output_config.effort`、流式。不需要专门的 beta 头。
- 回标准 SSE；`web_search_tool_result` 的完整 content 放在 `content_block_start` 里；结果项要有 `title`、`url`；错误用 `{error_code}` 对象。`encrypted_content`、引用、`server_tool_use` 的 input 都不需要。
- `call()` 不看 `stop_reason`，没有 `pause_turn` 续传（推断，未核实）。
- 旁证：magpie 提交 `e8315b18` 称用真实 Claude Code 2.1.285 经 sub2api（claude_code_only）开了开关后 “WebSearch returns results”。

### 2. 什么条件下 Claude Code 自己就不提供 WebSearch

**`isEnabled`**（源码核实，已复核）原文：cc@2.1.302 `isEnabled(){if(!sn(CDs))return!1;let e=Pe();if(e==="firstParty"||JH(e))return!0;if(e==="gateway")return!1;if(e==="vertex")return DMo(Ke(et()));if(e==="foundry")return!0;return!1}`，`CDs="allow_web_search"`（组织策略）。

- 按 API provider（cc@2.1.302 `function Pe(){if(Br()||pet()||met())return"gateway";return a.CLAUDE_CODE_USE_BEDROCK?"bedrock":a.CLAUDE_CODE_USE_FOUNDRY?"foundry":a.CLAUDE_CODE_USE_ANTHROPIC_AWS?"anthropicAws":a.CLAUDE_CODE_USE_ANTHROPIC_GOOGLE_CLOUD?"anthropicGoogleCloud":a.CLAUDE_CODE_USE_MANTLE?"mantle":a.CLAUDE_CODE_USE_VERTEX?"vertex":"firstParty"}`）：
  - firstParty、anthropicAws、anthropicGoogleCloud（`JH`）：提供；
  - bedrock、mantle、gateway：不提供；
  - vertex：按会话模型，`DMo(e)` 为 `!_r(e,"claude-opus-4-0")`，比 opus-4-0 早的模型不提供（子任务源码核实）；
  - foundry：提供，部署不支持时调用才报 “Web search is not available on this Foundry deployment.”。
  - 文档所说：feature-availability 页的 Web search 一行 Bedrock 列为 ✗（另有 “Available where Amazon Bedrock is not: web search”，Google Cloud 上只有 Opus 4、Sonnet 4、Haiku 4.5 及以后）；web-search-tool 页 “Web search is not available on Amazon Bedrock”，Google Cloud 只有基础版，Foundry 的 Azure 部署只有 `web_search_20250305`，工具版本有 `web_search_20250305`、`web_search_20260209`（动态过滤）、`web_search_20260318`。
- **按 `ANTHROPIC_BASE_URL` 是否自定义：`isEnabled` 不看。** Osuna 只设 `ANTHROPIC_BASE_URL`，provider 仍是 firstParty，WebSearch 照常提供；现在藏起它的只有 `permissions.deny`。base URL 的判断（cc@2.1.302 `function _f(e){try{let t=new URL(e).host;return["api.anthropic.com"].includes(t)}catch{return!1}}`）只影响 `search_profile`、小模型选择、组织策略是否适用、tool search 默认开关（子任务源码核实）。自定义 base URL 时组织策略 `allow_web_search` 不生效（子任务源码核实，`rMr` 返回 `custom_base_url`）。
- **gateway 模式**：未公开的 `CLAUDE_CODE_USE_GATEWAY` 加上 base URL 和 token 时，会登记为 gateway 凭据（cc@2.1.302 `function tl(){{if(!a.CLAUDE_CODE_USE_GATEWAY)return!1;let e=a.ANTHROPIC_BASE_URL,n=a.ANTHROPIC_AUTH_TOKEN||o_t();`，已复核），子任务追到 provider 因此变成 gateway、WebSearch 关掉；从 `tl()` 到 `Pe()` 返回 gateway 的连接我没有逐行复核。程序内置的 Desktop 配置说明写 “In gateway mode Claude Code turns off its usage analytics and authenticated calls to Anthropic … and may hide its WebSearch tool”，其他副作用没追完。文档所说（claude-apps-gateway 页，说的是 Claude Apps 网关会话）：“Server-side web search | Not available | The CLI can't see which upstream provider the gateway routes to, so it can't verify web search support and disables WebSearch on gateway sessions”。
- 其他环境变量：没有 `CLAUDE_CODE_DISABLE_WEB_SEARCH` 一类变量；`CLAUDE_CODE_DISABLE_WEB_FETCH` 不影响 WebSearch（文档：“The WebSearch tool stays available”）；`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` 不进 `isEnabled`；`CLAUDE_CODE_SIMPLE`（即 `--bare`）的工具集里没有 WebSearch（cc@2.1.302 `if(a.CLAUDE_CODE_SIMPLE&&!r?.skipSimpleModeFilter){`）；搜索次数上限不能设成 0（文档）。`isEnabled` 里没有远端开关。
- **除 `permissions.deny` 外能关掉它的办法**（子任务源码核实）：`--disallowedTools` / SDK `disallowedTools`（来源 `cliArg` 的 deny）；`--tools` / SDK `tools` 不列 WebSearch（来源 `toolsNarrowing`）；任何设置来源的 deny，包括 `--settings` / SDK `settings`（flagSettings，始终启用）和托管设置；上面的 provider 变量与 `CLAUDE_CODE_SIMPLE`。
- 文档所说（tools-reference）：“WebSearch permission rules take no specifier. A bare `WebSearch` entry in `allow` or `deny` is the only form.”

### 3. 顺带：WebFetch 是否依赖服务端

- 不依赖服务端工具（源码核实）：本地抓网页、HTML 转 Markdown，再交给 `VE()` 选的模型处理（cc@2.1.302 `querySource:"web_fetch_apply"`），请求同样发到 `ANTHROPIC_BASE_URL`。开关是 cc@2.1.302 `isEnabled(){return!a.CLAUDE_CODE_DISABLE_WEB_FETCH&&sn(Jft)}`，与 provider 无关。
- 抓取前的域名预检写死请求 `https://api.anthropic.com/api/web/domain_info?domain=…`，不跟随 base URL；`skipWebFetchPreflight: true` 可以关掉（cc@2.1.302 `if(!nr().skipWebFetchPreflight){`）。文档所说（llm-gateway-connect）：“Turn it off separately with `skipWebFetchPreflight: true` in settings if your network blocks that host”。Osuna 现在不写这个键。

### 4（Claude Code 一侧）. deny 规则、SDK 参数、设置来源怎么叠加

- **整名 deny 把工具从发给模型的列表里拿掉**（源码核实，已复核）：cc@2.1.302 `function XY(e,n){let o=[...dc(n),...xe(e,n)],r=wTo(n,o);return e.filter((d)=>{if(de(n,d,o,r)||d.mcpInfo?.effectiveMaxPermission==="blocked")return!1;`，deny 规则汇总所有来源：cc@2.1.302 `var WU=[...Ps,"cliArg","command","session","toolsNarrowing","mcpServerPolicy","hostCredential"]`（`Ps` 是 user/project/local/flag/policy 五种设置来源）。文档所说（permissions）：“A bare tool name like `Bash` removes the tool from Claude's context entirely, so Claude never sees it.”；prompt-caching 页「Denying an entire tool」：“Claude can't call that tool from your next request on, whether you add the rule through `/permissions` or by editing a settings file directly … When tool search is unavailable or disabled, Claude Code removes the definition from the next request, which invalidates the cache, and so does removing the rule later.”，同页把 “a custom `ANTHROPIC_BASE_URL` gateway” 列为 tool search 不可用的情形。也就是说，在 Osuna 这种自定义 base URL 下，加上或去掉这条 deny，下一次请求的工具定义就变，前缀缓存随之失效。
- 模型硬调一个被拿掉的工具时，回 `No such tool available: …`，被 deny 的会补一句 cc@2.1.302 `${e} is disabled for this session, in subagents as well as here.`（已复核）。
- **各来源的 deny 取并集**：文档所说（permissions）“If a tool is denied at any level, no other level can allow it … `--disallowedTools` can add restrictions beyond what managed settings define.”；“a user-level deny blocks a project-level allow”。所以 `settings.json` 里有 `"WebSearch"`，任何会话级的东西都放不开它；反过来，`settings.json` 里没有时，会话级的 deny（`--disallowedTools`、`--settings`、`applyFlagSettings`）可以单独给某个会话关掉它。
- **SDK 参数**：`disallowedTools` 变成 CLI 的 `--disallowedTools`（Osuna 装的 0.3.246 的 `sdk.mjs`：`if(D.length>0)Z.push("--disallowedTools",D.join(","))`，已复核），`sdk.d.ts` 原文 “These tools will be removed from the model's context and cannot be used”。`settingSources` 变成 `--setting-sources=…`（同文件已复核）。`settings` 进 flagSettings 层（`sdk.d.ts:1986-2003`，“the highest priority among user-controlled settings”）。`Query.applyFlagSettings()` 可在会话中途合并 flagSettings（`sdk.d.ts:2483-2507`，“Equivalent to the inline `settings` option of `query()`, but applies mid-session … Successive calls shallow-merge top-level keys … Pass `null` for a key to clear it”；只在流式输入模式可用）。以上引用都是 0.3.246。
- **`settingSources`**（源码核实，已复核 `Wo()`）：CLI 只读启用的来源，flagSettings 和 policySettings 总是启用（cc@2.1.302 `t.add("flagSettings"),t.add("policySettings")`）。不含 `"user"` 时，`~/.claude/settings.json` 里的 `env` 和 `permissions` 都不生效（子任务源码核实）。SDK 文档：省略时加载全部，`[]` 关掉文件设置（`sdk.d.ts:2029-2038`）。
- **运行中的会话改 `settings.json`，下一次请求就变**（子任务源码核实，已复核日志字符串 cc@2.1.302 `Settings changed from ${n}, updating app state`）：交互式与 SDK/无头模式都订阅设置文件变化，重读各来源的权限规则、重算工具池；外部加上或去掉 `"WebSearch"`，下一次发给模型的工具列表就跟着变。`env` 走同一个事件，但在另一处重写 `process.env`，并要求工作区已信任。文档所说（settings）：“Claude Code watches your settings files and reloads them when they change, so it applies most edits to the running session without a restart, including edits to `permissions`, `hooks`, and credential helpers such as `apiKeyHelper`”。
- **PreToolUse 钩子**（子任务源码核实；输入字段已复核）：对 WebSearch 会触发（整名 deny 拿掉之后模型调不到，也就不触发）。输入是 `{session_id, transcript_path, cwd, scratchpad_dir, prompt_id, permission_mode, agent_id, agent_type, effort}` 加 `hook_event_name:"PreToolUse", tool_name, tool_input, tool_use_id`，**没有 `model`**（cc@2.1.302 `hook_event_name:"PreToolUse",tool_name:e,tool_input:r,tool_use_id:n`；文档 hooks 页：“Only `SessionStart` hooks can receive a `model` field, and Claude Code doesn't always include it”，“There is no `$CLAUDE_MODEL` environment variable”）。钩子返回 deny 时主模型收到 `is_error` 的 tool_result，内容是 `permissionDecisionReason`（没给时 `Hook PreToolUse:WebSearch denied this tool`）；退出码 2 时是 `PreToolUse:WebSearch hook error: [<命令>]: <stderr>`（子任务源码核实，这两句我没有在二进制里复核到原样字符串）。

## magpie

出处写作 `magpie:文件:行号`，都在 `7597c132`。引用的注释、提交说明、测试断言只是 magpie 一方的说法，测试没有运行。

名词对齐：界面上的 “Searches the web by itself” 是字段 `Provider.Searches`（JSON 键 `searches`）。magpie 的「代搜」有两种：**代搜供应商**（searcher，一家自己会搜的供应商用它的模型替别的模型搜）和**搜索 API**（Tavily、Brave、Exa、Firecrawl、You.com、SearXNG）。

### 5. 开关在中转站里起什么作用

开关本身（源码核实）

- 字段与注释：`magpie:internal/provider/provider.go:214-219`，原文 “Searches says the vendor answers a web search tool offered on its Anthropic or Responses API by itself (web_search_20250305, web_search) … A request offering one then goes to it as the client sent it, rather than given magpie's search (#359).”
- 只在 `searchesItself` 里读：`saidTo := p.Searches && (proto == Anthropic || proto == Responses) && p.Base(proto) != ""`，也就是**只对这家填了地址的 Anthropic 或 Responses 接口算数**，只有 Chat 地址的不算（`magpie:internal/gateway/search.go:98-117`）。登录账号不看这个开关（只有插件账号看）；不是登录账号的，开关为真就算会搜，否则查硬编码的官方主机表 `searchHosts`（:200-207：Responses 的 api.openai.com、api.x.ai、api.deepseek.com、open.bigmodel.cn、api.z.ai；Anthropic 的 api.anthropic.com、api.deepseek.com；Chat 的 openrouter.ai；Gemini 官方地址）。

识别请求里的搜索工具（源码核实）

- 先粗筛正文里有没有 `web_search` / `oogle_search` / `googleSearch` 字样，再解析看 `WebSearch` 标记（`searchAsked`，`magpie:internal/gateway/search.go:209-217`）。
- Anthropic：`type` 非空、不是 `custom`、没有 `input_schema` 的算服务端工具，其中 `type` 以 `web_search` 开头的置 `WebSearch=true`（`magpie:internal/gateway/anthropic.go:173-179`）。Responses：`type` 以 `web_search` 开头的都算（`web_search`、`web_search_preview`、带日期的），不看 `external_web_access`（`magpie:internal/gateway/responses.go:403-406`、`:446-465`）。Chat：`web_search_options` 非 null 或工具里有 `web_search*`（`magpie:internal/gateway/chat.go:126-130`）。
- 识别结果只有一个布尔值；走翻译时客户端写在工具上的 `max_uses`、域名过滤等都不保留（`magpie:internal/gateway/ir.go:162`）。

候选怎么选、没开开关怎么办（源码核实，关键处已抽查）

- **选候选不看开关**：同一模型的多家、分组成员、各家自配的后备由 `plan` / `planGroup` 排序，再按协议排，都不看搜索；路由、冷却、亲和相关文件里没有任何搜索筛选（`magpie:internal/gateway/fallback.go:335-395`，`gateway.go:4660-4675`）。没开开关的照样入选，自动切换也照样会切到没开开关的那家。
- **每个候选各自决定直通还是重建**：请求带搜索且这家在客户端协议上不会搜（`!searchesModel(...)`，Chat 客户端除非对方是另一个 magpie）时，不直通，改为在客户端自己的协议上重建（`magpie:internal/gateway/gateway.go:3439-3449`、`:3507-3511`）。会搜的那家直通，工具原样发出（测试断言 `max_uses:8` 和三段 system 原样保留，`magpie:internal/gateway/search_test.go:489-510`）。
- 直通时按厂商的小改动（已抽查）：发给 Grok 时去掉 `external_web_access`（`magpie:internal/provider/grok.go:262-271`）；发给 ChatGPT 后端时，输入里回放了 `web_search_call` 却没声明 `web_search` 工具的请求，补上只读缓存的 `{"type":"web_search","external_web_access":false}`。注释原文：“The ChatGPT backend turns away a request whose input replays a web search (a web_search_call item) without the web_search tool among its tools: HTTP 200, then only an error event, "response protection is unavailable" (#1270).”（`magpie:internal/provider/codex_request.go:465-503`，`internal/gateway/codex_backend.go:707-711`）。
- **重建时先找这家会搜的那个协议**：例如只填了 Responses 地址又开了开关的中转，Claude Code 的搜索请求会被换到 Responses、写成那边的原生 `{"type":"web_search"}`（`magpie:internal/gateway/gateway.go:5399-5420`；改写成目标协议原生工具见 `anthropic.go:960-962`、`responses.go:1211-1218`）。这条路径没找到专门测试（magpie 子任务注明是从代码路径推出）。
- **这家不会搜**：能代搜（`canSearchFor`：Web search 插件开着，且有代搜供应商或至少一个搜索 API，`magpie:internal/gateway/search_kimi.go:45-61`、`search_api.go:38-49`）就代搜：给模型加一个函数工具 `web_search`（冲突时叫 `magpie_web_search`，只有 `query` 参数），拦下调用、执行搜索、把结果当工具结果再问，最多 6 轮；回给客户端时按客户端协议写成原生块（Anthropic 的 `server_tool_use` + `web_search_tool_result`，Responses 的 `web_search_call`）（`magpie:internal/gateway/search.go:36`、`:505-515`、`:905-1056`；`anthropic.go:1483-1497`、`:1583-1598`；`responses.go:1741-1750`）。不能代搜就把搜索工具剔掉再发（`magpie:internal/gateway/gateway.go:4725-4729`）。
- **不报错**：请求层面没有「这家不支持搜索」的错误。错误文字只出现在代搜失败时塞给模型的工具结果里（`"search failed: "+err`，`magpie:internal/gateway/search.go:1030`）。
- **用户在模型名里点名了某家**：候选只有那一家（加它自己配的后备），那家不会搜时照样代搜或剔除，不会为了搜索改投别家（`magpie:internal/gateway/fallback.go:357-366`）。
- **开了开关的中转不会被自动挑来替别的模型代搜**：`searchRank` 一开头就把 `p.Searches` 置为 false（`magpie:internal/gateway/search.go:231-259`，已抽查），注释给的理由是会花掉中转的额度，而且只服务 Claude Code 的中转会拒收 magpie 自己发的、没有 `metadata.user_id` 的请求。只能在设置里手动指定为代搜供应商（`:261-281`）。
- 代搜供应商替别的模型搜时，magpie 自己发一个 Anthropic Messages 请求，带 `{"type":"web_search_20250305",…,"max_uses":3}`（`magpie:internal/gateway/search.go:867-893`）；这个代搜供应商的回复里既没有 `server_tool_use` 也没有 `web_search_tool_result` 时，记为「没搜就答了」，设置页提示它的账号或套餐可能不提供联网搜索（`:766-865`，`app.js:20940`）。

### 6. magpie 给 CLI 写的配置；Codex 的 web_search；`/v1/alpha/search`

- **Claude Code**：magpie 不写任何 WebSearch 规则（`internal/agent/claude*.go` 搜 `websearch|deny|permissions` 无命中，已复查）。它写进 `settings.json` 的是 `env` 的 `ANTHROPIC_BASE_URL`、`ANTHROPIC_AUTH_TOKEN` 和各档模型变量（`magpie:internal/agent/claude.go:25-37`）。它写 `permissions.deny` 只为用户在资料库里关掉的 MCP 工具（`mcp__<server>__<tool>`，`magpie:internal/library/mcp_tools_off.go:31-34`、`:285-301`）。源码核实。
- **Codex 配置**：只写 `[model_providers.magpie]`（`name`、`base_url`、`wire_api="responses"`、`experimental_bearer_token`、`http_headers = { x-openai-actor-authorization = "magpie" }`）和 `model_provider`、`model_catalog_json`，没有 `web_search` 相关键（`magpie:internal/agent/codex.go:388-408`，已抽查）。那个请求头让 Codex 把它当「OpenAI actor」，于是给它出画图工具和 `web.run`（Codex 的判断见下文「Codex 自身」：`model-provider-info/src/lib.rs:629-637`）。Osuna 的专用表只写 `name`、`base_url`、`wire_api`、`experimental_bearer_token`，没有这个头（`codex-config-patch.ts:400-404`）。
- **Codex 发来的 `web_search`**：按第 5 题同样处理（识别、直通、重建、代搜、剔除）。magpie 注释原文 “Codex offers web_search on every turn”（`magpie:internal/gateway/gateway.go:3439-3443`）。`external_web_access:false`（cached）不影响判断，代搜照样实时搜（`magpie:internal/gateway/search_own_api_test.go:56` 起）。
- **`/v1/alpha/search`**：Codex `web.run` 工具的接口（`magpie:internal/gateway/gateway.go:650-652` 挂路由，`codex_search.go:17-25` 注释：“Codex offers web.run since 0.143 for a provider that sends x-openai-actor-authorization, as magpie's does, on a model whose catalog entry says use_responses_lite … Unanswered, the 404 ended the turn: Codex takes any failure of web.run as fatal”）。只读 `model` 和 `commands.search_query` / `image_query` 里的 `q`、`domains`，回 `{"encrypted_output", "output"}`（`codex_search.go:27-47`）。ChatGPT 账号的模型转发到 `https://chatgpt.com/backend-api/codex/alpha/search`；其他情况对每条查询走代搜链，做不到也回 200 加一段文字（`codex_search.go:49-84`、`:190-234`）。它是代搜链的另一个入口，不读 `Searches` 开关。源码核实（Codex 侧行为是 magpie 注释所说，已用 Codex 源码印证 `web.run` 的出现条件，见下文「Codex 自身」）。

### 7. 没有任何接口开开关、也没配代搜时的默认行为

前提：magpie 认定「会搜」不只看开关。官方主机表里的地址、Claude / Codex / Grok / Google 登录账号、Kimi Code 与 WorkBuddy 套餐、另一个 magpie 都算会搜，并且会被自动挑来代搜（`magpie:internal/gateway/search.go:200-207`、`:238-259`）。下面说的是这些一个都没有、也没有搜索 API（`canSearch()` 为假）的情形。

- **Claude Code**：WebSearch 那次子请求不直通，在 Anthropic 协议上重建，`web_search_20250305` 被去掉，`metadata` 保留，上游回 200 和模型凭记忆写的文字（`magpie:internal/gateway/claude_code_websearch_test.go:42-93`，已抽查；测试断言，未运行）。测试里这次子请求的样子：system 第二段是 “You are an assistant for performing a web search tool use”，user 是 “Perform a web search for the query: …”，tools 是 `[{"type":"web_search_20250305","name":"web_search","max_uses":8}]`，UA `claude-cli/2.1.285`。Claude Code 端看到什么只有 magpie 的文字：提交 `1b8f674a` “magpie then took the web_search_20250305 server tool out of Claude Code's WebSearch request, the model answered from nothing, and WebSearch showed no results.”；`magpie:docs/subsystems/gateway-routing.md:278-281` “canSearchFor was false and Claude Code's WebSearch came back empty (#1798)”（仓库文字所述，已抽查）。
- **Codex**：Responses 请求里的 `web_search` 被去掉，照常发到 `/v1/responses`（`magpie:internal/gateway/search_own_api_test.go:15-54`，测试断言）。走 `web.run` 时回 200，`output` 原文 “magpie couldn't search the web for <query>: no provider that can search the web, nor a search API, is set up in magpie: add a search API in magpie's Settings → Models → Web search (or magpie search add <api> <key>), or a provider that can search”（`magpie:internal/gateway/codex_search.go:214-226`，已抽查）。
- CLI 帮助原文：“Without any of them, the client's search is left out.”（`magpie:internal/cli/search_cli.go:41-46`）。

### 8. 开关的文案、默认值、预设、检测

- **英文**（`magpie:internal/gui/assets/app.js:9193-9195`，已抽查）：行名 “Web search”；勾选项 “Searches the web by itself”；说明 “For a relay in front of Anthropic's or OpenAI's own API: Claude Code's WebSearch and Codex's web_search go to it as they were sent, not through magpie's search. magpie doesn't automatically search with it for other models, but you can name it as the searcher.”
- **简体中文**（`magpie:internal/gui/assets/i18n.js` 的 `zh` 块，第 6 行起到 7318 行，已抽查）：:1128「联网搜索」；:3294「自己能联网搜索」；:3312「用于 Anthropic 或 OpenAI 官方 API 前的中转：Claude Code 的 WebSearch 和 Codex 的 web_search 原样发给它，不经 magpie 搜索。不会自动用它为其他模型搜索，但可手动选为代搜供应商。」
- **在哪显示**：只在自定义供应商（没有预设、不是登录账号）的编辑器「高级」折叠区，且只在填了 Anthropic 或 Responses 地址时显示；控件是勾选框；保存时写 `body.searches = !!draft.searches && searchable()`（`magpie:internal/gui/assets/app.js:8692`、`:8813`、`:9188-9199`、`:9603`、`:19459-19465`）。CLI 写法 `magpie provider set my-relay search=yes`（`magpie:internal/cli/providers_cli.go:113-115`、`:1056-1063`）；插件的 config 钩子可以设 `searches: true`（`magpie:internal/plugin/providers.go:125-129`）。
- **默认值**：false。字段是普通 `bool`，新建草稿里没有它，GUI 测试断言 “a relay opens as not searching”（`magpie:internal/gui/tests/provider-search.test.cjs:98`）。复制供应商时带上（`magpie:internal/provider/provider.go:962`）。
- **按厂商或预设自动打开**：没有。没有任何预设或目录把 `Searches` 设为 true。厂商级的「自己会搜」是另外的硬编码判断（主机表、Command Code 模型名单、Codex 账号与 Grok 只在 Responses 上、Google 登录的 Gemini、另一个 magpie 的模型列表），与这个开关无关（`magpie:internal/gateway/search.go:106-110`、`:118-150`、`:157-197`、`:200-207`；`search_remote.go:13-84`）。
- **检测**：没有。供应商的「测试」只发最小请求，不涉及搜索（`magpie:internal/provider/test.go:33-36`）。只有代搜供应商有被动判断（见第 5 题最后一条），不针对这个开关。
- **引入提交**：`e8315b18`（2026-10-01，PR #365，issue #359），标题 “gateway: a relay that searches the web by itself is sent Claude Code's WebSearch as it was sent (#359) (#365)”。正文：magpie 按主机认会搜的 API，所以 api.anthropic.com 前面的中转被换成了 magpie 的搜索，没配代搜时 WebSearch 工具被整个去掉；开关只在这家有地址的 Anthropic 或 Responses 接口上算数；开了开关的不拿来替别的模型搜。正文称用真实的 Claude Code 2.1.285 经 sub2api（claude_code_only 模式）验证过 “WebSearch returns results with search=yes”（已抽查原文）。之后相关提交：`763eb604`（10-03，开了开关的中转可手动指定为代搜供应商）、`ec6df1de`（10-06，带搜索的请求在客户端自己的协议上翻译）、`77f90fd8`（10-14，插件可设 `searches: true`）。

## Codex 自身（第 6、10、12 题用到，源码核实）

路径都在 `openai/codex@ce0323f2` 的 `codex-rs/` 下。

- 搜索模式：`WebSearchMode` 有 `Disabled / Cached / Indexed / Live`，默认 `Cached`（`protocol/src/config_types.rs:376-382`）。取值顺序：`config.toml` 顶层 `web_search` → 已弃用的 `features.web_search_cached` → `features.web_search_request` → 都没有时 `Cached`（`core/src/config/mod.rs:2741-2752`、`:3907-3908`）。`[tools] web_search` 只是过滤、地点、上下文大小等参数，写布尔值会被忽略（`config/src/config_toml.rs:474-476`、`:699-747`）。
- 按服务商限制：`Live`、`Indexed` 要服务商的 `external_web_access`，`Cached`、`Disabled` 任何服务商都允许（`core/src/config/mod.rs:3152-3197` `resolve_web_search_mode_for_turn`）。自定义服务商（Osuna 的 `osuna_api_endpoint` 就是）默认 `web_search: true`、`external_web_access: true`；`[model_providers.<id>.capabilities]` 只能改 `external_web_access` 和 `remote_compaction`，改不了 `web_search`（`model-provider/src/capabilities.rs:19-52`，`model-provider-info/src/capabilities.rs:13-18`）。
- 发出的工具：模型不是 `use_responses_lite`、没走独立搜索、服务商 `web_search` 为真时，每轮请求带一个托管工具 `{"type":"web_search","external_web_access":false}`（`Cached`；`Live` 是 `true`），可带 `filters`、`user_location`、`search_context_size`、`search_content_types`（`core/src/tools/spec_plan.rs:685-715` `hosted_model_tool_specs`，`core/src/tools/hosted_spec.rs:14-46`，序列化见 `tools/src/tool_spec.rs:39-53`）。**所以 Osuna 什么都不写时，经中转站的 Codex 默认每轮都带 `web_search` 工具**（推断，未核实：没有抓包，只按源码默认值推出）。
- 历史：上游执行了搜索时回复里的 `web_search_call` 项留在历史里，下一轮原样发回（`core/src/context_manager/history.rs:1033-1056` `is_api_message`，`WebSearchCall` 在 :1049 算作要发的项）。
- 独立搜索 `web.run`：一个由 Codex 本地执行的扩展工具，向 `{服务商 base_url}/alpha/search` 发 POST（`codex-api/src/endpoint/search.rs:15`、`:34-47`）。只在功能 `standalone_web_search`（`UnderDevelopment`，默认关，`features/src/lib.rs:1261-1266`）或模型元数据 `use_responses_lite` 选中时出现（`core/src/tools/spec_plan.rs:1199-1207`），并且服务商要是 OpenAI 内置服务商、用 OpenAI actor 认证，或表里写了 `supports_standalone_web_search = true`（`ext/web-search/src/extension.rs:42-55`；自定义服务商默认 `false`，`model-provider-info/src/lib.rs:200-202`）。「用 OpenAI actor 认证」指不要求 OpenAI 登录、且表里的 `http_headers` 带非空的 `x-openai-actor-authorization`（`model-provider-info/src/lib.rs:629-637`）。走 Osuna 专用表时这条路不会出现；magpie 那种「ChatGPT 登录时只写 `openai_base_url`」的接法下服务商还是内置 OpenAI，功能打开时会向中转站发 `/v1/alpha/search`（推断，未核实）。
- 关掉的办法：`config.toml` 顶层 `web_search = "disabled"`（或会话级配置覆盖同名键）。

## Osuna

### 4（Osuna 一侧）. Osuna 开的 Claude 会话从哪里拿到 WebSearch 规则（源码核实）

- Osuna 用 Claude Agent SDK 起会话，`settingSources` 固定为 `["user", "project", "local"]`（`agent/providers/claude/agent.ts:162-166`，传入 :3430）。所以 SDK 起的 CLI 会读 `~/.claude/settings.json`（含 Osuna 写的 `env` 和 `permissions.deny`），与终端里直接跑的 `claude` 读同一份用户设置。
- `disallowedTools`：Osuna 自己不为 WebSearch 传任何东西。只有两处来源，都来自用户配置：
  - provider 覆盖里的 `disallowedTools`（`protocol/src/provider-config.ts:28`、`:69`；`provider-registry.ts:251-266`、`:285-288` 合并），在 `agent.ts:3466-3471` 追加到 SDK 的 `disallowedTools`；
  - 会话的 `providerOptions.disallowedTools`（`claude/options.ts:48-49`），经 `...providerOptions` 展开进 SDK 选项（`agent.ts:3442`）。
- SDK 的 `settings` 选项（「flag settings」层）Osuna 自己只用来传 `fastMode`、`ultracode`、`disableAllHooks`（`agent.ts:3475-3493` `buildSettingsOptions`）；用户写在 `providerOptions.settings.permissions` 里的 `allow/ask/deny`（`options.ts:4-10`、`:70-72`）也进这一层（随 `...providerOptions` 展开，或经 `mergeClaudeSettings` 合并，`agent.ts:588`、`:3487`）。ADR 0004 的「Considered Options」把「经 SDK 的 `settings` 层并存」列为被否决的方案，理由是用户选了单一开关。
- 文档 `docs/custom-providers.md:168`、`:238`、`:760-779` 让 `extends: "claude"` 的自定义提供方自己写 `"disallowedTools": ["WebSearch"]`；`:114` 写明总开关开着时 settings.json 的 deny 对它们同样生效。
- 终端里的 `claude`（用户自己的终端，或 Osuna 终端里的 Claude Code 配置 `{ id: "claude", command: "claude", args: [PROMPT_SENTINEL] }`，`protocol/src/terminal-profiles.ts:20`）不带任何额外参数，规则只来自设置文件，也就是同一份 `~/.claude/settings.json`。
- 会话中途换模型：Osuna 调 SDK 的 `query.setModel()`，不重开会话（`agent.ts:2507-2525`），开会话时传的 `disallowedTools` 不会跟着变。
- 规则怎么叠加（`settings.json` 的 deny 与 `--disallowedTools`、`settings` 层的 deny）由 Claude Code 决定，见上文 Claude Code 部分第 4 题：各来源的 deny 取并集，`settings.json` 里的 deny 在会话级放不开。

### 9. `claude-settings-patch.ts` 里 WebSearch deny 的读写（源码核实）

文件：`packages/server/src/server/api-endpoints/claude-settings-patch.ts`。

- 规则名常量：`const WEB_SEARCH_RULE = "WebSearch";`（:33），注释说明理由（:18-19）。
- 接管记录里的字段：`webSearchDeny: { added, permissionsCreated, denyCreated }`（:68-72）。`added` 表示这条规则归 Osuna；后两个记 `permissions` 对象、`deny` 数组是不是 Osuna 新建的。
- 写入：`applyClaudeApiEndpoint` 每次写中转站时都调用 `ensureWebSearchDenied`（:140-141），记录存进接管记录（:169）。没有任何条件分支，只要 Claude Code 的总开关开着就写。
- `ensureWebSearchDenied`（:421-451）：
  - 文件里 `permissions.deny` 已经含字符串 `"WebSearch"`（`deny?.includes(WEB_SEARCH_RULE)`，精确等于，不认 `WebSearch(...)` 这类带括号的写法）时不动文件；有接管记录就沿用旧记录，没有就记 `added: false`。**「用户自己写的 deny 保留」就是靠这一步判断的：首次接管时规则已经在，就记成不归 Osuna。**
  - 没有就在数组末尾追加（`edit(text, ["permissions","deny",-1], …)`）。之前接管过、`added` 为 true（用户中途手动删掉了这条）时沿用旧记录；否则记 `added: true`，并按接管前的文件记下 `permissionsCreated`、`denyCreated`。
- 切回官方：`restoreClaudeOfficial`（:287-300）只在 `webSearchDeny.added` 为 true 时删掉数组里第一个 `"WebSearch"`（`indexOf`）；数组是 Osuna 建的且删空了就删掉数组；`permissions` 是 Osuna 建的且空了就删掉对象。`added: false` 时一个字节不动。
- 外部改动检测：`modifiedOwnedKeys`（:366-368）在 `added` 为 true 而文件里没有这条时，报 `permissions.deny "WebSearch"` 被改过（标签见 :336）。
- 解析：`permissions` 不是对象、`permissions.deny` 不是数组时整个文件当成解析不了，什么都不写（:405-412）。
- 测试：`claude-settings-patch.test.ts:103`（只改负责的键和这一条）、`:195-212`（用户自己写的规则不归 Osuna，切回官方后还在）、`:584-594`（只有 Osuna 加的那条被删才算外部改动）；端到端 `daemon-e2e/api-endpoint-gateway.e2e.test.ts:4678`（启动时给旧版开着的 Agent 写配置，期望文件里有 `permissions.deny: ["WebSearch"]`）、`:4773`（旧版接管记录里的 `webSearchDeny: { added: false, … }`）。
- 数据模型文档：`docs/data-model.md:734` 的 `takeover-claude.json` 一行列了 `webSearchDeny`。

### 10. 中转站现在怎么处理带搜索工具的请求（源码核实）

路径（`gateway/gateway.ts`）：只服务 `GET/HEAD /api/hello`（:175）、`GET /v1/models`（:180）、`POST /v1/messages`、`POST /v1/responses`（`AGENT_PATHS`，:122-126）和 `POST /v1/messages/count_tokens`（:103）。其余一律 404 `"<方法> <路径> is not served by the gateway"`（:186-193）。所以 Codex 独立搜索用的 `POST /v1/alpha/search` 现在会得到 404（Codex 什么时候会调它见第 6 题）。

每家用哪种格式（`gateway/routing.ts:233-244` `chooseRequestFormat`）：Claude 模型且这家有 Anthropic 地址 → 一律 Anthropic；否则这家有 Agent 自己格式的地址 → 直通；否则按 Chat → Responses → Anthropic 取第一个翻译过去。格式是按**每个候选**挑的（`gateway.ts:529-554` `askableCandidates`），同一个请求换到下一家时可能从直通变翻译，反之亦然。被拒重问「这个格式的地址没有这个模型」时，同一家也会换格式（ADR 0008）。

**Claude Code（Anthropic Messages）**

- 直通：请求体除模型名和几处按上游模型的修补外逐字节原样发出（`gateway/passthrough.ts:74-83` 注释，`upstreamBody` :411-433）。修补里碰 `tools` 的只有三处：advisor 服务端工具（`withAdvisorFitted`，`claude-code-fields.ts:83-119`）、按厂商改工具参数 schema（`vendor-rewrites.ts:162-180`，只改 `input_schema`/`parameters`，服务端工具没有这两个键）、拒收重问去掉 `strict` 等字段（`refused-fields.ts`）。`web_search_2025xxxx` 这类服务端工具**不会被改动，原样转给上游**。
- 有一个现成的「按这家去掉服务端工具」的先例：advisor 工具（`{"type":"advisor_20260301",…}`）在直通时只在「上游是 Claude 且 advisor 的模型是这家的 Claude」时留着，否则去掉这个工具、连同对话里它的说明和点名它的延后加载块，一个工具都不剩时连 `tool_choice` 也去掉（`claude-code-fields.ts:90-119`、`:147-200`）。
- 翻译（Anthropic → Chat / Responses）：`translation/anthropic.ts:133-148` `parseTools` 把「`type` 是字符串、不是 `custom`、没有 `input_schema`」的工具当服务端工具剔掉。剔完一个工具都不剩时，翻译出去的请求既不带 `tools` 也不带 `tool_choice`（`chat.ts:269`、`responses.ts:637` 只在有工具时写）。也就是说上游收到的是一个不带工具的普通对话请求，只能用文字回答。测试：`translation/chat.test.ts:860-875`、`translation/anthropic.test.ts:292-300`。
- 翻译回来的回复：Anthropic 上游回的 `server_tool_use` 块只算一个 `other_tool` 事件、内容跳过（`translation/anthropic.ts:772-776`、`:828-830`、`:856`）；对话历史里的未知块（`server_tool_use`、`web_search_tool_result`）在翻译时也被丢掉（`parseBlock` 的 `default: return []`，:128-130）。
- 「开口」判定把服务端工具块算作内容（`reply-tap.ts:143-145`，`passthrough.test.ts:804-820`），所以上游一开始做搜索，就不再切换别家。

**Codex（OpenAI Responses）**

- 直通（这家有 Responses 地址）：Codex 发来的 `{"type":"web_search", …}` 原样转发。直通只按模型改推理项、`effort none`（`passthrough.ts:427-430`），不碰 `tools`。
- 翻译（Responses → Chat / Anthropic）：`translation/responses.ts:493-529` `parseResponsesTools` 只收 `function`、`custom` 和命名空间里的这两种，注释写明「联网搜索之类的服务端工具不代办，剔除」。测试 `translation/responses.test.ts:587-590`。历史里的 `web_search_call` 项在翻译时也丢掉（`parseItem` 的 `default: return null`，:366-394）。
- 拒收重问：`refused-fields.ts` 对 Codex 的 `image_gen` 工具有专门的去掉重问，对 `web_search` 工具没有。上游以 400 拒收 `web_search` 时，按 `failure.ts:182-195` `retryable`，只有词表认出原因（如 `W.shape` 的 `unknown (item |content |input )?(type|variant|field|parameter)`）才换下一家且不冷却（`requestRefused`，:217-223），否则错误交给 Codex。（推断，未核实：具体走哪条取决于上游报错原文。）

**Osuna 有没有给 Codex 写关掉 web_search 的配置**：没有。`codex-config-patch.ts` 只负责顶层 `model_provider` / `model` / `model_catalog_json` 和专用表 `[model_providers.osuna_api_endpoint]`（:4-10、:20），没有 `web_search`、`tools`、`features`。模型目录条目（`codex-model-catalog.ts:81-114` `toEntry`）也不写 `web_search_tool_type`、`use_responses_lite`。Osuna 自己开的 Codex 会话只在用户给 provider 选项写了 `web_search`（`codex/options.ts:51`，`disabled | cached | indexed | live`）时把它作为线程级配置传给 app-server（`codex-app-server-agent.ts:5382-5397`）。Codex 默认会发什么见第 6 题。

### 11. 给接口加一个按接口的布尔字段要动哪些地方（源码核实，只列位置）

参考现有的接口开关 `enabled`（经 `set_endpoint_state` 改）和最近加的 `manualModels`（经 `save` 改，提交 `c2fe8c6b8`）。

协议（`packages/protocol`）

- `src/api-endpoint/rpc-schemas.ts`：`ApiEndpointSchema`（:95-115，`enabled: z.boolean().optional()` 在 :107），以及二选一的写入口：`ApiEndpointSaveRequestSchema`（:199-212，`manualModels` 就在这里）或 `ApiEndpointSetEndpointStateRequestSchema`（:302-308，`enabled`、`clearCooldown` 在这里）。新字段只能可选（CLAUDE.md 的协议规则）。
- `src/messages.ts:3910-3912`：`server_info.features` 的能力位（现有 `apiEndpointGateway`，带 `COMPAT(...)` 标记；daemon 在 `websocket-server.ts:1867-1868` 声明，App 在 `api-endpoints/view.tsx:44` 等处读）。按 `docs/protocol-compatibility.md`，新功能要么新加一个能力位，要么沿用已有的。
- 生成的校验器 `src/generated/validation/ws-outbound.aot.ts` 不进仓库，用 `npm run generate:validators --workspace=@getpaseo/protocol` 重生成（同目录 `README.md`）。
- 协议测试：`messages.api-endpoint.test.ts`、`messages.wire-compat.test.ts`（`.atw/spec/server/backend/persistence.md:331`）。

daemon（`packages/server/src/server`）

- `api-endpoints/store.ts:52-75` `StoredApiEndpointSchema`（`enabled: z.boolean()` 在 :63，`manualModels` 可选在 :71）。已有的 `endpoints.json` 没有这个键，必填的话两种 schema 都读不过，整个文件报解析不了（`parseEndpointsFile`，:107-113），所以新键只能可选或带默认。
- `api-endpoints/service.ts`：输入类型 `ApiEndpointSaveInput`（:120-132）或 `ApiEndpointStateInput`（:139-143）；`setEndpointState`（:529-542）或 `buildEndpoint` / `EndpointFields` / `validateFields`（:1463-1531）；投影给客户端的 `toWire`（:1319-1346）。
- 如果 `settings.json` 的内容要随这个字段变：`cliWiring`（:689-701）、`cliModels`（:708-735）、`cliFingerprint`（:805-816）。`cliFingerprint` 只收中转站地址、口令、`cliModels`，不在里面的东西变了不会重写 `settings.json`（`.atw/spec/server/backend/persistence.md:214`）。以及 `claude-settings-patch.ts` 的 `ClaudeGatewayWiring`（:94-100）、`ensureWebSearchDenied`（:421-451）、接管记录 `webSearchDeny`（:68-72）。
- `session/api-endpoint/api-endpoint-session.ts`：`handleSave`（:117-131）或 `handleSetEndpointState`（:218-238）把新字段从请求带进 service。权限表 `authorization/operation-permissions.ts:159`、`:405` 按消息类型定，现有消息加字段不用改。
- 中转站（按请求生效的部分）：`api-endpoints/gateway/routing.ts`（`resolveGatewayRoute` :51-64 定候选和顺序）、`gateway/gateway.ts`（`handleAgentRequest` :387-487、`askableCandidates` :529-554、`planAttempts` :598-635）、`gateway/passthrough.ts`（`upstreamBody` :411-433、`fitClaudeCodeBody` :488-500，advisor 先例在 `claude-code-fields.ts`）、`gateway/translation/*`（剔服务端工具的地方见第 10 题）。

客户端与 App

- `packages/client/src/daemon-client.ts`：`ApiEndpointSetEndpointStateOptions`（:699）、`apiEndpointSetEndpointState`（:6340-6348）、`apiEndpointSave`，类型从协议推出。
- `packages/app/src/api-endpoints/`：接口开关的 UI 在 `detail-header.tsx:114-120`（`Switch`）和 `host-list-section.tsx:215` 一带；写入在 `use-host-endpoints.ts:126-155`（`runStateChange` / `setEnabled`）。走保存表单的话是 `use-endpoint-detail.ts:161`、`connection-section.tsx`、`internal/connection-form-model.ts`。
- 文案：`packages/app/src/i18n/resources/` 下 9 个语言文件（ar、en、es、fr、ja、ko、pt-BR、ru、zh-CN），见 `docs/i18n.md`。

测试与文档

- daemon 端到端：`daemon-e2e/api-endpoint-claude.e2e.test.ts`、`api-endpoint-host-wide.e2e.test.ts`、`api-endpoint-gateway.e2e.test.ts`；单元：`claude-settings-patch.test.ts`、`gateway/passthrough.test.ts`、`gateway/routing.test.ts`、`gateway/translation/*.test.ts`。
- 浏览器测试：`packages/app/e2e/browser/settings-api-endpoints.spec.ts`、`e2e/support/helpers/api-endpoints.ts`。
- 文档：`docs/data-model.md:732`（`endpoints.json`）、`:734`（`takeover-claude.json`）、ADR 0004 的 WebSearch 一条（或新 ADR）、`.atw/spec/server/backend/persistence.md:303`（存储字段清单）。

## 12. 「只对开了开关的那家生效」在事实层面可能的几种路线

只列事实和后果，不做推荐。先列各条路线共用的事实，再逐条列路线。

### 共用的事实

1. `settings.json` 的 `permissions.deny` 对读这份用户设置的所有 Claude Code 会话生效：终端里的 `claude` 和 Osuna 用 SDK 开的会话（`settingSources` 含 `"user"`）都读它。WebSearch 的权限规则不能带限定词，只能整个允许或整个拒绝。（第 2、4 题）
2. 任何来源的 deny 都放不开：`settings.json` 里有 `"WebSearch"`，会话级的设置、参数都没法给某个会话单独放开；反过来，`settings.json` 里没有时，会话级的 deny 可以单独关掉某个会话的 WebSearch。（第 4 题）
3. 改了 `settings.json`，运行中的会话从下一次请求起就按新规则给模型列工具。在自定义 `ANTHROPIC_BASE_URL` 下，每加上或去掉一次这条 deny，下一次请求的前缀缓存就失效一次。会话级的 deny（`applyFlagSettings` 改）同理（推断，按同一份文档）。（第 4 题）
4. 搜索是 Claude Code 另发的一次 `/v1/messages`：只带 `web_search_20250305` 一个工具、强制调用、只有查询词没有主对话历史。在 Osuna 的写法下，模型名是会话模型（在子代理里是子代理的模型）。主对话只拿到结果字符串。（第 1 题）
5. 中转站按每个请求的模型名单独选路（`routing.ts:51-64`），所以搜索子请求和主对话那一轮可能落在同一模型的不同接口上；直通时服务端工具原样发出，翻译时被剔掉，剔掉后上游只能用文字回答。直通时按这家去掉某个服务端工具已有先例（advisor）。（第 10 题）
6. 子请求回来只有文字时，Claude Code 不报错，把那段文字当作搜索结果交给主模型（没有链接，带 REMINDER）；子请求报错时，主模型收到 `is_error` 的错误文本。（第 1 题）
7. 「开口」判定把服务端工具块算作内容：上游开始搜索后，中转站不再切换别家。（第 10 题）
8. Codex 不改配置时每轮都带 `web_search` 工具；搜过之后历史里的 `web_search_call` 项会在后续请求里发回。（「Codex 自身」）
9. 用户自己写的 `"WebSearch"` deny 不归 Osuna（第 9 题）。凡是要求 `settings.json` 里没有这条的路线，在用户自己写了它时对 Claude Code 都不起作用。
10. magpie 的做法是：不写任何 CLI 配置；选候选不看开关；每个候选各自决定（这家在客户端协议上会搜就原样直通，不会搜就代搜或剔掉）；不报错。（第 5、6 题）

### 路线 0：现状（对照）

- `settings.json`：总开关开着就写 deny。
- 中转站：不变。
- 用户看到的：所有接口的模型都看不到 WebSearch，开了开关的那家也一样，开关对 Claude Code 没有作用。
- Codex：不变（直通 Responses 的接口原样收到 `web_search`，翻译时剔掉）。

### 路线 A：去掉 deny，中转站按每个候选决定（magpie 的做法，去掉代搜那一步）

- `settings.json`：不写 deny（或只在至少一家开了开关时不写，见路线 D）。
- 中转站：带 `web_search_*` 服务端工具的请求照常选路，候选不筛。轮到开了开关、有 Anthropic 地址的那家时原样直通；轮到没开开关的（或开了开关但只有 Chat 地址的）时把搜索工具去掉再发（翻译路径现在已经这样做；直通路径要像 advisor 那样去掉）。magpie 还会把开了开关、只有 Responses 地址的那家改写成那边的原生 `web_search`（第 5 题），Osuna 的翻译现在不生成原生搜索工具。
- 用没开开关那家的模型时：模型照样看得到 WebSearch，会去调用；子请求被去掉工具后，上游模型凭记忆写一段文字，Claude Code 把它当搜索结果交给主模型（共用事实 6），不报错。magpie 的提交说明把这种结果描述为 “WebSearch showed no results” / “came back empty”（第 7 题）。如果直通时不去掉工具，结果取决于上游：拒收则报错（主模型收到错误文本），忽略则同上，背后真是 Anthropic 则真的搜了。
- 同一模型既有开了也有没开的：子请求按正常顺序走：用户选的那家排第一，再按粘性（键是 `claude|模型|会话`；子请求只有一条 user 消息，按 `turnOf` 不算「一轮之内」，推断）。第一家没开开关时搜索被去掉，即使后面同名的那家能搜；去掉工具不算失败，不会切换。
- Codex：同一规则用到 Codex 时，没开开关、直通 Responses 的接口从「原样收到 `web_search`」变成「被去掉」，开了开关的照旧收到；翻译路径不变。不用到 Codex 时 Codex 不变。

### 路线 B：去掉 deny，中转站只把搜索子请求交给开了开关的同名候选

- `settings.json`：不写 deny（或按路线 D 的条件）。
- 中转站：认出搜索子请求（2.1.302 下它只有一个 `web_search_*` 工具，`tool_choice` 点名 `web_search`），候选只留同一模型、开了开关、有能直通的格式的接口，失败只在它们之间切换。一个都没有时，两种做法：B1 按 Anthropic 格式回错误；B2 去掉工具发给正常的第一家（同路线 A）。
- 用没开开关那家的模型时（这个模型没有任何开了开关的接口）：B1 下主模型收到错误文本，工具还在列表里，模型可能再试（每次多一次往返，计入会话搜索上限，默认 200 次）；B2 同路线 A。
- 同一模型既有开了也有没开的：搜索子请求总是落到开了开关的那家，主对话那一轮可以由别家答。子请求只有查询词，换一家不涉及对话历史。
- 在子代理里搜索时，子请求的模型是子代理的模型（例如 haiku 档，中转站按档位映射找接口），筛的是那个模型的候选。
- Codex：Codex 每轮都带 `web_search`，同样的筛法用到 Codex 会让 Codex 的每一轮都只能走开了开关的接口（magpie 明确不筛候选）；只对 Claude Code 的搜索子请求这样做，Codex 不变。

### 路线 C：去掉 deny，搜索子请求可以交给任何开了开关的接口（不限同一模型）

- `settings.json`：不写 deny。
- 中转站：搜索子请求所在模型没有开了开关的接口时，改发给别的模型的、开了开关的接口（换成那家的模型名），由那个模型执行搜索、写摘要。
- 后果：用没开开关那家的模型时也能真的搜到；摘要由另一个模型写，花另一家的额度。
- 这在 magpie 里属于「代搜供应商」（searcher），magpie 不会自动挑开了开关的中转来替别的模型搜（第 5 题，理由是额度和只服务 Claude Code 的中转会拒收 magpie 自己的请求；Claude Code 自己的子请求带着它自己的 `metadata`，magpie 测试显示重建时保留，第 7 题）。PRD 的「不做」列了 04·D1–D16，其中 D2 是「选谁来搜：自动、指定 provider 或具体模型」，这条落在那个范围里。
- Codex：同路线 B 的说明。

### 路线 D：`settings.json` 的 deny 按一个全局条件写或不写

- 可选的条件，例如：D1 每一家开着的接口都开了开关才不写；D2 起始模型（`model`）的第一家开了开关就不写；D3 至少一家开了开关就不写（即路线 A、B 的配置部分）。
- 事实：这个决定对所有会话、所有模型是同一个（共用事实 1）；Osuna 改写后运行中的会话下一次请求就跟着变（共用事实 3）；要让开关的改动触发改写，`cliFingerprint` 要包含这个条件（第 11 题）。
- 后果：D1 下只要有一家没开，开了的那家也搜不了；D2 下用户 `/model` 换到别的模型、或几个会话用不同模型时，跟着的是同一个决定，换到的模型的接口没开开关时就落到路线 A 或 B 的中转站处理（中转站不改就是现状的直通原样转、翻译剔掉）。
- Codex：不受影响。

### 路线 E：`settings.json` 不写 deny，Osuna 自己开的会话按会话模型加会话级 deny

- `settings.json`：不写 deny（共用事实 2：写了就放不开）。
- Osuna 的 SDK 会话：会话模型没有开了开关的接口时，开会话时传 `disallowedTools: ["WebSearch"]`（`--disallowedTools`，只在开会话时生效），或在 `settings` 层写 `permissions.deny`，会话中途换模型时用 `Query.applyFlagSettings()` 改（SDK 0.3.246 提供，只在流式输入模式可用；Osuna 已是流式输入，`agent.ts:3256` 传的是 `input.iterable`，换模型用的 `query.setModel()` 也要求这个模式，`agent.ts:2507-2525`）。
- 终端里的 `claude`：Osuna 管不到会话级参数，这些会话看到的就是没有 deny 的 `settings.json`，搜索子请求怎么处理由中转站决定（路线 A 或 B）。
- 会话级 deny 对子代理同样生效（被 deny 时的提示原文是 “… is disabled for this session, in subagents as well as here.”），主模型和子代理用不同模型时，一个会话只能有一个决定（推断，未核实）。
- Codex：不受影响。

### 路线 F：`settings.json` 不写 deny，写一个 PreToolUse 钩子按会话判断

- `settings.json`：不写 deny，在 `hooks` 里加一个匹配 WebSearch 的 PreToolUse 钩子（Osuna 已有往同一个文件写钩子的先例：终端活动钩子，默认关，`docs/terminal-activity.md:87-101`）。
- 钩子输入里没有模型名，只有 `session_id`、`transcript_path` 等（第 4 题），钩子要另找途径知道这个会话现在用哪个模型、会落到哪家。中转站每个请求都能看到模型名和 `x-claude-code-session-id` 请求头（`affinity.ts:87-93` 用它认会话），这个头是否与钩子拿到的 `session_id` 相同没有核实。
- 钩子拒绝时主模型收到 `is_error` 的拒绝理由；工具仍在列表里，模型看得到、会去调。
- 终端和 Osuna 的会话都会跑这个钩子（都读用户设置）；Osuna 的内部 Agent 带 `disableAllHooks`（`agent.ts:3475-3493`），不跑。
- Codex：不受影响。

### Codex 这边能单独动的地方（与上面各路线独立）

- 不动：现状，直通 Responses 的接口原样收到 `web_search`，翻译时剔掉。
- 按候选：开了开关的原样转，没开的去掉（magpie 的做法，路线 A 的 Codex 部分）。
- 全局关：在 `config.toml` 写顶层 `web_search = "disabled"`，与 Claude Code 的 deny 一样对所有会话、所有模型生效；Osuna 现在不写。
- 搜过之后历史里的 `web_search_call` 项：翻译时被丢掉；直通给没开开关的 Responses 接口时会原样发过去，第三方上游怎么处理没有核实。按 magpie 的注释，ChatGPT 后端收到「回放了 `web_search_call` 却没声明 `web_search` 工具」的请求会回 200 后只给一个错误事件 “response protection is unavailable”（第 5 题），所以「按候选去掉工具」碰上带搜索历史的对话时可能触发这条（推断，未核实）。Osuna 的 `failure.ts` 已经认这句话（`W.protection`，注释「同样的历史在哪都一样失败」）。
- `web.run` / `/v1/alpha/search` 只在 Codex 把服务商当 OpenAI actor 时出现；Osuna 的专用表没有那个请求头，所以现在碰不到。要是 Codex 的接法改成 magpie 那样，这条路就会出现，Osuna 的中转站现在对它回 404（第 10 题），magpie 的注释说 404 会让 Codex 结束这一轮（第 6 题）。

## 没能核实的地方

- 远端开关 `tengu_plum_vx3` 在用户机器上的取值（它来自远端或本机缓存，按禁令没读）。按源码，在 Osuna 的写法下两条分支都会落到会话模型，但这依赖用户进程环境里没有 `ANTHROPIC_SMALL_FAST_MODEL`、`ANTHROPIC_DEFAULT_HAIKU_MODEL`，也依赖 `_CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL` 和远端客户端数据没把 base URL 当官方。
- 2.1.302 的搜索子请求实际带的 `max_tokens`、`temperature`、完整 beta 头、会话 id 请求头没有抓包，只有 v2.1.220 的 issue 旁证。
- 子请求报错后 Claude Code 走的是无包装的 `is_error` 文本还是外层 `<tool_use_error>` 包装，没有运行验证。
- PreToolUse 钩子拒绝时的默认文字（`Hook PreToolUse:WebSearch denied this tool`）在二进制里没有搜到原样字符串，只有子任务的转述和文档。
- `CLAUDE_CODE_USE_GATEWAY` 让 provider 变成 gateway 的完整链路、以及它的其他副作用。
- 设置热重载时，`env` 里被删掉的键会不会从进程环境里移除。
- 第三方中转是否真的支持 `web_search_20250305`、回的块是什么格式：取决于上游，magpie 也只有一次 sub2api 的作者自测。
- Codex 默认每轮带 `web_search` 是按源码默认值推出的，没有抓包；`web_search_call` 历史项直通给不支持的上游会怎样，没有核实。
- magpie 的结论里，测试断言没有运行；「只有 Responses 地址又开了开关时 Claude Code 的搜索被改写成 Responses 原生 `web_search`」是从代码路径推出的，没找到专门测试。
- 路线 F 里中转站看到的 `x-claude-code-session-id` 与钩子输入的 `session_id` 是否是同一个值。
- 路线 E 里「一个会话只能有一个决定」对主模型与子代理用不同模型的情形是推断。
