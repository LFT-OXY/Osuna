# 01 — Provider 可用性探测只对内置 Provider 生效

**What to build:** 用户在 daemon config 里亲手声明的自定义 Provider（自定义 ACP 或 extends 某个已注册 Provider），如果起不来，Import session 面板与会话历史列表要明确报出这个 Provider 的错误并给 Retry，而不是静默地当它不存在。没装的内置 Provider 仍然安静跳过，不为不用它的人刷错误。

**Status:** ready-for-agent
**Impl:** done

**Blocked by:** 无 —— 可以立刻开始

依据：prd.md「功能改动（唯一一处）」；归因见 research/failure-attribution.md 第 5 条。

判定信号是 **Provider id 是否属于内置集合**，不是 `derivedFromProviderId` —— 后者对内置
Provider 和泛型 ACP 自定义 Provider 都是 `null`，分不出这两类（provider-registry 的定义
注释写明了）。内置集合由 protocol 侧 provider manifest 导出，server 已经在用。
`AgentManager` 现在拿到的 `providerDefinitions` 里没有「是否内置」这一位，怎么补由实现决定：
在定义上多带一个显式标志，或让 manager 直接查内置集合，都可以；不要用
`derivedFromProviderId` 凑。

协议不动、客户端不动。`providerErrors` 的形状与语义不变，变的只是哪些 Provider 会进去。

- [x] 新增一条 `AgentManager` 单元测试：config 声明的自定义 Provider 探测失败（`isAvailable`
      返回 false 或抛错）时进 `providerErrors`，且其会话不出现在结果里。
- [x] `1bad014d6` 留下的那条既有断言保持通过：未安装的内置 Provider 被跳过、不进
      `providerErrors`；已安装但列出失败的仍进 `providerErrors`。
- [x] `import-session-flow.spec.ts` **不改动**，改完功能后自行变绿 —— 它是本票的端到端确认。
- [x] `npm run typecheck`、`npm run lint` 通过。
