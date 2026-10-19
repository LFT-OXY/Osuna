# 30 — 文档收尾

**What to build:** 按最终做出来的样子更新文档，融入已有章节，不在末尾追加：

- `docs/glossary.md`：访谈中改过、新增的词条（「第三方接口」「中转站」「使用第三方接口」「默认模型」「会话历史」「提供方」「自己能联网搜索」「默认思考档位」「Codex 服务商」）对照最终行为复核。
- `docs/data-model.md`：接口的新字段、Agent 设置的新字段、接管记录里新负责的键、挪对话的备份与记录。
- `docs/usage.md` 的「Outbound requests」：代理探测；models.dev 改为 Codex 打开开关时也下载；中转站转发 Codex 自己的 ChatGPT 请求（原样转发，不是 daemon 主动发出）。
- `docs/custom-providers.md`：`extends: "claude"` 的自定义提供方与 WebSearch 规则的说明随新规则更新。
- `THIRD_PARTY_NOTICES`：覆盖本任务新借鉴 magpie 的文件。
- 01 号工单写的 ADR：补上 13 号工单的核实结果（挪动会不会被改回），以及实现中定下的、ADR 需要知道的取舍。
- `.atw/spec/` 里被这次改动说错的规范一并改正。

**Blocked by:** 02, 03, 04, 05, 06, 07, 08, 09, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29
**Status:** ready-for-agent
**Impl:** done

- [ ] 上面每份文档都改好，遵守 CLAUDE.md「Writing docs」与「Doc voice」。
- [ ] 词汇表与界面文案、最终行为一致。
- [ ] `THIRD_PARTY_NOTICES` 覆盖每个带 magpie MIT 声明的新文件（逐个对过）。
- [ ] ADR 与实现一致，核实结果已补。
- [ ] 改到的文件用 `npm run format:files` 格式化。

参考：prd.md 第 3、39 条；prd.md「Acceptance Criteria」的「文档」一项。
