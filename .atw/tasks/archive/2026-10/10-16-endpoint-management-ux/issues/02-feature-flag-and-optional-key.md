# 02 — 新功能开关与 key 选填

**What to build:** 打开整个子任务的地基，并做第一个用户看得到的改变：key 可以不填。

- 新能力位 `server_info.features.apiEndpointManagement`（带 `COMPAT(...)` 标记）。本任务所有新界面只在主机声明它时显示；没声明时客户端照旧，不做兼容分支。
- 接口存储与协议加上 prd 第 1 条的新字段的「骨架」：本张只落 key 选填需要的部分，其余字段由各自的工单加；但从本张起，daemon 保存接口时「没给的字段保留原值」，旧客户端（含官方 Paseo 手机 App）保存不会清掉新字段（prd 第 47 条）。
- key 选填：新建与编辑都可以不填 key；没 key 时 daemon 的所有请求（中转站转发、测试连接、自动识别、拉模型）都不带认证头；key 文件里不留空条目；线上仍用 `hasApiKey`。表单的保存、检测按钮不再要求 key。

**Blocked by:** None — can start immediately
**Status:** ready-for-agent
**Impl:** done

- [x] 端到端：不填 key 保存接口；中转站转发、测试连接、拉模型发往假上游的请求都没有 `Authorization`、`x-api-key`。
- [x] 端到端：已有 key 的接口不受影响；编辑时 key 留空仍表示保留原 key。
- [x] 端到端：用旧形状（不含新字段）的保存消息保存一家带新字段的接口，新字段保留。
- [x] 浏览器测试：不填 key 保存成功；保存失败时错误留在原处。
- [x] UI: 添加窗口 / 没填 key / 桌面 1280 与窄窗口 390 — 保存按钮可点，key 框标明「选填」。
- [x] 新文案 9 种语言齐全，中文是真翻译，用词与 `docs/glossary.md` 一致，资源测试通过。
- [x] 截图用无头浏览器在临时目录里拍，不碰真实的 `~/.claude`、`~/.codex`（开工前确认用户已同意这种拍法）。
- [x] 新功能只在主机声明 `apiEndpointManagement` 时出现；协议新字段都可选，协议兼容测试通过。
- [x] `npm run typecheck`、`npm run lint` 通过，改到的测试文件本机通过。

参考：prd.md 第 1、2、46、47 条，用户故事 17–19；decisions.md R1-Q11。

实现时凡本工单没写明的细节，先查 magpie `7597c132` 的做法并照做；比 magpie 少做或更严一律不行，除非 prd 写明。
