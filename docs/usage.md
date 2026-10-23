# Usage

The daemon reads the session logs the local CLIs already write, turns them into
token counts, and prices them. Requests that went through the **Gateway** are
also in its own ledger, which says which API endpoint answered; the two are
merged so a call counts once ([The gateway ledger](#the-gateway-ledger)).
Nothing is sent anywhere; the one exception is the price table, below.

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

## The gateway ledger

The gateway writes one row per Claude Code or Codex request it carried, when the
request ends ([ADR 0014](adr/0014-gateway-ledger-merges-with-cli-logs.md)): the
endpoint and model that answered, the six token columns, the duration, the time
to first content, the stop reason, every try with its outcome, and the id of the
reply the CLI got back. No prompt, reply text, tool arguments or body is
written. On the translated path the id is the one the gateway wrote back to the
CLI, so it is the one the CLI logs. Writing the row changes no byte sent to the
endpoint or to the CLI.

Codex's ChatGPT models, which the gateway relays to ChatGPT when Codex signs in
with ChatGPT, get a row too, under **Official** and never at an endpoint's
multiplier, with the ask to ChatGPT as its one try. Only `/responses` is
recorded, as in magpie; compaction and search are not. A ChatGPT reply that
breaks off after it began, or that Codex leaves, is booked as far as it came,
not as a failure; Codex leaving before ChatGPT answers is booked as ChatGPT not
reached (`context canceled`), not as cancelled. Both are what magpie's
`codexUpstreamOn` does.

A request no one answered is a row of 0 tokens: every endpoint failed, or the
agent went away first. The first is `failed`, the second `cancelled` with a
`canceled` try, magpie's words. When every endpoint was resting and the gateway
handed back the stored error without asking, the resting endpoint it named is
the request's one try, 0 ms long, with its cooldown, as magpie keeps a try for
it. Each try keeps its endpoint, result, failure class, the vendor's words (key
masked, cut to 200 characters) and the cooldown it caused, so a failure, a
refusal (result `refused`) and a re-ask without a refused field (`reasked`)
read apart. The row's `error` is the text the agent was sent. These rows add no
tokens, but count as an error under the unknown project at the endpoint last
tried, as magpie counts failed calls in its groups, so the unknown project is
listed even when every request in the period failed.

The ledger and the CLI log meet on that id (Claude `message.id`, the
`response_id` of Codex's `token_usage_record`; a rollout old enough to have only
`token_count` names none, so its calls stay Official):

- **Both have the call**: one row. Tokens and endpoint come from the ledger;
  project, session and turn from the log, since the gateway cannot tell which
  project or Osuna session a request belongs to. Claude Code's split lines of
  one reply are deduplicated first, as before, and the merge pairs the
  deduplicated reply.
- **Only the ledger**: counted under no project and no session, at the time the
  request started. The project split shows these as the unknown project.
- **Only the log**: a direct call, counted as **Official**. Every call from
  before the ledger existed is in this group too, including ones that went
  through the gateway: there is no way back to which endpoint answered them.

The merge is the same whichever side reaches disk first and whether the daemon
restarts in between, a hard kill included. Rows are increments, so nothing is
rewritten: a ledger row lands at once under no project, and the move to the
log's project and the endpoint (Official gives back what the log counted, the
unknown project what the ledger counted there) is written only in the scan
batch that also writes the log's reply, with a `merged` record marking it done.
A batch the kill threw away was never moved, so the next scan moves it; a moved
one is marked and is not moved twice. Log lines that correct a reply after the
move are taken back from Official as they come. The turn a call ran in stays
counted on the log's row, which is why an Official group can be left holding
turns and no tokens; the report leaves such a group and model out. A reply of
any age merges, as magpie merges over the whole period it reads.

Pi and OMP follow the same rule once they go through the gateway: a log entry
matched by its reply id merges as above; one that matches no ledger row and
whose provider is the gateway Osuna writes into their config is skipped, and
only the ledger counts it, as magpie's `calls_pi.go` does.

### Two layers: summaries and per-request records

Usage is kept twice. The 15-minute bucket and turn rows are the summaries: every
total, split and cost on the page reads them, and they are kept forever. The
per-request records under `usage/requests/` are the ledger rows, the CLI log
replies (Claude Code, Codex, Pi and OMP; Pi and OMP name a reply by session and
entry id) and the `merged` markers. They back the Requests tab, and they are what
a restart reloads to carry on merging.

The records keep 30 days and 200 MB, as magpie keeps its routing history. After
a write, at most once an hour, the daemon gzips every day that is over, then
deletes the days older than 30 days (today counts as one) and the oldest days
until the rest fit 200 MB, counted compressed; a day goes whole and today always
stays. A late record for a gzipped day (a log line correcting an old reply) goes
to that day's plain file again and joins the `.gz` as a gzip member of its own
at the next prune; until then the two read as one day. Memory forgets the same days, so the list
and the merge end where a restart would load them. A `merged` marker sits in the
file of its ledger row (both stamped with the request's start), so the two go
together and a pruned day never moves a call twice. What pruning gives up: a log
line that corrects a reply after its ledger row is gone counts at Official, and
so does a reply first scanned after its ledger row was pruned. Summaries never
change.

### The Requests tab

`usage.requests.list` lists the records newest first, a page of 100 at a time
(magpie's request page), with the total the filters keep and the choices the
period offers whatever the filters keep. A call both sides have is one row with
the log's model, session and project and the ledger's tokens, timing and tries;
a reply only the log has is a direct row at Official with no timing and no
tries. Status follows magpie: failed is a request the agent got an error for
(failed or cancelled), named after its last try's failure class; switched is one
answered after more than one try. A request no one answered is listed at the
endpoint it last tried. The search looks in the model, the endpoint names, the
session, the project, the error and the tries' reasons, ignoring case. Output
speed is magpie's `DecodeOf` without the held-reply check, which needs a
streaming time the ledger does not keep yet. The client asks each counted host
for its newest `offset + limit` rows and merges them, so a page across hosts is
exact.

### Endpoint cards

Usage counts an endpoint by its id, so a rename shows the new name over all of
its calls and a duplicate is a card of its own. The name comes from
`endpoint-snapshots.json` ([data-model.md](data-model.md#9-api-endpoints)), which
also keeps a deleted endpoint's last name: its usage stays, marked "(deleted)",
and no balance is read for it. An id the ledger names that is in neither
`endpoints.json` nor the snapshots (deleted before snapshots existed, or the file
was lost) is deleted too, under the name its last ledger row recorded.

Across hosts the client puts endpoints of one name on one card and adds Official
up, since the same relay set up on two machines has two ids; the card is deleted
only when it is deleted on every host. On one host an endpoint is its id: a host
joins the card with its live endpoint of that name (or its only one, when all are
deleted), and any other of that name there is a card of its own. When some host
has two or more live endpoints of one name, no endpoint of that name is merged
across hosts, since nothing says which of the two the other host's stands for.
Picking a host splits
them again. The balance line is the first host's reading that has something to
show.

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

### Codex's resets

The Codex plan usage card reads `chatgpt.com/backend-api/wham/usage` with
Codex's own sign-in (`auth.json`) whenever the card is shown, at most once in 5
minutes per account unless you press Refresh. When that answer says the ChatGPT
account holds resets, the same read sends `GET
chatgpt.com/backend-api/wham/rate-limit-reset-credits` with the same bearer
token, `ChatGPT-Account-Id` and `User-Agent: Osuna/<version>`, for when each
one expires. It waits 4 seconds; on any failure the card shows the count alone.
The sign-in file is read, never written.

**Use a reset** on the card is the one place Osuna uses a CLI's sign-in to change
the account rather than read it; the sign-in itself is still only read. It sends
nothing until you confirm. Then it reads the same list again, picks the
available reset that expires soonest (ones without an expiry last), and sends
`POST chatgpt.com/backend-api/wham/rate-limit-reset-credits/consume` with the same
headers and a body of `{credit_id, redeem_request_id}`, where
`redeem_request_id` is a fresh random UUID so a retried request uses one reset
at most. If the list can't be read, it uses none and says so. The answer's
`code` (`reset` with `windows_reset`, `nothing_to_reset`, `no_credit`,
`already_redeemed`) is shown on the card, and the account is read again past
the 5-minute cache. Osuna never uses a reset on its own.

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

The balance read goes to the endpoint's **Balance URL** when you set one in the
edit dialog's Advanced, on any endpoint, templated or custom. It is asked with
`GET`, or with `POST` and no body when you pick POST, and `{key}`, `{apiKey}`,
`{api_key}`, `{token}`, `{{key}}` or `${API_KEY}` in the address (escaped) or in
a header value is replaced with the key. Without one, it goes to the vendor's
own balance query, which the daemon picks by the host of the endpoint's base
URLs (Chat Completions first, then Responses, then Anthropic), never by its
template. An endpoint on a host the daemon doesn't know with no Balance URL, or
one with no key, sends nothing.

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

An endpoint on a plan key also reads its **Plan usage** windows, beside the
balance and on the same schedule, with or without a Balance URL. The daemon
picks the query by the host and path of the base URLs (Chat Completions first,
then Anthropic, then Responses):

| Plan            | Base URL                                            | Request                                                                   |
| --------------- | --------------------------------------------------- | ------------------------------------------------------------------------- |
| GLM Coding Plan | `open.bigmodel.cn` / `api.z.ai`                     | `GET https://open.bigmodel.cn/api/monitor/usage/quota/limit` (`api.z.ai`) |
| Kimi Code       | `api.kimi.com` / `api.kimi.ai`, path with `/coding` | `GET <base>/coding/v1/usages`, on the endpoint's own host                 |
| MiniMax         | `api.minimaxi.com` / `api.minimax.io`               | `GET https://api.minimaxi.com/v1/token_plan/remains` (`.io`)              |
| OpenCode Go     | `opencode.ai/zen/go` or `opencode.ai/inference/go`  | `GET https://opencode.ai/zen/go/v1/usage`                                 |
| Command Code    | `api.commandcode.ai`                                | `GET https://api.commandcode.ai/alpha/billing/credits`                    |
| Ollama Cloud    | `ollama.com`                                        | `GET https://ollama.com/api/balance`                                      |

These carry only the key (`Authorization: Bearer`, the bare key for GLM),
`Accept: application/json`, `Accept-Language: en-US,en` and
`User-Agent: Osuna/<version>`, never the endpoint's Headers. OpenCode Go's also
carries a new `x-opencode-session` and `x-opencode-session-id`, without which
OpenCode's gateway answers 400. A key that has no plan shows nothing: a reply
with no windows, or a failed read of a GLM key off `/api/coding/` or of any
MiniMax key (pay-as-you-go keys use the same address), unless the failure is
temporary, as does a Command Code or Ollama Cloud key with no windows. Command
Code and Ollama Cloud are asked the same address twice, once for the balance and
once for the windows, as magpie asks it. When Command Code's reply leaves out
the plan, the daemon also asks `GET
https://api.commandcode.ai/alpha/billing/subscriptions` with the same key, at
most every ten minutes per key, for the month's credits the Credits window is
measured against.

A GLM key whose own read shows no windows (or fails, other than the key being
refused) is asked as a team plan's, only when the endpoint has both the **Team
organization ID** and **Team project ID**: `GET
<site>/api/monitor/usage/quota/limit?type=2` with the bare key,
`Bigmodel-Organization`, `Bigmodel-Project` and `Set-Language` (`zh` on BigModel,
`en` on Z.ai), first at the key's own host and then, for BigModel, at
`bigmodel.cn`. The site that answers is then asked `GET
<site>/api/biz/customer-package-reset/list?targetType=TEAM` with the same headers
for the team's resets by window; magpie reads those only with a ZCode sign-in,
which Osuna doesn't read, so when the key isn't taken there no count shows.
"Check balance" and "Detect URL" don't read plan windows.

Volcengine Ark's Coding Plan and Agent Plan and Tencent Cloud's Token Plan
Enterprise tell their windows only to the account's cloud access key, never to
the plan's key, so the endpoint's **AccessKey ID** and **Secret Access Key**
(Tencent's SecretId and SecretKey) go to the vendor's open platform, not to the
endpoint's address, on the same schedule as the balance:

| Plan                                | Base URL                                                               | Request                                                                                                                                                          |
| ----------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Volcengine Ark Coding Plan          | `ark.<region>.volces.com/api/coding`                                   | `POST https://open.volcengineapi.com/?Action=GetCodingPlanUsage&Version=2024-01-01`, body `{}`                                                                   |
| Volcengine Ark Agent Plan           | `ark.<region>.volces.com/api/plan`                                     | `POST https://open.volcengineapi.com/?Action=GetAFPUsage&Version=2024-01-01`, body `{}`                                                                          |
| Tencent Cloud Token Plan Enterprise | `tokenhub.tencentmaas.com/plan` / `tokenhub-intl.tencentmaas.com/plan` | `POST https://tokenhub.tencentcloudapi.com/`, `DescribeTokenPlanList` (`{"Offset":0,"Limit":100}`), then `DescribeTokenPlan` (`{"TeamId":…}`) for each team plan |

Volcengine's request is signed as its SDK signs it (`HMAC-SHA256` over
`content-type;host;x-content-sha256;x-date`, scope `<date>/<region>/ark/request`,
the region from the host, `cn-beijing` when it names none). Tencent's carries
`X-TC-Action`, `X-TC-Version: 2026-03-22`, `X-TC-Region` (`ap-guangzhou`, or
`ap-singapore` on the intl host) and `X-TC-Timestamp`, signed `TC3-HMAC-SHA256`
over `content-type;host;x-tc-action`. Both carry `User-Agent: Osuna/<version>`
(Volcengine's also `Accept: application/json`) and only the signature, never the secret, the
plan's key or the endpoint's Headers. An endpoint missing either half of the
access key sends nothing and its section says "Needs AccessKey"; Ark's
pay-as-you-go (`/api/v3`) has no windows and asks nothing. A refused signature or
access key (401, 403, an `AuthFailure…`, `SignatureDoesNotMatch` or
`AccessDenied` code) adds "check the AccessKey and its permissions". The access
key never reaches a log, and no RPC returns it except the edit dialog's Show.

Each window carries its pace as of the read: the share used less the share of the
window gone by, the window starting its length before its reset, and a monthly
one on the same day a month before.

An **Account token** saved on the endpoint replaces the key as the whole
`Authorization` header: a JWT (a sub2api login token) as `Bearer <token>`, one
written with its scheme as is, any other (a new-api or AiHubMix system access
token) bare. It goes to the Balance URL with the endpoint's headers, or, on
AiHubMix with no Balance URL, to `GET https://aihubmix.com/api/user/self` with
none of them. The **User ID** goes as `New-Api-User` on the Balance URL's request
only, over a `New-Api-User` header set on the endpoint, and never on a chat
request. A token beside a query that takes only the key (new-api's
`/api/usage/token`, sub2api's `/v1/usage`) sends nothing: the section names the
account query to use instead. An account query (`/api/user/self`,
`/api/v1/user/profile`) without a token asks the same site's key query with the
key, unless the endpoint sets its own `Authorization` or `Cookie` header. The
token never reaches a log, and no RPC returns it except the edit dialog's Show.

"Check balance" in the edit dialog sends the same read once, when you press it,
with what is in the form: its Balance URL, method, field, key, account token,
user ID, base URLs and headers, saved or not. Its answer is not kept for the
minute nor as the last reading.

"Detect URL", under the Balance URL in the edit dialog, is the only request that
guesses an address, and only when you press it. With the form's key, base URLs
and headers (never the account token) it asks `GET <site>/api/usage/token`
(new-api), then `GET <site>/v1/usage` (sub2api), and stops at the first that
answers with a balance, filling that address into the form with its default
field. The site is the scheme and host of the first http(s) base URL, taken in
the order Chat, Anthropic, Responses. When neither answers, each address's
reason stays under the button. Nothing is saved, kept for the minute, or taken
as the last reading, and the daemon never sends these two requests on its own:
not when listing, reading balances or starting.

The balance read carries the key as `Authorization: Bearer`, `Accept: application/json`,
`User-Agent: Osuna/<version>` and the endpoint's own **Headers**, which can
replace that user agent. When both are sent depends on the "Auto-refresh balance
and plan usage" switch at the bottom of the API endpoints page (on by default,
for the whole host):

| Switch | The API endpoints page (endpoints that are on)    | An endpoint's page (on or off)                    | The Usage page (endpoint cards not deleted)       |
| ------ | ------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------- |
| On     | When you open it, then every minute it stays open | When you open it, then every minute it stays open | When you open it, then every minute it stays open |
| Off    | When you open it                                  | When you open it                                  | When you open it                                  |

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

### An endpoint's price multiplier

A relay that bills a share of the public price gets a **Price multiplier** in
its edit window, under Advanced: 0 to 1000, at most three decimals, empty for
the list price, 0 for free. The price of a row is found in this order, as
magpie's `priceOf` does:

1. A custom price for the model, as entered. It is not multiplied.
2. The table price, through the lookup above, times the multiplier of the
   endpoint the row went through.
3. An Official row is the table price as it is.

Cost is still computed on read, so a new multiplier reprices that endpoint's
whole history, and the daemon sends `usage.pricing.updated` so open pages
re-read. A deleted endpoint stays at the multiplier it had when it was deleted,
read from `endpoint-snapshots.json`. The Usage page, the session list and turn
usage price the same way; a turn that went partly through an endpoint is priced
row by row. Two places differ from magpie on purpose: magpie reads 0 as "no
multiplier", and prices an endpoint it no longer knows at the list price.
