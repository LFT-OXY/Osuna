# CLI config rewriting follows the CLI's own choices and edits commented settings

[ADR 0004](0004-api-endpoint-rewrites-cli-config.md) treated any change to an owned key as an outside edit, refused a `settings.json` it could not parse as JSON, and always wrote a token for Claude Code. In use that meant a model picked with `/model` was reported as tampering and later put back, a `settings.json` with a BOM or a comment kept the switch from turning on, and Claude Code lost its claude.ai sign-in whenever the switch was on. This ADR changes those rules and adds the keys Osuna now owns. ADR 0004's other rules stand: owned keys only, originals recorded and restored, atomic replace, re-read before rename, detection only when the status is read. Most of what follows is magpie's (MIT).

The facts behind this are in task `10-16-cli-wiring-web-search`, `research/claude-code-wiring.md` (questions 1–8) and `research/codex-wiring.md` (question 10); the decisions are `research/decisions.md` Q1, Q2, Q4–Q7, Q13–Q16, Q23, Q26–Q29 and Q31.

## What this replaces in ADR 0004

- **"If a file does not parse, write nothing to any file."** For `settings.json`, Osuna now reads and writes JSONC. A leading BOM is dropped on read and kept on write. Comments and trailing commas are accepted, and edits touch only owned keys, so comments and layout stay. A file with comments or trailing commas is edited even though Claude Code itself cannot read it, and the settings page says so (below). A file that is not valid JSONC is still refused, with the reason in the user's UI language. `config.toml` keeps ADR 0004's rule.
- **"If the owned keys no longer hold what the daemon wrote, tell the user the file was changed outside Osuna … Never overwrite silently."** A model or thinking level the CLI saved itself is not an outside edit:
  - When the CLI's model becomes another model some endpoint serves (bare, with an endpoint prefix, or with `[1m]`), Osuna takes it as the new default model, updates what it recorded as written, and moves the fields that follow the main model with it. No warning.
  - When it becomes a model no endpoint serves, the settings page reports **Model replaced**.
  - Osuna never writes back over a model the CLI saved.
  - Thinking levels are handled the same way: Codex's `model_reasoning_effort`, Claude Code's `effortLevel` and `modelSettings`.

  The other cases are listed under "Changed outside Osuna" below.

- **"On Claude, write `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN` …"** (with [ADR 0007](0007-api-endpoints-route-through-daemon-gateway.md)'s gateway token). Claude Code's settings page gets an option to keep the claude.ai sign-in, off by default. While it is on, `ANTHROPIC_AUTH_TOKEN` is written as an empty value, still owned, so Claude Code sends its claude.ai sign-in; turning the option off writes the token back. The gateway accepts the claude.ai token ([ADR 0010](0010-codex-wiring-and-gateway-caller-recognition.md)) and never forwards it, drops `oauth-` betas from `anthropic-beta`, and turns an upstream 401, or a 403 saying the OAuth token was revoked, into a 502 `api_error` naming the endpoint, so Claude Code does not throw away the user's sign-in. Other errors keep their status, with `x-api-key` in the body replaced by `API key`. The settings page warns when the option is on but a token was typed back in, or off but the token is empty.

## Changed outside Osuna

The status check reports these cases. The app translates them from a code and parameters.

| Case                                | When                                                                                                                              | Actions                                                                                                                                                                                                                                                                                                       |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No longer through the gateway       | The URL, the token, `openai_base_url` or a mirror table's URL changed; or a cloud-platform switch or managed setting overrides it | Re-apply, switch to Official, keep current settings (switch off without restoring files, stop warning). When the switch or address is set where Osuna can't edit it (managed settings, `~/.claude.json`, the login shell): switch to Official, keep current settings, how to fix. Re-applying can't change it |
| Model replaced                      | The CLI's model is one no endpoint serves                                                                                         | Re-apply, keep current settings (stop warning, switch stays on)                                                                                                                                                                                                                                               |
| Bypassed                            | Settings look right, but the CLI's own logs show use since the last rewrite and the gateway received nothing from that provider   | Re-apply, switch to Official                                                                                                                                                                                                                                                                                  |
| Proxy does not forward              | Codex would reach the gateway through a proxy that does not forward loopback requests (`decisions.md` Q18)                        | How to fix                                                                                                                                                                                                                                                                                                    |
| Settings file has comments          | `settings.json` has comments or trailing commas                                                                                   | How to fix                                                                                                                                                                                                                                                                                                    |
| Codex profile overrides, unreadable | As before                                                                                                                         | As before                                                                                                                                                                                                                                                                                                     |
| `multi_agent_v2` overrides          | Codex's own `multi_agent_v2` is on and overrides **Codex Subagents may use any model**, or the config cannot be read              | How to fix                                                                                                                                                                                                                                                                                                    |

**Keep current settings** keeps the file as it is now. When Osuna's Codex model provider table itself was changed outside Osuna (its URL or token), the daemon records that and stops rewriting the table on start, an exception to [ADR 0010](0010-codex-wiring-and-gateway-caller-recognition.md)'s "on every start the daemon rewrites the table". The table is Osuna's again the next time the switch is turned on. Cost: Codex conversations recorded under that table resume at whatever address the user put there, not through the gateway.

"Endpoint not answering" is not a case: Osuna only writes a local address, so it can only happen when the address was changed, which is the first case. The comments case exists because Claude Code skips a `settings.json` it cannot read; in the terminal it shows an error, but sessions Osuna starts through the SDK go to the official API with no message (verified in Claude Code 2.1.302's shipped code, read but not run).

## Keys Osuna now owns

Each is recorded and restored under ADR 0004's rules. A value the user wrote first stays theirs, except the cloud-platform switches, which takeover removes and switch-off restores.

- **Cloud-platform switches.** On takeover, `CLAUDE_CODE_USE_BEDROCK`, `_VERTEX`, `_FOUNDRY`, `_ANTHROPIC_AWS`, `_ANTHROPIC_GOOGLE_CLOUD` and `_MANTLE` that are on in `settings.json` `env` are removed, because each sends requests past the gateway, and they come back when the switch goes off, unless the user has set them again since. Switches that are off and other cloud-platform variables are left alone. The same switches in managed settings, `~/.claude.json` or the login shell, and a managed `ANTHROPIC_BASE_URL` that does not point at the gateway, are only reported.
- **Default thinking.** Per provider, chosen from the default model's levels. Claude Code: `effortLevel`, plus `modelSettings.<model>.effortLevel` for a Claude model; `max` goes into `env.CLAUDE_CODE_EFFORT_LEVEL`, which locks every session at max, and the UI says so; Ultra Code writes `ultracode: true` and is offered only for models that reach xhigh. Codex: `model_reasoning_effort`. Osuna's own Claude sessions pass Ultra Code off explicitly when it is not chosen, so the file's default does not reach them.
- **Background and Subagent models for Claude Code.** `env.ANTHROPIC_SMALL_FAST_MODEL` and `env.CLAUDE_CODE_SUBAGENT_MODEL`, the latter as `<model>:<level>`, which the gateway strips before routing. Unset, both follow the main model.
- **Codex Subagents and memory.** `[agents]` default Subagent model and level, and `[memories]` extraction and consolidation models. Forcing a Subagent model is done in the gateway, not in the config.
- **Codex Subagents may use any model.** A switch, as in magpie: Osuna marks the multi-agent version of each model in the list it writes as v1, so a GPT main conversation can start Subagents on endpoint models. Codex's own `multi_agent_v2`, when on, overrides it, and that is reported.
- **`CLAUDE_CODE_AUTO_MODE_SERVER=0`** when no model reachable through the gateway would be checked by Anthropic, meaning no Claude model and no endpoint at `api.anthropic.com`. Recomputed on every rewrite.

## Fixes that change written values

- A dotted Claude version (`claude-opus-4.6`) is written with hyphens when that spelling matches exactly one Claude id on sale, because Claude Code mistakes the dotted form for an old model. Other ids and the user's own values are left alone.
- A model that reaches `max` but lists no `xhigh` is also reported as supporting `xhigh`, so Claude Code allows Ultra Code. The gateway still sends the model's own levels.

## What this replaces in ADR 0007

- **"Tier mapping has to be configured on every endpoint that should answer `opus`, `sonnet`, `haiku`, or `fable`; an endpoint without a mapping gets the tier name as the model id."** The code never did that: it answered 404. Now, while Claude Code's switch is on, a request for one of Claude Code's built-in tier ids (`claude-haiku-4-5-20251001` and the like) goes to the model that tier is mapped to, even when an endpoint selected that id, as magpie does: Claude Code asks for these ids by name for its own small tasks, whatever the user picked. With no endpoint that is on mapping the tier, it goes to Claude Code's default model, and so does a bare tier name (`opus`, `sonnet`, `haiku`, `fable`) or another `claude-` id (`claude-mythos-5-1`) that no endpoint serves. A request for the default model's own id is routed as asked.
- **"`ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU,FABLE}_MODEL` and `ANTHROPIC_SMALL_FAST_MODEL` are no longer written."** `ANTHROPIC_SMALL_FAST_MODEL` is written when the user picks a background model, as above.

## Considered Options

- **Accept a BOM, keep refusing comments.** Rejected: the user chose magpie's behaviour. Known cost: the switch shows on while Claude Code ignores the file; the settings page warning is Osuna's addition to make that visible.
- **Keep warning on every model change.** Rejected: picking a model in the CLI is the most common edit, and treating it as tampering made Osuna undo the user's choice.
- **Pass the claude.ai sign-in through with a custom header.** Not needed once the gateway recognises callers without the token ([ADR 0010](0010-codex-wiring-and-gateway-caller-recognition.md)).

## Consequences

- With default thinking at `max`, Claude Code's `/effort` cannot go lower in any session.
- Tools that rewrite the same keys still fight with this feature; the cases above are the only defence.
