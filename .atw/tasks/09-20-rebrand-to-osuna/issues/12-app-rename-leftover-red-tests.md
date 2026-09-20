# 12 — app 包两处改名遗留的红测试：插件 SDK 半改 与 MCP 工具名夹具过期

**What to build:** 修掉 app 包里两条因改名而红、但生产端已经改完的测试。两条的共同点是
**生产代码改了、测试侧的「被测输入」没跟着改**，所以红的不是实现而是夹具与断言。

**Impl:** done
**Status:** ready-for-agent

**Blocked by:** None

## 为什么单独开票

两条都在 `npm test` 的默认路径里，也就是说**仓库当前的全量测试是红的**。它们不属于票 08
（运行时契约）的切片，票 08 已验证过两条在 clean tree 上复现一致、与它无关。也不适合塞进
票 07（内部标识符清扫）——票 07 是机械改名，这两条各自需要一个判断。

## 一：`view.test.tsx` — 插件 SDK 的解构改了、函数体没改

`packages/app/src/plugins/timeline/view.test.tsx:286-293`

```js
const osuna = useOsuna();          // :286  批次 3 改到位了
React.useEffect(() => {
  const owner = paseo.observeEvents(["project.update"]);   // :291  没改 → ReferenceError
  return () => { ... };
}, [paseo]);                        // :293  没改
```

失败：`ReferenceError: paseo is not defined`，抛在插件客户端 bundle 的 `<Card>` 组件里。

**这是同一个缺陷的第三个实例。** 前两个在 `plugin-osuna-api.e2e.test.ts`（5 处，票 08 修）
与 `connection-demand.e2e.test.ts`（票 08 修）。三处都是批次 3 把 `ctx.paseo` → `ctx.osuna`、
`usePaseo` → `useOsuna` 时，只改了解构模式没改函数体。因为插件源码都写在模板字符串 / `eval`
的 bundle 里，**typecheck 与 lint 一律看不见**，只有真跑才暴露。

修法明确（改 `paseo.` → `osuna.`、`[paseo]` → `[osuna]`），不需要决定。

**做完顺手做一次收口**：全仓搜一遍还有没有第四个实例 —— 模式是「`useOsuna()` / `{ osuna }`
出现在同一段字符串里，而同段里还有裸 `paseo.`」。

## 二：`projection.test.ts` — MCP 工具名夹具停留在旧名

`packages/app/src/tool-calls/detail-level/projection.test.ts`

```
- "otherToolCount": 2,  "paseoCallCount": 2      ← 断言
+ "otherToolCount": 4,  "paseoCallCount": 0      ← 实得
```

生产端 `packages/app/src/tool-calls/detail-level/overview/model.ts:38-45` 用
`isOsunaToolName()` 分类，而该函数（`packages/protocol/src/tool-name-normalization.ts:47-53`）
要求 `mcp__osuna__*` / `osuna_*`。测试夹具仍写 `paseo_list_providers`、`paseo_list_worktrees`、
`paseo__create_agent`，于是一条都不再被计入，全部落进 `otherToolCount`。

**注意这条与 voice 那条不是一回事。** `isSpeakToolName` 只看叶子名是不是 `speak`，与品牌无关，
所以 `voice-permission-policy.test.ts` 里的 `paseo_voice.speak` 是**正确的**、不要动。
工具调用分类这条路径则是明确认品牌的。（票 08 落地时曾只抽查 voice 就外推说这些夹具都无害，
是错的，在此更正。）

- [ ] 把夹具里的 `paseo_*` / `paseo__*` MCP 工具名改成 `osuna_*` / `mcp__osuna__*`
- [ ] **顺带决定**：`paseoCallCount` 这个字段名本身（`overview/model.ts:13,38,45,65`）是批次 4
      漏下的导出名。要么本票一并改成 `osunaCallCount`，要么留给票 07 —— 但不要只改夹具不改
      字段名，那正是「半改的标识符比两端都糟」。

## 范围

- [ ] 修 `view.test.tsx` 的三处 `paseo` → `osuna`
- [ ] 全仓收口搜第四个 `useOsuna()` + 裸 `paseo.` 实例
- [ ] 修 `projection.test.ts` 的工具名夹具，并对 `paseoCallCount` 字段名做出决定
- [ ] 验收：`cd packages/app && npx vitest run src/plugins/timeline/view.test.tsx src/tool-calls/detail-level/projection.test.ts`
- [ ] `npm run typecheck`、`npm run lint` 通过

## 落地记录（2026-09-20）

### 更正：本票开票时对第二条的诊断是错的

开头写的「**生产代码改了、测试侧的「被测输入」没跟着改**，所以红的不是实现而是夹具与断言」
对第二条不成立。第 50 行说生产端「用 `isOsunaToolName()` 分类」只说对了一半：

`isOsunaToolName()`（`packages/protocol/src/tool-name-normalization.ts:41-59`）只认**带命名空间
分隔符**的名字 —— 含 `__` 的 `mcp__osuna__*`，或含 `.` 的 `osuna.*`。**裸名** `osuna_list_providers`
既无 `__` 也无 `.`，它一路走到最后 `return false`。裸名完全依赖
`packages/app/src/tool-calls/detail-level/overview/model.ts:4` 的
`DIRECT_OSUNA_TOOL_PREFIX` 常量 —— 而该常量在本票开工时是

```ts
const DIRECT_OSUNA_TOOL_PREFIX = "paseo_";   // 名字已是 OSUNA，值还是 paseo_
```

批次 4 只改了常量名没改值。所以第二条**不是纯夹具问题，生产代码也是半改的**。

### 决定一：`paseoCallCount` 一并在本票改掉，不留给票 07

`paseoCallCount` → `osunaCallCount`、`isPaseoCall` → `isOsunaCall`，连同唯一消费方
`overview/view.tsx:45` 的 i18n 键 `toolCallGroup.paseoCalls` → `osunaCalls`，以及 9 个 locale 的
用户可见文案 `called Paseo {{count}} times` → `called Osuna ...`。

理由：i18n 键与字段名是同一个标识符簇，只改字段不改键正是本票第 63 行反对的「半改的标识符比
两端都糟」；且 `called Paseo` 对本 fork 是用户可见的品牌错误，不是内部标识符。

### 决定二：`DIRECT_OSUNA_TOOL_PREFIX` 的值改成 `"osuna_"`，这是一次删兼容

历史会话里旧的裸 `paseo_*` 工具名从此不再计入 Osuna 调用数，落进 `otherToolCount`。
与 `isOsunaToolName()`（已完全不认 paseo）和 `plugin-requirements.ts:22-28`（「拒绝上游 Paseo
插件是故意的，不要加 `requirements.paseo` 兜底」）同调，也符合仓库「不自行增加兼容 shim」。

### 收口结果：第四、五、六个实例

全仓搜「SDK 对象改名但函数体没改」，除票内已知的 `view.test.tsx` 外还有三处，都在插件 bundle
的模板字符串里，typecheck 与 lint 一律看不见：

- `packages/app/e2e/browser/plugin-workspace-panels.spec.ts:99` —— `client.paseo.agents.list(...)`，
  而 `PluginCommandCapabilities`（`packages/plugin/src/client/contracts.ts:163`）已是 `osuna`
- 同文件 `:143` —— 服务端 handler 解构了 `{ osuna }`，函数体写 `paseo.workspaces`
- `packages/server/src/server/daemon-e2e/terminal-workspace-sdk.e2e.test.ts:140,149` —— 同一形态
- `packages/app/e2e/support/helpers/plugin-buttons.ts:30` —— `const paseo = useOsuna()`，
  自洽不会报错，但名字过期，一并改

### 审查追加修掉的三处

- `packages/server/src/server/bootstrap.smoke.test.ts:678` 与
  `terminal-workspace-sdk.e2e.test.ts:120` 的清单键 `requirements: { paseo }`。
  `PluginManifestSchema`（`packages/server/src/server/plugins/manifest.ts:11-17`）是 `.strict()`
  且字段名为 `osuna`，留着会让插件在**清单解析**阶段就炸，而不是走被测的那条路径。
- `terminal-workspace-sdk.e2e.test.ts:112` 测试标题里的 "Paseo API"。
- `projection.test.ts:275,324,325` 的 fetch/search 夹具。这两条 fetch 夹具的本意是「品牌域名的
  fetch 不得计入品牌调用」，前缀改成 `osuna_` 后 `https://paseo.sh` 已无鉴别力，改指
  `github.com/LFT-OXY/Osuna`。

### 不归本票（留给票 07）

`createTestPaseoDaemon` / `test-utils/paseo-daemon.ts`、tmpdir 前缀 `paseo-buttons-` 等、
locale 里的 `appName: "Paseo"`、`track-presentation.ts` 的 `row.kind === "paseo"` 与
`paseo_subagent_*` React key。

### 验收

- `cd packages/app && npx vitest run src/plugins/timeline/view.test.tsx src/tool-calls/detail-level/projection.test.ts` —— 23 passed
- `packages/app` 全量 —— 643 files / 5738 tests passed（含 `src/i18n/resources.test.ts` 的 parity 36 项）
- `packages/server` `src/server/bootstrap.smoke.test.ts` —— 21 passed
- `npm run typecheck`、`npm run lint` —— 全绿
- 全量 `npm test` 仍有一条红：`packages/cli/src/commands/daemon/pair.test.ts`，属**票 10**，与本票无关
