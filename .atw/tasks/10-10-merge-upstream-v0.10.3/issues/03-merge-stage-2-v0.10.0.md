# 03 — 第二段：合并到上游 v0.10.0

**What to build:** 合并分支上多一个把上游 `c481ecf3e`（v0.10.0，本段 6 个提交）合进来的 merge commit。模拟合并里这一段没有新的代码冲突，新增的冲突只有 4 个与 Osuna 同名的安卓商店说明文件。合完之后分支仍能通过检查，01、02 的结果原样保留。规格见 `prd.md` 的「合并方式」「版本号与发版元数据」。

**Blocked by:** 02
**Status:** ready-for-agent
**Impl:** done

- [x] 合并分支包含一个以合并前的分支头与 `c481ecf3e` 为双亲的 merge commit。
- [x] 冲突文件的裁决与依据记在 `## Comments` 下；出现模拟合并里没有的代码冲突时按 `prd.md` 的规则裁决，规则裁决不了的已停下来问过维护者。
- [x] 与 Osuna 同名的安卓商店说明文件留 Osuna 的。
- [x] 所有工作区版本号仍是 `0.14.2`；`package-lock.json` 重新生成后与本段合并前逐字节相同，或差异已说明；`CHANGELOG.md` 与合并前逐字节相同。
- [x] `docs/release.md`「合并后核对」逐项过完，结果记在 `## Comments` 下；上游站点链接数不多于 01 的基线。
- [x] 翻译资源测试通过。
- [x] typecheck 和 lint 通过；本段上游改动落在 01、02 处理过的文件上时，对应的测试文件重新跑过并通过。
- [x] 已推送，草稿 PR 上本段的 CI 已看过；失败项逐个有结论。

## Comments

### 2026-10-11 实施记录

**本段上游的 6 个提交。** `30178c4f5`（锁文件签名与 Nix 哈希）、`dec2d861e`（官网首页 Philosophy 一节）、`7f5d32cdd`（官网的 Orca 对比页）、`da48803a4`（#5526，OpenCode 2.x 重连后恢复每个会话的完整环境变量）、`dfc9add77`（更新日志）、`c481ecf3e`（发版提交，只改版本号）。

**提交。** merge commit `6cac3ad8b`（双亲 `5f29e2c53` 与 `c481ecf3e`）。本段没有冲突之外的适配，merge commit 之后没有适配提交。合并后本地 tag 仍是 14 个，`git tag | shasum` 仍是 `8625da06…`。

#### 冲突（18 个，全部是机械性的）

实际冲突与 2026-10-10 的模拟合并一致：没有代码冲突，比第一段多出的只有 4 个安卓商店说明。

| 文件 | 裁决 | 依据 |
| --- | --- | --- |
| 12 个 `package.json` | 冲突块取 Osuna（版本号、`@getpaseo/*` 内部依赖），共 17 个冲突块。解完与合并前逐字节相同：上游这一段在冲突块之外没有加东西 | 版本号与发版元数据表 |
| `package-lock.json` | 从合并前的文件出发用 `npm install --package-lock-only --ignore-scripts` 重新生成，与合并前逐字节相同。上游这一段没有改外部依赖 | 同上 |
| `CHANGELOG.md` | 冲突块取 Osuna，与合并前逐字节相同 | 同上 |
| `fastlane/metadata/android/en-US/changelogs/100001.txt` – `100004.txt` | 留 Osuna 的，与合并前逐字节相同。两边版本号重叠算出了同名文件（add/add） | 同上 |

做法：脚本只把冲突块取 HEAD 一侧，冲突块之外保持自动合并的结果，再用 `shasum -c` 对合并前的指纹逐个核对。指纹清单是这 18 个冲突文件，加上仓库里另外 6 个没有冲突的 `package.json`（`packages/app/modules/` 下 4 个原生模块、`packages/expo-two-way-audio/examples/` 下 2 个示例），24 个全部一致。

#### 自动合并的 9 个文件

合并后都与上游 `c481ecf3e` 逐字节相同，Osuna 在 01、02 里没有碰过其中任何一个：

- `provider-launch-config.ts`、`opencode/v2/agent.ts`、`opencode/v2/session.ts`、`opencode/v2/agent.test.ts`：#5526。2.x 会话设环境变量的位置从 `configureConnection()` 挪到 `reconcileConnection()`（事件流重连时也会重设），设进去的内容由启动上下文里的那几个变量换成 `createProviderEnv` 算出的整份提供方环境；`createProviderEnv` 的返回类型收窄为 `ExternalProcessEnv`。只动 2.x 路径；`createProviderEnv` 在 Osuna 这边的调用方（`claude/agent.ts`、`claude/query.ts`、`codex-app-server-agent.ts`）typecheck 通过。
- `packages/website` 下 4 个文件（首页的 Philosophy 一节、Orca 对比页及其路由）：只落在官网包里，按 prd「CI 与官网」照收。官网在本仓库只手动部署。
- `nix/npm-deps.hash`：自动合并成上游的值。按 `docs/release.md` 不追；Nix 与 Nix Update Hash 是已知红灯。

本段上游的改动与 01、02 处理过的文件的交集只有上面那 18 个机械性文件，没有落在两张工单手工处理过的代码文件上。

#### 合并后核对

- 更新源：`electron-builder.yml` 的 `publish` 仍是 `LFT-OXY/Osuna`。
- 桌面身份与数据目录：`appId` `com.chinhae.osuna.desktop`、`productName` `Osuna`；`main.ts` 仍把 userData 固定在原目录名。
- 签名与签名断言：`mac-sign.js` 钩子、`OSUNA_MAC_SIGNING_SHA1`、`Verify macOS signature` 都在；`notarize: false`，没有 Apple 公证变量。
- 部署工作流：四个文件的 `on:` 只有 `workflow_dispatch`。
- 以上四项，以及 `packages/app/src`、`packages/cli/src`、`packages/protocol`：相对合并前没有任何差异。
- 上游站点链接数：app 72 / 1，cli 13 / 3，与 01 合完后的数字相同，不多于基线。官网包里新增的上游链接不在这个口径里。
- 翻译键：本段上游没有改翻译资源；`i18n/resources.test.ts` 38 条通过。
- `COMPAT(...)`：本段没有新带进来的标签。
- 协议：本段没有改协议包。

#### 验证

- `npm run typecheck`、`npm run lint`、`npm run format:check`：通过。
- 本段新增或改动过的测试文件只有 `opencode/v2/agent.test.ts`，14 条通过。上游在里面加了一条「重连与恢复后还原同目录各智能体的环境变量」，并把两条旧用例里对环境变量的断言从 `toEqual` 改成 `toMatchObject`（环境里现在多了整份提供方环境，其中一条另补了「重连前后两份环境相同」的 `toEqual`）。这个文件合并前与上游 `52d345db7` 逐字节相同，里面没有 Osuna 的用例，所以被改的不是 Osuna 的断言。
- 另外跑了与改动相邻的 `provider-launch-config.test.ts` 20 条、`opencode/runtime-client.test.ts` 20 条（01 在这层包装上补过 Osuna 的入口），通过。
- 没有新写测试：本段没有 Osuna 自己的行为改动，按 prd「Testing Decisions」只用已有的和上游带来的测试。没有界面改动，不截图。
- 整套测试交给 CI。

#### 评审（2026-10-11）

提交前对未提交的 merge 做了 Standards 与 Spec 两个维度的评审；本段没有界面改动，Visual 没有跑。

- Spec：没有缺失项与范围蔓延。指出本记录三处写得不准（指纹清单的 24 个文件没说明多出的 6 个；#5526 的改动描述成了「启动时覆盖一次」；漏记上游把两条旧断言改成 `toMatchObject`），已按仓库实际内容改正，改后逐条对过。#5526 与 ADR 0003、「2.x 路径按上游的原样收下」没有抵触：没动 `listCommands`，`createProviderEnv` 不启动进程。
- Standards：Osuna 自己的改动上没有硬性违规。字面上不合 `docs/coding-standards.md` 的三处都在上游代码里（`opencode/v2/agent.ts` 三元分支里的函数调用、官网 `landing-page.tsx` 的内联对象类型、`opencode/v2/agent.test.ts` 的 `toMatchObject`），2.x 路径与官网按 prd 原样收下，没有改。
- 如实报给维护者、没有处理的判断项，都在上游代码里：`session.ts` 的 `launchEnv` 现在装的是整份环境，名字没跟着改；上游新用例断言依赖 `process.env.PATH` / `USER`，环境里没有 `USER` 时那一条断言等于没断言。
- 01 留给 05 的那一条不受本段影响：2.x 会话的 `listCommands()` 仍先调 `reconnectIfExited()`。Spec 评审说这条路径「多了一次设置环境变量的请求」，对照 `session.ts` 不成立——服务退出后的重连原来在 `configureConnection()` 里设一次，现在在随后的 `reconcileConnection()` 里设一次，次数没变。

#### 规范回写

没有要写回的内容。本段没有 Osuna 自己的代码改动，遇到的情况（版本号类文件取 Osuna、锁文件与合并前逐字节相同的自检、同名的安卓商店说明、`nix/npm-deps.hash` 不追、上游改自己旧用例的断言不报冲突）在 `docs/release.md`「从上游同步」里都已有条目。

#### 推送后的 CI（2026-10-11）

merge commit `6cac3ad8b` 推到 `origin/merge-upstream-v0.10.3`，草稿 PR #15 上 20 项作业全部通过（运行 38069256583，`linux` 为 38069257207）：format、lint、typecheck、app-tests、server-tests（三个平台）、desktop-tests（两个平台）、cli-tests（三个分片）、sdk-tests、relay-tests、playwright（四个分片）、linux。没有失败项。

首次失败、重试后通过的一条，在 playwright 分片 3：`settings-providers-list-detail.spec.ts:58`「pushes the detail and returns through the breadcrumb on a wide window」。与 02 记录的是同一条：合并前 main 最近三次 CI 与前两次推送里都是同样的首次失败、重试通过。合并前就有，与本段无关，没有处理。其余三个分片没有重试的用例。
