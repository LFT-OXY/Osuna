# The gateway keeps a ledger, merged with the CLI logs

[ADR 0007](0007-api-endpoints-route-through-daemon-gateway.md) rejected "Record the gateway's own usage" because the CLIs already log every turn and a second ledger would double count. The usage page still cannot tell which API endpoint a call went to, what each endpoint cost, or how fast it answered, and none of that is in the CLI logs. So the gateway now records one row per request it carries: endpoint, model, tokens, duration, time to first token, and every attempt with its outcome and failure reason. It never records conversation content. Requests where every endpoint failed get a row too, and so do Codex's requests for ChatGPT's own models, which count as Official.

The decisions behind this are in task `10-16-gateway-ledger-usage`, `research/decisions.md` Q1–Q21.

## How a call is counted once

When a ledger row and a CLI log entry are the same call, matched by the reply's id (Claude `message.id`, Codex `response_id`), they become one row. Tokens, endpoint and timing come from the ledger. Project, session and turn come from the CLI log, because the gateway cannot tell which project or Osuna session a request belongs to. A ledger row with no log entry counts under an unknown project. A log entry with no ledger row is a direct call and counts as Official, and so does every gateway call from before the ledger existed. Pi and OMP follow the same rule, matched by the `responseId` their logs record; an entry whose provider is `osuna`, the provider Osuna writes into their config for the gateway, and that matches nothing is skipped, as magpie does. That holds for Pi's `usage` and OMP's `model_usage` entries too, which name no reply id and so never match.

## Storage

Two tiers. The 15-minute usage buckets gain an endpoint column and the sums the output speed needs, and are kept for good like the rest of Usage. Per-request rows, which back the Requests list, an endpoint's Recent problems and the CSV export, are kept 30 days and at most 200 MB, dropping the oldest day first, as magpie keeps its routing history.

## Also changed in ADR 0007

- **Cooldowns survive a daemon restart.** ADR 0007 kept them in memory only, and magpie still does. A restart now resumes each cooldown until its end, so the gateway does not go straight back to an endpoint it had just set aside.

## Considered Options

- **Keep only the ledger row and drop the matched log entry** (the parent task's first wording). Rejected: gateway calls would vanish from the per-project view and from each turn's cost, since only the logs know project and turn. magpie also keeps its gateway row and copies the session id onto it from the log.
- **Record only which endpoint answered, without tokens.** Rejected by the user: the ledger is the record of what went through the gateway, and failed requests and speed need it anyway.
- **A separate group for gateway calls from before the ledger.** Rejected: they cannot be split by endpoint either way; [usage.md](../usage.md) says so.
