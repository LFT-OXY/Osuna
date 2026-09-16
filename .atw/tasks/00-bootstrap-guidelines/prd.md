# Bootstrap Task: Fill Project Development Guidelines

**You (the AI) are running this task. The developer does not read this file.**

The developer just ran `atw init` on this project for the first time.
`.atw/` now exists with empty spec scaffolding, and this bootstrap task
exists under `.atw/tasks/`. When they want to work on it, they should start
this task from a session that provides ATW session identity.

**Your job**: help them populate `.atw/spec/` with the team's real
coding conventions. Every future AI session — the `/atw-implement` run
and this project's `atw-review` sub-agents — reads spec files
listed in per-task jsonl manifests. Empty spec = the AI writes generic
code. Real spec = the AI matches the team's actual patterns.

Don't dump instructions. Open with a short greeting, figure out if the repo
has any existing convention docs (CLAUDE.md, .cursorrules, etc.), and drive
the rest conversationally.

---

## Status (update the checkboxes as you complete each item)

- [ ] Fill guidelines for @getpaseo/expo-two-way-audio
- [ ] Fill guidelines for @getpaseo/highlight
- [ ] Fill guidelines for @getpaseo/plugin
- [ ] Fill guidelines for @getpaseo/protocol
- [ ] Fill guidelines for @getpaseo/client
- [x] Fill guidelines for @getpaseo/server
- [x] Fill guidelines for @getpaseo/app
- [ ] Fill guidelines for @getpaseo/relay
- [ ] Fill guidelines for @getpaseo/website
- [ ] Fill guidelines for @getpaseo/desktop
- [ ] Fill guidelines for @getpaseo/cli
- [~] Add code examples (server and app done; remaining packages pending)

### Progress notes

- 2026-09-17: `server` and `app` written in English from `docs/` plus source evidence. Scaffold layers that did not match the package were deleted: `spec/server/frontend/` and `spec/app/backend/` are gone, and the file sets were reshaped (`persistence.md`, `rpc-and-protocol.md`, `logging.md`, `testing.md` for server; `styling.md`, `hooks-and-data.md`, `testing.md` for app). Remaining nine packages untouched.
- Doc conflict found and fixed: `CLAUDE.md` "Platform gating" and `docs/design.md` §14 forbade `onPointerEnter`/`onPointerLeave`, contradicting the canonical envelope in `docs/hover.md`. Both now point at `hover.md` and keep `onHoverIn`/`onHoverOut` only for a `Pressable` styling itself. `docs/design.md` also pointed `SettingsSection` at a path that no longer exists; corrected to `components/settings/headings/settings-section.tsx`.

---

## Spec files to populate

### Package: @getpaseo/expo-two-way-audio (`spec/expo-two-way-audio/`)

- Backend guidelines: `.atw/spec/expo-two-way-audio/backend/`

- Frontend guidelines: `.atw/spec/expo-two-way-audio/frontend/`

### Package: @getpaseo/highlight (`spec/highlight/`)

- Backend guidelines: `.atw/spec/highlight/backend/`

- Frontend guidelines: `.atw/spec/highlight/frontend/`

### Package: @getpaseo/plugin (`spec/plugin/`)

- Backend guidelines: `.atw/spec/plugin/backend/`

- Frontend guidelines: `.atw/spec/plugin/frontend/`

### Package: @getpaseo/protocol (`spec/protocol/`)

- Frontend guidelines: `.atw/spec/protocol/frontend/`

### Package: @getpaseo/client (`spec/client/`)

- Backend guidelines: `.atw/spec/client/backend/`

- Frontend guidelines: `.atw/spec/client/frontend/`

### Package: @getpaseo/server (`spec/server/`)

- Backend guidelines: `.atw/spec/server/backend/`

- Frontend guidelines: `.atw/spec/server/frontend/`

### Package: @getpaseo/app (`spec/app/`)

- Backend guidelines: `.atw/spec/app/backend/`

- Frontend guidelines: `.atw/spec/app/frontend/`

### Package: @getpaseo/relay (`spec/relay/`)

- Backend guidelines: `.atw/spec/relay/backend/`

- Frontend guidelines: `.atw/spec/relay/frontend/`

### Package: @getpaseo/website (`spec/website/`)

- Frontend guidelines: `.atw/spec/website/frontend/`

### Package: @getpaseo/desktop (`spec/desktop/`)

- Frontend guidelines: `.atw/spec/desktop/frontend/`

### Package: @getpaseo/cli (`spec/cli/`)

- Backend guidelines: `.atw/spec/cli/backend/`

- Frontend guidelines: `.atw/spec/cli/frontend/`


### Thinking guides (already populated)

`.atw/spec/guides/` contains general thinking guides pre-filled with
best practices. Customize only if something clearly doesn't fit this project.

---

## How to fill the spec

### Step 1: Import from existing convention files first (preferred)

Search the repo for existing convention docs. If any exist, read them and
extract the relevant rules into the matching `.atw/spec/` files —
usually much faster than documenting from scratch.

| File / Directory | Tool |
|------|------|
| `CLAUDE.md` / `CLAUDE.local.md` | Claude Code |
| `AGENTS.md` | Codex / Claude Code / agent-compatible tools |
| `.cursorrules` | Cursor |
| `.cursor/rules/*.mdc` | Cursor (rules directory) |
| `.windsurfrules` | Windsurf |
| `.clinerules` | Cline |
| `.roomodes` | Roo Code |
| `.github/copilot-instructions.md` | GitHub Copilot |
| `.vscode/settings.json` → `github.copilot.chat.codeGeneration.instructions` | VS Code Copilot |
| `CONVENTIONS.md` / `.aider.conf.yml` | aider |
| `CONTRIBUTING.md` | General project conventions |
| `.editorconfig` | Editor formatting rules |

### Step 2: Analyze the codebase for anything not covered by existing docs

Scan real code to discover patterns. Before writing each spec file:
- Find 2-3 real examples of each pattern in the codebase.
- Reference real file paths (not hypothetical ones).
- Document anti-patterns the team clearly avoids.

### Step 3: Document reality, not ideals

**Critical**: write what the code *actually does*, not what it should do.
Sub-agents match the spec, so aspirational patterns that don't exist in the
codebase will cause sub-agents to write code that looks out of place.

If the team has known tech debt, document the current state — improvement
is a separate conversation, not a bootstrap concern.

---

## Quick explainer of the runtime (share when they ask "why do we need spec at all")

- Every ticket runs through `/atw-implement` in the main session (writes
  code), which dispatches two `atw-review` sub-agents (verify quality).
  No implementation sub-agent is spawned.
- Each task has `implement.jsonl` / `check.jsonl` manifests listing which
  spec files to load.
- The platform hook auto-injects those spec files + the task's `prd.md`
  into every sub-agent prompt, so the sub-agent codes/reviews per team
  conventions without anyone pasting them manually.
- Source of truth: `.atw/spec/`. That's why filling it well now pays
  off forever.

---

## Completion

When the developer confirms the checklist items above are done with real
examples (not placeholders), guide them to run:

```bash
python3 ./.atw/scripts/task.py finish
python3 ./.atw/scripts/task.py archive 00-bootstrap-guidelines
```

After archive, every new developer who joins this project will get a
`00-join-<slug>` onboarding task instead of this bootstrap task.

---

## Suggested opening line

"Welcome to ATW! Your init just set me up to help you fill the project
spec — a one-time setup so every future AI session follows the team's
conventions instead of writing generic code. Before we start, do you have
any existing convention docs (CLAUDE.md, .cursorrules, CONTRIBUTING.md,
etc.) I can pull from, or should I scan the codebase from scratch?"
