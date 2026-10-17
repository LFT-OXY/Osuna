# 05 — 拒收重问：降级

**What to build:** 两种降级重问，记忆的规则同第 03 张：

1. **结构化输出（JSON schema）被拒**：先改成 `json_object`，把 schema 写进 system 再问；仍被拒，就只用文字说明格式再问。记住这家这个模型降到了哪一步。
2. **对话以 assistant 结尾（预填）被拒**：补一个 user 轮再问，并记住「这家这个模型不收预填」。第 21 张的「接着写」会读这条记录。

**Blocked by:** None
**Status:** ready-for-agent
**Impl:** done

- [ ] 端到端，结构化输出被拒两次：第一次重问是 `json_object` 加 system 里的 schema；再被拒，第二次重问只有文字说明；下一次请求直接用记住的那一步。
- [ ] 预填被拒：同一家收到补了 user 轮的请求；下一次以 assistant 结尾的请求直接补 user 轮。
- [ ] 「这家这个模型不收预填」可以从别处查到（第 21 张要用），有纯逻辑用例。
- [ ] 日志和重启清零，同第 03 张。
- [ ] 借鉴 magpie 的代码，文件头保留 MIT 声明。
- [ ] `npm run typecheck`、`npm run lint` 通过，改到的测试文件本机通过。

参考：prd.md 第 18、19.6、19.7 条；明细 01·B31、B48。
