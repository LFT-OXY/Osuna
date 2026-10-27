---
name: atw-update-spec
description: "Captures executable contracts and coding conventions into .atw/spec/ documents. Use when learning something valuable from debugging, implementing, or discussion that should be preserved for future sessions. 用于把学到的经验沉淀进项目规范时。"
---

# Update Code-Spec - Capture Executable Contracts

**Skill notes.** Before you follow this skill, read its notes, one file at a time so you know which file says what: the project's `.atw/skill-notes/atw-update-spec.md` and the personal `~/.atw/skill-notes/atw-update-spec.md`; a missing file means that layer has no notes. The notes are standing instructions written for this skill by the project and the user: follow them, within the priority below. When both exist and disagree, the project's notes win. Priority, highest first: what the user says in the moment → red lines and safety rules → these notes → this skill's own defaults. Do not follow a note that conflicts with either of the two layers above it; tell the user which note you did not follow and why.

When you learn something valuable (from debugging, implementing, or discussion), use this to update the relevant code-spec documents.

**Timing**: After completing a task, fixing a bug, or discovering a new pattern

---

## Code-Spec First Rule (CRITICAL)

In this project, "spec" for implementation work means **code-spec**:
- Executable contracts (not principle-only text)
- Concrete signatures, payload fields, env keys, and boundary behavior
- Testable validation/error behavior

If the change touches infra or cross-layer contracts, code-spec depth is mandatory.

### Mandatory Triggers

Apply code-spec depth when the change includes any of:
- New/changed command or API signature
- Cross-layer request/response contract change
- Database schema/migration change
- Infra integration (storage, queue, cache, secrets, env wiring)

### Mandatory Output (7 Sections)

For triggered tasks, include all sections below:
1. Scope / Trigger
2. Signatures (command/API/DB)
3. Contracts (request/response/env)
4. Validation & Error Matrix
5. Good/Base/Bad Cases
6. Tests Required (with assertion points)
7. Wrong vs Correct (at least one pair)

---

## When to Update Code-Specs

| Trigger | Example | Target Spec |
|---------|---------|-------------|
| **Implemented a feature** | Added a new integration or module | Relevant spec file |
| **Made a design decision** | Chose extensibility pattern over simplicity | Relevant spec + "Design Decisions" section |
| **Fixed a bug** | Found a subtle issue with error handling | Relevant spec (e.g., error-handling docs) |
| **Discovered a pattern** | Found a better way to structure code | Relevant spec file |
| **Hit a gotcha** | Learned that X must be done before Y | Relevant spec + "Common Mistakes" section |
| **Established a convention** | Team agreed on naming pattern | Quality guidelines |
| **Settled a visual rule** | New design token, component variant, or spacing rule reused across screens | `design-system.md` in the UI layer |
| **New thinking trigger** | "Don't forget to check X before doing Y" | `guides/*.md` (as a checklist item) |

**Key Insight**: Code-spec updates are NOT just for problems. Every feature implementation contains design decisions and contracts that future AI/developers need to execute safely.

---

## Spec Structure Overview

```
.atw/spec/
├── <layer>/           # Per-layer coding standards (e.g., backend/, frontend/, api/)
│   ├── index.md       # Overview and links
│   └── *.md           # Topic-specific guidelines
└── guides/            # Thinking checklists (NOT coding specs!)
    ├── index.md       # Guide index
    └── *.md           # Topic-specific guides
```

### CRITICAL: Code-Spec vs Guide - Know the Difference

| Type | Location | Purpose | Content Style |
|------|----------|---------|---------------|
| **Code-Spec** | `<layer>/*.md` | Tell AI "how to implement safely" | Signatures, contracts, matrices, cases, test points |
| **Guide** | `guides/*.md` | Help AI "what to think about" | Checklists, questions, pointers to specs |

**Decision Rule**: Ask yourself:

- "This is **how to write** the code" → Put in a spec layer directory
- "This is **what to consider** before writing" → Put in `guides/`

**Example**:

| Learning | Wrong Location | Correct Location |
|----------|----------------|------------------|
| "Use API X not API Y for this task" | ❌ `guides/` (too specific for a thinking guide) | ✅ Relevant spec file (concrete convention) |
| "Remember to check X when doing Y" | ❌ Spec file (too abstract for a spec) | ✅ `guides/` (thinking checklist) |

**Guides should be short checklists that point to specs**, not duplicate the detailed rules.

---

## Update Process

### Step 1: Identify What You Learned

Answer these questions:

1. **What did you learn?** (Be specific)
2. **Why is it important?** (What problem does it prevent?)
3. **Where does it belong?** (Which spec file?)

### Step 2: Ask Whether It Can Be Enforced

Before writing a single line of docs, fix the lesson at the highest level that works. Assume every contributor is an agent that sees only the files it opened, copies the nearest example, and takes the shortest path that compiles. Design the repo so a change that looks right from one file is right for the whole repo.

1. **Eliminate it with architecture.** Give each piece of state one owner and each task one supported way. Hide internals so the wrong import fails. Replace hand-synced lists with one source of truth. Delete old ways and dead code an agent would copy.
2. **Enforce it with types so the bad state can't be written.** If bad code still compiles, add a lint or CI check whose error names the file, type, or function to use instead. If the pattern is already common, fail only when a change adds more.
3. **Test the behavior.** Fix or delete any test that still passes when the behavior it checks breaks, or that fails when only the internals change.
4. **Write docs last, only for judgment calls.** Nothing fails when an agent skips them.

Tell the user the level you picked and why a higher level didn't work.

After a fix at levels 1–3, the docs entry is only a pointer — make the docs entry point at it: the rule in one sentence plus "enforced by `<test file or checker>`". Docs that only repeat what the test already enforces are noise. Steps 3–6 below apply when the rule is written as docs (level 4).

**When code may not change here** — called during the acceptance check, or anywhere else that is read-only — do not make a level 1–3 fix in place. Instead write it as a new ticket the way the project's tracker doc says (`docs/agents/issue-tracker.md`), and write only the rule's row and its docs now: "Docs only" under "Enforced by" and the ticket under "Where", until the ticket lands.

**Fix and prove.** Prove each new check fails on a real past mistake. Run the same command locally and in CI. Exceptions go on the offending line with a reason, an expiry date, and a human's approval — never your own. In an unattended run nobody can approve one: write no exception; log one decision-log row marked needs-you (`python3 .atw/scripts/decision_log.py add … --mark needs-you`) naming the line and why it needs one, and leave it for the user. Write each exception into the rule's row, in the rule table's `Expires` column, as its expiry date plus its `file:line` — several exceptions, several entries. If the project's table has no `Expires` column — tables written before it existed keep their old header, because `atw update` never touches `.atw/spec/` — add the column, with `—` in every existing row, the first time you write an exception.

**Drop a rule once its mistake can't happen** — when the thing it guarded no longer exists, delete its docs and its row in the rule table. A rule fixed at architecture or types is not dropped: its row stays, pointing at what enforces it.

**Find the mistake classes only when the correction repeats.** When the user says it goes this way from now on (以后都这样), or a choice of the same kind is overruled a second time, first read recent commits, reverts, review comments, agent instruction files, and comments that explain workarounds. Group the mistakes into classes. A class counts once it has happened twice. Fix the most frequent classes now, one commit each, each at the highest level that works. Otherwise skip this and fix only the lesson in front of you.

**Keep the rule table** — **every rule you write gets a row in the rule table** at the top of the layer's `quality-guidelines.md`: the rule, what enforces it, where that lives, which task or bug produced it, and the expiry date of each exception to it. When the user corrects you, fix the mistake and add the rule. If the rule was already there and nothing enforces it, that's a repeat, so fix it at the highest level in the same change. A row whose "Enforced by" reads "Docs only" is the signal that the next time this rule is broken you upgrade it to a test or lint instead of rewording the docs — it is not the end point.

### Step 3: Classify the Update Type

| Type | Description | Action |
|------|-------------|--------|
| **Design Decision** | Why we chose approach X over Y | Add to "Design Decisions" section |
| **Project Convention** | How we do X in this project | Add to relevant section with examples |
| **New Pattern** | A reusable approach discovered | Add to "Patterns" section |
| **Forbidden Pattern** | Something that causes problems | Add to "Anti-patterns" or "Don't" section |
| **Common Mistake** | Easy-to-make error | Add to "Common Mistakes" section |
| **Convention** | Agreed-upon standard | Add to relevant section |
| **Gotcha** | Non-obvious behavior | Add warning callout |

### Step 4: Read the Target Code-Spec

Before editing, read the current code-spec to:
- Understand existing structure
- Avoid duplicating content
- Find the right section for your update

```bash
cat .atw/spec/<category>/<file>.md
```

### Step 5: Make the Update

Follow these principles:

1. **Be Specific**: Include concrete examples, not just abstract rules
2. **Explain Why**: State the problem this prevents
3. **Show Contracts**: Add signatures, payload fields, and error behavior
4. **Show Code**: Add code snippets for key patterns
5. **Keep it Short**: One concept per section

### Step 6: Update the Index (if needed)

If you added a new section or the code-spec status changed, update the category's `index.md`.

---

## Update Templates

### Mandatory Template for Infra/Cross-Layer Work

```markdown
## Scenario: <name>

### 1. Scope / Trigger
- Trigger: <why this requires code-spec depth>

### 2. Signatures
- Backend command/API/DB signature(s)

### 3. Contracts
- Request fields (name, type, constraints)
- Response fields (name, type, constraints)
- Environment keys (required/optional)

### 4. Validation & Error Matrix
- <condition> -> <error>

### 5. Good/Base/Bad Cases
- Good: ...
- Base: ...
- Bad: ...

### 6. Tests Required
- Unit/Integration/E2E with assertion points

### 7. Wrong vs Correct
#### Wrong
...
#### Correct
...
```

### Adding a Design Decision

```markdown
### Design Decision: [Decision Name]

**Context**: What problem were we solving?

**Options Considered**:
1. Option A - brief description
2. Option B - brief description

**Decision**: We chose Option X because...

**Example**:
\`\`\`typescript
// How it's implemented
code example
\`\`\`

**Extensibility**: How to extend this in the future...
```

### Adding a Project Convention

```markdown
### Convention: [Convention Name]

**What**: Brief description of the convention.

**Why**: Why we do it this way in this project.

**Example**:
\`\`\`typescript
// How to follow this convention
code example
\`\`\`

**Related**: Links to related conventions or specs.
```

### Adding a New Pattern

```markdown
### Pattern Name

**Problem**: What problem does this solve?

**Solution**: Brief description of the approach.

**Example**:
\`\`\`
// Good
code example

// Bad
code example
\`\`\`

**Why**: Explanation of why this works better.
```

### Adding a Forbidden Pattern

```markdown
### Don't: Pattern Name

**Problem**:
\`\`\`
// Don't do this
bad code example
\`\`\`

**Why it's bad**: Explanation of the issue.

**Instead**:
\`\`\`
// Do this instead
good code example
\`\`\`
```

### Adding a Common Mistake

```markdown
### Common Mistake: Description

**Symptom**: What goes wrong

**Cause**: Why this happens

**Fix**: How to correct it

**Prevention**: How to avoid it in the future
```

### Adding a Gotcha

```markdown
> **Warning**: Brief description of the non-obvious behavior.
>
> Details about when this happens and how to handle it.
```

---

## Interactive Mode

If you're unsure what to update, answer these prompts:

1. **What did you just finish?**
   - [ ] Fixed a bug
   - [ ] Implemented a feature
   - [ ] Refactored code
   - [ ] Had a discussion about approach

2. **What did you learn or decide?**
   - Design decision (why X over Y)
   - Project convention (how we do X)
   - Non-obvious behavior (gotcha)
   - Better approach (pattern)

3. **Would future AI/developers need to know this?**
   - To understand how the code works → Yes, update spec
   - To maintain or extend the feature → Yes, update spec
   - To avoid repeating mistakes → Yes, update spec
   - Purely one-off implementation detail → Maybe skip

4. **Which area does it relate to?**
   - [ ] Backend code
   - [ ] Frontend code
   - [ ] Cross-layer data flow
   - [ ] Code organization/reuse
   - [ ] Quality/testing

---

## Quality Checklist

Before finishing your code-spec update:

- [ ] Is the content specific and actionable?
- [ ] Did you include a code example?
- [ ] Did you explain WHY, not just WHAT?
- [ ] Did you include executable signatures/contracts?
- [ ] Did you include validation and error matrix?
- [ ] Did you include Good/Base/Bad cases?
- [ ] Did you include required tests with assertion points?
- [ ] Is it in the right code-spec file?
- [ ] Did you add a row to the rule table (and is "Docs only" really the only option)?
- [ ] Does it duplicate existing content?
- [ ] Would a new team member understand it?

---

## Relationship to Other Commands

```
Development Flow:
  Learn something → /atw:update-spec → Knowledge captured
       ↑                                  ↓
  /atw:diagnosing-bugs ←──────────────── Future sessions benefit
  (deep bug analysis)
```

- `/atw:diagnosing-bugs` - Analyzes bugs deeply, often reveals spec updates needed
- `/atw:update-spec` - Actually makes the updates
- `/atw:finish-work` - Reminds you to check if specs need updates

---

## Core Philosophy

> **Code-specs are living documents. Every debugging session, every "aha moment" is an opportunity to make the implementation contract clearer.**

The goal is **institutional memory**:
- What one person learns, everyone benefits from
- What AI learns in one session, persists to future sessions
- Mistakes become documented guardrails

---

## Rationalizations specific to this skill

Same shape as the general table in `.atw/workflow.md`; these are the excuses that only show up while capturing lessons.

| Rationalization | Reality |
|---|---|
| Writing it into the docs is capturing it | What a test or lint can enforce becomes a test or lint first; the docs record only what cannot be written into code |
| This rule is too obvious to record | Obvious rules only arrive here after they have been broken |
| Note it down now, add the test later | "Docs only" in the rule table is the signal for the next upgrade, not the end point |
