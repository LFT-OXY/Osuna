# 09 — 文档收尾与验收证据

**What to build:** 让仓库文档和实际实现保持一致，并补齐验收证据：

- **`docs/custom-providers.md`**：更新相关小节，说明第三方接口和自定义提供方的区别与相互影响，其中包括「Claude 启用第三方接口后，继承 `claude` 的自定义提供方会被覆盖」。
- **ADR 0004**：对照实现核对一遍。实现中有推翻或补充的地方，比如 TOML 方案、关闭 WebSearch 的具体写法，都要同步写进去。
- **词汇表**：核对 `docs/glossary.md` 的 API endpoint 词条，确保与最终的界面文案一致。
- **截图**：按 `docs/qa.md`，在桌面端浅色和深色主题下各截一套，覆盖模式区、表单、拉取和勾选模型、测试结果、确认框、「已被外部修改」。

**Blocked by:** 01, 02, 03, 04, 05, 06, 07, 08

**Status:** ready-for-agent
**Impl:** done

- [x] `docs/custom-providers.md` 更新完成，并遵守 CLAUDE.md 的写文档规范：把内容融入已有的章节，不在末尾追加段落。
- [x] ADR 0004 与实现一致。
- [x] 词汇表的 API endpoint 词条与界面文案一致。
- [x] 截图齐全，放在任务目录下，覆盖上面列出的全部界面和两种主题。
- [x] 截图过程中，没有使用开发者真实的 `~/.claude` 和 `~/.codex`：用临时的 `CLAUDE_CONFIG_DIR` 和 `CODEX_HOME` 启动 dev daemon，上游用假服务或测试 key。
