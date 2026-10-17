# 01 — 先写新 ADR，标出 ADR 0004、0007 被取代的地方

**What to build:** 动手写代码之前，先把这次推翻旧规则的决定写成四篇新 ADR，并在旧 ADR 里标出被取代的句子。后面每张工单的审查者会对照 ADR 0004、0007 检查代码，这两篇现在写的正好和本任务要做的相反；先改好，审查者看到的就是这次定下的规则，不会把对的改动当成违规改回去。

四篇（编号从 0009 往后取；语言与格式跟现有 ADR 一致，英文，参照 ADR 0008 的「What this replaces in ADR 0007」写法）：

1. **联网搜索按接口放行**（prd 第 7–11 条）：取代 ADR 0004 的 WebSearch 禁止规则那一条。写明 Q19 偏离 magpie 的三处与依据：至少一家开着的接口打开了「自己能联网搜索」才去掉禁止规则；搜索子请求只交给同一模型下打开了开关的接口；一家都没有时回明确的错误，不剔掉工具让模型凭记忆冒充结果。不做代搜。
2. **Codex 的接法与中转站认调用方**（第 12–19 条）：取代 ADR 0007 的「Codex gets `base_url` … and `experimental_bearer_token`」「The token is the gateway's authentication」「Official removes the dedicated Codex table」三处，以及 Consequences 里「关开关后会话回到官方地址」那句。写明 ChatGPT 登录时只写 `openai_base_url`、中转站原样转 ChatGPT 请求且从不把 ChatGPT 令牌发给接口；本机请求一律收、按口令或路径与 User-Agent 认 Agent；口令开关前后不变；Osuna 的 Codex 服务商表写了就保留。
3. **挪 Codex 对话**（第 20–22 条）：Osuna 改写 Codex 自己的对话文件与状态库，这是 ADR 0004 以外的新范围。写明只在用户发起时改、先备份、一分钟内写过的不挪、挪回即撤销，以及已知局限（设置快照事件里的旧服务商不改；状态库重建时挪动可能被改回，待 13 号工单核实，30 号工单补结果）。
4. **CLI 配置改写的新规矩**（第 24–33 条）：`settings.json` 按 JSONC 读写、带注释也照改；CLI 自己存下的模型与思考档位跟着走、不算被改过；「被改过」的几种情况与「保留当前设置」；新增的负责的键；保留 claude.ai 登录时口令写空值。取代 ADR 0004 的「If a file does not parse, write nothing」（对带注释的 `settings.json`）、「If the owned keys no longer hold what the daemon wrote … Never overwrite silently」（对 CLI 自己存下的选择）、Claude 一律写口令那一条。

另外：ADR 0007 Consequences「an endpoint without a mapping gets the tier name as the model id」与现有代码不符（现在回 404），改成 prd 第 26 条第 4 项的做法（改用默认模型），在第 4 篇或 ADR 0007 的标注里写明。

只写文档，不改代码。

**Blocked by:** None
**Status:** ready-for-agent
**Impl:** done

- [ ] 四篇新 ADR 写好，各自写明取代了 ADR 0004、0007 的哪几句；依据指向 `research/` 下对应的笔记与 decisions.md 的题号。
- [ ] ADR 0004、0007 里被取代的每一句旁标出被哪篇取代（照 ADR 0008 标 0007 的写法），原文保留不删。
- [ ] ADR 0007 关于档位名的那句改正或标出。
- [ ] 遵守 CLAUDE.md「Writing docs」与「Doc voice」；只写决定、理由与取舍，不写文件名、函数名这类实现细节。
- [ ] 改到的文件用 `npm run format:files` 格式化。

参考：prd.md「Implementation Decisions」第 3 条；research/decisions.md 全文；ADR 0008 的结构。
