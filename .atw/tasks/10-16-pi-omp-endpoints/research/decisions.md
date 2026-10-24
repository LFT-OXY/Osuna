# 子任务 6 访谈决定（2026-10-24）

依据：magpie `7597c132`（HEAD `dd1e8822` 上 Pi/OMP 接线未变），克隆在 `/tmp/magpie-7597`；Pi 1.4.0 源码 `/tmp/pi-mono-src`（本机装 1.3.0）；OMP 18.12.6 源码 `/tmp/omp-src`（本机装 17.3.3）。

## 第 1 轮

- 用户指出：Osuna 现在不能改 Pi、OMP 的配置文件。核实：Osuna 不读写 Pi 的 `models.json`、OMP 的 `models.yml` / `config.yml`，只读 Pi `settings.json` 的 sessionDir（`pi/session-descriptor.ts:156-164`）。本任务就是补这一块；不加手动编辑 CLI 配置的界面。
- **Q1 终端也生效**：是。改 Pi / OMP 的全局配置（Pi：`$PI_CODING_AGENT_DIR` 或 `~/.pi/agent`；OMP：Osuna 现有的目录规则 `omp/provider-config.ts:96-132`），终端里直接跑也走中转站。
- **Q2 服务商名**：`osuna`。Pi / OMP 里模型显示为 `osuna/<模型>`；用量去重（ADR 0014 的 Pi / OMP 规则）按这个名字跳过。
- **Q3 模型清单与格式**：清单同 Codex 的 `/model`（开着的接口的选中模型，遵守「接口名显示方式」，含裸名与「某家的模型」两种）。格式照 magpie `route.go:167-207`、`provider.go:1429-1533`：默认 OpenAI Chat；GPT 系模型在其接口都有 Responses 地址时走 Responses；Claude 模型所在接口有 Anthropic 地址时走 Anthropic；裸名（多家同名）只有全部成员都是 Responses 才走 Responses，其余留在 Chat。
- **Q4 关开关还原**：完全照 Claude Code、Codex 的现有做法（ADR 0004 / 0012：关前预览、放回原值、用户期间自改的保留、删 `osuna` 服务商）。
- **Q5 Pi 的 enabledModels**：选 (a)。Pi 新会话先用 `enabledModels` 的第一项（`pi-mono packages/coding-agent/src/core/model-resolver.ts` `findInitialModel` 第 1 步、`main.ts:813`），压过 defaultModel；magpie 只追加到末尾（`pi.go:12-17,65-71`）。Osuna 在清单已存在时把默认模型放到最前，关开关时挪回；没有清单不新建。比 magpie 多做。
- **Q6 默认思考档位**：Pi、OMP 也有（Pi `defaultThinkingLevel`，OMP `defaultThinkingLevel`）。
- **Q7 要重开的对话**：Pi、OMP 加进现有「哪些对话要重开」提示。Pi、OMP 的 RPC 模式不重读模型文件。
- **Q8 OMP 模型角色**：选 (a) 照 magpie。打开开关只改 default 角色；其余 9 个角色（subagent/task、smol、slow、plan、vision、advisor、commit、tiny、memory）默认空着交给 OMP；设置页有角色区，每个角色可选模型和思考档位（写成 `模型:档位`，`omp.go:360-449`）。
- **Q9 OMP 命名配置**：选 (b) 严格照 magpie。`~/.omp/profiles/<name>/agent` 每套各一份完整设置（开关、默认模型、思考档位、角色），默认关；当前 `OMP_PROFILE` 指向的那套不单独列（`omp.go:157-187`）。

## 助手按 magpie 直接定、已告知用户

- 中转站 Chat 入口：Pi 中途加的工具提升到顶层（`message_tools.go:10-29`）；直转 Chat 时 `developer` 改 `system`；读会话头做粘性（`gateway.go:5953-5985`）。
- Pi / OMP 配置里写各自的中转站口令认人；不照 magpie 给 OMP 写 `User-Agent: omp`（身份如实）。
- 修 `usage/pi-like-parser.ts` 的回复编号（改用会话记录的 `responseId`），接上 ADR 0014 的 Pi / OMP 去重规则。

## 第 2 轮

- 事实：Osuna 已能用手写的自定义提供方（`extends: "omp"` + `env.OMP_PROFILE`）在某套命名配置里开 OMP 对话（`docs/custom-providers.md`「OMP profiles and Pi-compatible forks」）；`options.smolModel/slowModel/planModel` 在 Osuna 启动 OMP 时作为 `--smol/--slow/--plan` 传入（`omp/provider-config.ts:61-66`）。
- **Q10 每套 OMP 配置的设置放哪**：选 (a)。OMP 提供方设置页的「使用第三方接口」分块：默认那套一块，每找到一套命名配置多一块，各有开关、默认模型、思考档位、模型角色；新找到的默认关。指向某套命名配置的自定义提供方跟随那一块，不另设。
- **Q11 名称**：OMP profile —「OMP profiles」/「OMP 配置」，默认那套叫「Default」/「默认」；Model roles —「Model roles」/「模型角色」，角色显示「中文名（OMP 原名）」并说明空着时跟谁（照 magpie `app.js:3624-3636`）。已写进 `docs/glossary.md`（同时把 API endpoint、Gateway、Use API endpoints 三条扩到 Pi、OMP）。
- **Q12 按提供方隐藏模型**：选 (a)，本任务不做，记为总任务的缺口，以后四家一起加。
- 助手定、已告知：Osuna 配置里手写的 `smolModel/slowModel/planModel` 在 Osuna 开的 OMP 对话里优先于设置页的角色；终端不受影响。
- 助手定（未单独问）：继承 `pi` 的自定义提供方（Pi 分支程序）不接；Pi 只接 daemon 环境下的那个目录。
