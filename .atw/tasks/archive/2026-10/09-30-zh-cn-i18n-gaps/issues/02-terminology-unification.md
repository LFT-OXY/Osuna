# 02 — 已有中文译文的术语统一

**What to build:** 简体中文下，同一个概念在整个界面只有一种叫法。已有译文里的「智能体」「子智能体」「代理」统一改为「Agent」「Subagent」。「Agent Provider」这种半英文写法改为「提供方」。把作为界面名词的英文残留改成 PRD 定下的中文：Worktree 改为工作树，Daemon 改为守护进程，Diff 改为差异，Prompt 改为提示词，Model 改为模型，Project 改为项目，Commit / Pull / Push 改为提交 / 拉取 / 推送。占位示例值、插值和保留英文类别不动。glossary 补上这次新定下的术语写法。

工单 01 只改了和英文完全相同的值，同一界面留下了中英混排的邻居，也在本工单一并统一：Provider（如「选择一个 Provider」「添加 Provider」）改为提供方，Setup / setup 改为初始化（如「Setup 已完成」「正在 setup workspace...」），Beta 改为测试版（「切换到 Beta…」），Host / Mode / workspace / merge 等作为界面名词的残留按 PRD 译法原则改为中文。

**Blocked by:** 01

**Status:** ready-for-agent
**Impl:** done

- [x] 中文资源中不再出现「智能体」「子智能体」「Agent Provider」
- [x] 中文资源中 Worktree、Daemon、Diff、Prompt、Model、Project、Commit、Push、Pull 不再作为界面名词出现（占位示例值和插值除外）
- [x] 现有测试中写死的「个 Model」断言改为新译法，白名单测试仍然通过
- [x] `docs/glossary.md` 为 Model、Project 等本次新定的术语补上 `zh-CN UI` 写法
- [x] 资源测试文件、typecheck、lint 通过
- [x] Electron 桌面端切到中文，抽查输入框、Agent 控件、模型选择器、工作区 Git 面板、项目设置的术语一致
