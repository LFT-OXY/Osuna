# ADR 草稿：API endpoints are host-wide and reached through the daemon's gateway

> 草稿。实现时落到 `docs/adr/0007-api-endpoints-route-through-daemon-gateway.md`（编号接现有最大号 0006），并按英文 ADR 的口吻定稿；正文沿用 ADR 0004 的写法：先一段说清决定与理由，再列规则。以下为内容草稿，括号内中文是给审稿人的提示，定稿时删去。

---

# API endpoints are host-wide and reached through the daemon's gateway

An **API endpoint** used to be one provider's own list of third-party connections, with at most one active, and activating it wrote that endpoint's URL, key, and model into the CLI's config ([ADR 0004](0004-api-endpoint-rewrites-cli-config.md)). Now an endpoint belongs to the host, carries one key and up to three protocol URLs, and the CLI never sees it: the daemon writes its own gateway, `http://127.0.0.1:<port>/api-endpoint-gateway`, into the CLI config, and the gateway picks the endpoint per request, swaps in the real key, translates between Anthropic Messages, OpenAI Chat, and OpenAI Responses, and moves to another endpoint that serves the same model when the current one runs out of quota. We chose this because the user's goal is to keep working through several relays without touching anything when one of them is exhausted, and the CLI can only point at one URL. The design is a TypeScript port of magpie's (MIT) gateway, not a hosted magpie binary, so it runs inside the daemon on every platform the daemon runs on and phones use it through the daemon as before.

ADR 0004's file-editing rules stay in force: owned keys only, originals recorded and restored, atomic replace, parse-or-refuse, re-read before rename, external-change detection, the WebSearch deny rule, `jsonc-parser` for `settings.json`, node-position splicing for `config.toml`, and the dedicated Codex table `osuna_api_endpoint`. This ADR replaces the rules in 0004 that say *what* those keys hold.

## What changes from ADR 0004

- **The written URL and token are the daemon's, not the endpoint's.** Claude gets `ANTHROPIC_BASE_URL` = the gateway and `ANTHROPIC_AUTH_TOKEN` = a per-provider random passphrase; Codex gets `base_url` = the gateway's `/v1` and `experimental_bearer_token` = the same kind of passphrase. The real API key never leaves the daemon. The passphrase is the gateway's authentication and also says which provider is calling, so the gateway can apply that provider's switch and default model. It is only accepted from a loopback source.
- **Codex gets the token in plain text, and `auth.command` goes.** ADR 0004 put the key behind `auth.command` so no secret sat in `config.toml`. The passphrase is not the user's key, it is useless off this machine, and it is revoked when the switch goes back to Official, so a plain value is acceptable and it drops the `codex-api-key` file, the `/bin/cat` indirection, and the Codex 0.118 minimum version check. Because the key name starts with `experimental_`, it has to be tracked across Codex releases.
- **Claude's model is written as top-level `model`, not `env.ANTHROPIC_MODEL`.** `ANTHROPIC_MODEL` in `env` outranks `/model`, so a model picked inside a session was lost on the next session. A top-level `model` is the start value only. `ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU,FABLE}_MODEL` and `ANTHROPIC_SMALL_FAST_MODEL` are no longer written: tier mapping is per endpoint and has to follow the endpoint the gateway chose, so the gateway translates tier names. All of these, if present on takeover, are recorded and removed, and restored on the way back.
- **Codex gets a model catalog.** `model_catalog_json` points at a daemon-owned file listing every selected model of every enabled endpoint, because Codex refuses unknown model ids on each turn otherwise.
- **One switch per provider, one switch per endpoint.** A provider has "Use API endpoints" on or off and one bare default model name; an endpoint has its own on/off that applies to every provider. There is no "active endpoint" any more. Which endpoint a session uses comes from its model name: Osuna sessions send `<slug>/<model>` for a specific endpoint, everything else sends a bare model name and the gateway resolves it in endpoint creation order.
- **Sessions no longer record the mode they started in.** The `apiEndpointId` session field and the resume-time warning go. The gateway resolves the model name at request time and, if nothing can serve it, returns the upstream error to the CLI, which shows it in the conversation.

## Rules the gateway adds

- It is mounted on the daemon's existing HTTP listener under `/api-endpoint-gateway`, ahead of the password middleware and the global JSON body limit, and streams bodies both ways. The relay never exposes it. A daemon listening on a socket cannot host it, so the provider switch refuses to turn on.
- On every start the daemon compares the URL it wrote with the URL it is bound to and rewrites the CLI config if they differ, because the port can change between runs.
- Failover happens only before the first byte of the response and only to an endpoint that serves the same model name. A failed endpoint cools down in memory, by the magpie failure classes; cooldown does not survive a daemon restart.
- Per request, the gateway sends the agent's own protocol straight through when the endpoint has a URL for it, except that a Claude model always goes over the Anthropic URL when there is one, to keep prompt caching. Otherwise it translates to the first protocol the endpoint has.
- Translation covers what magpie covers, minus vendor-specific rewrites, the "remember what was rejected" retry, web search, and file attachments beyond magpie's own handling. Nothing is retried on a 400; the upstream error goes to the CLI.
- Translated or not, the error body the CLI sees is `"<endpoint name>: <upstream text>"` in the CLI's own error shape, with `Retry-After` passed through.

## Considered Options

- **Keep ADR 0004 as is and add an ordered fallback list per endpoint** (magpie's model). Rejected: the CLI still points at one URL, so failover needs a gateway anyway, and the user chose automatic same-model failover over a hand-maintained list.
- **Run magpie itself and manage its process.** Rejected: a Go binary per platform in the desktop bundle, its own port and config files, and no way to keep its UI out of the way. The user chose a rewrite in the daemon.
- **A separate port for the gateway.** Rejected: the daemon already has a listener with Host filtering, 0600 file helpers, and a port recorded in `paseo.pid`; one more port means one more thing that can be taken.
- **Keep `auth.command` for Codex.** Rejected once the token became a revocable passphrase rather than the user's key; the indirection only bought a version floor and a second file.
- **Record the gateway's own usage.** Rejected: the CLIs already log every turn and the usage page reads those logs; a second ledger would double count.
- **Change the official Paseo mobile app.** Rejected: the user runs the upstream app on the phone and does not build it. Old clients get a projection of the host-wide model onto the one-active-endpoint protocol they know, and that projection is permanent, not a COMPAT shim.

## Consequences

- A custom provider that `extends: "claude"` with its own `ANTHROPIC_BASE_URL` is overridden by the gateway while the Claude switch is on, as `settings.json` `env` outranks process env. Switch Claude Code to Official to give it its own URL again.
- Turning a provider's switch off sends its sessions back to the official URL; a session on an endpoint model then gets "model not found" from Anthropic or OpenAI. Accepted.
- Every request from a terminal session passes through the daemon, so the daemon must be running for the CLI to work while the switch is on. The CLI's connection-refused error is the only message.
- Tier mapping has to be configured on every endpoint that should answer `opus`, `sonnet`, `haiku`, or `fable`; an endpoint without a mapping gets the tier name as the model id.
- `model_catalog_json` has to be regenerated whenever an endpoint, its selected models, or a switch changes, or Codex warns on every turn.
- Old clients, including the official mobile app, see only bare model names and cannot pick which endpoint serves a model.
- Files borrowed from magpie's design keep its MIT notice at the top and the full text goes in a root notices file.

---

## 定稿时要做的（给实现工单的提示，不进 ADR）

- 文件名与编号：`docs/adr/0007-api-endpoints-route-through-daemon-gateway.md`。
- ADR 0004 文首加一行 status：`superseded in part by ADR 0007`，并在正文里给被取代的条目各加一句指向 0007（见 09 票 Answer 的清单）。
- 英文术语按 `docs/glossary.md`：**API endpoint**、**Official**；新词 **Gateway**（中转站）、**Endpoint switch**（接口开关）、**Use API endpoints**（使用第三方接口）、**Default model**（默认模型）、**Cooling down**（冷却中）、**Needs attention**（需要检查）、**Off**（已关闭）以词条定稿为准。
