# Usage

The daemon reads the session logs the local CLIs already write, turns them into
token counts, and prices them. Nothing is sent anywhere; the one exception is
the price table, below.

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

## The one outbound request

This is the only network request the daemon makes on its own initiative. It is
a plain GET to `raw.githubusercontent.com` for that one public file: no
authentication, no query string, no request body, nothing about you or your
machine beyond the IP and user agent any HTTP request carries. Everything else
the daemon fetches is either something you asked for or a connection you turned
on.

It runs 30 seconds after start and every 24 hours after that. It skips the
request when the table it already fetched is younger than a day; a daemon still
running on the built-in snapshot always asks, however recent that snapshot's own
date is. The request is
conditional (`If-None-Match`), so an unchanged file costs a 304 rather than 2.7
MB. It times out after 15 seconds; a failure is logged at `info`, retried an
hour later, and never replaces the table you already have.

Turn it off with `features.usage.pricing.autoUpdate: false` in `config.json`, or
`PASEO_USAGE_PRICING_AUTO_UPDATE=0` at launch. Off means the daemon prices from
the built-in snapshot and your own prices, and never reaches the network —
including on a host that has no network at all. The switch covers the automatic
check only: "Refresh now" in the price table still fetches when you press it.

## Your own prices

`features.usage.pricing.overrides` is a list of `{ model, pricePerMillion,
note? }`. The match is the stored model id exactly, ignoring case and
surrounding space — no normalization, no prefix stripping, so an override
applies to the id as your logs spell it and to nothing else. All four columns
are required; zero is a price, which is how you mark a model as free rather than
as unknown. A repeated model takes its last entry. Removing the entry removes
the price.

An override wins over the table. Everything else falls back to the table through
the lookup order in `packages/server/src/server/usage/pricing/matcher.ts`: the
id as written, the Claude spelling the table uses, the undated id, then the same
steps with a gateway prefix removed. A model that survives all of that unmatched
costs zero and is reported as unpriced, which is what the price table's amber
pill shows.
