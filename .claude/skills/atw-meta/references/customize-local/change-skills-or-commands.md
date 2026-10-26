# Change Local Skills, Commands, Prompts, And Workflows

When the user wants to change AI entry points, auto-trigger rules, or explicit command behavior, edit skills, commands, prompts, or workflows in local platform directories.

Before editing, classify the skill you are about to touch:

- **Bundled upstream skill** — `atw-meta`, `atw-spec-bootstrap`, `atw-session-insight`, `atw-channel`. Source of truth lives in the ATW CLI repo under `packages/cli/src/templates/common/bundled-skills/<name>/`; auto-dispatched to every platform's skill root by `getBundledSkillTemplates()` on `atw init` / `atw update`. Local edits here are tracked by `.atw/.template-hashes.json` and will be flagged on the next update.
- **Project-local skill** — anything else under `.{platform}/skills/`. Owned by the user; not refreshed by `atw update`.

The remainder of this file uses "skill" for the local file; the override and conflict rules differ between the two cases.

## Read These Files First

1. `.atw/workflow.md`
2. Target platform skill/command/prompt/workflow directory
3. Related agent or hook files
4. Whether project rules already exist in `.atw/spec/`
5. `.atw/.template-hashes.json` — confirms whether the skill you are about to edit is upstream-owned (entry present) or project-local (entry absent)

## Which Entry Type To Choose

| Goal | Recommendation |
| --- | --- |
| AI should automatically know a capability | Add or modify a skill. |
| User wants to trigger manually with a command | Add or modify a command/prompt/workflow. |
| Team project conventions | Prefer `.atw/spec/` or a project-local skill — never a bundled skill directory. |
| Adjust how an existing ATW skill or command works | Write its skill notes: `.atw/skill-notes/<installed name>.md` for the project, `~/.atw/skill-notes/<installed name>.md` for yourself across every project. Do not edit the installed copy and do not copy it under a new name. |
| A whole capability ATW does not have | Create a project skill whose name does not start with `atw-`. |
| Contribute the change back upstream | Edit `packages/cli/src/templates/common/bundled-skills/<name>/` in the ATW CLI repo, not the deployed copy. |
| Change ATW flow semantics | Synchronize `.atw/workflow.md`. |

## Adjust An Existing ATW Skill: Write Its Skill Notes

Every ATW skill and command is installed once per platform and refreshed by `atw update`, so an edit to any installed copy conflicts with the next update, and a copy under a new name is never called by the flow and gets none of ATW's later improvements. Put the adjustment in the skill's notes instead; the skill itself keeps upgrading and the notes sit on top of it, one file for every platform.

- **Where**: `.atw/skill-notes/<installed name>.md` in the project — it travels with the repository and the whole team uses it; `~/.atw/skill-notes/<installed name>.md` for one person, on every project on this machine. When both exist, the project's notes win.
- **Name**: the installed name — the skill directory name (`atw-tdd`, `atw-brainstorm`) or, for the three commands, `atw-start`, `atw-continue`, `atw-finish-work` on every platform.
- **How it is read**: install puts a fixed paragraph at the top of every ATW skill and command telling the AI to read both files first. Priority, highest first: what the user says in the moment → red lines and safety rules → the notes → the skill's own defaults. A note that conflicts with the two higher layers is not followed, and the user is told.
- **Ownership**: the notes belong to the project or the user. `atw update`, `atw uninstall` and `atw mode` never touch `.atw/skill-notes/` or `~/.atw/skill-notes/`.

Write a note as short, direct instructions about how the skill should behave differently ("Ask before running the full suite."), not a second copy of the skill.

## Modify A Skill

A skill is usually:

```text
<skill-name>/
├── SKILL.md
└── references/
```

`SKILL.md` should be short and responsible for triggering/routing. Put long content in `references/` so AI can read it on demand.

The frontmatter description should specify when to use the skill. Example:

```yaml
description: "Use when customizing this project's deployment workflow and release checklist."
```

Do not write vague descriptions such as "helpful project skill"; they can trigger incorrectly.

### Bundled vs. Project-Local

The same directory shape is used by two very different ownership models:

| Aspect | Bundled (`atw-meta`, `atw-spec-bootstrap`, `atw-session-insight`, `atw-channel`) | Project-local |
| --- | --- | --- |
| Source of truth | `packages/cli/src/templates/common/bundled-skills/<name>/` in ATW CLI repo | Inside the user project itself |
| Dispatch | Auto-dispatched to every platform skill root by `getBundledSkillTemplates()` (`packages/cli/src/templates/common/index.ts`) on `atw init` / `atw update` | Created by the user (or another skill) and never moved |
| Hash tracking | Every file recorded in `.atw/.template-hashes.json`; conflict prompt on update | Not tracked |
| Editing locally | Allowed but will be marked "modified by user" on next update | Free editing |
| The right way to customize | Write the skill's notes (see above); never edit the installed copy or clone it under a new name | Edit the file directly |

If the goal is "make my project's AI behave differently when an ATW skill runs," the answer is that skill's notes, not surgery on `atw-meta/` and not a renamed copy.

## Modify A Command/Prompt/Workflow

Explicit entry points should state:

- How the user triggers it.
- Which `.atw/` files to read.
- Which scripts to run.
- How to report after completion.

If a command only repeats workflow rules, prefer making it reference/read `.atw/workflow.md` instead of maintaining a second copy of the flow.

## Common Paths

| Platform | Entry directories |
| --- | --- |
| Claude Code | `.claude/skills/`, `.claude/commands/` |
| Cursor | `.cursor/skills/`, `.cursor/commands/` |
| OpenCode | `.opencode/skills/`, `.opencode/commands/` |
| Codex | `.agents/skills/`, `.codex/skills/` |
| Gemini CLI | `.agents/skills/`, `.gemini/commands/` |
| Kiro | `.kiro/skills/` |
| Qoder | `.qoder/skills/`, `.qoder/commands/` |
| CodeBuddy | `.codebuddy/skills/`, `.codebuddy/commands/` |
| GitHub Copilot | `.github/skills/`, `.github/prompts/` |
| Factory Droid | `.factory/skills/`, `.factory/commands/` |
| Pi Agent | `.agents/skills/` |
| Reasonix | `.reasonix/skills/` (no separate commands dir; slash commands built into the platform) |
| ZCode | `.zcode/skills/`, `.zcode/commands/` |
| Kilo / Antigravity / Devin | workflows + skills |

Every directory above is a deploy target for the four bundled skills. Each platform receives a full copy on `atw init` and refresh on `atw update`; nothing has to be wired by hand.

## Add A Project Skill (Only For A Missing Capability)

Create a project skill only when a whole capability is missing — something no ATW skill does at all. To change how an existing ATW skill works, write its skill notes instead. Never put project-private content into a bundled skill directory, since `atw update` will overwrite it.

```text
.claude/skills/acme-deploy/
└── SKILL.md
```

For multi-platform projects, add equivalent versions in each platform skill directory, or use `.agents/skills/` on platforms that support the shared layer (Codex, Gemini CLI).

Pick a name that does **not** start with `atw-`: that prefix is ATW's own, and a reused name causes `getBundledSkillTemplates()` to overwrite the project copy on the next update. A common convention is to prefix the project name: `acme-deploy`, `acme-onboarding`.

## Notes

- Do not mix every platform's syntax into one file.
- Do not change only one platform entry point while claiming all platforms are supported.
- Do not hide long-term engineering conventions inside a command; write them to `.atw/spec/`.
- Do not hand-edit files inside `atw-meta/`, `atw-spec-bootstrap/`, `atw-session-insight/`, or `atw-channel/` under any `.{platform}/skills/` directory expecting the change to persist — they are bundled and refreshed by `atw update`. Either contribute upstream or write the skill's notes.
- After `atw update` reports a "modified by you" conflict on a bundled skill file, choose **keep** only if you accept maintaining the divergence by hand; otherwise accept the overwrite and re-apply the intent as the skill's notes.
