# Usage

The daemon reads the session logs the local CLIs already write, turns them into
token counts, and prices them. Nothing is sent anywhere; the one exception is
the price table, below.

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
