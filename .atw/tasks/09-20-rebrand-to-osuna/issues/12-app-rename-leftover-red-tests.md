# 12 — app 包两处改名遗留的红测试：插件 SDK 半改 与 MCP 工具名夹具过期

**What to build:** 修掉 app 包里两条因改名而红、但生产端已经改完的测试。两条的共同点是
**生产代码改了、测试侧的「被测输入」没跟着改**，所以红的不是实现而是夹具与断言。

**Impl:** ready
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
