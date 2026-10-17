# The gateway reshapes rejected requests, fails over refusals, and opens at the first content

[ADR 0007](0007-api-endpoints-route-through-daemon-gateway.md) let the gateway change a request only in a few named ways and switch endpoints only before the first byte of a reply. Through real relays that left the user stuck where magpie keeps going: a relay that turns down one field fails the whole turn, a "server busy" sent after `message_start` reaches the CLI, one relay's safety filter stops a conversation another relay would answer, and Claude Code drops a slow model after 5 minutes because nothing arrives while the gateway waits. This ADR replaces the three rules of 0007 listed below and adds four. Everything else in 0007 stands, including cooldowns that live in daemon memory only. What the gateway recognises — failure words, rejected shapes, refusals, vendor wording — is ported from magpie (MIT) at `7597c132`, word for word, with the source named at each place (see the table at the end).

## What this replaces in ADR 0007

- **"Failover happens only before the first byte of the response."** Now: only before the reply **opens**. A reply opens at its first content — text, thinking or a tool call — read in each protocol, passthrough and translated alike. Frames before that (`message_start`, `response.created`, `ping`, empty blocks) are held in the gateway and sent at opening, in order and unchanged. Any failure before opening — an error, a dropped connection, an empty reply, a **Refusal** — goes through **Failover**; after opening the gateway never switches. Thinking is content, so it is never held back (magpie's reasoning hold is not ported). "Before opening" no longer means "the CLI has seen no bytes": a streaming request that has not opened after 15 s already has its 200 and keepalive events:
  - Claude Code gets `ping`, Codex gets `response.in_progress` every 15 s; Codex ignores SSE comments, so it has to be a real event.
  - Keepalive pauses after 5 minutes with nothing from the upstream, so the CLI's own idle timeout can act, and resumes when the gateway sends a new upstream request (the next candidate, a re-ask).
  - A failure after the 200 can no longer set a status or `Retry-After`. It ends the stream with one event: Claude Code `error` with `api_error` (it retries without streaming, which gets the real status), Codex `response.failed` with `server_error`. A failure within 15 s still gets its real status and headers, as 0007 says.
- **"minus vendor-specific rewrites (except the thinking fields …, Claude models' own way of turning thinking off, and DeepSeek's reasoning replay)".** The exceptions grow by four vendors, on magpie's triggers: Kimi / Moonshot, MiniMax and DeepSeek only at their official hosts, and Grok by model name through any endpoint. The same Kimi, MiniMax or DeepSeek model through a relay is sent unchanged; if the relay turns it down, that is a **Rejected shape**. magpie also recognises vendors by preset; Osuna has no presets, so only the host counts. Reading a vendor's errors (Zhipu's refusal wrapped in a 200 and its reset time without a zone, Command Code's bare 400, Cline's free-model quota) is failure classification, not a rewrite, and is not limited to these four.
- **"A rejected request is never re-sent to the same endpoint in a changed shape and the upstream error goes to the CLI, with one exception …"** Now: a **Rejected shape** is re-asked. When an endpoint turns down part of a request as written, the gateway changes that part and asks the same endpoint again, before opening and before the failover decision, then keeps sending that endpoint's model the changed shape until the daemon restarts (keyed endpoint + model + shape, memory only, one `info` log line per new record). A further rejection naming another shape is recorded and asked again the same way; one it cannot recognise, or one whose rewrite leaves the body unchanged, falls to the normal rules. The shapes, each recognised and rewritten as magpie does:
  - the request format at that URL ("no model here") → the endpoint's next format, translating if needed; when every format says so, only that model on that endpoint cools and the gateway switches;
  - both key headers in one request → one header;
  - Claude Code's auto-mode safeguard fields, `display` → dropped;
  - `temperature` / `top_p` / `top_k` called deprecated → dropped;
  - deferred-tool blocks (`tool_addition`, `tool_removal`, `tool_reference`) → dropped;
  - a JSON schema → `json_object` with the schema in the system prompt, then the format told in text only;
  - a conversation ending with the assistant's text (prefill) → a user turn appended, for Codex only; Claude Code's prefill is its own ask and gets the refusal back;
  - a tool's `strict`, Codex's `image_gen` tool after a bare 400, Codex's `prompt_cache_key` → dropped;
  - reasoning turned off — 0007's one exception, now one shape among these.

  This also removes 0007's "minus … the 'remember what was rejected' retry".

Two sentences of 0007 change with these. "Only to an endpoint that serves the same model name" now compares names after magpie's normalization (vendor prefix, version punctuation, snapshot date), and each endpoint is asked under its own spelling. "With `Retry-After` passed through" holds only before a keepalive began.

## Rules this adds

- **A refusal fails over.** A refusal is read from the error or the ending only, never from text an answer quotes. Error form: codes `content_filter`, `*_policy`, an `invalid_prompt` that cites usage policy, or the whole sentence "The request was rejected because it was considered high risk". End form: Anthropic `stop_reason: refusal`, Chat `finish_reason: content_filter`, Responses incomplete for `content_filter`. Before opening, the gateway asks every remaining candidate with the same model; there is no count and no setting. A refusal cools no endpoint and never marks **Needs a check**, even when said with a 403. When all refuse:
  - Claude Code gets the first end-form refusal held back, as sent (200, `stop_reason: refusal`, `stop_details`), streamed or whole as it asked, so its own refusal fallback model can take over; when every refusal was an error, a 400.
  - Codex gets a Responses-shaped 400 `<endpoint>: <model> refused this request (<reason>)` with `code: invalid_prompt`.

  After opening, a refusal reaches the CLI as the upstream sent it, still with no cooldown.

- **A Retired model is saved.** The vendor's word that a model is retired is kept per endpoint + model in a file ([data model](../data-model.md)) and survives a restart; for a week the model leaves that endpoint's entries in every model list agents pick from, and bare-name requests skip it there. One answer from that endpoint + model restores it. A request naming that endpoint is still sent, but a retired answer still fails over to the other endpoints, and that endpoint + model also cools by the normal rules, so while it cools a pinned request asks the others first; the vendor's words reach the CLI only when no other endpoint offers the model. The endpoint's selected models and the providers' default models are never changed. Cooldowns stay in memory as 0007 says.
- **Passthrough is reworded.** Passthrough does not translate. Apart from the model name and auth it applies only generic patches that let the target model accept the request, chosen by the target model and never by which vendor serves it. Vendor rewrites are only the four above. Passthrough never changes who the request says it is from: `User-Agent` and the other identifying headers and fields stay the CLI's. This is what the parent task's rule "only the model name and auth change" now means.
- **User-Agent is the CLI's.** Passthrough forwards the CLI's `User-Agent`; translated requests carry it too; a request without one gets `Osuna/<version>`. A custom header the user sets on an endpoint (a later sub-task) will win over this. magpie writes `magpie/<version>` by default and added a per-endpoint switch, off by default, to send the agent's own (#1851). We send the agent's own always because sub2api groups can admit only Claude Code (`ClaudeCodeOnly` matches `^claude-cli/\d+\.\d+\.\d+`), so magpie's default would break keys that work through passthrough today, and the other passthrough headers already say Claude Code or Codex. The UA names who started the request, which is true even when the body was translated.

## Considered Options

- **Never fail over a refusal.** The same model at another relay usually refuses too, so asking each one in turn costs waiting and money; and handing content one vendor's safety filter stopped to another vendor can look like getting around a safety check. Rejected: the user chose magpie's behaviour and asks every same-model endpoint.
- **Keepalive for Claude Code only.** Rejected: the user chose both CLIs. Known cost: a Codex request that fails after 15 s gets `response.failed` with `server_error`, and Codex retries the whole turn up to 5 times.
- **magpie's User-Agent default.** Rejected for the reasons above.
- **Hold thinking until the first text** (magpie's reasoning hold), so a refusal after thinking can still fail over. Rejected: the user wants thinking shown live.

## Settled during implementation

- **No 4-minute keepalive cap for Codex.** magpie stops holding a Codex reply after 4 minutes in total (`agentQuietMost`, `holdLead`) because its keepalive to Codex is an SSE comment, which Codex ignores, so Codex's 300 s idle timer runs on. Osuna sends a real `response.in_progress`, which resets that timer, so the cap is not ported.
- **Codex's refusal code is `invalid_prompt`, in the stream too.** openai/codex (`ce0323f2`, `codex-rs/codex-api/src/sse/responses_error.rs:82`, `api_bridge.rs:150-172`) reads `invalid_prompt` as a terminal error: no retry, and the message is shown. magpie sends `server_error` after a keepalive (`gateway.go:6366`), which Codex retries up to 5 times into the same refusal. `bio_policy` and `cyber_policy` also stop Codex but show as OpenAI's own policies, so they are not used.
- **Where each recognition comes from.** Failure words, rejected shapes, refusals and vendor wording are magpie's, copied as written. Each file's header names the magpie functions it ports, and [`THIRD_PARTY_NOTICES`](../../THIRD_PARTY_NOTICES) lists the files. The recognition lives here, under `packages/server/src/server/api-endpoints/gateway/`:

| What is recognised                                               | File                                    | magpie source                                                                           |
| ---------------------------------------------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------- |
| Failure words and classes, retired or unserved models            | `failure.ts`                            | `internal/gateway/routing.go`, `fallback.go`, `gateway.go`; `internal/provider/test.go` |
| Reasoning off, format at that URL, key headers, `image_gen`      | `refusals.ts`                           | `anthropic.go`, `gateway.go`, `internal/catalog/authheader.go`                          |
| Refused fields                                                   | `refused-fields.ts`                     | `anthropic_shapes.go`, `anthropic.go`, `strict_refused.go`, `image_tool.go`             |
| JSON schema and prefill                                          | `refused-downgrades.ts`                 | `format.go`, `prefill.go`                                                               |
| Refusals                                                         | `safety-filter.ts`                      | `fallback.go`                                                                           |
| A 2xx that is not an API reply; Zhipu's refusal wrapped in a 200 | `not-api-reply.ts`, `zhipu-envelope.ts` | `notapi.go`; `internal/provider/zhipu_envelope.go`                                      |

## Consequences

- Rejected-shape records clear on restart, so the first request after a restart pays the rejection once more; concurrent first requests may each pay it.
- A refusal can be asked of every endpoint that serves the model before the CLI hears it, so a refused turn takes longer and may be billed by more than one relay.
- After a keepalive began, the CLI never sees `Retry-After`; Claude Code learns the real status from its non-streaming retry.
- Every file borrowed from magpie keeps its MIT notice at the top and is listed in the root [`THIRD_PARTY_NOTICES`](../../THIRD_PARTY_NOTICES).
