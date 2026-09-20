# Cross-Layer Thinking Guide

> **Purpose**: Think through data flow across layers before implementing.

---

## The Problem

**Most bugs happen at layer boundaries**, not within layers.

Common cross-layer bugs:

- API returns format A, frontend expects format B
- Database stores X, service transforms to Y, but loses data
- Multiple layers implement the same logic differently

---

## Before Implementing Cross-Layer Features

### Step 1: Map the Data Flow

Draw out how data moves:

```
Source → Transform → Store → Retrieve → Transform → Display
```

For each arrow, ask:

- What format is the data in?
- What could go wrong?
- Who is responsible for validation?

### Step 2: Identify Boundaries

| Boundary              | Common Issues                     |
| --------------------- | --------------------------------- |
| API ↔ Service         | Type mismatches, missing fields   |
| Service ↔ Database    | Format conversions, null handling |
| Backend ↔ Frontend    | Serialization, date formats       |
| Component ↔ Component | Props shape changes               |

### Step 3: Define Contracts

For each boundary:

- What is the exact input format?
- What is the exact output format?
- What errors can occur?

---

## Common Cross-Layer Mistakes

### Mistake 1: Implicit Format Assumptions

**Bad**: Assuming date format without checking

**Good**: Explicit format conversion at boundaries

### Mistake 2: Scattered Validation

**Bad**: Validating the same thing in multiple layers

**Good**: Validate once at the entry point

### Mistake 3: Leaky Abstractions

**Bad**: Component knows about database schema

**Good**: Each layer only knows its neighbors

### Mistake 4: Every Consumer Parses The Same Payload

**Bad**: A command reads JSONL events and casts fields inline:

```typescript
const thread = (ev as { thread?: string }).thread;
const labels = (ev as { labels?: string[] }).labels;
```

This looks local, but it means every consumer owns a private version of the
event contract. The next field change will update one command and miss another.

**Good**: Decode once at the event boundary, then export typed projections:

```typescript
if (!isThreadEvent(ev)) return false;
return ev.thread === filter.thread;
```

**Rule**: For append-only logs, JSON streams, RPC payloads, or config files,
create one owner for:

- event / payload type definitions
- type guards and normalization from `unknown`
- metadata projections used by UI commands
- reducers that replay state from the source of truth

Rendering code may format fields, but it must not redefine the payload contract.

---

## Checklist for Cross-Layer Features

Before implementation:

- [ ] Mapped the complete data flow
- [ ] Identified all layer boundaries
- [ ] Defined format at each boundary
- [ ] Decided where validation happens

After implementation:

- [ ] Tested with edge cases (null, empty, invalid)
- [ ] Verified error handling at each boundary
- [ ] Checked data survives round-trip
- [ ] Checked that consumers import shared decoders / projections instead of
      casting payload fields locally
- [ ] Checked that derived state points back to the source event identifier
      (`seq`, `id`, `version`) instead of inventing a second cursor

---

## Cross-Platform Template Consistency

In ATW, command templates (e.g., `record-session.md`) exist in **multiple platforms** with identical or near-identical content. This is a cross-layer boundary.

### Checklist: After Modifying Any Command Template

- [ ] Find all platforms with the same command: `find src/templates/*/commands/atw/ -name "<command>.*"`
- [ ] Update all platform copies (Markdown `.md` and TOML `.toml`)
- [ ] For Gemini TOML: adapt line continuations (`\\` vs `\`) and triple-quoted strings
- [ ] Run `/atw:check-cross-layer` to verify nothing was missed

**Real-world example**: Updated `record-session.md` in Claude to use `--mode record`, but forgot iFlow, Kilo, OpenCode, and Gemini — caught by cross-layer check.

---

## Generated Runtime Template Upgrade Consistency

Some generated files are both documentation and runtime input. In ATW,
`.atw/workflow.md` is parsed by `get_context.py`, `workflow_phase.py`,
SessionStart filters, and per-turn hooks. Template changes must be validated
against both fresh init and upgrade paths.

### Checklist: After Modifying A Runtime-Parsed Template

- [ ] Identify every runtime parser that reads the template, not just the file
      writer that installs it
- [ ] Check whether relevant syntax lives outside obvious managed regions
      such as tag blocks
- [ ] Verify fresh `init` output and a versioned `update` scenario that writes
      the older `.atw/.version`
- [ ] Add an upgrade regression using an older pristine template fixture, then
      assert the installed file reaches the current packaged shape
- [ ] Update the backend spec that owns the runtime contract

## Mode-Detection Probe Checklist

When a CLI auto-detects a mode by probing a remote resource (e.g., checking if `index.json` exists to decide marketplace vs direct download):

### Before implementing:

- [ ] Probe runs in **ALL** code paths that use the result (interactive, `-y`, `--flag` combos)
- [ ] 404 vs transient error are distinguished — don't treat both as "not found"
- [ ] Transient errors **abort or retry**, never silently switch modes
- [ ] Shared state (caches, prefetched data) is **reset** when context changes (e.g., user switches source)
- [ ] **Shortcut paths** (e.g., `--template` skipping picker) must have the same error-handling quality as the probed path — check that downstream functions don't call catch-all wrappers

### After implementing:

- [ ] Trace every path from probe result to the mode-decision branch — no fallthrough
- [ ] External format contracts (giget URI, raw URLs) are tested or at least documented as comments
- [ ] Metadata reads consume a complete response or use a streaming parser — never parse a fixed-size prefix as full JSON
- [ ] When reconstructing a composite identifier from parsed parts, verify **all** fields are included and in the **correct position** (e.g., `provider:repo/path#ref` not `provider:repo#ref/path`)
- [ ] Verify that **action functions** called after a shortcut don't internally use the old catch-all fetch — they must use the probe-quality variant when error distinction matters

**Real-world example**: Custom registry flow had 8 bugs across 3 review rounds: (1) probe only ran in interactive mode, (2) transient errors fell through to wrong mode, (3) giget URI had `#ref` in wrong position, (4) prefetched templates leaked across source switches, (5) `--template` shortcut bypassed probe but `downloadTemplateById` internally used catch-all `fetchTemplateIndex`, turning timeouts into "Template not found".

**Real-world example**: Agent-session update hints fetched npm `latest` metadata with `response.read(4096)` and then parsed it as complete JSON. The `@chinhae/atw-cli` package metadata exceeded 4 KB, so the JSON was truncated, parse failed silently, and the first session injection showed no update hint. Fix: read the complete response before parsing, and add a regression where `version` is followed by an 8 KB metadata tail.

---

## Cross-Platform Template Consistency

In ATW, command templates (e.g., `record-session.md`) exist in **multiple platforms** with identical or near-identical content. This is a cross-layer boundary.

### Checklist: After Modifying Any Command Template

- [ ] Find all platforms with the same command: `find src/templates/*/commands/atw/ -name "<command>.*"`
- [ ] Update all platform copies (Markdown `.md` and TOML `.toml`)
- [ ] For Gemini TOML: adapt line continuations (`\\` vs `\`) and triple-quoted strings
- [ ] Run `/atw:check-cross-layer` to verify nothing was missed

**Real-world example**: Updated `record-session.md` in Claude to use `--mode record`, but forgot iFlow, Kilo, OpenCode, and Gemini — caught by cross-layer check.

---

## Generated Runtime Template Upgrade Consistency

Some generated files are both documentation and runtime input. In ATW,
`.atw/workflow.md` is parsed by `get_context.py`, `workflow_phase.py`,
SessionStart filters, and per-turn hooks. Template changes must be validated
against both fresh init and upgrade paths.

### Checklist: After Modifying A Runtime-Parsed Template

- [ ] Identify every runtime parser that reads the template, not just the file
  writer that installs it
- [ ] Check whether relevant syntax lives outside obvious managed regions
  such as tag blocks
- [ ] Verify fresh `init` output and a versioned `update` scenario that writes
  the older `.atw/.version`
- [ ] Add an upgrade regression using an older pristine template fixture, then
  assert the installed file reaches the current packaged shape
- [ ] Update the backend spec that owns the runtime contract

**Real-world example**: Codex inline mode changed workflow platform markers from
`[Codex]` / `[Kilo, Antigravity, Windsurf]` to `[codex-sub-agent]` /
`[codex-inline, Kilo, Antigravity, Windsurf]`. Fresh init was correct, but
`atw update` only merged `[workflow-state:*]` blocks and preserved stale
markers outside those blocks. Result: upgraded projects got new hook scripts
but old workflow routing, so `get_context.py --mode phase --platform codex`
could return empty Phase 2.1 detail.

---

## Mode-Detection Probe Checklist

When a CLI auto-detects a mode by probing a remote resource (e.g., checking if `index.json` exists to decide marketplace vs direct download):

### Before implementing:
- [ ] Probe runs in **ALL** code paths that use the result (interactive, `-y`, `--flag` combos)
- [ ] 404 vs transient error are distinguished — don't treat both as "not found"
- [ ] Transient errors **abort or retry**, never silently switch modes
- [ ] Shared state (caches, prefetched data) is **reset** when context changes (e.g., user switches source)
- [ ] **Shortcut paths** (e.g., `--template` skipping picker) must have the same error-handling quality as the probed path — check that downstream functions don't call catch-all wrappers

### After implementing:
- [ ] Trace every path from probe result to the mode-decision branch — no fallthrough
- [ ] External format contracts (giget URI, raw URLs) are tested or at least documented as comments
- [ ] Metadata reads consume a complete response or use a streaming parser — never parse a fixed-size prefix as full JSON
- [ ] When reconstructing a composite identifier from parsed parts, verify **all** fields are included and in the **correct position** (e.g., `provider:repo/path#ref` not `provider:repo#ref/path`)
- [ ] Verify that **action functions** called after a shortcut don't internally use the old catch-all fetch — they must use the probe-quality variant when error distinction matters

**Real-world example**: Custom registry flow had 8 bugs across 3 review rounds: (1) probe only ran in interactive mode, (2) transient errors fell through to wrong mode, (3) giget URI had `#ref` in wrong position, (4) prefetched templates leaked across source switches, (5) `--template` shortcut bypassed probe but `downloadTemplateById` internally used catch-all `fetchTemplateIndex`, turning timeouts into "Template not found".

**Real-world example**: Agent-session update hints fetched npm `latest` metadata with `response.read(4096)` and then parsed it as complete JSON. The `@chinhae/atw-cli` package metadata exceeded 4 KB, so the JSON was truncated, parse failed silently, and the first session injection showed no update hint. Fix: read the complete response before parsing, and add a regression where `version` is followed by an 8 KB metadata tail.

---

## Product Identity Literals

A product's own name, bundle id, URL scheme and CLI binary name are a cross-layer
contract with no type system behind it. Each one is hardcoded as a plain string in
layers that cannot import each other — TypeScript source, a YAML packaging config, an
Expo JS config, shell shims, CI workflow steps, a Nix derivation, native Gradle/podspec
metadata. Change one site and the build still succeeds; the failure shows up only in the
packaged artifact, or in CI, or in a user's install.

### Checklist: Before changing a display name, bundle id, URL scheme, or binary name

- [ ] **Packaging config** — `electron-builder.yml` (`appId`, `productName`,
      `executableName`, `protocols`, every `artifactName`, `executableArgs`,
      `extraResources`), `packages/app/app.config.js`, `eas.json`.
- [ ] **Runtime code that must agree with the artifact** — Electron `app.setName` /
      `setDesktopName` / `--class`, the deep-link scheme constant, the daemon's CORS
      allowlist for the packaged renderer, diagnostics redaction regexes.
- [ ] **Names derived by a third party from your id** — Squirrel's
      `<appId>.ShipIt` cache directory, the deb/rpm package name derived from
      `productName`, `Contents/Frameworks/<productName> Helper.app`, the
      `<executableName>.desktop` entry.
- [ ] **Build hooks** — `afterPack` / `afterSign` scripts that locate the bundle by
      name, Linux launcher installers.
- [ ] **Shell shims and their bundle lookups** — `packages/desktop/bin/*`,
      `packages/cli/bin/*`, and the code that resolves `<pkg>/bin/<name>` at runtime.
- [ ] **CI steps that name the artifact** — bundle assertions, `dpkg --remove <pkg>`,
      release asset names, release titles.
- [ ] **Nix derivations** — `pname`, wrapper binary names, `mainProgram`, desktop items,
      `startupWMClass`, the `Foo.app` search in the darwin install phase.
- [ ] **Device automation** — maestro flows and agent-device specs target the installed
      app id; they silently target a nonexistent app after a `packageId` change.
- [ ] **Tests whose fixtures model the real bundle layout** — they keep passing with
      stale names and then stop describing reality.
- [ ] **Published package READMEs** — they ship to npm with the package, so they are
      part of the identity, not docs.
- [ ] **Local Expo modules under `packages/app/modules/`** — seven sites per module, none
      of them typed: Gradle project name (from `package.json` `name`, not the directory),
      `namespace`/`group`, the Kotlin source path against its `package` declaration, the
      `expo-module.config.json` class lists, the podspec **filename** (that, not `s.name`,
      is the Swift module name), the CMake target against `System.loadLibrary`, the JNI
      `METHOD` macro prefix, and `Name("…")` on *every* platform the module ships against
      the literal the app's TypeScript looks up. The contract table and the test that
      enforces it are in
      [app/frontend Directory Structure](../app/frontend/directory-structure.md#local-native-modules-live-outside-src).

### The forms a search-and-replace misses

A replace rule written around "what character comes before the name" misses every
escaped or line-anchored spelling of it. In the Paseo → Osuna rename these got through a
rule that required the name to follow `/`, `"`, `'` or a backtick, and only tests and a
failed build caught them — two of them were **production regressions**:

- **Regex-escaped** — `/[/\\]\.paseo[/\\]worktrees[/\\]/` in `checkout-git.ts` and
  `/(^|\/)\.paseo\/worktrees(\/|$)/` in `agent-working-directory-suggestions.ts`. The
  daemon had already moved to `.osuna/worktrees`, so worktree ownership silently stopped
  matching. Also `/Failed to parse paseo\.json at .*paseo\.json/` in a test, and
  `s/^appId: sh\.paseo$/` in a Maestro shell script.
- **Windows backslash paths** — `"C:\\Users\\me\\repo\\.paseo\\worktrees"`,
  `$env:USERPROFILE\.paseo\models\local-speech`.
- **Line-anchored** — `.paseo/` alone on a line in `.gitignore`. Nothing precedes it, so
  the daemon's new `.osuna/worktrees` briefly stopped being ignored.
- **Inside prose strings** — `"Could not deploy .paseo/triggers/z-help.yml"`,
  `"- .paseo/triggers/slack-help.yml"`, where a space or `- ` precedes the name.
- **Segment-wise parsing** — `packages/server/src/server/auth.ts` splits the WebSocket
  subprotocol and compares `segments[0] === "paseo"`, so replacing the joined string
  `paseo.bearer.` in the *producer* silently broke password auth until the parser moved too.
- **Object keys in schemas, not just string literals** — `isPaseoOwnedWorktree` and
  `paseoTools` are wire field names in `packages/protocol/src/messages.ts`. A sweep for
  `"paseo"` string literals reports the protocol package as clean.
- **Files with no extension** — `docker/base/rootfs/usr/local/bin/osuna-docker-entrypoint`
  was skipped by a glob list of `*.ts`, `*.yml`, `Dockerfile*`, so the container kept
  defaulting to the old port while the image published the new one.

Conversely, do **not** blind-replace in generated or minified assets: `6767` appears in
`mermaid/runtime/html.gen.ts` as a font metric (`.86767`) and a colour
(`peachpuff:16767673`), and in `terminal-emulator-webview-html.ts` as SVG path
coordinates. Replacing those corrupts the bundle.

### The sweep corrupts text whose subject is the old name

Some text is *about* the old name, so replacing it destroys the meaning instead of updating it.
A sweep cannot tell the difference; only reading the hit can.

- **A comment written to explain the old name.** The `COMPAT(plugin-requirements)` note in
  `packages/protocol/src/plugin-requirements.ts` explained that plugins declaring
  `requirements.paseo` get rejected. After the sweep it read "they declare `requirements.osuna`,
  never `requirements.osuna`" and told the reader not to add a `requirements.osuna` fallback —
  a tautology plus a warning against the field the code already reads. Negative information.
- **Version-pinned historical docs, where the old name is correct.** `public-docs/plugins/v0.7/`
  documents Paseo v0.7. The sweep changed two lines to `osuna-plugin.json`, making the doc claim
  v0.7 required a manifest that only exists in the fork. Reverted, not renamed.
- **Docs quoting an error string verbatim** so users can grep for it. The half-migration table in
  `public-docs/plugins/v0.8/migration.md` quotes runtime error text. The quote has to match the
  code character for character, so it moves only when the code's string moves — and it moves
  *with* it, or the table stops matching anything.

### A binary name has no compile-time consumer

Renaming the CLI binary (`paseo` → `osuna` in `packages/cli/package.json`'s `bin`) changed
nothing the type system checks: every consumer *spawns* it by name. Typecheck, lint and the
whole suite stayed green while terminal activity reporting for OpenCode was dead. Four shapes,
all from the same rename:

- **A generated runtime template, half migrated.** `agent-hooks/opencode/opencode-plugin.ts`
  builds the plugin OpenCode loads. An earlier batch updated the env var it reads
  (`OSUNA_TERMINAL_ID`) but left `Bun.spawn(["paseo", …])` two lines below. A modern literal
  sitting next to a stale one in the same template looks deliberate, and nothing makes them
  agree. Read the whole generated body, not the line you came for.
- **The tests pinned the broken behaviour.** `opencode.test.ts` asserted the spawn argv was
  `["paseo", "hooks", …]` and `claude.test.ts` wrote a fake binary *named* `paseo`. Updating
  those assertions is not evidence of a fix — see the default-branch rule in
  `.atw/spec/server/backend/testing.md`.
- **A fallback nothing executes.** `"${OSUNA_HOOK_CLI:-paseo}"` and the cmd branch
  `else (paseo …)` in `agent-hook-installer.ts` only run when the daemon did not inject
  `OSUNA_HOOK_CLI` — which the common path always does, so the stale name sat behind a branch
  no test entered.
- **Silent degradation, no failure.** `paseoCliShimNames()` returned names npm would never
  create in `node_modules/.bin`, so `findNpmBinDir` returned null forever and
  `resolveOsunaCliExecutablePath` fell through to the package entrypoint. Nothing broke; the
  shim preference simply stopped existing.

Today the contract is one env key with one fallback name, written in three languages that
cannot import each other — POSIX sh and cmd in `agent-hook-installer.ts`, and generated
JavaScript in `opencode-plugin.ts`. A rename has to move all three, plus
`osunaCliShimNames()` and `OSUNA_CLI_BIN_ENTRY` in `terminal/terminal.ts`.

### One message, two producers

`requirements.osuna` rejections are raised in two places: `plugin-requirements.ts` (range check)
and `plugins/runtime.ts` (pre-0.8 entry layout). Renaming one left the other emitting the old
product name and the old migration URL, and three test files asserting the old string kept
passing because they matched the stale producer. Before rewriting user-facing error text, grep
for the URL or a distinctive phrase from it — not for the identifier you are renaming.

### Renaming a file moves more than its imports

`plugin-paseo-api.e2e.test.ts` → `plugin-osuna-api.e2e.test.ts` has no importers, so typecheck
and lint stayed green. `packages/server/package.json`'s `test:integration` script names the file
as a literal path; the rename alone would have broken it silently, since that script is not part
of the default suite. Grep the bare filename across `package.json`, CI YAML and docs, not just
the import graph.

### A generic rule can invent an identifier worse than either name

A rule keyed on "a letter precedes the name" turned `github.com/getpaseo/paseo` into
`github.com/getpaseo/osuna` — upstream owner, new repo name, a URL that has never existed and
never will. Half-renamed identifiers are worse than either endpoint because they look
deliberate. Replace whole known compounds (full URLs, package names, scoped names) **before**
running any generic rule, so the generic rule never sees them.

That advice was written down and then broken again in batch 4, by an author who had just read
it. A `paseo` → `osuna` pass over the docs produced, in one run: `github.com/getosuna/osuna`
(an organization that has never existed), the domains `osuna.sh`, `app.osuna.sh` and
`hub.osuna.sh` (none registered), a doc calling the **upstream** relay repo "the official Osuna
relay", and a README fork notice reading *"Osuna is a fork of Osuna"*. Every one of them
typechecks, lints and reads fluently. The lesson is not "be careful" — it is mechanical:

- **Protect before you sweep.** Substitute every must-not-change token for a placeholder first,
  run the generic rule, then restore. The protect list is the interesting artifact: it holds the
  old name's *legitimate* appearances, and writing it forces you to enumerate them.
- **Three kinds belong on that list**: text whose subject is the old name (a fork notice, a
  rename changelog, this guide); factual references to upstream assets (their repo, their issue
  links, their hosted services); and docs describing code that **still** carries the old name,
  where renaming the doc makes it a lie.
- **Grep for what the sweep could have invented**, not only for what it should have changed. A
  rename is finished when both `rg <old>` and `rg <new-org>/<new-repo>`-style probes for
  fabricated compounds come back clean.

### Docs cannot be renamed ahead of the code they describe

A doc citing `paseo.pid` or `paseoHome` is *correct* while the code still spells them that way.
Sweeping the doc "for consistency" produces a document that describes software nobody is
running, and the error is invisible: nothing links docs to identifiers. Before renaming any
identifier inside prose, grep the code for both spellings and rename the doc only where the code
has already moved. In batch 4 this check reversed the direction of the work twice — 89 `PASEO_*`
environment variables in docs were stale and had to move, while `paseo.pid`,
`paseo.parent-agent-id` and `paseoHome` were current and had to stay.

Run the check the other way too: a doc citing a value the code no longer has is how batch 4
found a missed `DEFAULT_HUB_ORIGIN = "https://hub.paseo.sh"` that the ticket's "relay / Hub
defaults" item had asked for and the implementation had skipped. **The documentation sweep is a
consistency check on the code**, not a cosmetic pass over it.

### A ticket that cites line numbers renames only those lines

Batch 8's ticket said: rename the timeline step name at `worktree-bootstrap.ts:360,371,381`. All
three were renamed, and the sweep for that exact literal came back clean. Thirty lines below,
`buildTerminalsTimelineItem` emitted `paseo_worktree_terminals` from the same file, built the same
kind of synthetic `tool_call`, and went untouched — the ticket had never named it, and a grep for
the literal the ticket *did* name cannot find it.

It was the worse of the two to miss. `..._setup` carries a typed `detail.type`, so every app-side
consumer dispatches on that and never reads `name`; `..._terminals` has `detail.type: "unknown"`,
so `buildToolCallDisplayModel` falls back to `humanizeToolName(name)` and renders the raw string.
The user would have seen "Paseo worktree terminals" sitting next to a renamed "Osuna worktree
setup" in one bootstrap flow.

**Grep the shape, not the string.** When a ticket names line numbers, treat them as an entry point:
read the whole producer, and search for siblings by their *construction* (here, `name: "` inside a
`type: "tool_call"` literal) before trusting that the named lines were all of them.

### "Cannot read it" is not "it is not there"

The same batch added a read-only shim so a renamed daemon would still notice a lock file left under
the old name. The first draft wrote `await readPidLock(legacyPath).catch(() => null)` — which
`.atw/spec/server/backend/error-handling.md` forbids verbatim ("`catch (e) { return null }` is
forbidden"), and which defeated the shim precisely where it mattered: `readPidLock` returns `null`
only for ENOENT and *throws* for EACCES, a truncate window, or corrupt JSON. A lock you cannot read
is not proof that nobody holds it, so the catch turned the one case the shim existed for into
"no instance running" and would have started a second daemon on the same port and agent store.

An interlock must fail closed. When a shim's whole job is to detect something, the unreadable case
belongs with "detected", not with "absent" — and it needs its own test, or the branch is both
untested and wrong at the same time, each hiding the other.

### A renamed file leaves a live orphan in `dist/`

Renaming `paseo-config-schema.ts` → `osuna-config-schema.ts` left `dist/paseo-config-schema.js`
behind: `tsc` writes new output but never deletes stale output, and `dist/` is gitignored, so
every source-level check passed. Five CLI test files then failed with
`Cannot read properties of undefined (reading 'optional')` — the orphan was still being loaded
and still exporting the old names. `rg` over tracked files reported the rename as complete.

**A source-level sweep cannot prove runtime correctness**: an unversioned build artifact sits
between them. After renaming or deleting any file whose output ships, run the package's
`build:clean` (or delete `dist/`) before trusting a test run, and treat
`ls dist | grep <old-name>` as part of the acceptance.

### Tool pitfalls when scripting the sweep

- `git grep -E` is POSIX ERE: **`\b` does not work**. A file list built with
  `git grep -l -E '\bfoo\b'` comes back silently empty, so the replace appears to
  succeed while touching nothing. Use `git grep -P`, or grep the bare name and filter.
- **zsh does not word-split unquoted parameters.** `python3 rename.py $TOKENS` passes all 78
  tokens as one argument under zsh (it works under bash), so every `\b<ident>\b` pattern is a
  single impossible string and the script reports `0 处改动` instead of failing. Silent false
  success again. Pass a token *file* (`@tokens.txt`) rather than relying on the shell's
  splitting rules, and make the script print how many tokens it parsed.
- `xargs sed -i ''` aborts the whole batch on the first unusable path. A symlink
  (`AGENTS.md` → `CLAUDE.md`) stopped a 379-file rename after 7 files. Loop per file, skip
  symlinks, and count what you changed.
- An audit that compares removed vs added diff lines proves the lines you *did* change are
  brand-only. It cannot see a line you failed to change — `.gitignore` passed that audit
  while still holding `.paseo/`. Pair it with a full-text sweep for the old name.
- A batch loop that calls `read_text()` dies on the first binary file. PNG screenshots under
  `plugin-examples/` raised `UnicodeDecodeError` mid-loop and abandoned the rest of the batch
  with no summary. Catch per file, skip, and report what was skipped.
- Object property shorthand hides a rename. `requirements: paseo === undefined ? undefined : { osuna }`
  typechecks wherever *some* `osuna` is in scope and silently asserts the wrong value; where
  nothing is, it is an undefined identifier that neither typecheck nor lint reports in a server
  test file (see `.atw/spec/server/backend/testing.md`). Rename the parameter and the shorthand
  in one edit.

### The rule

For any identity string that more than one TypeScript layer reads, export it once from
the lowest shared package and import it. Static config (YAML, Expo JS, Gradle) cannot
import, so it stays hardcoded — which means **a test must assert the config and the code
agree**. `packages/desktop/src/daemon/desktop-packaging.test.ts` is the model: it reads
`electron-builder.yml` and asserts the scheme and protocol name.
`packages/app/src/native/local-native-modules.test.ts` is the same shape for Gradle, CMake,
JNI, podspecs and `expo-module.config.json`.

Write the assertion data-driven over the directory, not per known name. Both tests above
enumerate what is on disk, so a module or artifact added later is covered without anyone
remembering to extend the test — and the assertion stays a contract rather than a snapshot
of today's names.

**Real-world example**: renaming Paseo to Osuna. `productName` changed in
`electron-builder.yml`, but `after-pack.js` and `after-sign.js` still had
`const EXECUTABLE_NAME = "Paseo"`, so the local desktop build would have failed at the
pack hook, and `desktop-packages.yml`'s `dpkg --remove paseo` would have failed in CI.
The URL scheme lived in five places across protocol, desktop, server, Expo config and
the packaging YAML; changing only the YAML would have shipped a packaged app whose
renderer the daemon's CORS allowlist rejects.

---

## When to Create Flow Documentation

Create detailed flow docs when:

- Feature spans 3+ layers
- Multiple teams are involved
- Data format is complex
- Feature has caused bugs before

---

## Event Log / Projection Boundary

Append-only logs are cross-layer contracts. A single event travels through:

```
CLI input → event writer → events.jsonl → reader → filter → reducer → display
```

### Checklist: After Adding A New Event Kind Or Field

- [ ] Add the event kind to the central event taxonomy
- [ ] Add a typed event variant or type guard at the event layer
- [ ] Add normalization helpers for array/object fields that come from
      user input or JSON
- [ ] Keep `seq` / `id` assignment in the event writer only
- [ ] Make filters and reducers consume the typed event guard, not local casts
- [ ] Make display code consume reducer output or typed events, not raw JSON
- [ ] Add at least one regression that proves history replay and live filtering
      use the same filter model

**Real-world example**: Thread channels added `kind: "thread"`, `description`,
`context`, labels, and `lastSeq`. The first implementation replayed thread
state correctly, but several commands still re-parsed event payload fields with
local casts. The fix was to make the core event layer own `ThreadChannelEvent`
and `isThreadEvent`, make `reduceChannelMetadata` the only channel metadata
projection, and make `reduceThreads` the only thread replay reducer.
