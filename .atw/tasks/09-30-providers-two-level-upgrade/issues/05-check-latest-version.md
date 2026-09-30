# 05 — 检查新版本

**What to build:** 打开 Providers 页面时，App 问 daemon 各内置提供方有没有新版本；点页面上的刷新时强制重新检查。有新版本时，列表行和详情页的版本一节显示"v{当前} → v{最新}"。

daemon 端：
- 新增 `provider.version.check.request` / `.response`，需要 `daemon.read` 权限。请求可以带 `providers` 和 `force`；响应每项为 `{ provider, installedVersion?, latestVersion?, updateAvailable, error? }`。
- 统一查 npm registry 的 `latest`。npm 包名和提供方定义放在一起维护：claude 是 `@anthropic-ai/claude-code`，codex 是 `@openai/codex`，copilot 是 `@github/copilot`，opencode 是 `opencode-ai`，pi 是 `@earendil-works/pi-coding-agent`，omp 是 `@oh-my-pi/pi-coding-agent`。
- 结果在内存里缓存 1 小时，同一个提供方同时发起的查询合并成一次，只在收到请求时才联网。
- 版本按 semver 比较，解析不了就视为没有更新。
- 某一家联网失败只写进那一项的 `error`。
- 联网函数通过依赖注入传入，测试时替换成桩。

`docs/usage.md` 里讲 daemon 联网的那一节（The one outbound request）要写明：这是用户打开页面时才发的请求、发往哪里、带什么内容。

**Blocked by:** 04
**Status:** ready-for-agent
**Impl:** ready

- [ ] RPC 按 `docs/rpc-namespacing.md` 命名，权限登记为 `daemon.read`，新字段都是可选的
- [ ] daemon e2e 测试，用桩替代联网：返回 `latestVersion` 和 `updateAvailable`；1 小时内再查不重复联网；`force` 会重查；某一家失败只影响那一项
- [ ] semver 比较有单测
- [ ] App 在打开页面时查一次，刷新时带 `force`；离开页面再回来走缓存；`providerVersions` 没打开时不发请求
- [ ] 有新版本时，列表行和详情页显示"v{当前} → v{最新}"；检查失败时页面不报错，只是不显示
- [ ] `docs/usage.md` 对应一节已经改写，是整合进原文，不是在末尾追加
- [ ] 新增的文案在 9 个语言文件里都补上了
- [ ] typecheck 和 lint 都通过
