# Activating an API endpoint rewrites the CLI's own config

An **API endpoint** switches Claude Code or Codex itself, so the daemon writes the endpoint into the CLI's own config files: `~/.claude/settings.json` for Claude, `~/.codex/config.toml` for Codex. The terminal CLI follows the switch too. We chose this because a user on a third-party endpoint rarely also uses the subscription, and one switch that holds everywhere is simpler than two setups side by side. The daemon writes only the keys it owns and leaves every other byte alone, because Claude Code, Codex, other tools, and Osuna's own terminal hooks all write to these files.

The rules, most of them learned from incidents in cc-switch (MIT), whose `live/` module is the reference:

- Before the first write, record the original value of each owned key. Switching back to **Official** restores those values, not an empty default, so a relay the user configured by hand comes back. If the file did not exist before the first write and nothing but the daemon's keys is left in it, switching back deletes it.
- Replace the file atomically and keep its permission bits. Do not change the permissions of its directory.
- Take one byte-for-byte copy of each file before its first managed write. It is for manual recovery only. Never restore it automatically.
- If a file does not parse, write nothing to any file.
- Hash the file before computing the patch, and re-read it just before the atomic rename. If it changed, recompute on the new content. Stop with a conflict after three tries.
- If the owned keys no longer hold what the daemon wrote, show "modified externally". Let the user re-apply or switch to Official. Never overwrite silently.
- Codex gets its key from `model_providers.<id>.auth.command`, which reads a 0600 file the daemon owns. `~/.codex/auth.json` is never read or written, so ChatGPT logins and account switching are untouched and no refresh token can be rolled back. This needs Codex 0.118.0 or later.
- On Claude, write `ANTHROPIC_AUTH_TOKEN` and set `ANTHROPIC_API_KEY` to empty. Both keys are owned and restored.
- On Claude, turn WebSearch off with a `"WebSearch"` entry in `permissions.deny`. WebSearch runs on Anthropic's servers, third-party endpoints reject it, and Claude Code has no environment variable that removes it, only permission rules. The entry is owned only when the daemon added it. A `"WebSearch"` rule the user already wrote stays after switching back.
- Edit `settings.json` with `jsonc-parser`'s `modify`, which replaces only the edited property. A line the daemon inserts into is re-indented to the file's own indentation, so a compact one-line object that receives a new key comes back multi-line.
- Switching back to Official leaves the Codex `[model_providers.<id>]` table in place and restores only the top-level `model_provider` and `model`. Codex groups sessions by provider id, so deleting the table would make third-party sessions impossible to resume. The table goes only when the endpoint itself is deleted. Editing that endpoint while Official rewrites the table and the key file, so a resumed session reaches the new URL and key.
- Edit `config.toml` by splicing text at node positions from `toml-eslint-parser`, which also validates TOML 1.0 strictly. A replaced top-level value keeps its line and trailing comment, and a restored one gets back its original spelling, quotes included. The dedicated table is generated whole and appended at the end of the file. After every edit the result is parsed again, and a file that would not come out valid, such as one that declares `model_providers` as an inline table, is refused like an unparsable one. `smol-toml` re-serializes the whole file. `@decimalturn/toml-patch` preserves formatting but treats the comment above a key as part of that key, so it drops the user's comment when it removes a key it inserted underneath. The `toml_edit` WASM bindings would add a WASM asset to the daemon bundle.
- The dedicated Codex provider id is `osuna_api_endpoint`. Custom provider ids must match `[a-z][a-z0-9-]*`, so the provider config a custom Codex provider injects per request can never merge into this table. The id is not one of Codex's reserved ids either.

## Considered Options

- **Side by side through custom providers:** each endpoint becomes its own provider row and reaches the CLI only through its process environment. Rejected: `settings.json` `env` overrides process env, so a relay the user already configured by hand would win.
- **Side by side with a separate `CLAUDE_CONFIG_DIR` per endpoint** (t3code). Rejected: the user would maintain two copies of skills, CLAUDE.md, permissions, and hooks.
- **Side by side through the Agent SDK `settings` flag layer**, which outranks user and project settings. Rejected once the user chose a single switch over coexistence. Reconsider this option if side by side is ever wanted again.
- **Snapshot the whole file and restore the snapshot** (desktop-cc-gui). Rejected: this wipes every later edit to the file. For Codex it restores an old `auth.json` whose single-use refresh token has already been spent.
- **Stash and delete `auth.json` while third-party is active** (cc-switch default). Rejected: `auth.command` makes touching the file unnecessary.
- **Bundle or drive cc-switch itself.** Rejected: it is a Rust desktop app with no headless mode, and the switch has to run in the daemon so phones and remote clients can use it.

## Consequences

- Claude Code re-applies `settings.json` `env` to sessions that are already running, so a switch takes effect in live sessions immediately. The switch confirmation names how many running sessions it affects.
- A session started under one mode and resumed under the other may fail on a model id. The daemon records the mode each agent session started in so it can warn.
- Tools that rewrite the same files, such as cc-switch, will fight with this feature. External-change detection is the only defence.
