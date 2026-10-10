# 01 — 第一段：合并到上游 v0.9.1

**What to build:** 合并分支 `merge-upstream-v0.9.2` 上有一个把上游 `818658520`（v0.9.1，同步点之后的前 7 个提交）合进来的 merge commit。合完之后 Osuna 多出上游这一段的内容——「导入会话」能找到全部 Codex 对话、侧栏在补发事件后不丢对话、Opus 5.5 换成上游的形态——而 Osuna 自己的功能和有意做的决定都在。用户能看到的变化只有一处：没手动选过档位的 Opus 5.5 对话，默认思考档位由「高」变为「中」。规格见 `prd.md` 的「合并方式」「冲突裁决 → Opus 5.5 模型」「版本号与发版元数据」；冲突清单与两边 Opus 5.5 的逐项差异见 `research/discovery.md`。

**Blocked by:** None — can start immediately
**Status:** ready-for-agent
**Impl:** done

- [x] `upstream` remote 已抓到 `818658520` 与 `c67b7158b`，仍配置为不抓取 tag；合并前后本地 tag 列表不变。
- [x] 合并前按 `docs/release.md`「合并后核对」的口径统计一次应用与 CLI 源码中指向上游站点的链接数，记在本工单的 `## Comments` 下，作为 02 与 03 的基线。
- [x] 合并分支包含一个以合并前的分支头与 `818658520` 为双亲的 merge commit。
- [x] 每个冲突文件怎么裁的、依据哪条规则，逐个记在 `## Comments` 下，供 03 写 PR 正文用。规则裁决不了的冲突没有自行取舍：已停下来问过维护者，问答记在 `## Comments` 下。
- [x] Opus 5.5 的清单条目是上游的写法，默认思考档位为「中」；带前缀模型 ID 的归一化是上游的写法，Osuna 为同一问题写的那份已去掉。
- [x] Osuna 测试里 Opus 5.5 默认思考档位的预期由「高」改为「中」，除这一条外没有 Osuna 的断言被删除、跳过或放宽；改动前后的断言行记在 `## Comments` 下。
- [x] `us.anthropic.claude-opus-5-5` 及其 1M 后缀形式解析到清单里的 Opus 5.5，这两条 Osuna 的断言仍在并通过。
- [x] 两边各自独有的 Opus 5.5 用例都在：上游的前缀与日期后缀归一化、`2.1.280` 下默认模型为 Opus 5.5；Osuna 的旧版 CLI 不出现 Opus 5.5。
- [x] 所有工作区版本号仍是 `0.14.2`；`package-lock.json` 是重新生成的，与合并前逐字节相同。
- [x] `CHANGELOG.md` 与合并前逐字节相同；`.gitignore` 两边新增的条目都在。
- [x] `docs/release.md`「合并后核对」逐项过完，结果记在 `## Comments` 下；任何一项有变化都已查清原因。
- [x] 对本段冲突涉及的测试文件对比合并前后，没有 Osuna 的断言行被悄悄删掉。
- [x] typecheck 和 lint 通过。
- [x] Claude 模型清单的测试文件单独跑过并通过。
- [x] 合并分支已推到 `origin`，并开出指向 main 的草稿 PR（推送与开 PR 前先向维护者说明并取得同意）。

## Comments

### 2026-10-10 第一段处理记录

合并前分支头 `9010d774c`（= `origin/main`），merge commit `2887a73f6`，双亲 `9010d774c` 与 `818658520`。
合并后 `git merge-base HEAD upstream/main` = `818658520`。

**抓取。** `upstream` remote 已有 `818658520` 与 `c67b7158b`，`remote.upstream.tagOpt` = `--no-tags`。
合并前后 `git tag` 都是 14 个，逐行相同。

**上游站点链接数基线（合并前，`docs/release.md`「合并后核对」的口径）。**

| 范围               | 全部 | 非测试 |
| ------------------ | ---- | ------ |
| `packages/app/src` | 70   | 1      |
| `packages/cli/src` | 13   | 3      |

合并后四个数字相同。

**冲突裁决（17 个文件，与模拟合并一致）。**

| 文件 | 裁决 | 依据 |
| ---- | ---- | ---- |
| 12 个 `package.json`（根目录与 11 个工作区） | 取 Osuna 一侧。上游本段对这些文件只改了版本号与 `@getpaseo/*` 内部依赖版本，`git diff 7f7e60bcb 818658520` 去掉版本行后为空 | 版本号与发版元数据 |
| `package-lock.json` | 先取 Osuna 一侧，再用 `npm install --package-lock-only --ignore-scripts` 重新生成；`cmp` 与合并前逐字节相同 | 同上 |
| `CHANGELOG.md` | 取 Osuna 一侧；`cmp` 与合并前逐字节相同 | 同上 |
| `.gitignore` | 两边各加的一条都留：Osuna 的 `.gradle/`、上游的 `*.heapsnapshot` | 规则 3 |
| `providers/claude/model-manifest.ts` | 整个文件取上游，结果与 `818658520` 逐字节相同。Osuna 相对同步点的改动只有两处，都被上游同等实现覆盖：Opus 5.5 清单条目（上游多一行 `defaultThinkingOptionId: "medium"`）、带前缀模型 ID 先试主-次版本的归一化（Osuna 的 `hasOneMillionContext` 局部变量与中文注释去掉） | 规则 2，维护者已确认 |
| `providers/claude/models.test.ts` | 以上游文件为底，补回 Osuna 独有的两处，见下 | 规则 2，维护者已确认 |

没有规则裁决不了的冲突，本段没有新增需要问维护者的问题。

**`models.test.ts` 逐项。** 相对上游只多 9 行（`git diff 818658520 HEAD -- <该文件>`）：

- `parseClaudeCodeVersion` 下的 `reads the real --version output`（Osuna 独有，原样保留）。
- `Claude Opus 5.5 catalog` 下新增一条 `resolves provider-prefixed Opus 5.5 IDs to the catalog entry`，
  装 Osuna 独有的两条断言：`findClaudeModel("us.anthropic.claude-opus-5-5")` 与
  `findClaudeModel("us.anthropic.claude-opus-5-5[1m]")` 都解析到 `claude-opus-5-5`。单独成条而不是塞进
  上游的用例，上游以后改自己那条时不会再冲突。上游的归一化写法直接满足这两条，没有在上游写法上补代码。

相对合并前 Osuna 去掉的行，逐条对应：

| Osuna 原来的行 | 合并后 |
| -------------- | ------ |
| `["claude-opus-5-5", false, "high"]`、`["claude-opus-5-5-20260926", false, "high"]`（`resolves disabled thinking for model %s`，第 179–180 行） | `["claude-opus-5-5", false, "medium"]`、`["claude-opus-5-5-20260401", false, "medium"]`。**结论改了：`high` → `medium`，本次唯一一处**——是同一条 `it.each` 的两行参数，生成两个用例，PR 正文按两行写；日期样例取上游的 |
| `preOpus55Models` 的三条断言（`2.1.279` 没有 Opus 5.5、默认是 Opus 5；`2.1.280` 有 Opus 5.5） | 上游的四条，前三条内容相同（不用局部变量），多一条 `2.1.280` 下默认模型是 Opus 5.5 |
| Opus 5 目录用例的过滤条件 `id === "claude-opus-5" \|\| id === "claude-opus-5[1m]"` | 上游的 `/^claude-opus-5(\[1m\])?$/`，筛出的集合相同，断言不变 |
| `offers one Opus 5.5 entry with a 1M context window` | 上游同名用例，内容相同 |
| `offers effort levels up to Ultra Code without a thinking-off option` | 上游的 `offers every effort level except off, because Opus 5.5 cannot disable thinking`：同一个档位列表断言，另加默认档位为 `medium` 的两条 |
| `resolves suffixed, dated, and provider-prefixed Opus 5.5 IDs to the catalog entry` 的五条 | 前三条由上游的 `resolves suffixed and dated Opus 5.5 IDs to the catalog entry` 覆盖（日期样例 `20260926` → `20260401`），后两条 `us.anthropic.` 进上面新增的那条 |
| 用例标题 `supports fast mode on Opus 5 and Opus 5.5 but not on other Claude 5 models` | 取上游的标题 `supports fast mode on Opus 5 but not on other Claude 5 models`，断言相同 |

两边各自独有的用例都在：上游的 `does not collapse a prefixed minor release onto the major it extends`
（`anthropic/claude-opus-5-5`、`us.anthropic.claude-opus-5-5-20260401-v1:0`）与 `2.1.280` 下默认模型为
Opus 5.5；Osuna 的旧版 CLI（`2.1.279`）不出现 Opus 5.5。

**git 没报冲突、结果却不对的。** `models.test.ts` 只报了 3 个冲突块，但自动合并把两边各写的
`describe("Claude Opus 5.5 catalog")` 留了两份（Osuna 的在 Opus 5 目录之后，上游的在 Fable 5.1 目录之后），
最低版本断言也重复了一组。以上游文件为底重做后各剩一份。

**两边都改过、自动合上的文件。**

- `packages/cli/tests/15-provider.test.ts`：上游本段只改了 `EXPECTED_CLAUDE_MODELS` 一块，与 Osuna 对同一块的
  改动逐字相同；Osuna 在这个文件里的其他改动上游没碰。结果与合并前相同。
- `providers/claude/agent.test.ts`：上游本段只改了一行（默认模型为 `claude-opus-5-5`），Osuna 也改了同一行。
  就 Opus 5.5 而言 Osuna 比上游多两处（`resolveVersion` 用 `2.1.280`、`getThinkingIds("claude-opus-5-5")` 含
  `ultracode`），都在；Osuna 在这个文件里与 Opus 5.5 无关的其他用例上游没碰。结果与合并前相同。
- `providers/codex-app-server-agent.ts` 及其测试：Osuna 的改动与上游 #5174 不重叠，上游的改动原样进来。
  测试里删掉的一行（`thread/list` 的旧参数）是上游改自己的用例，不是 Osuna 的断言。

**合并后核对（`git diff 9010d774c 2887a73f6`）。** 全部无变化：

- 更新源：`electron-builder.yml` 的 `publish` 仍是 `github` / `LFT-OXY` / `Osuna`，文件无改动。
- 桌面身份与数据目录：`appId: com.chinhae.osuna.desktop`、`productName: Osuna`；`main.ts` 无改动。
- 签名与签名断言：`desktop-release.yml` 无改动，`mac-sign.js`、`OSUNA_MAC_SIGNING_SHA1`、
  `Verify macOS signature` 都在，Apple 公证变量 0 处。
- 只手动触发的部署工作流：四个文件的 `on:` 都只有 `workflow_dispatch`；`.github/workflows` 无改动。
- 上游站点链接数：与基线相同。
- 翻译键：`packages/app/src/i18n` 无改动。上游本段在应用里只改了 `runtime/directory-sync` 三个文件，没有新的用户可见文案。
- `COMPAT(...)` 标签：新增 0。
- `packages/protocol/src` 无改动。

`nix/npm-deps.hash` 跟着上游变了，按 `docs/release.md` 不追。上游本段新增的四个安卓商店说明文件
`fastlane/metadata/android/en-US/changelogs/90011.txt`–`90014.txt` 与 Osuna 已有文件不重名，照收。

**留给 03 的事。** 日期后缀样例 `20260926` → `20260401` 涉及 Osuna 的三行断言（结论不变，只换样例），PR 正文
照实写成"替换"。默认档位 `high` → `medium` 是用户可见的变化，本次不发版、不动 `CHANGELOG.md`，下次发版写
条目时要带上。

**本机运行。**

| 检查 | 结果 |
| ---- | ---- |
| `npm run typecheck` | 通过，0 个错误（提交钩子里又跑了一遍，同样通过） |
| `npm run lint`（全仓 4611 个文件） | 0 warning 0 error |
| `providers/claude/models.test.ts` | 48 条通过 |
| `providers/claude/agent.test.ts` | 83 条通过 |
| `providers/codex-app-server-agent.test.ts` | 158 条通过 |
| `app/src/runtime/directory-sync/agent-replica.test.ts`、`index.test.ts` | 30 条通过 |

`packages/cli/tests/15-provider.test.ts` 是 CLI 的 e2e，内容与合并前相同，留给 CI。

**评审（Standards / Spec 两个维度，各一个独立子代理，只读）。** 没有要改代码的发现。指出的都是本记录的措辞：
`15-provider.test.ts` 与 `agent.test.ts` 两条写得过宽、漏记四个安卓商店说明文件、默认档位断言实际是两行参数。
已在上文改准。两条判断项不改：用例标题 `supports fast mode on Opus 5 but…` 取上游的（`prd.md` 写明标题差异取
上游）；`CHANGELOG.md` 本次不动（`prd.md` Out of Scope）。

规范补充：`.atw/spec/server/backend/quality-guidelines.md` 加一条"Claude 模型的默认思考档位来自清单条目"；
`prd.md`「冲突裁决 → Opus 5.5 模型」补两句实际做法。

**推送与草稿 PR。** 推送前向维护者说明了会发生什么（分支推到 `LFT-OXY/Osuna`、开草稿 PR、main 不变、
CI 会跑整套测试并占用 macOS runner），维护者 2026-10-10 选择"同意，推送并开草稿 PR"。分支已推到
`origin/merge-upstream-v0.9.2`，草稿 PR 是 [#14](https://github.com/LFT-OXY/Osuna/pull/14)，目标分支 main。
推送后本地 tag 列表仍不变。
