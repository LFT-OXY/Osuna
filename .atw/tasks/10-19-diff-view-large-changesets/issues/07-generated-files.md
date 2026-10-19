# 07 — Generated file 默认收起并标「生成」

**What to build:** daemon 认出 **Generated file**，Changes 面板不管文件多少都默认收起它们，并在文件头标「生成」/ "Generated"。

- daemon 判断，三条规则：一份 lock 文件名单（参考 orca 的 generated-code-path 名单，来源见 `research/reference-projects.md`）；`git check-attr linguist-generated` 为 true；路径匹配 `*.min.js`、`*.min.css`、`*.map`。`check-attr` 要批量问，不要每个文件起一个子进程。
- 协议在 diff 的 file 结构上加可选字段 `generated?: boolean`。旧客户端忽略它；旧 daemon 不发，客户端就当作不是 Generated file，不加兼容兜底。`status` 枚举不加新值。
- 客户端接上 06 留好的入口；标签样式与 06 的行数标签一致，走 i18n。
- 用户手动展开过的 Generated file 保持展开；「全部展开」也会展开它。

**Blocked by:** 06
**Status:** ready-for-agent
**Impl:** done

- [ ] daemon 用例（真实 git 仓库）：`package-lock.json`、`yarn.lock`、`.gitattributes` 标了 `linguist-generated` 的文件、`app.min.js`、`app.js.map` 都带 `generated: true`；普通文件不带；`.gitattributes` 用 `linguist-generated=false` 取消的文件不带。
- [ ] 协议：旧客户端的 schema 能解析带 `generated` 的消息；新客户端能解析不带它的消息（现有协议兼容测试写法）。
- [ ] 规则单测：Generated file 在只有 3 个文件时也收起；手动展开后保持展开。
- [ ] UI：桌面版，改动里有 `package-lock.json`，它的文件头带「生成」标签，下面没有正文；英文界面下是 "Generated"（截图）。
- [ ] 用 02 的场景复测打开耗时，数字追加进 `research/baseline.md`。
- [ ] typecheck、lint 通过；i18n 守卫测试通过。
