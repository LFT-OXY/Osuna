# Web search is allowed per endpoint

[ADR 0004](0004-api-endpoint-rewrites-cli-config.md) turned Claude Code's WebSearch off for every third-party endpoint, because WebSearch runs on Anthropic's servers and most relays reject it. Some relays do search by themselves, and the user wants Claude Code and Codex to search through those. An endpoint now carries a switch, **Searches the web by itself**, off by default. It counts only when the endpoint has an Anthropic or OpenAI Responses URL, and the UI shows it only then. Osuna never probes for it and never turns it on by vendor.

The facts behind this are in task `10-16-cli-wiring-web-search`, `research/web-search.md`; the decisions are `research/decisions.md` Q19–Q22.

## What this replaces in ADR 0004

- **"On Claude, turn WebSearch off with a `"WebSearch"` entry in `permissions.deny`."** Now: Osuna writes that entry only while no endpoint that is on has the switch on. When at least one has it, Osuna does not write the entry and removes the one it wrote. The condition is part of what decides whether `settings.json` is rewritten. A `"WebSearch"` rule the user wrote stays untouched, and while it stands the switch has no effect on Claude Code. Adding or removing the entry reaches running sessions on their next request and costs that request its prompt cache; the UI says so.

## Where this departs from magpie

magpie (MIT) has the same switch. Osuna departs from it in three places:

1. **The deny rule goes only when some endpoint that is on can search.** magpie removes it unconditionally.
2. **A search sub-request goes only to endpoints that serve the same model and have the switch on**, even when the conversation itself runs on another endpoint. Failover runs among those candidates as usual. A search inside a Subagent is matched by the Subagent's model. magpie picks candidates without looking at the switch.
3. **When no such endpoint exists, the gateway answers with a clear error.** It is an Anthropic-shaped 400 `invalid_request_error` saying this model has no endpoint that searches by itself. Not 401 or 403, which make Claude Code ask for a new login; not 429 or 5xx, which make it retry. The gateway does not strip the search tool and send the request on.

The reason for all three is how Claude Code reads the reply. It runs a search as a separate sub-request and hands whatever text comes back to the main model as the search result (`web-search.md` question 1). A relay that cannot search, or a request with the tool stripped, still answers with text, and that text is the model writing from memory presented as a search. The user sees an error in the conversation, but cannot tell that text from a real search result.

## Codex

The same switch governs Codex. Codex sends its `web_search` tool on every turn. An endpoint with the switch on receives it as sent; one with only an Anthropic URL gets it as Anthropic's server-side search tool, and the results are written back in Codex's shape. An endpoint with the switch off gets the request without the tool, and without a `tool_choice` that names it.

Codex signed in with ChatGPT also has a standalone search call. For a ChatGPT model it goes to ChatGPT. For an endpoint model the gateway answers 200 with a short text saying the model cannot search the web, as magpie does without a search provider, because a 404 makes Codex end the turn.

## Considered Options

- **Search on behalf of endpoints that cannot** (magpie's search provider, or another endpoint searching for this one). Rejected: the user does not want a search service of Osuna's own, and handing a model's search to a different vendor's model changes who answers.
- **Let any endpoint with the switch serve the search, whatever its model.** Rejected: the search sub-request asks for the conversation's model, and swapping in another model breaks the "same model" rule failover already follows.
- **Decide the deny rule per session** (a session-level deny for sessions Osuna starts, or a hook that decides per call). Rejected: terminal sessions read only `settings.json`, so the two would disagree, and the gateway already sees every search sub-request.
- **WebFetch's domain preflight** (`skipWebFetchPreflight`). Not done in this change; magpie does not write it for Claude Code either.

## Consequences

- Turning the switch on for one endpoint lets every Claude Code session try to search. A session whose model has no searching endpoint gets the error above in the conversation, where before it had no WebSearch tool at all.
- The switch is the user's statement that the relay searches. If it is wrong, the relay's error reaches the CLI.
- Custom providers that `extends: "claude"` read the same `settings.json`, so they follow the same rule.
