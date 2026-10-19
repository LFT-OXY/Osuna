# 03 — 「被绕过」记录与登录 shell 的测试在 Windows 上通过

**What to build:** CI 的 server-tests (windows-latest) 里这 3 条通过。逐条查清是测试照 macOS / Linux 写死了，还是代码在 Windows 上真有问题；是代码问题就修代码，是测试问题就让测试表达跨平台都成立的行为（Windows 上不适用的用 `it.skipIf` 并写明原因）。

- `src/server/api-endpoints/cli-bypass.test.ts`「a file that can't be written leaves the request alone and keeps the time in memory」：Windows 上启动时没有「Couldn't read…」警告。
- `src/server/api-endpoints/login-shell-env.test.ts`「asks the login shell, marked as a probe, and keeps the answer for a minute」「also asks fish and nushell when they are set up, the login shell's value first」：Windows 上读出空对象。先查 prd 第 25 条「登录 shell 的环境」在 Windows 上该怎么做（10-16 任务 16 号工单与实现记录）。

**Blocked by:** None
**Status:** ready-for-agent
**Impl:** ready

- [ ] 结论写进本票 Comments：每条是测试问题还是代码问题、依据。
- [ ] 本机（macOS）这两个文件通过；合并请求的 CI 里 windows-latest 这 3 条通过。
- [ ] `npm run typecheck`、`npm run lint` 通过。
