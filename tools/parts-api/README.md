# Parts API v1 — RobotForge's own supplier API

Suppliers won't give us an API, so RobotForge becomes the API
(Forge Engine architecture §9, `~/workspace/hackathon/
forge-engine-architecture-2026-11-01.md`). The **gather pipeline**
(`tools/gather/`) is the ingestion side — it fetches public supplier
pages and datasheets and extracts prices/specs **with receipts**.
This is the serving side: records live in the Worker's KV namespace
and are served with their trust states intact.

When Nexar/Mouser keys arrive later, those APIs become additional
**upstream** sources feeding the same records (`source_kind: "api"`)
— the consumer-facing shape below never changes.

All routes are additive in `live/worker.js`; auth and model routes
are untouched. **This PR ships code + tests + tooling only — the
Worker is NOT deployed and production KV is NOT seeded.** The
deploy+seed runbook is at the bottom.

## Endpoints

Base: `https://robotforge-live.abelxmendoza.workers.dev`
Public read, the site's existing CORS origins, JSON everywhere.
`/health` reports `routes.parts: true` when KV is bound.

| Route | What it returns | Cache |
|---|---|---|
| `GET /parts` | List of part summaries. Filters: `q` (name/MPN substring), `category` (exact, case-insensitive), `interface` (exact, case-insensitive). Each entry: `id`, `name`, `mpn` (null when unrecorded), `category`, headline `specs`, `interfaces`, `photo` (URL + credit) when a verified record exists, `best_estimate` (amount + `state` + `source_kind`) or `null`. | `public, max-age=60, s-maxage=3600` |
| `GET /parts/:id` | The full record: specs, photo record, **all** price estimates (supplier, qty breaks, `fetched_at`, `expires_at`, `source_kind`, `state`, quote receipt), provenance. Unknown id → clean `404 {"error": "...", "code": "part_not_found"}`. | `public, max-age=60, s-maxage=3600` |
| `GET /parts/:id/estimate` | The current best estimate + `alternates` + any `expired` ones + explicit `unknowns` (`shipping`, `tax`, `stock`) + `as_of`. Expired estimates are flagged `expired: true` and never returned as the current best. | `public, max-age=60, s-maxage=300` |
| `POST /bom/estimate` | Body `{"lines":[{"partId","qty"}]}` (max 100 lines). **Deterministic rollup — no model calls, no budget spent.** Per line: the applied price break for the requested qty, `line_total`, the estimate's trust fields. Totals split `by_source_kind` plus `unverified_web_gathered_total` (the exact amount resting on state-`web_gathered` estimates). Unpriced lines are listed in `unpriced` (never zero-filled); unknown part ids are per-line `unknown_part` results, not a 500; lines whose only estimates are expired land in `stale` and stay out of the totals. | `no-store` |

Every response that carries prices includes
`"disclaimer": "Estimates — verify price and availability before purchase."`
Without the KV binding the parts routes answer
`503 {"code": "parts_not_configured"}`; with KV bound but nothing
seeded, `GET /parts` answers `{"seeded": false, "count": 0}` — an
honest empty, never an error or an invented catalogue.

## Record schema

One KV key per part (`parts:<id>`) plus one index (`parts:index`
→ `{ids, count, seeded_at, seed_version}`). Records are built by
`seed.py` from three sources, field-for-field aligned with the
shapes that already exist in the repo:

- **Catalogue** (`catalog/parts.json`): `id`, `name`, `blurb`,
  `used_for`, `notes`, `source`, `license`, `specs`, `robot_types`.
  `category` is the catalogue's `part_class`, renamed. `mpn` is the
  catalogue's `mpn`/`specs.mpn` when recorded — **nothing in the
  catalogue records MPNs today, so `mpn` is `null` until the gather
  pipeline or an API upstream supplies one**; it is never invented.
  `interfaces` derives from `specs.interfaces[]` where recorded,
  else from the `specs.interface` free-text string split on `/`
  (today: 13 of 50 parts).
- **Price estimates** — the canonical shape is the **gather
  pipeline's** `price_estimate` (snake_case), which is also the
  shape `tools/gather/apply.py` writes into catalogue parts:
  `{unit_price, currency, price_breaks: [{qty, unit_price}],
  supplier, supplier_url, source_kind, state, fetched_at,
  expires_at, quote, stock_wording}`. `source_kind` ∈
  `api | web_gathered | user_entered`; `state` ("verification") ∈
  `web_gathered | cross_checked | confirmed` (only the latter two
  may feed safety checks, §8). **Field mapping to
  `lib/buildPlan.ts`'s `SourcedPrice`:** `amount` ↔ `unit_price`,
  `url` ↔ `supplier_url`, `snippet` ↔ `quote`, `verification` ↔
  `state`, `qtyBreak` ↔ `price_breaks[0].qty` when a single break
  is recorded. `seed.py` accepts both spellings on input and
  always emits the canonical gather shape.
- **Photo records** — `part.photo` only:
  `{url, credit, source_page, fetched_at, state}`. The catalogue's
  `part.image` is an AI-generated illustration and is **never**
  served as a photo; a part with no verified photo record serves
  `photo: null`.

**Trust ranking** (best estimate): unexpired first; then
verification state (`confirmed` > `cross_checked` > `web_gathered`);
then source kind (`api` > `web_gathered` > `user_entered`); then
freshest `fetched_at`. An expired estimate is never the best, and a
confirmed estimate beats a fresher unverified one.

**The no-currency-without-a-source-record invariant:** an estimate
is servable only with a finite `unit_price`, a source URL
(`supplier_url` or `url`), and a `fetched_at`. Anything else is
dropped at seed time *and* filtered again at serve time, so
hand-edited KV can never put a bare number on the wire. Enforced by
tests at both layers.

## Examples (real output)

Seeded from `tests/fixtures/parts_api/` (catalogue fixture + one
gather proposal run) through `seed.py` into a test KV, served by
the Worker itself:

`GET /parts?category=drivers`

```json
{
  "ok": true, "seeded": true, "count": 1,
  "parts": [{
    "id": "driver_tb6612fng", "name": "TB6612FNG dual motor driver",
    "mpn": null, "category": "drivers",
    "specs": {"channels": 2, "current_a_per_channel": 1, "voltage_v_max": 15},
    "interfaces": [], "photo": null,
    "best_estimate": {
      "unit_price": 4.95, "currency": "USD", "supplier": "Pololu",
      "source_kind": "web_gathered", "state": "web_gathered",
      "fetched_at": "2026-11-01T09:25:48Z", "expires_at": "2026-11-02T09:25:48Z"
    }
  }],
  "as_of": "2026-11-01T10:03:17.662Z",
  "disclaimer": "Estimates — verify price and availability before purchase."
}
```

`GET /parts/servo_sts3215/estimate` — the price came from a gather
**proposal** (not yet applied to the catalogue); the seed merged it
as a `web_gathered` estimate with its quote receipt:

```json
{
  "ok": true, "part_id": "servo_sts3215", "as_of": "2026-11-01T10:03:17.684Z",
  "estimate": {
    "unit_price": 19.99, "currency": "USD",
    "price_breaks": [{"qty": 1, "unit_price": 19.99}, {"qty": 10, "unit_price": 17.49}],
    "supplier": "Waveshare",
    "supplier_url": "https://www.waveshare.com/sts3215-servo.htm",
    "source_kind": "web_gathered", "state": "web_gathered",
    "fetched_at": "2026-11-01T08:00:00Z", "expires_at": "2026-11-02T08:00:00Z",
    "quote": "$19.99", "expired": false
  },
  "alternates": [], "expired": [],
  "unknowns": ["shipping", "tax", "stock"],
  "disclaimer": "Estimates — verify price and availability before purchase."
}
```

`POST /bom/estimate` with lines
`[{driver_tb6612fng ×150}, {servo_sts3215 ×4}, {realsense_d435 ×1}, {not_a_part ×1}]`
— qty 150 applies the 100+ break ($3.85); the camera has no estimate
on record and the unknown id is a per-line result:

```json
{
  "ok": true, "as_of": "2026-11-01T10:03:17.688Z",
  "disclaimer": "Estimates — verify price and availability before purchase.",
  "unknowns": ["shipping", "tax", "stock"],
  "lines": [
    {"partId": "driver_tb6612fng", "qty": 150, "status": "priced",
     "qty_break": 100, "unit_price": 3.85, "line_total": 577.5, "currency": "USD",
     "estimate": {"unit_price": 4.95, "supplier": "Pololu", "state": "web_gathered", "…": "…"}},
    {"partId": "servo_sts3215", "qty": 4, "status": "priced",
     "qty_break": 1, "unit_price": 19.99, "line_total": 79.96, "currency": "USD",
     "estimate": {"unit_price": 19.99, "supplier": "Waveshare", "state": "web_gathered", "…": "…"}},
    {"partId": "realsense_d435", "qty": 1, "status": "unpriced", "reason": "no_estimate_on_record"},
    {"partId": "not_a_part", "qty": 1, "status": "unknown_part"}
  ],
  "totals": {
    "currency": "USD", "priced_total": 657.46,
    "by_source_kind": {"api": 0, "web_gathered": 657.46, "user_entered": 0},
    "unverified_web_gathered_total": 657.46, "priced_lines": 2
  },
  "unpriced": ["realsense_d435", "not_a_part"], "stale": []
}
```

## Seed tool

```sh
# Build records locally (no network, no KV writes):
python3 tools/parts-api/seed.py build \
    [--catalog catalog/parts.json] \
    [--proposals-dir tools/gather/proposals] \
    [--out tools/parts-api/records.json]

# Upload to KV (deploy-time only; needs the Cloudflare credential
# the cf_api helper uses — dynamic_credentials or CLOUDFLARE_API_TOKEN):
python3 tools/parts-api/seed.py upload --records tools/parts-api/records.json \
    --account <account-id> --kv-id <RF_LIVE_KV namespace id>
```

Merge rules: a catalogue-applied `price_estimate` is the primary
estimate; gather **proposal** estimates join as alternates, except
when a proposal names the same supplier URL as an applied record —
the applied record wins (a proposal never displaces or duplicates
its own source). Estimates that fail the source-record invariant
are dropped. Re-running the seed is idempotent: same inputs → same
records (modulo `seeded_at`).

## Deploy + seed runbook (the remaining steps after this PR)

1. **Deploy the Worker** with the established discipline —
   `cf_api.py` upload metadata must carry
   `keep_bindings: ["secret_text"]` so the five existing secrets
   survive; verify `GET /health` afterwards: `ok: true`,
   `configured`/`baseten`/`meta` unchanged, `routes.parts: true`.
2. **Seed production KV** (same account as the Worker,
   `12b0787876fd57ea7996f5e39f39deb4`; KV id from
   `cf_api.py kv-list` — `RF_LIVE_KV`):
   `seed.py build` against the live `catalog/parts.json` + the
   gather proposals directory, then `seed.py upload`.
   Expect 50 records; prices appear only where gather output has
   actually been applied/proposed (today: the TB6612FNG Pololu
   record from the gather smoke run) — everything else seeds
   honestly unpriced.
3. **Verify:** `GET /parts` count == catalogue count (50);
   `GET /parts/driver_tb6612fng/estimate` returns the Pololu
   estimate with its quote; one `POST /bom/estimate` rollup by
   hand; anonymous `/describe` still 401s (the account gate is
   untouched) and the daily budget is unmoved by parts calls.

## Tests

- `tests/worker_mock.mjs` — 10 Parts API scenarios (list + filters
  anonymously, 503 without KV + health flag, honest unseeded empty,
  get 200/404, confirmed-beats-fresher ranking, expired flagged
  never fresh, sourceless price never served, BOM rollup incl.
  qty-break + trust split + unverified share, expired excluded
  from totals, body/line validation) alongside the pre-existing
  auth/gate scenarios — the rollup scenario also asserts **zero
  upstream model calls and zero budget spent**.
- `tests/test_parts_api.py` — seed-tool tests: record shape,
  interface derivation, applied-vs-proposal merge, the source-record
  invariant, the photo≠illustration invariant, index, CLI build,
  and the real catalogue seeding 50 records, all unpriced.
