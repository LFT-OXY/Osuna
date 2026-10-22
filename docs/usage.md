# Usage

The daemon reads the session logs the local CLIs already write, turns them into
token counts, and prices them. Nothing is sent anywhere; the one exception is
the price table, below.

Subscription limits are a different thing, **Plan usage**. Its data comes from
[usage sources](plugins.md#usage-sources). Read
[ADR 0006](adr/0006-usage-in-code-is-upstream-plan-usage.md) before you look for
either one's code.

## What gets scanned

Every CLI decides where its own logs live, and the scanner resolves the same
paths that CLI would:

| Source      | Root                                                                                |
| ----------- | ----------------------------------------------------------------------------------- |
| Claude Code | `$CLAUDE_CONFIG_DIR/projects`, else `~/.claude/projects`                            |
| Codex       | `sessions` and `archived_sessions` under `$CODEX_HOME`, else `~/.codex`             |
| Pi          | Pi's own rule, its `settings.json` included                                         |
| OMP         | `PI_CONFIG_DIR`, `OMP_PROFILE`/`PI_PROFILE`, `PI_CODING_AGENT_DIR`, `XDG_DATA_HOME` |

Those variables are read from the **daemon's own environment**, once at start. A
per-provider `env` in `config.json` moves the CLI Paseo launches and not the
scanner, so logs written to a relocated directory are counted nowhere. Put the
variable in the daemon's environment if you want the numbers to follow.
`params.sessionDir` is not read here either — that one belongs to session import
([custom-providers.md](custom-providers.md#omp-profiles-and-pi-compatible-forks)).

OMP is resolved from environment variables alone; its `settings.json` is not
read, while Pi's is. An OMP install whose sessions were moved that way reports
nothing. The roots are resolved once from the environment, and reading a CLI's
config files there would mean owning their reload story too.

Codex can compress a rollout to `.jsonl.zst`. Those are skipped, and the daemon
says so once per run at `info`.

## The scan

One worker reads files, serially. The round that runs at start is the backfill;
after it, a timer starts the same round every 60 seconds
(`PASEO_USAGE_SCAN_INTERVAL_MS`). Both rounds are the same code over every file
no cursor has finished — only the first reports progress. Cursors are on disk,
so a restart resumes mid-file and a second start has almost nothing left to do.

Inside a round, main-thread transcripts are read before subagent ones, newest
first: a subagent that names no parent turn is matched against the turn spans of
the session that spawned it, and recent days are what people look at.

[data-model.md](data-model.md#7-usage) holds the row formats, the cursor fields,
and what a rewritten file costs.

## What each log makes hard

Traps in the raw logs that the parsers have to carry, each of them spanning CLI
versions.

- **Claude Code** writes one API response as several lines that each repeat the
  same `usage`, and a resume copies the whole previous transcript into a new
  file under a new session id. Summing lines double counts, and so does summing
  files. `forkedFrom` is what stitches a resume chain back into one session.
- **Codex** keeps `total_token_usage` as a per-process running sum that restarts
  at zero on resume, so reading it as a total and reading it as a difference are
  both wrong; each event's own `last` is the safe field. From 0.153.2 the same
  response arrives a second time as a `token_usage_record`, so a reader that
  accepts both counts it twice.
- **Pi and OMP** share a transcript format but not its details: Pi writes the
  header first, OMP puts a rewritable title line ahead of it, and the two name
  the reasoning column differently. An OMP branch or `--continue` copies the
  parent's entries into the child file.
- **All four** may carry a raw U+2028 or U+2029 inside a JSON string, which is
  legal there and which Node's `readline` treats as a line terminator. The
  scanner splits on `\n` bytes for that reason; a reader built on `readline`
  drops those lines with no error. One machine's logs held 44 and 3 of them
  across 13 files.

## Where the numbers fall short

- The entries an OMP child file copied from its parent are skipped by their
  stamps and counted from the parent instead. When that parent is no longer
  under a scanned root — another profile, moved by `settings.json`, deleted —
  the copied stretch is counted in neither file.
- A subagent transcript that names no parent turn and started outside every turn
  span of its session keeps its tokens in the session totals and in no turn, so
  per-turn numbers can sum to less than the session.
- A `.jsonl.zst` rollout counts as zero.
- Prices themselves are estimates; see [Known undercounts](#known-undercounts).

## The price table

Prices come from LiteLLM's public `model_prices_and_context_window.json`. The
daemon ships a slimmed snapshot of it at
`packages/server/src/server/usage/pricing/snapshot.json`, with LiteLLM's MIT
license beside it — keep the two together, that license is the condition for
redistributing the data.

The snapshot keeps four columns per model (input, cache read, cache write,
output) and drops everything else, which takes 2.7 MB down to about 400 KB. It
also drops the upstream file's first entry, `sample_spec`: that is field
documentation, not a model, and counting it adds a phantom zero-priced model.

Refresh it with `npm run usage:pricing:refresh` before a stable release; the
[release checklist](release.md#completion-checklist) has the line. Nothing
refreshes it automatically, and no CI job commits it.

### Why cost is not stored

Bucket rows hold tokens only. Cost is computed when a report is built, so
correcting a price — or adding one for a model the table never knew — reprices
every day you have already recorded, with no migration and no backfill. The
price of that choice is that a report has to look up every model it touches;
the lookup is memoized per model and the table changes at most once a day.

### Known undercounts

The four columns cannot express long-context tiers, Anthropic's higher one-hour
cache-write rate, or OpenAI's priority and flex tiers. Sessions that use them
are estimated low. Reasoning tokens are counted inside output and never priced
separately.

## Outbound requests

The daemon downloads two public files on its own initiative, both plain GETs:
no authentication, no query string, no request body, nothing about you or your
machine beyond the IP and user agent any HTTP request carries. The one other
request it makes on its own is the daily model list refresh of each API
endpoint that is on, which carries that endpoint's key. Its other requests are
something you asked for, such as the CLI update check or an endpoint's tests;
follow from a page you have open, such as the vendor status pages read while the
API endpoints or usage page is open, or an endpoint's balance; or follow from a switch you turned on: the
API endpoint checks and the gateway's calls to endpoints, all below. Traffic the CLIs send
through the gateway is theirs, not the daemon's.

| File                                           | Fetched when                                      | Used for                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The price table on `raw.githubusercontent.com` | Always                                            | Pricing usage                                                                                                                                                                                                                                                                                                                   |
| `models.dev/api.json`                          | Claude Code or Codex is switched to API endpoints | Telling Claude Code and Codex each endpoint model's context window and effort levels, plus Claude Code its reply length and Codex whether it takes images; picking Claude Code's newest model as the default model when the CLI has none; letting the gateway decide whether `temperature` and `top_p` go to a vendor's own API |

Each runs 30 seconds after start and every 24 hours after that, and skips the
request while the copy it already fetched is younger than a day. A daemon still
running on the built-in price snapshot always asks, however recent that
snapshot's own date is; models.dev has no snapshot, and turning Claude Code's or
Codex's API endpoint switch on while both were off checks it right away. Both
requests are conditional (`If-None-Match`), so an unchanged file costs a 304
rather than 2.7 or 5.7 MB. They time out after 15 seconds; a failure is logged
at `info`, retried an hour later, and never replaces the copy you already have.
The daemon keeps the models.dev answer slimmed to each model's window, reply
length, effort levels and image input, each vendor's sampling support, and
Claude Code's own models newest first, in
`$PASEO_HOME/api-endpoints/models-dev.json`.

Turn both off with `features.usage.pricing.autoUpdate: false` in `config.json`,
or `PASEO_USAGE_PRICING_AUTO_UPDATE=0` at launch. Off means the daemon prices
from the built-in snapshot and your own prices, tells Claude Code and Codex what
an endpoint's own model list says and what a models.dev copy fetched earlier
says, reads no vendor status page, refreshes no endpoint's model list on its
own, and fetches neither file — including on a host that has no network at all. The switch covers the automatic check only:
"Refresh now" in the price table still fetches the price table when you press
it.

The vendor status check runs only while the API endpoints page or the usage
page is open, and only while the price table's auto-update is on. The daemon
reads the public status summary of each vendor an endpoint's base URL is on, and
of Anthropic and OpenAI for Claude Code's and Codex's plan usage cards:
`status.claude.com`, `status.openai.com` and `status.moonshot.cn`, each a GET of
`/api/v2/summary.json` with no authentication and nothing else of yours. The
open page asks every 5 minutes, and the daemon reads each summary at most once in 5
minutes, waiting up to 4 seconds on the first look. A read times out after 15
seconds; a failure is logged at `info` and shows nothing. DeepSeek's page is
only linked, never read.

The CLI update check runs only when you ask for it. Opening Settings →
Providers, or pressing refresh on a provider there, makes the daemon look up the
latest release of each installed built-in CLI: one GET per CLI to
`registry.npmjs.org/-/package/<package>/dist-tags`. The package name is the
whole request; your installed version is not sent, the daemon compares the two
itself. The answers stay in memory for an hour, so reopening the page
does not ask again; refresh does. Nothing is looked up at startup, on a timer,
or for a CLI that is disabled, not installed, or whose version could not be read. The price table switch does not
cover it.

### API endpoints

These go to the base URLs of one API endpoint and carry its key, unless it has
none, plus its own **Headers** and extra body
([glossary](glossary.md)). They name Osuna as the client, except Test as
Claude Code and Test as Codex
([ADR 0013](adr/0013-osuna-reads-other-apps-and-tests-as-the-cli.md)). On a
custom endpoint with **Don't check its certificate** on, its own `https` hosts
are reached without checking their certificate.

| Request                                                                                                  | Sent when                                                                                                                                                                                                                                                  | Price table switch |
| -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| Daily model list: each format's list (`GET <base>/v1/models`, then `<base>/models`; Azure's deployments) | For each endpoint that is on. First look 5 minutes after start, then every minute; an endpoint whose list is under a day old is skipped. Up to 60 seconds per endpoint; a failure is logged at `info`, keeps the list, and is tried again 15 minutes later | Stops it           |
| Model list after saving                                                                                  | You add an endpoint or change its key, import endpoints from other apps, or add one from an import link. Up to 8 seconds; a failure doesn't stop the save                                                                                                  | Doesn't            |
| Model list                                                                                               | You open an endpoint's page, or press "Fetch again" there or "Fetch models" in the add or edit dialog                                                                                                                                                      | Doesn't            |
| Test connection, Auto-detect and Each picked model                                                       | You press it. Test connection on an endpoint with no selected models and no fetched list fetches its model list first, to pick a model to ask. Each picked model asks up to 30 models on every format, 8 at a time                                         | Doesn't            |
| Test models, Test as Claude Code, Test as Codex                                                          | You press the button: one "hi" capped at 16 tokens per model, 4 at a time. The two "Test as" ones send the headers that CLI last sent through the gateway                                                                                                  | Doesn't            |

The dialog's requests use what is in the form, so they can reach an address and
key you haven't saved yet.

The balance read goes to the vendor's own balance query, which the daemon picks
by the host of the endpoint's base URLs (Chat Completions first, then Responses,
then Anthropic), never by its template. An endpoint on a host the daemon doesn't
know, or with no key, sends nothing.

| Vendor       | Host                                         | Request                                                   |
| ------------ | -------------------------------------------- | --------------------------------------------------------- |
| DeepSeek     | `api.deepseek.com`                           | `GET https://api.deepseek.com/user/balance`               |
| Kimi         | `api.moonshot.cn` / `api.moonshot.ai`        | `GET https://api.moonshot.cn/v1/users/me/balance` (`.ai`) |
| OpenRouter   | `openrouter.ai`                              | `GET https://openrouter.ai/api/v1/credits`                |
| SiliconFlow  | `api.siliconflow.cn` / `api.siliconflow.com` | `GET https://api.siliconflow.cn/v1/user/info` (`.com`)    |
| StepFun      | `api.stepfun.com` / `api.stepfun.ai`         | `GET https://api.stepfun.com/v1/accounts` (`.ai`)         |
| Command Code | `api.commandcode.ai`                         | `GET https://api.commandcode.ai/alpha/billing/credits`    |
| Ollama Cloud | `ollama.com`                                 | `GET https://ollama.com/api/balance`                      |
| AiHubMix     | `aihubmix.com`                               | `GET https://aihubmix.com/dashboard/billing/remain`       |

An endpoint on OpenCode Zen (`opencode.ai/zen` or `opencode.ai/inference`, not
Go's `/go` or a `/custom` provider) sends nothing either: OpenCode tells no key
its balance, so its section says to read it on the OpenCode console.

It carries the key as `Authorization: Bearer`, `Accept: application/json`,
`User-Agent: Osuna/<version>` and the endpoint's own **Headers**, which can
replace that user agent. When it is sent depends on the "Auto-refresh balance
and plan usage" switch at the bottom of the API endpoints page (on by default,
for the whole host):

| Switch | The API endpoints page (endpoints that are on)    | An endpoint's page (on or off)                    |
| ------ | ------------------------------------------------- | ------------------------------------------------- |
| On     | When you open it, then every minute it stays open | When you open it, then every minute it stays open |
| Off    | When you open it                                  | When you open it                                  |

Bringing the app back to the front counts as opening the page, and a page you
can't see sends nothing. Refresh in the "Balance and plan usage" section always
sends it. With the switch off, opening a page again within 30 seconds of the
last read sends nothing, and the daemon refuses any read the app didn't mark as
yours (as magpie's "When I ask"), answering with the reading it kept. The daemon
keeps each endpoint's reading for a minute, so pages open together share one
request; Refresh skips what it kept, and saving or deleting the endpoint drops
it. When a read is temporarily unavailable (429, 5xx, a timeout, a network
error), the section and the row show the last good reading with its age
instead, kept on disk across restarts (`balance-readings.json` in
[data-model.md](data-model.md)). Each request times out after 15 seconds and a
whole read after 30. Nothing is sent at startup, and the price table switch
does not cover it, nor does this switch cover the CLI logins' plan usage. The
answer is shown only: failover never reads it. What the vendor said on a failure
is shown with the key and header values masked, cut to 200 characters.

"From the website" in the add or edit dialog of a custom API endpoint also runs
only when you press it. The daemon looks for the icon of the site the endpoint's
base URL is on: for each of the API's host and the domains above it
(`api.relay.com`, then `relay.com`), a GET of `/api/status` (where a new-api or
one-api panel names its logo), of the home page, and of the pictures the page
names or `/favicon.ico`, stopping at the first picture it can keep. Requests carry
`User-Agent: Osuna/<version>` and nothing else of yours; the endpoint's key is
never sent. Every site and picture asked for is an `https` address, and only
hosts whose every address is public are reached, redirects included: a base URL
on this computer or the local network is refused before any request. The
whole search stops after 30 seconds, each picture after 15, and the picture is
kept like one you picked yourself. The price table switch does not cover it.

An import link (`paseo://import?...`) can name the endpoint's picture with
`icon=`. The daemon fetches that one picture as soon as the link's dialog opens,
as magpie does, with the same identity and public-host rule: `https` only, at
most 1 MB, given up after 15 seconds, keeping the default icon. The picture
stays in memory and is kept on disk only when you add the endpoint. The link's
key is never sent with it.

While Claude Code's or Codex's API endpoint switch is on, reading that
provider's settings page can send two checks of the daemon's own. Each times out
after 3 seconds and its answer is reused for 20 seconds:

| Request                                | Sent when                                                                                                                                                                                                                                  | Identity                                                                            |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `GET <gateway>/` through a proxy       | Codex would reach the gateway through an HTTP proxy (from the login shell, the daemon's environment or the system settings) that `NO_PROXY` doesn't exempt, and nothing else is wrong; asks whether the proxy passes the request back here | `User-Agent: Osuna/<version>`, plus the proxy's own credentials if its URL has them |
| `GET` to the root of a managed address | Claude Code's managed settings set `ANTHROPIC_BASE_URL` to an address that is not the gateway but could be a proxy in front of it (another host, or a loopback address with a path of its own); asks whether it answers as the gateway     | `User-Agent: Osuna/<version>`                                                       |

The gateway's calls to an endpoint are the connection you turned on: the
requests it forwards for the CLIs, and its own, such as the summary it asks for
when Codex compacts a conversation on an endpoint model.

Two more kinds of traffic pass through or start beside the daemon without being
its requests:

- For Codex signed in with ChatGPT, the gateway forwards Codex's requests for
  ChatGPT's own models, including the model list, to `chatgpt.com` as Codex sent
  them, Codex's own sign-in included. The one change is in a conversation that
  carries a compaction summary the gateway made for an endpoint model: that item
  goes as a plain message. A request
  carrying an OpenAI API key goes to `api.openai.com` the same way. The daemon
  reads no credential and adds nothing ([ADR 0010](adr/0010-codex-wiring-and-gateway-caller-recognition.md)).
- To learn how Codex is signed in, the daemon starts Codex's own app-server and
  asks it. With a ChatGPT sign-in, Codex then asks `chatgpt.com` for the
  account's workspace, with its own credentials.

Reading the login shell's environment, reading the system proxy settings,
listing processes, and restarting Codex's shared background app-server stay on
the machine.

## Your own prices

`features.usage.pricing.overrides` is a list of `{ model, pricePerMillion,
note? }`. The match is the stored model id exactly, ignoring case and
surrounding space — no normalization, no prefix stripping, so an override
applies to the id as your logs spell it and to nothing else. All four columns
are required; zero is a price, which is how you mark a model as free rather than
as unknown. A repeated model takes its last entry. Removing the entry removes
the price; "Remove custom price" in the price table deletes every entry for that
model and leaves the rest, notes included.

An override wins over the table. Everything else falls back to the table through
the lookup order in `packages/server/src/server/usage/pricing/matcher.ts`: the
id as written, the Claude spelling the table uses, the undated id, then the same
steps with a gateway prefix removed. A model that survives all of that unmatched
costs zero and is reported as unpriced. The price table lists those models at
the top of its "Custom prices" group, marked "No price data", with inputs open
for the four columns; saving writes the override and the row stays in that group.
