# 中文开发工具界面对专有名词的译法（2026-09-30 核对）

## 来源

- Git 官方中文翻译 `git/git` 仓库 `po/zh_CN.po`（文件头自带术语表，社区维护）。
- VS Code 官方中文语言包 `microsoft/vscode-loc`：`i18n/vscode-language-pack-zh-hans/translations/extensions/vscode.git.i18n.json`。
- Trae（字节跳动 AI IDE）中文文档：https://docs.trae.cn/ide_agent-overview ，https://docs.trae.ai/ide/agent?_lang=zh 。

## 对照

| 英文 | Git zh_CN | VS Code zh-hans | Trae 中文 |
|---|---|---|---|
| commit | 提交（commit message：提交说明） | 提交 | — |
| push / pull | 推送 / 拉取 | 推送 / 拉取 | — |
| merge / rebase | 合并 / 变基 | 合并 / 中止变基 | — |
| cherry-pick / stash / fetch | 拣选 / — / 获取 | 挑拣 / 储藏 / 抓取 | — |
| diff | 差异 | — | — |
| worktree | 工作区（与 working tree 同译） | 工作树 | — |
| hook | 钩子 | — | 钩子（Hook） |
| Agent / Subagent | — | — | 智能体（Agent）/ 子智能体（Subagent）；内置智能体名为 "Agent" |
| Prompt / Skill / Rule | — | — | 提示词 / 技能 / 规则 |
| MCP Server | — | — | 保留英文 |

Git 译文中保留英文的主要是命令名（`git commit`）和选项，不是界面名词。

## 结论

官方本地化界面把 Git 操作和常见 AI 概念都译成中文，只保留缩写、协议名、命令名和产品专名。中文开发者口头常说「commit 一下」「提个 PR」，但本地化 UI 不照搬口语。
