# 01 — 逻辑图开关和给 Agent 的说明块

**What to build:** 对话输入框工具栏出现"逻辑图"开关（Switch，默认关）。打开时为这个对话新建一张空的 **Logic map**：daemon 在 workspace 的 `docs/logic-maps/` 下建一个带临时名字的图文件夹，并随 Agent 记录持久保存"这个 Agent 开着逻辑图、维护的是哪张图"。开关开着时，daemon 在发给 provider 的每条用户消息末尾附加一段逻辑图说明块，做法与 **Routing block** 相同：只附在发给 provider 的那份里，时间线保留原文，并从 provider 历史、导入和预览里剥掉。说明块写明当前维护哪张图、节点粒度与每层 7–20 个的规则、每轮有新结论就更新并在回复里说明增改删了哪些节点。关掉开关后不再附加说明块，已有的图原样保留。草稿对话（还没发第一条消息）和运行中的对话都能开关；重启 Osuna 后状态不变。`server_info.features` 新增逻辑图功能标记，客户端只在这一处判断：标记不在时不显示开关，改为提示"需要更新这台主机上的 Osuna"。本票的开关打开即新建，不弹选择（选择"新建 / 接着已有的图"在 06 做）。设计见 PRD 的 Implementation Decisions（Daemon 侧、App 侧）与 User Stories 1–8。

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

**Impl:** done

- [ ] 设置开关的 RPC 按 `docs/rpc-namespacing.md` 用带点的命名空间与成对的 `.request` / `.response`；协议新增字段全部可选，旧客户端能解析新消息、新 daemon 能解析旧消息，有协议兼容测试。
- [ ] 开关状态随 Agent 记录持久保存（zod schema、原子写入、不做迁移），daemon 重启后读回；草稿对话设置的状态在第一条消息发出后归到新建的 Agent 上。
- [ ] 打开开关时在 workspace `cwd` 下的 `docs/logic-maps/<临时名>/` 创建空图（骨架文件合法、节点为空）。
- [ ] 开着时发给 provider 的消息带说明块，关着时不带；时间线、provider 历史、导入和预览里都看不到说明块。测试照 `routing-block.test.ts`、`trailing-routing-block.test.ts` 的写法。
- [ ] `server_info.features` 有逻辑图标记；标记不在时输入框不显示开关，显示"需要更新主机"的提示。
- [ ] UI：桌面 1280 宽 / 输入框工具栏 / 开关关、开两态，以及连到旧主机时的提示——截图显示开关是 Switch、位置与其他 Agent 控件对齐，提示文字完整。
- [ ] 新增文案 zh-CN、en 齐全，用词与 `docs/glossary.md` 的 Logic map 条目一致（"逻辑图"）。
- [ ] `npm run typecheck`、`npm run lint` 通过；本票新增或修改的测试文件单独跑通过。
