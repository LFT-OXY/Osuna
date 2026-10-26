# 01 — 第一段：合并到上游 v0.12.0-beta.1

**What to build:** 合并分支 `merge-upstream-paseo-updates` 上有一个把上游 `e2f4948f9`（v0.12.0-beta.1，同步点 v0.11.2 之后 165 个提交）合进来的 merge commit。合完后 Osuna 多出上游这一段的内容——新的 Markdown 渲染器、手机全屏 Composer、Hoplite 与提供方目录、Agent 间消息的发送者信封与默认插话、后台工作区、`paseo usage` CLI 等——而 Osuna 自己的功能和有意做的决定都在。这是本次最大的一段（模拟 97 个冲突文件），merge commit 不能拆；这张工单做到「分支能通过检查、Osuna 原有行为不丢」为止，聊天 Markdown 与 Composer 的适配留给 02，提供方的适配留给 03。规格见 `prd.md` 的「合并方式」「补丁分支」「Markdown」「Composer」「提供方」「连接的主机与 Agent 间消息」「版本号与发版元数据」「协议与兼容」。

**Blocked by:** None — can start immediately
**Status:** ready-for-agent
**Impl:** ready

- [ ] 开工先确认分支是 `merge-upstream-paseo-updates`、基于 main `b8d4f55e7`、工作区干净；`upstream` remote 不抓 tag。
- [ ] 合并分支包含一个以合并前的分支头与 `e2f4948f9` 为双亲的 merge commit。
- [ ] 补丁分支分叉处的 16 个文件（15 个版本号与锁文件、依赖补丁脚本）按固定裁决处理：上游的部分取主线一侧，Osuna 的改动保留；依赖补丁脚本取主线一侧。
- [ ] 上游删掉的聊天 Markdown 样式文件与语言识别模块：Osuna 引用它们的地方先接到上游的新位置，分支能编译；Osuna 样式的完整迁移在 02。
- [ ] Composer：Web 与 Electron 仍是 Tiptap 输入，测高模块不在 Web 端恢复；冲突最多的输入组件解完后分支能编译，手机全屏编辑的接法在 02。
- [ ] Agent 间消息：上游的发送者信封与默认插话照收；经 Agent mention 派发的消息末尾仍有 Routing block（ADR 0004），由现有测试证明。
- [ ] `agent-manager` 里 Osuna 放行带父标签 Agent 的 attention 等改动保留；问题卡片的作答状态仍在 Osuna 的 core 模块里，上游对状态的改动改到 core 里。
- [ ] Claude、Codex、Pi、OMP、OpenCode 的 `paseo.create_agent` 命名与父工具调用归属、子智能体权限归属、已装版本与一键升级、CLI 启动解析、第三方接口切换的现有测试全部通过，无一改动断言。
- [ ] 合并前按 `docs/release.md`「合并后核对」的口径统计应用与 CLI 源码中指向上游站点的链接数（全部与非测试），记在 `## Comments` 下；合完后非测试数不多于合并前。
- [ ] 每个冲突文件怎么裁的、依据哪条规则，按区域逐个记在 `## Comments` 下，供 14 写 PR 正文用。规则裁决不了、或保留两边会改变用户可见行为的冲突没有自行取舍：已停下来问过维护者，问答记在 `## Comments` 下。
- [ ] 所有工作区版本号是 `0.17.0`；各 `package.json` 相对合并前的差异只有上游在版本号之外的改动；`package-lock.json` 是重新生成的，差异能逐项对应到上游新增或升级的依赖。
- [ ] `CHANGELOG.md` 与合并前逐字节相同；与 Osuna 同名的安卓商店说明文件留 Osuna 的；README 与 `CLAUDE.md` 的冲突块取 Osuna 的。
- [ ] 协议新增的字段都是可选的，协议的现有测试无一改动断言；上游新带进来的 `COMPAT(...)` 标签（合并前 main 上不存在的名字）改写为 `v0.18.0`，清单记在 `## Comments` 下。
- [ ] `docs/release.md`「合并后核对」逐项过完，结果记在 `## Comments` 下：更新源、桌面身份与数据目录、签名与签名断言、只手动触发的部署工作流、上游站点链接、翻译键。
- [ ] 翻译资源测试单独跑过并通过；上游新增的键九种语言齐全，zh-CN 是真实翻译、符合术语表。
- [ ] 对本段冲突涉及的测试文件对比合并前后，没有 Osuna 的断言行被悄悄删掉；必须跟着改的断言逐条记在 `## Comments` 下。
- [ ] 指令目录的现有测试全部通过，无一改动断言；取指令列表不启动进程（ADR 0003）。
- [ ] typecheck 和 lint 通过；本段冲突文件对应的测试文件、以及本段新增或改动过的测试文件逐个单独跑过并通过（不跑整套）。
- [ ] dev 桌面端快速冒烟：侧栏、输入框、聊天、Providers 页、第三方接口页、用量页打开正常，无报错。
- [ ] 本段不推送、不开 PR（维护者 2026-10-26 确认：七段全部做完再开 PR）。
