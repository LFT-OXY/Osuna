# 03 — 第二段：合并到上游 v0.9.0-beta.2

**What to build:** 合并分支上新增一个把上游 `e9d32a17d`（v0.9.0-beta.2，累计 21 个提交）合进来的 merge commit。这一段带来"会话只订阅自己打开过的聊天"和两项桌面发版流程改进（按架构抬高构建的 Node 堆上限、发布产物上传重试）。合完之后 Osuna 的多智能体协作、第三方接口等功能照常，桌面发版流程仍是 Osuna 的身份与签名，同时拿到上游的两项改进。规格见 `prd.md` 的「合并方式」「冲突裁决规则」「发版流程与 CI」。

**Blocked by:** 02
**Status:** ready-for-agent
**Impl:** done

- [x] 合并分支包含一个以上一段结果与 `e9d32a17d` 为双亲的 merge commit。
- [x] 所有冲突按 `prd.md` 的三条裁决规则处理，每个代码冲突文件的裁决与依据记在 `## Comments` 下；裁决不了的已问过维护者。
- [x] 桌面发版工作流保留 Osuna 的身份、签名步骤和上传前的签名断言；吸收了上游的堆上限与上传重试改进；堆上限设置只剩一处。
- [x] 只在 fork 下手动触发的部署工作流触发条件未变；更新源配置仍指向 `LFT-OXY/Osuna`。
- [x] "只订阅本会话打开过的聊天"生效的同时，Osuna 的子智能体 track、@ 提及智能体、第三方接口相关的 agent 快照与投影行为未变，对应的现有测试通过。
- [x] 所有工作区版本号仍是 `0.14.2`；`CHANGELOG.md` 不含上游的 0.9.0 系列条目；`package-lock.json` 是重新生成的。
- [x] 这一段带进来的上游 `COMPAT(...)` 标签版本号已改写；新增翻译键九种语言齐全、zh-CN 为真实翻译。
- [x] Osuna 原有的测试没有被删除、跳过或放宽断言。
- [x] typecheck 和 lint 通过；本段每个代码冲突文件对应的测试文件单独跑过并通过。
- [x] 草稿 PR 上 CI 全绿，Nix 与 Nix Update Hash 除外；已知偶发失败重跑后通过。

## Comments

### 范围

merge commit 是 `0798c61c8`，双亲 `237a17969`（上一段的结果）与 `e9d32a17d`。

上游 `7c1958f5b..e9d32a17d` 共 6 个提交：#5040（只订阅本会话打开过的聊天）、两个桌面发版流程提交（`0e965bcd7` 堆上限、`3cc4ae286` 上传重试）、一次 lockfile 与 Nix 哈希、一次 changelog、一次 cut。合并前分支在 `237a17969`（工单 02 的收尾提交）。

实际冲突 17 个文件，比模拟合并估的"累计 36"少：第一段解过的不再冲突，这一段新出现的代码冲突只有三个。

### 冲突裁决

机械性 14 个：

| 文件 | 裁决 | 规则 |
| --- | --- | --- |
| 12 个 `package.json` | 冲突块全是版本号（本包版本与 `@getpaseo/*` 内部依赖），取 Osuna 的 `0.14.2`。这一段上游没有改任何外部依赖，解完后 12 个文件与合并前逐字节相同 | 版本号与发版元数据 |
| `package-lock.json` | 冲突块取 Osuna 一侧后跑 `npm install --package-lock-only --ignore-scripts` 重新生成，结果与合并前逐字节相同（上游这一段对它的改动全是 `0.9.0-beta.1` → `beta.2`） | 同上 |
| `CHANGELOG.md` | 与合并前逐字节相同 | 同上 |

代码 3 个：

| 文件 | 裁决 | 规则 |
| --- | --- | --- |
| `packages/server/src/server/agent/agent-manager.ts` | 三处，都是两边在同一位置各加一项，全留：`resumeAgentFromPersistence` 两个重载的选项类型里，Osuna 的 `apiEndpointId`（第三方接口）与上游的 `attention`；调 `registerSession` 时，Osuna 的 `createAgentsCapability`（多智能体协作）与上游的 `restoring: true` | 3 |
| `packages/server/src/server/agent/agent-projections.ts` | 导入合并：上游改从 `persistence-hooks` 取 `resolveStoredAgentUpdatedAt`，Osuna 的 `stripTrailingRoutingBlock`（Routing block）保留 | 3 |
| `.github/workflows/desktop-release.yml` | 见下 | 签名与身份按 1；堆上限按 2；上传重试按 3 |

三条规则都够用，没有两条规则互相矛盾、也没有会改变用户可见行为的取舍，所以没有在动手前停下来问维护者。有一处是规则 2 之内的取值判断（arm64 的堆上限），不是规则裁决不了，但结果由维护者说了算，单独写在下一节并在交付时上报。

### 桌面发版工作流

两处冲突：

1. **构建步骤的环境变量。** 保留 Osuna 的签名变量（`CSC_LINK` / `CSC_KEY_PASSWORD` 取 Osuna 的 secret 名、`CSC_IDENTITY_AUTO_DISCOVERY: "false"`）与"不设 `PASEO_DESKTOP_SMOKE`"；上游一侧的 Apple 公证变量（`APPLE_ID` 等）与冒烟开关不收（规则 1，ADR 0001）。堆上限两边各做了一遍，按规则 2 以上游写法为底——matrix 每个架构带 `node_heap_mb`，`NODE_OPTIONS` 引用它——Osuna 原来写死的那一行去掉，全文件只剩这一处 `NODE_OPTIONS`。
2. **`publish-linux` 作业。** Osuna 已删除这个作业，上游只改了它的上传步骤。保持删除。

冲突之外自动合上的：macOS 与 Windows 两个作业的"上传到 Release"步骤换成上游的 `node scripts/upload-release-assets.mjs`（逐个文件上传、失败重试 5 次）。`finalize-rollout` 里上传清单的那一句 `gh release upload` 上游也没改，原样。

没变的：`on:` 触发段逐行相同；签名步骤 `-c.mac.sign=./scripts/mac-sign.js`、上传之前的 `Verify macOS signature` 断言、`OSUNA_MAC_SIGNING_SHA1` 都在；`.github/workflows/` 下除它之外只有 `ci.yml` 变了一行（契约测试多跑上游的 `scripts/upload-release-assets.test.mjs`），部署工作流没有改动；`packages/desktop/electron-builder.yml` 仍是 `owner: LFT-OXY` / `repo: Osuna`。

**替维护者做的一个选择，可以改：arm64 的堆上限留在 8192，没有跟上游降到 4096。** 上游的取值是 arm64 4096、x64 8192，理由写在上游 `0e965bcd7` 的提交说明里（"8192 on the 14 GB Intel runner, 4096 on the 7 GB arm64 runner"；工作流里的上游注释只提了 Intel）。Osuna 自 `97327a13f` 起两个架构都是 8192，从 v0.8.2 起每次发版都是这个值；Osuna 的 arm64 构建在默认约 2GB 的堆下死过，4096 够不够没有在 Osuna 的包上验证过，而这张工单不发版，验证不了。所以写法取上游的，arm64 的数值留 Osuna 的（规则 2 的"把 Osuna 多出的行为补回去"），matrix 里加了两行注释说明。这样合并前后两个架构的构建行为完全相同，"按架构"目前只落了写法，数值上还没有区别。代价是这一行与上游不同，上游以后再改这个值时会冲突一次。要改成跟上游一致，把 matrix 里 arm64 的 `node_heap_mb` 改成 4096 并删掉那两行注释即可。

### "只订阅本会话打开过的聊天"与 Osuna 的功能

- App 侧四个文件（`viewed-timeline-sync.ts`、`session-context.tsx`、`workspace-layout-store.ts` 及测试）全部自动合上，与上游的改动一致。Osuna 自基点以来对 `packages/app/src/timeline/` 只有一个提交（每轮用量），与这次改动不相交。
- daemon 侧，恢复一个已有智能体时不再把 `updatedAt` 盖成当前时间，并把存下来的"待查看"状态带回来。Osuna 在同一条恢复路径上加的东西——按创建时的接口模式恢复、接口模式变化提示、子智能体的创建能力判定——都还在原位，`registerSession` 的四个调用点与上游一一对应。
- 时间线订阅只影响聊天内容的推送；子智能体 track、@ 提及用的是智能体状态更新，不走这条订阅。Osuna 自有代码里没有读取"没打开过的聊天"的时间线的地方。

### 本段没有的东西

- 新增 `COMPAT(...)` 标签：0 个。
- 新增或改动的翻译键、设置界面硬编码英文：0 处（这一段没有碰 `i18n/`，也没有新界面）。
- 新增的 `toHaveCSS` / 色值断言：0 处。
- 新增的上游站点链接：0 处。计数与工单 02 相同：`packages/app/src` 70 / 1，`packages/cli/src` 13 / 3（全部 / 非测试）。
- 被删除、改名的文件：0 个；测试文件新增行里没有 `.skip` / `.only` / `.todo` / `.fixme`。
- 冲突之外需要手工改的自动合并结果：0 处（第一段有三处）。
- `nix/npm-deps.hash` 自动合成了上游的值，没有追。
- 本地 tag 合并前后都是 14 个，逐行相同。

### 运行记录（2026-10-10，本机，合并提交之前）

本工作树有 `packages/app/.expo`（工单 02 跑 e2e 时生成的）。跑 typecheck 时把它挪到了仓库外，跑完放回，所以下面的 typecheck 结果不受它影响。

- `npm run build:server`：通过。
- `npm run typecheck`（挪开 `.expo`）：通过，0 个错误。
- `npm run lint`：0 警告 0 错误。`npm run format:check`：通过。
- CI 契约测试 `node --test scripts/ci-workflow.test.mjs scripts/daemon-launch-contract.test.mjs scripts/sync-fdroid-changelogs.test.mjs scripts/upload-release-assets.test.mjs`：31 条通过（含上游新增的上传重试 3 条）。
- server，逐个文件：`agent/agent-manager.test.ts`、`agent/agent-loading.test.ts`（含上游新增的"恢复后保留待查看与最后活动时间"）、`agent/agent-projections.test.ts`、`persistence-hooks.test.ts`、`agent/agent-storage.test.ts`、`agent/trailing-routing-block.test.ts`、`agent/routing-block.test.ts`、`agent/agent-prompt.test.ts`、`agent/import-sessions.test.ts`、`session/agent-updates/agent-updates-service.test.ts`、`session.workspaces.test.ts`、`session.test.ts`、`session.lifecycle-boundary.test.ts` —— 13 个文件 579 条通过，4 条是合并前就标着跳过的。
- server e2e（假提供方，不碰真实 CLI 登录）：`daemon-e2e/api-endpoint-claude.e2e.test.ts`、`daemon-e2e/agent-create-agents-capability.e2e.test.ts` —— 42 条通过。
- app：`timeline/viewed-timeline-sync.test.ts`、`stores/workspace-layout-store.test.ts` —— 173 条通过。
- app 浏览器 e2e：`e2e/browser/viewed-agent-timelines.spec.ts` —— 7 条通过，含上游新增的"重载后只订阅恢复进去的那个聊天"。
- 整套测试没有在本机跑，交给 CI。

### 评审（`atw-code-review`，Standards 与 Spec 两轴；本工单不改界面，无截图，Visual 轴未跑）

评审在合并提交之前、对暂存区做的。

- Standards：没有硬违规。三个手工裁决的文件都合规（ADR 0001、`docs/testing.md`、`persistence.md` 的 `apiEndpointId` 一条）。判断题：
  - 已修并复查：matrix 里那行注释原来写"自 v0.8.1 起都用 8192"，与下面"v0.8.1 的 arm64 死在这里"矛盾。核对 tag：`97327a13f` 最早进的是 v0.8.2，注释改成"自 v0.8.2 起"。
  - 照规则原样提交并上报：`node_heap_mb` 两个架构同值，矩阵参数目前没有变化量（见上面的选择）；`resumeAgentFromPersistence` 两个重载各写了一遍同一个 9 字段的内联选项类型，这次各加一行 `attention`，形状合并前就有，抽成具名类型要动上游的行。
  - 上游原样带进来的写法，改它就是改上游的行，不动：`agent-loading.ts` 在对象字面量里直接调 `extractAttention(record)`；`persistence-hooks.ts` 的三子句 `||`；`restoring?: boolean` 的命名；`agent-loading.test.ts` 新测试逐字段断言与清理里的 `.catch(() => undefined)`。
  - 规范漂移，已在本工单补上：`.atw/spec/app/frontend/testing.md` 写"seeded agent route 经不起 reload"，而上游新 e2e 正是 reload 后断言并且通过。
- Spec：没有缺项，没有范围蔓延。其余 19 个文件的增删行与上游补丁逐行相同；两个 daemon 文件两边内容都在。三条，已处理：
  - 堆上限的依据写成了"1 与 3"，应是规则 2。裁决表与正文已改。
  - "没有遇到规则裁决不了的冲突"与"替维护者做的一个选择"并存，读起来矛盾。已改写：这是规则 2 之内的取值判断，不是规则裁决不了；**arm64 取 8192 还是 4096 仍由维护者定，交付时上报**。评审的意见是关票前应有维护者的确认。
  - "上游理由是 runner 只有 7GB"评审在补丁里找不到出处。出处是上游 `0e965bcd7` 的提交说明，已在记录和工作流注释里写明。
- 修正后的复查：重跑了 `scripts/ci-workflow.test.mjs`（9 条通过）与 `npm run format:check`（通过），工作流相对合并前的差异只多了注释里的两处字样。

### 规范补充

- `.atw/spec/server/backend/persistence.md` 新增「Bringing a stored agent back is not activity」：恢复路径带 `restoring: true`、用 `extractAttention` 带回待查看状态、读最后更新时间只用 `resolveStoredAgentUpdatedAt`。
- `.atw/spec/app/frontend/testing.md`：给"seeded agent route 经不起 reload"加了限定。

### 给后续工单

- 04：`desktop-release.yml` 在第三段还会再冲突一次（discovery 记的 2 处 / 128 行里有一部分属于第三段）。堆上限那一行如果上游没再动，就不会再冲突；上游若改了 arm64 的值，按本工单的选择处理，或按维护者届时的决定。
- 04：本工作树有 `packages/app/.expo`，跑 typecheck 前挪到仓库外、跑完放回。
- 05：值得写进文档的——没有依赖改动的一段，`package.json` 与 `package-lock.json` 解完应与合并前逐字节相同，可以拿这一点当自检；两边各做了一遍的发版设置（堆上限）取上游写法、数值另议；上游删改 Osuna 已删除的作业（`publish-linux`）时保持删除。
- 06：PR 正文里列出 arm64 堆上限的选择；本段没有因 Osuna 的决定而改动的上游测试。

### 推送与 CI

- 推送 `0798c61c8`（merge commit）与 `6bf8e47db`（本工单记录）到 `identify-fork-base`（草稿 PR #13），只推这一条分支，没有推 tag。依据是 PRD「每段推送后看 CI」和本工单的 CI 验收项，没有另行询问。
- `6bf8e47db` 上 CI 工作流 18 项全部通过，没有重跑：changes、format、lint、typecheck、app-tests、sdk-tests、relay-tests、server-tests（ubuntu / windows）、desktop-tests（ubuntu / windows）、cli-tests 三片、playwright 四片。Desktop Packages 的 `linux` 也通过（工单 02 记的那次 AppImage 自检偶发失败这一轮没有出现）。Nix 与 Nix Update Hash 这次没有被触发。
- `237a17969`（工单 02 的收尾提交）上的那次 CI 显示"已取消"：是被这次推送顶掉的，不是失败。

### 验收项说明

- 第 2 条"裁决不了的已问过维护者"：本段没有规则裁决不了的冲突。arm64 堆上限的取值是规则 2 之内的判断，已在交付时上报，**维护者尚未答复**，维持 8192；答复若是 4096，在进入 06 之前另起一个提交改掉。
- **维护者 2026-10-10 答复：跟上游，arm64 降到 4096。** 在工单 05 之后另起一个提交改掉：matrix 里 arm64 的 `node_heap_mb` 改为 4096，删掉那两行说明"不跟着降"的注释，改完后 matrix 这一段与上游 `7f7e60bcb` 逐行相同，上游再改这一行时不会因为它冲突。`node --test scripts/ci-workflow.test.mjs` 9 条通过。上面「桌面发版工作流」一节里"留在 8192"的选择至此作废。4096 在 Osuna 的包上还没有实际构建过，第一次验证是 06 手动派发的那次桌面发版工作流（不发布）：arm64 作业若在 `expo export` 阶段因内存耗尽失败，就是这个值不够。
