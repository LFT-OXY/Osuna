# 11 — CC Switch 一类的「OpenAI 镜像」Codex 服务商

**What to build:** CC Switch 这类工具会在 Codex 配置里加一张「OpenAI 镜像」服务商表（另一个 id、`name = "OpenAI"`、`requires_openai_auth`、没有 `base_url`）。记在它名下的对话不受 `openai_base_url` 影响，会直连 ChatGPT，用不了接口模型。

ChatGPT 登录的接法下，开关开着时，把这种表的 `base_url` 也指向中转站的 ChatGPT 后端地址；按 ADR 0004 记原值、算负责的键、关掉时还原；被外部改了算「不再经过中转站」。怎么认出这种表照 magpie。

**Blocked by:** 03, 09
**Status:** ready-for-agent
**Impl:** done

- [x] 端到端：配置里有镜像表时，打开开关后它的 `base_url` 指向中转站的 ChatGPT 后端地址，关掉后表恢复原样（没有 `base_url`）。
- [x] 不像镜像的表（有自己的 `base_url`、名字不是 OpenAI 等）不动；API key 接法下不动镜像表。
- [x] 外部改掉镜像表的地址后，提示「不再经过中转站」。
- [x] 认表的规则对照 magpie，写进实现记录；借鉴 magpie 的代码，文件头保留 MIT 声明。
- [x] `npm run typecheck`、`npm run lint` 通过，改到的测试文件本机通过。

参考：prd.md 第 17 条；research/codex-wiring.md 第 10 题；decisions.md Q35。
