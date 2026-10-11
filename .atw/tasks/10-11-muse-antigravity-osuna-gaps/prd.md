# Muse Code 与 Antigravity 补齐 Osuna 独有的提供方功能

来源：合并上游 v0.11.0-beta.1（任务 `10-11-merge-upstream-v0.11.2` 的第一段）时核实出的缺口，核实过程在任务 `10-11-merge-upstream-v0.11.2` 的 `issues/04-stage-1-builtin-plugins-and-new-providers.md`「2026-10-11 实施记录」（归档后在 `.atw/tasks/archive/` 下）。这份文件只记下要解决的问题，还没有做需求访谈，开工前先走 discover。

## Problem Statement

上游 v0.11.0 把 Muse Code（命令 `muse`）与 Antigravity（命令 `agy`）做成内置插件提供方（根目录 `plugins/muse-provider`、`plugins/antigravity-provider`），不在 `packages/server/src/server/agent/providers/` 下。Osuna 给内置 CLI 提供方加的三项功能都以「内置提供方」为前提，插件提供方一项也没有：

| 功能 | 现状 | 原因 |
| --- | --- | --- |
| 已装版本（列表状态行与详情页「版本」节） | 不出现 | 快照把插件提供方标为 `source: "custom"`；`provider-snapshot-manager.ts` 只对 `source === "builtin"` 取版本。插件的 `status()` 其实跑过 `--version`（Muse 要求 ≥1.3.0），但结果没有进快照 |
| 一键升级（列表行与详情页的「升级」按钮） | 不出现 | `ProviderVersionCheckService` 只查 `AGENT_PROVIDER_DEFINITIONS` 里带 `npmPackage` 的内置提供方；`ProviderUpgradeService` 对 `hasProviderUpgradeCommand` 之外的提供方返回 `unsupported`。两个 CLI 的安装与升级方式还没有查 |
| 安装指引（详情页「安装与升级」区块） | 不出现 | `provider-install-guide/internal/commands.ts` 的 `PROVIDER_INSTALL_GUIDES` 没有这两个；`resolveGuidedProvider` 对非内置提供方按 `extends` 找，插件提供方没有 `extends` |

另两处是上游原样的表现，用户会碰到，要不要在 Osuna 改由维护者定：

- **CLI 缺失时显示「错误」而不是「未安装」。** 快照刷新第一步调 `client.getCatalogCacheKey`（两个插件都声明了它），经上游 `agent/plugin-provider.ts` 的 `catalogCacheKey()` → `resolveLaunch()`，命令不在 PATH 时抛 `muse not found on PATH`，快照在这一步就记成 `error`，没走到后面问 `isAvailable()` 的那段：列表红点「错误」，详情页顶部是「Muse Code 无法启动」错误卡。内置提供方同样情况是黄点「未安装」。改法是让 `catalogCacheKey` 在命令缺失时不抛错（返回 undefined），或让快照先问可用性；两种都是对上游文件的偏离，每次合并上游都要重解。
- **⋯ 菜单里的「移除提供方」对插件提供方无效。** `provider-detail/header.tsx` 与上游列表页都按 `source === "custom"` 给「移除」；点了只删 `config.json` 里的覆盖项，插件注册的提供方还在，刷新后行还在。可选做法：快照给插件提供方一个单独的来源值（协议 `ProviderSnapshotEntrySchema.source` 目前只有 `builtin | custom`，加值要按 `docs/protocol-compatibility.md` 走），或应用侧按插件注册判断。

## Constraints

- `docs/providers.md`、`docs/plugins.md`：插件提供方由插件自己声明命令与状态，daemon 侧的版本、升级、安装指引要么走插件协议扩展，要么在 daemon 里按命令名特判；前者要动 `packages/plugin` 的接口，后者是对上游文件的偏离。discover 时先定走哪条。
- 本机没装这两个 CLI，也不在本机测任何提供方的登录（见 `.atw/spec` 与既有约定）。实测要一台装了 Muse Code / Antigravity 的机器。
- 改到 `agent/plugin-provider.ts`、`provider-snapshot-manager.ts` 这类上游文件时，贴着上游结构改，并写进 `docs/release.md`「踩过的坑」。

## Acceptance Criteria

- [ ] TBD — discover 之后写。
