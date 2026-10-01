# 04 — 显示已装版本号

**What to build:** 已装的内置提供方（claude、codex、copilot、opencode、pi、omp），在列表行的状态行后面显示 " · v{版本}"。详情页新增"版本"一节，显示已装版本。详情页的版块顺序改为：错误类提示 → 版本 → 安装指引（仅未安装时）→ 第三方接口 → Models → 诊断；版本和安装指引不同时出现。

版本号来自 daemon：对启用的内置提供方，在确认 CLI 可用之后跑一次 `--version`，从输出里取第一个 `x.y.z`，写进快照新增的可选字段 `version`。
- Claude 本来就会取版本，直接复用那次结果
- 执行的是用户在 config 里配置的命令
- 取不到版本不影响提供方的状态

App 按 `server_info.features.providerVersions` 门控，连着旧版本 daemon 时什么都不显示，门控处加 `COMPAT(providerVersions)` 标签。自定义提供方和 ACP 提供方不显示版本。

实现说明：只在目录探测成功后取版本，启动出错的提供方不带版本；`--version` 在刷新超时之外跑。Claude 的真实样例在 `claude/models.test.ts`（它用 `parseClaudeCodeVersion`），其余 5 家在 `provider-cli-version.test.ts`。

**Blocked by:** None — can start immediately
**Status:** ready-for-agent
**Impl:** done

- [x] 协议：`ProviderSnapshotEntry.version` 是可选字段；`server_info.features.providerVersions` 是可选字段；wire schema 没有用 transform
- [x] daemon 只对启用的内置提供方填写 `version`，并且用的是这个提供方实际使用的命令；Claude 不重复执行 `--version`
- [x] `--version` 输出的解析有单测，覆盖 6 家的真实输出样例和解析不了的情况
- [x] daemon e2e 测试：用假 CLI 脚本验证快照里带上 `version`，并且解析失败时状态不受影响
- [x] App 的列表行和详情页"版本"一节显示版本号；自定义提供方和 ACP 提供方不显示；`providerVersions` 没打开时不显示
- [x] 详情页的版块顺序和"版本与安装指引互斥"有组件测试，组件顶部的顺序注释已经更新
- [x] 新增的文案在 9 个语言文件里都补上了
- [x] typecheck 和 lint 都通过；改协议后已经先 `npm run build:server` 再做类型检查
