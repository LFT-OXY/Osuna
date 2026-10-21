# 01 — 合并前准备：合进 main 的新内容，分支 CI 全过

**What to build:** 接口管理好用性的分支能干净地合进 main：main 这期间的 96 个提交已合进分支、冲突解完；浏览器测试不再装桌面端的桥（「导入链接」用例挪到桌面端测试）；Windows 上不适用的权限用例在 Windows 跳过；分支上重跑 CI 全过，浏览器测试与 app 测试真的跑过。

**Blocked by:** None — can start immediately
**Status:** ready-for-agent
**Impl:** ready

- [ ] origin/main 以 merge（不 rebase）合进分支，冲突两边的修改都保留；合完跑 i18n 守卫，dist 旧了先重建；本机 typecheck、lint 与改到的测试文件通过。
- [ ] app 浏览器测试文件里不再出现桌面端的桥；「导入链接」整组用例在桌面端 Playwright 测试里，断言与原来一致（先问再加、名称和 key 可改、取消不加、同 id 提示替换、不安全的链接拒收、主机不支持时提示升级）。
- [ ] CI 目录归属检查（browser and desktop tests have exclusive, directory-owned suites）通过。
- [ ] 「数据库没权限打开」用例按仓库已有写法在 win32 跳过，其余平台照测。
- [ ] 分支上手动触发的 CI 全过（Nix 两项与记录在案的偶发项 rerun 后除外），playwright 各分片、app-tests 真的跑完；分支起点就有的 claude hook 用例与 Windows 上 cli-bypass、login-shell-env 的失败合并后不再出现。
- [ ] 测试不读写真实 `~/.claude`、`~/.codex`、钥匙串，不跑真的 CLI。

参考：prd.md「合并前」、用户故事 1–7；CI run 39565218013 的失败日志；`.atw/spec/app/frontend/testing.md`。
