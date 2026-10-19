# Osuna reads other apps' configs, takes import links, and tests as the CLI

The parent task's rule 15 says Osuna's own requests carry Osuna's identity: no borrowed client ID, `User-Agent` or `originator`, and nothing rewritten to get past a vendor's checks. Requests the CLI sends through the **Gateway** keep the CLI's look. Task `10-16-endpoint-management-ux` adds three things that step outside that rule, all chosen by the user on 2026-10-19 (`research/decisions.md` R1-Q16, R2-Q5, R2-Q10, R2-Q11, R3-Q1):

- Osuna reads other apps' configs on the host, keys included, to offer them for **Import**.
- The desktop app takes `paseo://import?...` links that add an endpoint, key included.
- The gateway records the headers Claude Code and Codex send, and **Test models** can send an Osuna-made test request with them: "Test as Claude Code" and "Test as Codex".

The reason for all three is that magpie (MIT, at `7597c132`) does them and the user's relays need them. sub2api-style groups admit only one CLI (sub2api's `ClaudeCodeOnly` matches `^claude-cli/\d+\.\d+\.\d+`; other relays answer "This account only allows Codex official clients"). A key in such a group works for the CLI through the gateway, as [ADR 0008](0008-gateway-reshapes-rejected-requests-and-fails-over-refusals.md) keeps the CLI's own headers, but an ordinary test from Osuna is turned away, so the endpoint looks broken when it is not. Reading configs and import links saves typing a relay in twice. Everything below is magpie's unless it says otherwise.

## Reading other apps' configs

- The daemon reads files on its own host and never writes them: CC Switch's `~/.cc-switch/cc-switch.db` (its `config.json` when there is no database), Claude Code's `settings.json`, Codex's `config.toml`, Alma's `chat_threads.db` and OpenCode's `auth.json`. Databases are opened read-only.
- While Osuna has taken over Claude Code, the import reads the original values [ADR 0004](0004-api-endpoint-rewrites-cli-config.md) recorded, not the gateway Osuna wrote there.
- Opening the API endpoints page scans every source except OpenCode, at most once a minute, and the page tells the user how many new ones it found. OpenCode is read only when the user opens the import dialog, because its `auth.json` holds every sign-in OpenCode has, not only keys.
- Keys stay in the daemon. The client gets each entry with its key masked and a fingerprint, and the daemon looks the key up by fingerprint when the user imports. "Ignore" stores the fingerprints of that batch, never a key.

## Import links

- Only the desktop app takes them, through the `paseo` scheme it already registers ([ADR 0002](0002-rename-stops-at-app-identity.md)). With the official Paseo desktop app also installed, the system may hand the link to Paseo instead.
- A link never saves anything by itself. The confirmation dialog names the hosts that would get the user's prompts and the key, lets the user change the name and the key, and warns separately when the link would replace an endpoint the user has. It adds to the host the window is showing; a host without `apiEndpointManagement` gets "update the host" instead.
- Refused, with the reason shown: a base URL that is not https, except plain http to this machine or the local network; a URL with an account, a query or a fragment; a key over 4096 bytes or with control characters; an unknown template; Vertex; a link with no base URL. A name is cut to 80 bytes and models to 200. `gemini` URLs are ignored until Osuna has a Gemini format.

## Testing as the CLI

- Each time the gateway passes on a request from Claude Code or Codex, it keeps that request's identifying headers as the CLI's latest sample, in a file in the daemon's API endpoint directory. It keeps only headers that say which CLI it is (Claude Code: `User-Agent`, `x-app`, `anthropic-*`, `x-stainless-*`, `x-claude-code-*`; Codex: `User-Agent`, `originator`, `version`, `x-codex-*`, `x-openai-*`). It drops any header naming a session, thread, conversation, turn, request id, subagent, auth, API key or attestation, and `anthropic-beta`. A sample without a `User-Agent` is not kept. Bodies are never stored.
- The sample is sent only when the user presses "Test as Claude Code" or "Test as Codex". Normal tests, model listing and every other request Osuna makes keep Osuna's own identity.
- "Test as Claude Code" uses the Anthropic format only, and only for relay services: endpoints added from a template in the relay group, or with "Custom". Osuna never sends Claude Code's headers to a vendor's own API (magpie excludes Anthropic, Google, Bedrock and Azure by host; Osuna goes by template group). Without a sample it refuses and says to run Claude Code through the gateway once.
- "Test as Codex" uses Responses, or Chat when the endpoint has no Responses URL, for any endpoint. Without a sample it uses the headers Codex signed in with ChatGPT sends (magpie's `codexSign`: `originator: codex_cli_rs`, a Codex `User-Agent` and `version`), so this one test can claim to be Codex before Codex has come through.

## Considered Options

- **Keep rule 15 whole: test with Osuna's own headers only.** Rejected by the user: a key that only serves one CLI then always fails its test, and the test is meant to say whether the CLI will work.
- **Test as Claude Code against any endpoint.** Rejected: sending Claude Code's headers to Anthropic's or a cloud's own API is posing as Claude Code to its vendor. magpie limits it to relays, and so does Osuna.
- **Scan OpenCode with the others.** Rejected: it would read every OpenCode sign-in each time the page opens.

## Consequences

- Osuna reads keys from files other apps own. A change those apps make to their own format can break a source until Osuna follows it; the other sources keep working.
- An import link is a way to get a key and a URL into Osuna from outside. The dialog and the refusals above are the only defence; there is no allow-list of senders.
- "Test as Claude Code" fails with "run Claude Code through the gateway once" on a fresh install, until the first Claude Code request.
- The parent task's rule 15 links here. Any further exception gets its own ADR.
- Files borrowed from magpie keep its MIT notice at the top and are listed in the root [`THIRD_PARTY_NOTICES`](../../THIRD_PARTY_NOTICES).
