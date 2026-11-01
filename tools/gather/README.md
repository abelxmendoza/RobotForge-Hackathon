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
