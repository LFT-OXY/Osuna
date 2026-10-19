# 03 — 「被绕过」记录与登录 shell 的测试在 Windows 上通过

**What to build:** CI 的 server-tests (windows-latest) 里这 3 条通过。逐条查清是测试照 macOS / Linux 写死了，还是代码在 Windows 上真有问题；是代码问题就修代码，是测试问题就让测试表达跨平台都成立的行为（Windows 上不适用的用 `it.skipIf` 并写明原因）。

- `src/server/api-endpoints/cli-bypass.test.ts`「a file that can't be written leaves the request alone and keeps the time in memory」：Windows 上启动时没有「Couldn't read…」警告。
- `src/server/api-endpoints/login-shell-env.test.ts`「asks the login shell, marked as a probe, and keeps the answer for a minute」「also asks fish and nushell when they are set up, the login shell's value first」：Windows 上读出空对象。先查 prd 第 25 条「登录 shell 的环境」在 Windows 上该怎么做（10-16 任务 16 号工单与实现记录）。

**Blocked by:** None
**Status:** ready-for-agent
**Impl:** done

- [x] 结论写进本票 Comments：每条是测试问题还是代码问题、依据。
- [ ] 本机（macOS）这两个文件通过；合并请求的 CI 里 windows-latest 这 3 条通过。
- [x] `npm run typecheck`、`npm run lint` 通过。

## Comments

三条都是测试问题，代码在 Windows 上的表现符合设计。依据是 CI 运行 39216198336 的 server-tests (windows-latest) 日志。

- `cli-bypass.test.ts`「a file that can't be written…」：Windows 只少了「Couldn't read…」，「Couldn't save…」照常出现。Windows 读「父路径是普通文件」的路径报 ENOENT（macOS / Linux 报 ENOTDIR），`readOptionalFile`（`config-file.ts`）把 ENOENT 当作文件还没建，所以不警告；两种情况都按「从没收到过」处理，用户看到的一样。改法：这条用例构造完先清掉启动时的警告，只断言写失败那条；读不了的警告由紧接着的「a file that can't be read or parsed…」管，那条在 Windows 上本来就过。
- `login-shell-env.test.ts` 两条：读取器在 Windows 上按设计不问登录 shell（`login-shell-env.ts` 的 `platform === "win32"` 直接返回 `{}`，照 magpie），而且用例里的假 shell 是 `#!/bin/sh` 脚本，Windows 起不来。改法：两条用 `it.skipIf(isPlatform("win32"))` 跳过，原因写在 describe 顶部注释；Windows 分支由「does not ask on Windows」覆盖，各平台都跑。
- 审查采纳：去掉按平台算预期值的分支（`docs/testing.md` 不许条件断言），平台判断改用 `test-utils/platform.ts` 的 `isPlatform`。没采纳：把两条挪进 `login-shell-env.posix.test.ts`，因为本票指定 `it.skipIf`，仓库里也有同样写法（`terminal.test.ts`）。
- 第二项验收里「本机通过」已做（两个文件 23 条全过）；「CI windows-latest 通过」要等合并请求的 CI，所以这项先不勾。
