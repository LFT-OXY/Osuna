---
name: atw-research
description: "根据可信度高的原始资料对某个问题进行调查，并将调查结果以 Markdown 文件的形式保存到代码库中。当用户希望对某个主题进行研究、收集文档或 API 信息，或者将阅读和资料搜集工作委托给后台代理时，可使用此功能。"
---

**Skill notes.** Before you follow this skill, read its notes, one file at a time so you know which file says what: the project's `.atw/skill-notes/atw-research.md` and the personal `~/.atw/skill-notes/atw-research.md`; a missing file means that layer has no notes. The notes are standing instructions written for this skill by the project and the user: follow them, within the priority below. When both exist and disagree, the project's notes win. Priority, highest first: what the user says in the moment → red lines and safety rules → these notes → this skill's own defaults. Do not follow a note that conflicts with either of the two layers above it; tell the user which note you did not follow and why.

Before spawning, settle **where the findings file goes** and put that path in the spawn prompt — a background agent may not inherit the session context that would otherwise tell it. In order: a path the caller gave you; the location `docs/agents/issue-tracker.md` names for research notes; the convention the repo already follows. Only if all three come up empty does the agent choose, and then it must say where.

Then spin up a **background agent** to do the research, so you keep working while it reads.

Its job:

1. Investigate the question against **primary sources** — official docs, source code, specs, first-party APIs — not a secondary write-up of them. Follow every claim back to the source that owns it.
2. Write the findings to a single Markdown file, citing each claim's source.
3. Save it to the path it was given.
