# 32 — Codex `/model` 里接口模型显示出是哪家接口

**What to build:** 用 ChatGPT 登录的 Codex，`/model` 列表里接口模型现在只显示模型名（如 `gpt-6-sol`）。两家接口选了同一个模型时，会出现两个同名条目，分不出是哪家的。31 号工单真实验收时发现（10-19，见 31 号工单 Comments；截图 `screenshots/31-codex-model-list-chatgpt-login-before-fix.png`）。

改成显示「模型名（接口名）」，和设置页里默认模型的写法一致；Codex 存进 `config.toml` 的 slug 仍是「接口标识/模型名」，不变。

- 显示名来自 `packages/server/src/server/api-endpoints/codex-model-catalog.ts` 的 `codexEndpointEntries`（`displayName: model.label ?? model.id`）。
- 同一份条目的 `display_name` 还被 `gateway/codex-requests.ts` 拿去当 Subagent 可选模型的名字，改完后核对那里读起来仍然对。
- API key 登录用的模型目录（`codexModelCatalog`，同名去重、带标识的条目 `visibility: "hide"`）不在本票范围。

**Blocked by:** —
**Status:** ready-for-agent
**Impl:** done

- [x] 用 ChatGPT 登录时，`/model` 里每个接口模型显示成「模型名（接口名）」；两家接口的同名模型分得开。
- [x] Codex 存下的模型仍是「接口标识/模型名」，现有的跟随 CLI 选择、默认模型写入不受影响。
- [x] Subagent 可选模型的名字跟着变，读起来没有重复或错位。
- [x] `codex-model-catalog.test.ts` 补上对应用例并通过；`npm run typecheck`、`npm run lint` 通过。
- [x] 用户在 dev 桌面端用真实 Codex 复看 `/model`（用户自己做），通过后回到 31 号工单勾「Codex」那一项。

参考：prd.md「Acceptance Criteria」中「模型清单里 ChatGPT 自带模型在前、接口模型以『接口标识/模型名』在后」；31 号工单 Comments。

## Comments

**2026-10-19 实现**

- 显示名写成 `模型名 (接口名)`，用半角括号：daemon 不知道界面语言，Codex 是英文界面，和设置页英文版的写法一致（中文版设置页是全角括号）。模型名仍取 `label ?? id`。
- Subagent 补列清单跟着变，写成 `` - `relay-a/kimi-k2`: kimi-k2 (RELAY-A) ``。这段会随提示词发给上游（主对话用 ChatGPT 自带模型时发给 OpenAI），多带了接口的显示名；`接口标识/模型名` 本来就在里面。
- 两家接口起了同一个名字时仍分不开；设置页不拦重名，不在本票处理。
- 清单内容变了，升级后 Codex 会重新拉一次模型清单。
- ADR 0010 补了显示名规则。

**2026-10-19 用户复看**

- 用户在 dev 桌面端（重新 `build:server` 后启动，端口 6769，真实 `~/.codex`）打开 Codex 的「使用第三方接口」，`/model` 里接口模型显示成「模型名 (接口名)」，两家接口的同名模型分得开，选接口模型能正常回复；关开关后 `~/.codex/config.toml`、`~/.claude/settings.json` 与开测前的备份逐字节一致。用户原话：「没问题」。

