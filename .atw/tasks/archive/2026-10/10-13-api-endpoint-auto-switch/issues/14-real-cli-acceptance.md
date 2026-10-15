# 14 — 真实 CLI 验收（由用户完成）

**What to build:** 用用户自己的第三方接口与 key 做最终人工验收。自动化测试全部用假上游，这一条是唯一接触真实厂商的检查。

**Blocked by:** 01, 02, 03, 04, 05, 06, 07, 08, 09, 10, 11, 12, 13, 15, 16, 17, 18
**Status:** ready-for-human
**Impl:** done

- [x] 在设置里录入至少两家真实接口、自动检测通过、拉取并勾选模型；打开 Claude Code 与 Codex 的总开关。
- [x] Claude Code：终端新会话从默认模型开始并正常回复；`/model` 能选到接口模型并回复；Osuna 对话里选某家的模型正常回复。
- [x] Codex：终端新会话正常回复；`/model` 列表含接口模型且无每轮警告；Osuna 对话里选某家的模型正常回复。
- [x] 至少一次跨格式（Claude Code 走 OpenAI 格式接口，或 Codex 走 Anthropic 格式接口）正常回复，含一次工具调用。
- [x] 关掉两个总开关后 `settings.json` 与 `config.toml` 恢复原样，口令文件与模型目录文件消失。
- [ ] PR 以 merge commit 并入 main；原生端（iOS / Android）实机验收免验（手机端用官方 App，不改）。 — 2026-10-15 已开 PR #17（https://github.com/LFT-OXY/Osuna/pull/17），因合并后 worktree 会被自动删除，归档在合并前做；合并方式按 merge commit。
