# Account rotation reads and writes the CLI's own login, and signs Codex accounts in as Codex

**Rotate accounts** keeps Codex and Claude Code signed in to an **Account** with room by swapping the login the CLI keeps for itself, so a terminal CLI follows the switch as well as the sessions Osuna starts. That cannot be done under two rules written for **API endpoints**: [ADR 0004](0004-api-endpoint-rewrites-cli-config.md) says `~/.codex/auth.json` is never read or written, and [ADR 0010](0010-codex-wiring-and-gateway-caller-recognition.md) says Osuna learns how Codex is signed in from Codex's app-server, never by reading `auth.json`. It also steps outside the parent task's rule 15, that every request Osuna sends itself carries Osuna's own identity (task `10-16-magpie-osuna-gaps`, `prd.md`, Implementation Decisions 15), which left the case of Osuna renewing a login on the CLI's behalf to this sub-task. This ADR replaces the parts of ADR 0004 and ADR 0010 that conflict with rotation and records three more exceptions to rule 15, after those in [ADR 0013](0013-osuna-reads-other-apps-and-tests-as-the-cli.md). It follows magpie (MIT).

The facts behind this are in task `10-16-multi-account-rotation`: `research/cli-login-mechanics.md` (Codex source `970111f6`, Claude Code docs and package strings), `research/magpie-rotation.md` (magpie HEAD `d5805372`) and `research/osuna-current-state.md`. The decisions are `research/decisions.md` Q6, Q7 and Q14 for the identity exceptions, Q2 and Q17 for where logins live, Q22 for removing the account in use, and Q25 for what running sessions do after a switch.

## What this replaces in ADR 0004

- **"`~/.codex/auth.json` is never read or written, so ChatGPT logins and account switching are untouched and no refresh token can be rolled back."** While **Rotate accounts** is on for Codex, Osuna reads and writes Codex's stored login: `$CODEX_HOME/auth.json` (`~/.codex` when the provider's environment sets no `CODEX_HOME`) when `cli_auth_credentials_store` is `file`, and the Keychain item `Codex Auth`, account `cli|<first 16 hex of sha256(CODEX_HOME)>`, when it is `keyring` or `auto` (Codex `login/src/auth/storage.rs:256-269`, magpie `codex_store.go:597-635`). With `ephemeral`, or a store Osuna cannot read, rotation refuses to switch and says why. The danger the old rule guarded against, a single-use refresh token written back after it was spent (Codex `manager.rs:1750-1771` treats `refresh_token_reused` as permanent), is now carried by [one login, one holder](#one-login-one-holder). The rest of ADR 0004's rewrite rules apply to these writes: only the login itself changes, the file is replaced atomically with its permission bits kept, the store is re-read right before each write, and a store that does not parse is not written.

The rejection of "Snapshot the whole file and restore the snapshot" in ADR 0004 stands: a switch moves one login between holders and never restores an older copy.

## What this replaces in ADR 0010

- **"…which Osuna learns from Codex's own app-server, never by reading `auth.json`."** The wiring check still asks the app-server how Codex is signed in. The "never" no longer holds: rotation reads the stored login to take back the account in use before a switch, to renew it, and to read its plan usage. The Codex plan usage source already read `auth.json` for its token (`plugins/codex-usage-source/server/usage.ts:84-92`).

## One login, one holder

This is magpie's rule (`internal/provider/logins.go:3-9`):

- The account in use has its login only in the CLI's own store. Osuna's account store keeps its profile, not a second copy of its tokens.
- A stored Codex account has its tokens only in Osuna's account store. A stored Claude account has its login only in its own private `CLAUDE_CONFIG_DIR` under the account store.
- A switch first takes the CLI's current login, the newest copy, back into that account's record, then writes the target account's login into the CLI's store, then clears the target's copy on Osuna's side. All of it runs under a cross-process lock, re-reading before each write.
- Removing the account in use deletes only Osuna's record of it and never signs the CLI out.

Claude Code's stored login follows the same rules and ADR 0004's rewrite rules: on macOS the Keychain item `Claude Code-credentials`, with `-<first 8 hex of sha256(CLAUDE_CONFIG_DIR)>` when the provider's environment sets one, account `$USER`; elsewhere `.credentials.json` in the config folder; and only the `oauthAccount` key of `.claude.json` (`research/cli-login-mechanics.md`; magpie `logins.go:1268-1310`, `claude_dirs.go:1-60`).

## Identity exceptions

Rule 15 holds everywhere else, with the exceptions in [ADR 0013](0013-osuna-reads-other-apps-and-tests-as-the-cli.md). These three are the user's choices:

1. **Codex logins are renewed with Codex's OAuth client identity** (Q6). Osuna sends `POST https://auth.openai.com/oauth/token` with Codex's client id `app_EMoamEEZ73f0CkXaXp7hrann` (Codex `manager.rs:214-215,3311-3328`; magpie `account.go:941-945,1118`), for the account in use within 5 minutes of its access token expiring or on a 401 `token_expired`, writing the result back to the CLI's store, and for stored accounts when they are used and once every 24 hours (magpie `keepalive.go:26,40-75`).
2. **Codex accounts are added by Osuna running the OAuth sign-in itself** with Codex's client identity: PKCE, Codex's client id, the callback on `127.0.0.1:1455`, and `originator=codex_cli_rs` (Q7; magpie `signin.go:40-45,340-366`). When the port is taken, the user pastes the address the browser ended on.
3. **Codex plan usage keeps upstream Paseo's browser `User-Agent`** (`Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)`, `plugins/codex-usage-source/server/usage.ts:230`), and stored accounts read their plan usage through the same code (Q14). The string came with upstream community contribution #1278 (`acea7f3d2`) with no stated reason. Keeping it leaves fewer conflicts when merging upstream, and no difference in use is known between it, `Osuna/<version>`, magpie's `Go-http-client/1.1` and Codex's own `codex_cli_rs/…`.

Claude Code has no exception. Accounts are added by running the real `claude auth login` in a new private `CLAUDE_CONFIG_DIR`, with Osuna catching the sign-in address and opening the browser (magpie `claude_signin.go:1-50`). Osuna never renews a Claude token and never calls Anthropic's sign-in service: Claude Code renews its own logins, a stored account's when Osuna runs the real `claude -p /usage` in its private folder to read its plan usage (magpie `claude_dirs.go:1-60`, `claude_warmup.go:85-125`). The account in use reads its plan usage through the existing Claude plan usage source.

## Considered Options

- **Run the real Codex app-server in a private `CODEX_HOME` per account**, signing in with `account/login/start` and renewing and reading plan usage with `account/rateLimits/read` (Codex `app-server-protocol/src/protocol/common.rs:1320-1384`, `account_processor.rs:595-740`; Codex's own test client suggests this, `app-server-test-client/README.md:26-55`). This was the assistant's recommendation. Rejected: the user chose to follow magpie (Q6, Q7).
- **Report Osuna's own identity on plan usage requests** (`Osuna/<version>`, as Osuna's reset-credit requests to the same host already do, `plugins/codex-usage-source/server/resets.ts:7-9`). This was the assistant's recommendation for Q14. Rejected: the user chose to keep upstream's string for easier merges (Q14).
- **Keep ADR 0004's rule and rotate through a separate `CODEX_HOME` or `CLAUDE_CONFIG_DIR` for Osuna's sessions.** Rejected: terminal CLIs would not follow the switch, and sessions and settings would split between two folders (Q2).

## Consequences

- Osuna holds the tokens of every stored Codex account in plain text under `$PASEO_HOME`, kept like the API endpoint key file: folder 0700, file 0600, atomic replace, last good copy kept (Q17).
- A Codex process already running stays on the account it started with (Codex `manager.rs:1926-1934,2053-2090`). If it renews that account after a switch, Codex cannot write the new token back, and Osuna's copy of the old account may need signing in again. Accepted and written into the user docs (Q25).
- A running Claude Code process may pick up the new login the next time its token stops working, because it adopts whatever the store holds on a 401.
- The identity check in the parent task's acceptance criteria lists these three exceptions instead of failing on them.
