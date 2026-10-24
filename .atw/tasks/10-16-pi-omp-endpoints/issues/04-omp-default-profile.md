# 04 — OMP 默认配置用上第三方接口

**What to build:** OMP 的提供方设置页出现「使用第三方接口」开关、默认模型、默认思考档位，管 OMP 默认那套配置。打开后 Osuna 改写 OMP 的 `models.yml` 和 `config.yml`，终端里的 `omp` 新会话也用 `osuna/<模型>`；还原、同步、跟随、提示都和 Pi 一样。

**Blocked by:** 03
**Status:** ready-for-agent
**Impl:** ready

- [ ] Agent 设置的 provider 取值接受 `omp`；目录照 Osuna 现有的 OMP 目录规则；能力位沿用 02 的或另加，旧 daemon 下新 App 不显示。
- [ ] `models.yml`（只有 `models.yaml` 时用它）的 `providers.osuna`：`baseUrl`、`api: openai-completions`、`apiKey` 为 OMP 的中转站口令、`auth: apiKey`、`compat.promptCacheSessionHeader: x-session-affinity`；不写 User-Agent。
- [ ] 模型清单与格式规则同 Pi；思考写成 `thinking: {mode, efforts}`（自适应 Claude 用 anthropic-adaptive，其他走 Anthropic 的用 budget，其余 effort）；OMP 早于 16.4.0 或版本未知时 `max` 降为 `xhigh`。
- [ ] 只有旧 `models.json`、没有 YAML 时，先照 OMP 的迁移转成 `models.yml` 再写。
- [ ] `config.yml`：`modelRoles.default` 写默认模型；设了默认思考档位才写 `defaultThinkingLevel`；`enabledModels` 规则同 Pi。
- [ ] YAML 按节点改：注释、列表的 flow / block 写法、用户的其他键原样保留；用户在 `providers.osuna` 里写的 `modelOverrides`、`discovery`、`disableStrictTools`、`remoteCompaction`、自加请求头和 compat 保留。
- [ ] 改写规则、关前预览、还原、再打开、跟随与漂移提示、接口变化时同步、「要重开」提示、刷新 Osuna 里 OMP 的模型清单，全部同 Pi（02、03）。只要还有别的角色或别处用着 `osuna/`，关开关时保留服务商。
- [ ] 测试：新加 OMP 接入的端到端测试；与 Pi 配置改写套件并列加 OMP 的套件，覆盖 YAML 写法保留、思考写法、`max` 降级、旧文件迁移、还原。
- [ ] 浏览器测试：OMP 设置页的开关、默认模型、思考档位、关前预览；失败时错误留在这一块。
- [ ] 9 种语言的新文字齐全。
- [ ] UI：OMP 提供方设置页 / 只有默认配置、已打开 / 1280 与 390 — 能看到 Switch、默认模型、默认思考档位，不显示块标题，宽 390 不被遮住。
- [ ] 文档：ADR 0004、0012 补上 OMP。

参考：prd「写进 OMP 配置的内容」「改写规则与还原」，用户故事 22–23、36–46。

实现时凡本工单没写明的细节，先查 magpie `7597c132` 的做法并照做（出处见 `research/decisions.md`，源码在 `/tmp/magpie-7597`，不在就重新克隆 yetone/magpie 切到该提交）；比 magpie 少做或更严一律不行，除非 prd 写明。测试绝不读写真实的 `~/.pi`、`~/.omp`，不运行真的 Pi / OMP。
