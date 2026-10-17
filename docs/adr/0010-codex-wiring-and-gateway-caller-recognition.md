# Codex keeps its ChatGPT sign-in, and the gateway recognises callers instead of authenticating them

[ADR 0007](0007-api-endpoints-route-through-daemon-gateway.md) pointed Codex at the gateway through Osuna's own **Codex model provider** table, removed that table when the switch went off, and made the gateway token the gateway's authentication. Through real use that split the user's Codex conversations in two: Codex lists only the conversations of the current Codex model provider, so conversations started on either side of the switch could not see each other; conversations started while the switch was on could not be resumed after it went off (``Model provider `osuna_api_endpoint` not found``); and while it was on, `/model` lost the ChatGPT models. This ADR changes how Codex is wired and how the gateway decides who is calling. It follows magpie (MIT).

The facts behind this are in task `10-16-cli-wiring-web-search`, `research/codex-wiring.md` (questions 2, 3, 7, 8, 10 and 13) and `research/claude-code-wiring.md` (question 1e); the decisions are `research/decisions.md` Q9, Q10, Q17, Q24, Q25, Q34 and Q35.

## What this replaces in ADR 0007

- **"Codex gets `base_url` = the gateway's `/v1` and `experimental_bearer_token` = the same kind of token."** Now the wiring depends on how Codex is signed in, which Osuna learns from Codex's own app-server, never by reading `auth.json`. It checks when the switch turns on, when the daemon starts, and when the status is read, and rewrites the config if the sign-in changed.
  - **Signed in with ChatGPT:** Osuna points Codex's built-in provider at the gateway with the top-level `openai_base_url`, set to the gateway's ChatGPT backend path. The path ends in `/backend-api/codex` so Codex keeps treating it as the ChatGPT backend. Osuna does not set the top-level `model_provider` or `model_catalog_json`, and removes them if it wrote them. It writes the top-level `model` as the default model, and still writes its own Codex model provider table, for conversations recorded under it. ChatGPT models go to ChatGPT through the gateway unchanged, so `/model` shows them alongside the endpoint models.
  - **Signed in with an API key, or not signed in:** Osuna's Codex model provider table, top-level `model_provider` and `model_catalog_json`, as before.
- **"The token is the gateway's authentication and also says which provider is calling."** Now the gateway accepts every loopback request that carries no forwarding header and refuses requests from web pages (cross-site requests and DNS rebinding), as magpie does. The token only identifies the agent. A request whose token does not match, such as one carrying a ChatGPT token, a claude.ai token or an empty value, is identified by path (the ChatGPT backend path is Codex) and by `User-Agent`, by magpie's rules. Osuna still writes a token into the CLI config, because the CLIs require a value.
- **"…and it is revoked when the switch goes back to Official."** The token stays the same across the switch going off and on. Running sessions keep reaching the gateway until they restart.
- **"Official removes the dedicated Codex table."** Osuna's Codex model provider table, once written, stays when the switch goes off, and the gateway keeps serving conversations recorded under it while the daemon runs. On every start the daemon rewrites the table for the current port, switch on or off. _Superseded in part by [ADR 0012](0012-cli-config-rewrite-follows-the-cli.md): after **keep current settings** on a table changed outside Osuna, the daemon leaves it alone until the switch is turned on again._

## Rules this adds

- **ChatGPT requests pass through untouched.** A model name with an endpoint prefix (`<slug>/<model>`) is served by the gateway's normal routing and failover. A bare name is a ChatGPT model, sent to ChatGPT with the original path, query and every header except hop-by-hop headers and `Host`. The gateway never sends the user's ChatGPT token or account id to an endpoint; an endpoint gets only the headers that say the request comes from Codex.
- **Bare names mean ChatGPT.** For Codex signed in with ChatGPT, endpoint models appear in `/model` as `<slug>/<model>`, and a bare name always means the ChatGPT model, even when an endpoint serves the same name. Codex signed in another way sees the same list as before.
- **The model list is ChatGPT's first.** The gateway asks ChatGPT for Codex's model list, waits 3 seconds, and falls back to the last answer; ChatGPT's 401 and 403 go back to Codex as they are. Endpoint models are appended.
- **A WebSocket handshake gets 426**, so Codex moves to HTTP at once instead of retrying and warning. Remote compaction is passed to ChatGPT for ChatGPT models and refused for endpoint models, as magpie does.
- **Mirror tables follow the switch.** A Codex model provider table written by tools like CC Switch that mirrors OpenAI (named OpenAI, requires OpenAI sign-in, no `base_url`) is not covered by `openai_base_url`. While the switch is on and Codex is signed in with ChatGPT, its `base_url` points at the gateway's ChatGPT backend path too. It is an owned key under ADR 0004's rules.
- **No special handling when the ChatGPT account is out of quota.** The app-server Osuna runs and the terminal Codex still send the request; ChatGPT answers that turn with its quota error and endpoint models keep working. Only the closed-source Codex desktop app holds requests back, and handling that is left to a later sub-task (`codex-account-held.md`).

## Considered Options

- **Keep a Codex model provider table for ChatGPT sign-ins too** (ADR 0007). Rejected: it hides the ChatGPT models and splits conversations by provider.
- **Keep token authentication and add a custom header** for clients that bring their own credentials. Rejected: the gateway listens on loopback only, a web page is the real risk and is refused by origin, and a header would be one more thing to write and track in each CLI.
- **Endpoint models under bare names when they collide with ChatGPT's.** Rejected: one name would reach two different models depending on the sign-in.
- **Switch Codex to the provider table while the ChatGPT account is held** (magpie). Deferred: it needs periodic reads of the sign-in, which belongs to a later sub-task, and helps only the desktop app.

## Consequences

- ADR 0007's "Turning a provider's switch off sends its sessions back to the official URL" no longer holds as written. Turning the switch off leaves running sessions on the gateway until they restart. New Codex conversations go to the official URL, but conversations recorded under Osuna's Codex model provider still resume through the gateway, which needs the daemon running.
- A Codex user signed in with ChatGPT keeps every ChatGPT feature that depends on the sign-in.
- The gateway relays the user's own ChatGPT traffic. [usage.md](../usage.md) is to list it with the daemon's network traffic as forwarded, not sent by the daemon.
- Any local process that can reach the loopback port can use the gateway without the token, as with magpie.
