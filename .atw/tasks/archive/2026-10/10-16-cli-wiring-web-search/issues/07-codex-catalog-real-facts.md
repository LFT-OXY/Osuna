# 07 — Codex 模型清单写真实能力

**What to build:** Osuna 写给 Codex 的模型目录里，每个模型写上真实的上下文长度、回复上限、推理档位与默认档、能否看图，Codex 才能按真实能力压缩对话、调档位。

- 先取接口自己的模型清单，其次 models.dev；都查不到的保持现在的写法（固定档位、272K 上下文）。
- models.dev 的下载改为 Claude Code 或 Codex 任一打开开关时都允许（仍要价格表自动更新开着）。
- 这套资料也给 10 号工单合并的清单用，写成可以共用的样子。

**Blocked by:** None
**Status:** ready-for-agent
**Impl:** done

- [x] 端到端：接口清单给了上下文、档位、看图的模型，目录里按这些值写；接口没给、models.dev 有的按 models.dev 写；都没有的与现在一样。
- [x] 只开 Codex 开关时也会下载 models.dev（价格表自动更新开着时）；两个开关都关时不下载。
- [x] 纯逻辑用例覆盖档位映射：接口或 models.dev 的档位名对到 Codex 收的档位名，以及默认档怎么定。
- [x] 对照 magpie 的做法，借鉴的代码文件头保留 MIT 声明。
- [x] `npm run typecheck`、`npm run lint` 通过，改到的测试文件本机通过。

参考：prd.md 第 23 条；decisions.md Q7；research/claude-code-wiring.md 第 3 题「Codex」（档位取值）。
