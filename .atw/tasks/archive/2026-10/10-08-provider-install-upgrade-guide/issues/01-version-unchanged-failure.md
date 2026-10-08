# 01 — 升级"成功"但版本没变时判为失败

**What to build:** 用户点"升级"后，升级命令正常退出、但提供方的版本没有变化时（比如 `claude update` 对 Homebrew 装的版本只打印提示），界面不再当作升级成功，而是显示"版本没有变化"的失败标题，并带上命令输出，让用户看到 CLI 实际说了什么。升级前或升级后读不出版本时，仍然只按退出码判断。规格见 `prd.md` 的"daemon：升级结果判定"一节和"升级失败块"一节里关于 `version_unchanged` 的部分。

**Blocked by:** None — can start immediately
**Status:** ready-for-agent
**Impl:** done

- [x] daemon 在执行升级命令前读一次已装版本，执行并刷新后再读一次。退出码为 0、两次版本都读得出并且相同时，返回 `ok: false`、`errorCode: "version_unchanged"`，带上输出和刷新后的版本。
- [x] 升级前或升级后任一次读不出版本时，仍然只按退出码判断。退出码为 0 时返回 `ok: true`。
- [x] 协议的升级错误码常量加上 `version_unchanged`，说明注释同步补上。消息结构不变，不需要 COMPAT 标记。
- [x] App 的失败块为 `version_unchanged` 显示专门的标题，说明命令已经执行完但版本没有变化，可能是由包管理器管理的安装，也可能是包管理器还没收到新版本。下面照常显示命令输出，可以关闭，也可以重试。
- [x] 新文案补齐 9 种语言，`resources.test.ts` 通过。
- [x] daemon 端到端测试（加在现有的升级用例文件里）：假 claude 的 `update` 打印 "Claude is managed by Homebrew" 并以 0 退出时，返回 `version_unchanged`，带输出；假 CLI 读不出版本、`update` 以 0 退出时，返回 `ok: true`；现有用例全部通过。
- [x] 详情页组件测试：`version_unchanged` 显示专门的标题和命令输出。
- [x] UI：提供方详情页 / 版本一节里的升级失败块 / 桌面 1280。截图里能看到"版本没有变化"的标题和命令输出原文。
- [x] typecheck 和 lint 通过。
