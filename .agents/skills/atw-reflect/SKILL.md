---
name: atw-reflect
description: "复盘（reflect）：从这次对话里找出值得改进的地方，以便同样的问题下次不再出现。派三个子代理分别从判断、工具、发散三个角度看，再由一个子代理合成「采纳 / 驳回 / 建议开任务」；每条采纳写明去处（项目规范、某个 skill 的附加说明、项目里新建的 skill），等用户同意才写；不建任务、不改代码。只有用户能启动。用于用户说「复盘一下」「回头看看这次对话有什么值得改进」「这次踩的坑怎么让下次不再犯」时。"
disable-model-invocation: true
---

**Skill notes.** Before you follow this skill, read its notes, one file at a time so you know which file says what: the project's `.atw/skill-notes/atw-reflect.md` and the personal `~/.atw/skill-notes/atw-reflect.md`; a missing file means that layer has no notes. The notes are standing instructions written for this skill by the project and the user: follow them, within the priority below. When both exist and disagree, the project's notes win. Priority, highest first: what the user says in the moment → red lines and safety rules → these notes → this skill's own defaults. Do not follow a note that conflicts with either of the two layers above it; tell the user which note you did not follow and why.

Only the user starts this skill. You never invoke it yourself — not when a task is archived, not when the user corrects you. `finish-work` only mentions that it can be run.

# Reflect

Look back over this conversation for lessons worth keeping, so the same problem does not come up again, then route each one to where it belongs once the user agrees.

Skip when the conversation is trivial, off-topic, or already covered by a skill that was followed correctly: say plainly that there is nothing worth keeping and stop. Do not make lessons up to fill the reply. A one-off is not a lesson.

This skill changes no code and creates no task. It writes only two things: the transcript file of step 1, deleted when the reflect ends, and the adopted items the user agrees to in step 5.

## 1. Read this conversation

Find this conversation's id with the same `resolve_context_key()` that `decision_log.py run` uses — it takes `ATW_CONTEXT_ID` when the tool passes it and otherwise the id the tool itself sets, such as `CODEX_THREAD_ID` on Codex:

```bash
python3 -c "import sys; sys.path.insert(0, '.atw/scripts'); from common.active_task import resolve_context_key; print(resolve_context_key() or '')"
```

Then read this conversation with each command and the start and end of its result — the reading the log self-check uses — into a file named for this conversation:

```bash
mkdir -p .atw/.runtime && atw mem extract --context <id> --tools > .atw/.runtime/reflect-<id>.txt
```

Pass the file's absolute path to each reviewer. Delete the file when the reflect ends — after step 6, or wherever you stop.

When the conversation cannot be read — the id prints empty, the tool is not one of the four where `atw mem`'s `--tools` reading has been verified (Claude Code, Codex, pi, omp), or `atw mem extract` fails (give its error) — write a tight summary of this conversation instead, pass that to the reviewers, and tell the user the review rests on a summary and why. Never read another conversation in its place.

## 2. Three reviewers in parallel

Dispatch three sub-agents in one message, using the current tool's own sub-agents; no model from another company is needed. Give each its template verbatim, with the transcript path or the summary filled in where marked:

| Lens | Template |
| --- | --- |
| Judgment | `references/judgment-reviewer.md` |
| Tooling | `references/tooling-reviewer.md` |
| Divergent | `references/divergent-reviewer.md` |

The reviewers read and look things up; they write nothing. They return their findings in their reply. On a tool without sub-agents, apply the three lenses yourself one after another, each from its template, and keep the three outputs apart.

## 3. Merge

One more sub-agent gets `references/synthesizer.md` verbatim, with each reviewer's full output filled in where marked. It sorts the findings into 采纳 (adopt), 驳回 (reject) and 建议开任务 (suggest a task), and proposes a destination for each adopted item. On a tool without sub-agents, merge them yourself from that template.

## 4. Move what a check could enforce

Move any adopted item that a test, lint rule, script or other check would enforce more reliably to suggest a task. Written rules are for what no check can enforce — the same order `atw-update-spec` follows in its step 2: remove the mistake by design, then types, then a test, and written rules last.

## 5. Ask before writing

First read the skill notes that exist — `.atw/skill-notes/*.md` and `~/.atw/skill-notes/*.md` — and compare each with its skill as installed now. Remind the user of any note that the skill as installed now already covers, that contradicts the skill, or that is plainly stale (it names a file, command or step that no longer exists). Only remind: never delete or edit a note. The user decides.

Show the merger's full output — adopt, reject, suggest a task — then list each adopted item with its destination and wait for the user's consent. They may pick some items and change any destination. Write nothing before they agree; never write on your own. Then write only what they agreed to, where they agreed:

- **A project convention → the project spec.** How this project's code is written goes into `.atw/spec/` through `atw-update-spec`. Write it as a written rule only; an item a check would enforce better belongs in suggest a task — move it there and tell the user, rather than change code or write a ticket.
- **Better behaviour of an existing skill → that skill's notes.** `.atw/skill-notes/<installed name>.md` for the project — it travels with the repository and the whole team uses it — or `~/.atw/skill-notes/<installed name>.md` for the user alone, on every project on this machine. Ask the user, item by item, which of the two. Write short, direct instructions about how the skill should behave differently, not a second copy of the skill. Never edit an ATW skill's installed copy and never copy it under a new name. Notes exist only for ATW's own skills and commands — the ones whose installed copy opens with the paragraph telling the AI to read its notes. A project's own skill, whose name does not start with `atw-`, is edited directly instead. Any other skill — one from a third party or in the user's personal skill directory — gets no notes and no edit: list the finding for the user as a suggestion only and write nothing.
- **A missing whole capability → a new project skill.** Create a skill whose name does not start with `atw-`, the same content in every skill directory the project's tools use — each directory that holds ATW's own `atw-*` skills, such as `.claude/skills/` and `.agents/skills/`. Its description says when to use it.

An ATW skill that did not start when it would have helped cannot be fixed by its notes, which are read only once the skill runs, nor by its description, which ATW owns: route that finding to the project spec, as a line saying when this project uses that skill.

Suggest-a-task items are only listed for the user: reflect creates no task and changes no code. Whether to open one is the user's call.

## 6. Short list

End with a short list, no preamble:

- Written: `<path>` — what changed, one line each.
- New skills: `<path>` — one line each (rare).
- Suggested tasks: the pattern and the check that would enforce it, one line each.
- Suggestions for other skills: the skill and the change, one line each — nothing was written.
- Rejected: one line per rejected finding, with the merger's reason.
