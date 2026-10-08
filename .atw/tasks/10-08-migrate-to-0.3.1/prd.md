# Migration Task: Upgrade to v0.3.1

**Created**: 2026-10-08
**From Version**: 0.2.10
**To Version**: 0.3.1
**Assignee**: oxy

## Status

- [ ] Review migration guide
- [ ] Update custom files
- [ ] Run `atw update --migrate`
- [ ] Test workflows

---

## v0.3.0 Migration Guide

### What changed

1. **The project glossary is now `GLOSSARY.md`.** Every bundled skill that read or wrote `CONTEXT.md` / `CONTEXT-MAP.md` (atw-domain-modeling, atw-init-repo, atw-triage, atw-tdd, atw-diagnosing-bugs, atw-codebase-design, atw-improve-codebase-architecture) now uses `GLOSSARY.md` / `GLOSSARY-MAP.md`. There is no fallback to the old names: a glossary left at `CONTEXT.md` is simply not found.
2. **Six bundled skills are gone:** atw-merge, dejargonizer, noob-mode, oxy-explanation, oxy-learning-hub, show-me. dejargonizer and noob-mode are succeeded by the new built-in `/atw-noob-mode`; explanation, oxy-learning-hub and show-me can be installed again as extra skills by re-running `atw init`.
3. **New skill `/atw-implement-spec`** implements a whole sliced spec in one parallel run. `tickets.py claim` gained `--parallel` for it. The per-ticket `/atw-implement` flow is unchanged.
4. **`atw init` asks for a display language and offers extra skills**, and no longer asks about the Claude Code statusLine (`--with-statusline` still installs it). Extra skills are downloaded from `LFT-OXY/oxy-Tools`; `atw update` keeps them current and `atw uninstall` removes them.
5. **New skill `/atw-noob-mode`**, a personal plain-language mode that stays on across stages until switched off.

### What `atw update --migrate` does for you

- Offers to rename `CONTEXT.md` → `GLOSSARY.md` and `CONTEXT-MAP.md` → `GLOSSARY-MAP.md` at the repository root. These are your files, so it asks before each one. Skip only if the file is not the ATW glossary.
- Deletes the installed files of the six removed skills, and the old `atw-domain-modeling/CONTEXT-FORMAT.md`, from every platform skill directory — but only copies you never edited. An edited copy is left where it is and reported.

### What is left for you

- [ ] **Multi-context repos:** rename each per-context `CONTEXT.md` to `GLOSSARY.md`, and fix the links inside `GLOSSARY-MAP.md` to match. The updater only knows the two root paths.
- [ ] **`docs/agents/domain.md` and `docs/agents/issue-tracker.md`:** `/atw-init-repo` wrote these into your repo and they still name `CONTEXT.md`. Replace the name in both, or re-run `/atw-init-repo` to regenerate them.
- [ ] **Open tasks:** `check.jsonl` and `implement.jsonl` under `.atw/tasks/<task>/` list files by path. A line that still names `CONTEXT.md` now points at a file that is gone, and the hook skips it without a word — the review sub-agent simply works without your glossary. Replace the name there, and in that task's `prd.md`, `map.md` and tickets. `python3 ./.atw/scripts/task.py validate <task-dir>` reports every line whose file is missing.
- [ ] **Any other mention** of `CONTEXT.md` / `CONTEXT-MAP.md` in `AGENTS.md`, `CLAUDE.md`, ADRs under `docs/adr/`, or `.atw/spec/`.
- [ ] **Edited copies of removed skills** the updater reported as kept: delete them if you no longer want them.

Nothing else needs action. Ticket states and `task.json` files are compatible as they are.

### AI Assistant Instructions

When helping with this migration:

- Find every glossary file still on the old name: `git ls-files '*CONTEXT.md' '*CONTEXT-MAP.md'`. Before renaming one, open it and confirm it is an ATW glossary (a `## Language` heading with bold terms and `_Avoid_:` lines, or for the map a list of links to per-context files). Leave an unrelated file that only shares the name alone, and say that you did.
- Rename with `git mv <dir>/CONTEXT.md <dir>/GLOSSARY.md` (and `CONTEXT-MAP.md` → `GLOSSARY-MAP.md`) so history follows the file. If a `GLOSSARY.md` already exists beside it, stop and ask the user which one is current instead of merging on your own.
- After the renames, update the references: `grep -rnE 'CONTEXT(-MAP)?\.md' --include='*.md' --include='*.jsonl' .` and fix each hit that points at a glossary — links inside `GLOSSARY-MAP.md`, `docs/agents/domain.md`, `docs/agents/issue-tracker.md`, `AGENTS.md` / `CLAUDE.md`, ADRs, `.atw/spec/`, and every task under `.atw/tasks/` that is not archived: its `check.jsonl` / `implement.jsonl`, `prd.md`, `map.md` and `issues/`. Do not edit anything under `.atw/tasks/archive/`: archived tasks are a record of what was true then.
- A `check.jsonl` / `implement.jsonl` line whose file does not exist is skipped silently when sub-agent context is built, so a stale glossary path there is invisible at review time. After editing a task's jsonl, run `python3 ./.atw/scripts/task.py validate <task-dir>` and clear every `File not found`.
- Do not rewrite the headings in `docs/agents/*.md` while you are there; other skills match them literally.
- If the updater reported removed-skill files as kept because they were modified, list them for the user and ask before deleting. Never delete them silently.
- Verify at the end: the first grep returns nothing outside archived tasks, and `git status` shows only renames and the reference edits.

