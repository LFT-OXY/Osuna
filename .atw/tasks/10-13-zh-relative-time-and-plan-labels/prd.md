# 相对时间与套餐额度名称的中文化

来源：任务 `10-11-merge-upstream-v0.11.2` 的工单 14（视觉走查）在中文界面里记下的三类英文，记录在该任务的 `issues/14-visual-pass-and-screenshots.md`「中文界面里仍是英文的」（归档后在 `.atw/tasks/archive/` 下）。维护者 2026-10-13 裁定不在合并任务里做，另开本任务。这份文件只记下要解决的问题，还没有做需求访谈，开工前先走 discover。

## Problem Statement

界面语言为中文时，下面三类文字仍是英文：

| 类别 | 例子 | 出处 |
| --- | --- | --- |
| 相对时间 | `11h ago`、`now`、`5m`、超过一周的 `Jan 15`；套餐卡片里的「Jan 15更新」「登录已过期（Sep 20）」 | `packages/app/src/utils/time.ts` 写死英文，合并上游前就是这样；14 个文件在用（会话历史、侧栏工作区行、套餐用量的更新时间等）。Usage 页自己的 `usage-stats/relative-time.ts` 已是中文 |
| 套餐额度的窗口与余额名 | `Session`、`Weekly`、`5-hour`、`30-day`、`Extra usage`、`Credits`、`Disabled`，以及来源报错的原文 | 用量来源插件（根目录 `plugins/*-usage-source`）在报告里给的 `label`，应用原样显示 |
| 模式、思考档位与功能名 | `Medium`、`Bypass`、`Auto-review`、读屏名 `Toggle plan mode`；Agent 档案编辑弹窗里速度那一行 | daemon 下发；`docs/i18n.md`「Translation Scope」写明不翻 |

## Constraints

- `utils/time.ts` 是上游文件，紧凑写法（`5m`、`2h`）用在最密的侧栏行上，中文写法要先定（「5 分钟」还是「5分」），再看宽度够不够；九种语言的文案键要一起加，翻译守卫才过。
- 额度名来自插件的报告，属于协议里的数据。在应用里按已知的 `id` 映射成文案键是一种做法，改插件让它带本地化的名字是另一种；两种都要对着 `docs/plugins.md` 与 `docs/protocol-compatibility.md` 定。
- 第三类要先改 `docs/i18n.md` 的范围约定才动。
- 改到上游文件时贴着上游结构改，并写进 `docs/release.md`「踩过的坑」。

## Acceptance Criteria

- [ ] TBD — discover 之后写。
