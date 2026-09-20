# 02 — OSC 11 测试在确定的主题下验真实底色

**What to build:** 在终端里跑 TUI 的用户查询背景色时，拿到的是当前主题的真实底色；而浏览器自己对颜色查询的回复绝不能漏回 PTY。这条 e2e 要继续同时守住这两件事。

**Status:** ready-for-agent
**Impl:** done

**Blocked by:** 无 —— 可以立刻开始

依据：prd.md「测试改动」第 4 条；归因见 research/failure-attribution.md 第 4 条。

背景：终端主题桥接上线后，daemon 按 app 上报的真实主题回答 OSC 11。e2e 浏览器跟随系统是
浅色，底色合法地就是白 —— 而这条测试原本正是用「白 = 浏览器泄漏」来表达它的断言，现在
分辨不了了。修法是让测试自己把主题钉死（沿用同仓 e2e 已有的 localStorage 种设置写法），
断言深色主题的真实终端底色。

这张单独成票，是因为它最容易被改成一条恒真断言换绿灯。

- [x] 测试在一个确定的深色主题下运行，断言该主题的真实终端底色。
- [x] 「不得出现纯白」这条保留 —— 此时它重新只可能意味着浏览器的回复漏回了 PTY。
- [x] **去掉终端主题桥接后这条测试会失败** —— 已验：把 `toTerminalViewAttributes` 临时改成
      恒返回 `undefined`（daemon 不再收到主题色），测试红在
      `expect(text).toContain("rgb:1818/1b1b/1a1a")` 这一行，不是红在别处；还原后复绿。
- [x] `npm run typecheck`、`npm run lint` 通过。
