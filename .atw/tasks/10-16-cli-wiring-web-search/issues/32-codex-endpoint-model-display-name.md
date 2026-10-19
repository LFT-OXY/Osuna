# 32 — Codex `/model` 里接口模型显示出是哪家接口

**What to build:** 用 ChatGPT 登录的 Codex，`/model` 列表里接口模型现在只显示模型名（如 `gpt-6-sol`）。两家接口选了同一个模型时，会出现两个同名条目，分不出是哪家的。31 号工单真实验收时发现（10-19，见 31 号工单 Comments；截图 `screenshots/31-codex-model-list-chatgpt-login-before-fix.png`）。

改成显示「模型名（接口名）」，和设置页里默认模型的写法一致；Codex 存进 `config.toml` 的 slug 仍是「接口标识/模型名」，不变。

- 显示名来自 `packages/server/src/server/api-endpoints/codex-model-catalog.ts` 的 `codexEndpointEntries`（`displayName: model.label ?? model.id`）。
- 同一份条目的 `display_name` 还被 `gateway/codex-requests.ts` 拿去当 Subagent 可选模型的名字，改完后核对那里读起来仍然对。
- API key 登录用的模型目录（`codexModelCatalog`，同名去重、带标识的条目 `visibility: "hide"`）不在本票范围。

**Blocked by:** —
**Status:** ready-for-agent
**Impl:** ready

- [ ] 用 ChatGPT 登录时，`/model` 里每个接口模型显示成「模型名（接口名）」；两家接口的同名模型分得开。
- [ ] Codex 存下的模型仍是「接口标识/模型名」，现有的跟随 CLI 选择、默认模型写入不受影响。
- [ ] Subagent 可选模型的名字跟着变，读起来没有重复或错位。
- [ ] `codex-model-catalog.test.ts` 补上对应用例并通过；`npm run typecheck`、`npm run lint` 通过。
- [ ] 用户在 dev 桌面端用真实 Codex 复看 `/model`（用户自己做），通过后回到 31 号工单勾「Codex」那一项。

参考：prd.md「Acceptance Criteria」中「模型清单里 ChatGPT 自带模型在前、接口模型以『接口标识/模型名』在后」；31 号工单 Comments。
