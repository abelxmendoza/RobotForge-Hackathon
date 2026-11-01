# Gather — the web-gathering pipeline (Forge Engine §8)

Muse Spark acts as RobotForge's librarian: this pipeline fetches public
supplier pages and datasheets, extracts prices/specs with Muse Spark, and
files **proposals** for catalog updates. It never silently overwrites a
record — applying a proposal is a separate, explicit step.

## The one command

```bash
# dry run: fetch -> extract -> validate -> diff -> proposals/<run-id>.{json,md}
python3 tools/gather/gather.py run [--part <catalog-part-id>] [--force]

# after reviewing the .md diff, write it into catalog/parts.json
python3 tools/gather/gather.py apply <run-id>
```

`run` prints a JSON report: pages fetched/unchanged/skipped, model calls,
changes proposed, fields rejected. Extraction uses the Meta Model API
connector helper (`meta_api.py`); point `META_API_HELPER` at it if it lives
somewhere else. No API key is handled by this tool — the connector's
surrogate credential does that.

## Why repeat runs are cheap (§8.1)

- Fetched pages live in a **content-addressed cache** (`cache/`, keyed by
  SHA-256 of the bytes, with an ETag/Last-Modified index).
- Within a page's TTL the network is not touched. Past TTL (or `--force`)
  the page is refetched — but if the **hash is unchanged, extraction is
  skipped entirely**. A repeat run over unchanged sources makes **zero
  model calls** and proposes **zero changes**. This is a tested property
  (`tests/test_gather.py::test_second_run_zero_model_calls_zero_changes`).
- Only changed pages pay for exactly one extraction call each; datasheet
  text is windowed to spec/electrical content before it reaches the model.

## The trust gate

The model must attach a literal `quote` from the page to every value.
Deterministic validation then keeps a field only if:

1. the quote is a literal substring of the fetched text,
2. the value/unit parse into the catalog field's canonical unit
   (normalization table in `validate.py`), and
3. the type matches the field schema.

Failures are dropped **with reasons** in the run's proposal — never repaired
or guessed. Surviving values carry state `web_gathered` plus source URL,
fetched-at, and pipeline version. Safety-relevant fields (voltage, current,
torque, fit dimensions) are grouped under "Confirm individually" in the
.md diff; prices and other low-risk fields can be approved in bulk. Even
after `apply`, a value stays `web_gathered` — confirmation is a distinct
human act, and only cross-checked/confirmed values may feed safety checks
(§8). `apply` keeps every prior value in the part's `gather_history`, so
rollback is re-applying the prior value from history.

Per-domain politeness is built in: minimum interval between requests,
an identifying User-Agent, and robots.txt is respected — a disallowed path
is skipped and the skip is reported.

## Adding a part (one entry, no code)

Add one object to `sources.json` (shape: `sources.schema.json`):

```json
{
  "part_id": "<catalog id>", "mpn": "<MPN or null>", "supplier": "<name>",
  "ttl_seconds": {"price": 86400, "stock": 21600, "specs": 2592000, "datasheet": 7776000},
  "pages": [
    {"kind": "product", "url": "https://…", "supplier": "…", "provides": ["price", "stock", "specs"]},
    {"kind": "datasheet", "url": "https://…", "supplier": "…", "provides": ["specs", "datasheet"]}
  ]
}
```

TTLs are per data class: prices/stock short, specs long, datasheets longest
(they change by revision). A part can have several product pages (a second
source is what later lets a value become `cross_checked`) and datasheet
pages, whose values override product-page values on conflict, with the
override noted in the proposal.

## Gathering an UNKNOWN part (on demand)

`gather.py` refreshes parts the catalog already knows. When chat, a BOM,
or a Parts-API 404 names a part the catalog does NOT know, `gather_part.py`
is the intake — it never dead-ends and never writes the catalog:

```bash
# 1. dedupe first: a known part stops here, before any fetch
python3 tools/gather/gather_part.py "TB6612"
#   -> {"status": "known", "part_id": "driver_tb6612fng", ...}

# 2. a genuine miss: an agent/human resolves sources by web search
#    (manufacturer product page + one distributor listing), then:
python3 tools/gather/gather_part.py "AS5600 magnetic encoder" \
    --url https://www.seeedstudio.com/Grove-12-bit-Magnetic-Rotary-Position-Sensor-AS5600-p-4192.html \
    --url https://files.allicdata.com/pdf/ds/2811/AS5600-ASOM%20datasheet.pdf \
    --mpn AS5600
#   -> draft registry entry + proposal, state web_gathered

# 3. a miss with no sources yet is queued, not dropped
python3 tools/gather/gather_part.py "Some new part"
#   -> one line in requests.jsonl, status needs_sources

# 4. drain the queue
python3 tools/gather/gather_part.py --from-requests
```

How each step behaves:

- **Dedupe** is deterministic (squashed-substring + all-token matching
  over catalog ids, names, and `source` strings). No fuzzy edit distance:
  `BNO085` does NOT match the catalog's `BNO055`. A hit costs no fetch,
  no model call, no proposal, and no registry entry.
- **Registry draft.** A miss creates ONE entry in `sources.drafts.json`
  (same shape as `sources.json`, marked `"draft": true` with its origin).
  Re-running reuses it and merges in any new page URLs — there is never a
  second entry for the same part. Page kinds default by URL (`.pdf` =
  datasheet) or per-URL `--kind`; suppliers default from the host.
- **Gather.** Each page runs through the same pipeline (content-hash
  cache, Muse Spark extraction, literal-quote validation, unit
  normalization) against a synthetic stub part, so every value arrives as
  a `spec_new`/`price_update` change in the usual proposal format, plus
  `new_part: true`, the `part_stub`, and a deterministic **photo
  candidate** (the first product page's `og:image`, with supplier credit,
  state `web_gathered`). A re-run over unchanged pages makes **zero model
  calls** and proposes zero changes — the §8.1 property holds on this
  path too.
- **Conflicts.** When two sources disagree on a spec, the datasheet value
  wins (the pipeline's precedence), the losing value is recorded on the
  change under `conflicts`, a note names both values with their quotes,
  and the change is forced into the "Confirm individually" queue.
- **Apply.** `gather.py apply <run-id>` stays the separate step. For a
  `new_part` entry it creates the catalog part (specs, `price_estimate`,
  `photo`) and promotes the draft entry from `sources.drafts.json` into
  `sources.json` — one registry entry per part, in exactly one registry.

### The requests queue — `requests.jsonl`

One JSON object per line:

```json
{"name": "AS5600 magnetic encoder", "hint_url": "https://…", "requested_by": "chat", "at": "2026-11-01T10:00:00Z", "status": "pending"}
```

Fields: `name` (required, free text), `hint_url` or `urls` (optional —
the sources an agent resolved; a `kinds` list parallel to `urls` is
honored), `requested_by`, `at`, `status`. Statuses: `pending` →
`proposed` (drain gathered it; `part_id`/`run_id` recorded), `known`
(dedupe hit; `part_id` recorded), `needs_sources` (no URLs yet — an
agent resolves sources and adds them, then the next drain picks it up).
A line whose sources all fail to fetch stays actionable with a
`last_attempt` note rather than being silently dropped, and a duplicate
of a part already proposed in the same drain is marked as such instead
of being gathered twice. Queueing dedupes too: a second open line for
the same normalized name is refused.

This file is the intake that chat / BOM / API-404 triggers append to.
The site-side counterpart — a Worker endpoint that accepts an
unknown-part report from the web app and appends to this queue — is a
documented **follow-up**, not part of this change; today the queue is
drained from the CLI.

## How this feeds the rest of the Engine

The build-plan engine's price/spec lines accept `source_kind: web_gathered`
values in exactly the shape this pipeline writes into `price_estimate` and
`provenance_gathered` (supplier URL, fetched-at, expiry from the price TTL,
quote). API-sourced values (Nexar/Mouser, Forge Engine Slice 1) outrank
web-gathered ones for the same part when they arrive.

## Known limits

- JS-rendered storefronts (e.g. Digi-Key product pages) return little
  server-side text; those parts price through the supplier APIs instead.
- The stdlib PDF fallback reads simple text layers; `pdftotext` is used
  when installed. A PDF with no extractable text is reported as a skip,
  never guessed at.
- Gathered stock wording is evidence about a moment, not a promise of
  availability at purchase time.
