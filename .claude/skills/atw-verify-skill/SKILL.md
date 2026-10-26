---
name: atw-verify-skill
description: "验证 skill 生成器：给项目里的一个应用写一份验证 skill（verification skill）——从代码摸清它是网页、命令行还是接口，怎么启动、怎么像用户那样操作、能留下什么证据，写成 `.atw/verify/<app>/` 下的说明与功能地图，交出前自己从头到尾试用一次；已经有了就改做体检：对照源码找出过时的说法，再逐个功能试用，只改验证 skill 自己。只有用户能启动。用于用户说「生成验证 skill」「给这个项目做一份验证 skill」「体检验证 skill」「重新生成验证 skill」时。"
disable-model-invocation: true
---

**Skill notes.** Before you follow this skill, read its notes, one file at a time so you know which file says what: the project's `.atw/skill-notes/atw-verify-skill.md` and the personal `~/.atw/skill-notes/atw-verify-skill.md`; a missing file means that layer has no notes. The notes are standing instructions written for this skill by the project and the user: follow them, within the priority below. When both exist and disagree, the project's notes win. Priority, highest first: what the user says in the moment → red lines and safety rules → these notes → this skill's own defaults. Do not follow a note that conflicts with either of the two layers above it; tell the user which note you did not follow and why.

Only the user starts this skill. You never invoke it yourself — not because a task has no verification skill, not because acceptance would be easier with one. Generating one installs dependencies, launches the app and drives it, and the user decides when that happens.

A verification skill is a project's scripted way to drive the real app and prove behavior: launch it, exercise a feature the way a user would, and capture evidence. This skill writes one for an app in the repo, or gives an existing one a health check (体检) so it keeps up with the app. Its content lives once, in `.atw/verify/<app>/`, and is the project's own file: committed, shared by the team, never overwritten by ATW updates. Each tool's skill folder gets only an entry page named `verify-<app>` that points there, written by `atw verify sync`. The generated skill is one the AI may use on its own — at acceptance, while reproducing a bug — so it carries no user-only marker.

## Starting it

- Claude Code: `/atw-verify-skill`
- Codex: `$atw-verify-skill`
- pi and omp: `/skill:atw-verify-skill`

Whatever follows the command is this run's request: which app ("for the CLI"), or which of the two jobs — `重新生成` (regenerate) or `体检` (health check). The user may say either in plain words in the same conversation. Every command you give the user to type is in the current tool's form only, from the list above. Talk to the user in their language.

## 1. Pick the app

An app is one thing a user touches — a web UI, a CLI or TUI, a desktop app, an API service, a mobile app, a library — with its own way to start. Look at the repo and at the directories already under `.atw/verify/`.

- Only one candidate: use it.
- Several, and the conversation does not settle which: ask the user. Otherwise do not ask.

The app's name is its directory name under `.atw/verify/` and is part of `verify-<app>`. Use only letters, digits, `.`, `_` and `-`, starting with a letter or digit — `atw verify sync` skips any other name.

## 2. Read its state

Look at `.atw/verify/<app>/`:

- **None** — the directory is missing, or holds nothing but `evidence/`: generate it.
- **Complete** — all of these hold: `SKILL.md` has frontmatter with `name: verify-<app>` and a non-empty `description`; it has a `## ` heading starting with each of the six section names `启动`, `健康检查`, `操作`, `证据`, `清理` and `辅助脚本` (a note may follow the name, as in `## 启动（Launch）`; a `###` heading does not count); the feature map index `features/README.md` exists, links at least one feature file by a relative `.md` link, and every feature file it lists exists. Then health-check it.
- **Incomplete** — anything else: report exactly what is missing and ask whether to patch it or start over. Do not run a health check on it as if it were whole. Patching fills in the missing parts by the generation steps and then proves the skill as generation does; starting over is a regeneration (below).

This is the same check `atw verify sync` makes before it writes an entry page. `atw verify sync --dry-run` writes nothing and lists an incomplete app as `skipped`, with the first thing missing as the reason.

### When the user says which

When the user says `重新生成` (regenerate) or `体检` (health check), do what they said rather than what the state suggests. A health check needs something to check: with no verification skill, say so and offer to generate one; with an incomplete one, report what is missing first, then treat each missing part as drift to fix within the health check's edit scope.

Before regenerating over an existing one, list every file that will be overwritten or deleted, and the hand edits in them: what changed since the generator wrote it, judged from the code history — uncommitted changes from `git status --porcelain -- .atw/verify/<app>/` and `git diff -- .atw/verify/<app>/`, and the commits after the one that added the directory from `git log --oneline -- .atw/verify/<app>/`. Overwrite only after the user agrees. "Regenerate" is not permission to drop hand-written content without saying so. `evidence/` is never deleted.

## 3. Do it

- Generate: read `references/generate.md` and follow it.
- Health check: read `references/health-check.md` and follow it.

Both drive the real app, so both carry the same rules for running it and keeping evidence: only on an instance this run started, with scratch data and test accounts; stop as blocked when that isolation is not possible; the browser security boundaries whenever a drive goes through a browser; evidence saved, redacted, and never removed by cleanup. Each step file states them in full, and so does the body template, so every generated skill carries them too.

Both end with `atw verify sync`, which writes or updates the `verify-<app>` entry page in the skill folder of every platform ATW finds configured in this project. Read its output: a `conflict` line means an entry page someone edited by hand, or a same-named folder ATW did not write, and the command exits with code 1 — tell the user which and why, and leave it as it is.

## Attached files

- `references/generate.md` — generating a verification skill: interview the repo, write the six sections and the feature map, prove it end to end, sync.
- `references/health-check.md` — health-checking one: index hygiene, a source read per feature, a live pass over every feature, triage, sync.
- `references/verify-skill-template.md` — the body template for `.atw/verify/<app>/SKILL.md`: frontmatter, the six sections, and the running and evidence rules.
- `references/feature-map-example/README.md` — a worked feature map: an index and two feature files.
