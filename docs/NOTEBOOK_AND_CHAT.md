# Robot notebook, data workspace, photo chat and discovery

This implementation extends the Next app (`web-next/`) and its existing
Cloudflare Worker (`live/worker.js`). It preserves Muse Spark/Meta inference;
no new model provider or AI SDK migration is required.

## Chat-first notebook

The notebook opens with an embedded conversation and a live, read-only record
preview. Say “I own a rover called Atlas” or “I spotted a robot.” The guide asks
for missing relationship, name, category, purpose and optional details, then
saves the record automatically. “Skip” leaves unknown fields blank; “cancel”
discards the pending draft. Explicit measurements are converted to SI units;
ambiguous lengths trigger a clarification and nonpositive values are rejected.
“Edit in chat” updates the same saved record. Table creation asks for a name,
columns and CSV rows in chat. The manual editor and backups remain collapsed
under an optional panel.

These guided writes use a local deterministic conversation engine. They do not
execute arbitrary model-generated actions. Chat history survives route changes;
the validated pending draft survives reload in sessionStorage. Existing grounded
questions can still be answered while a draft is pending.

## App-owned data

- **My robots** (`/notebook/`): create/edit records for owned projects, research
  robots and sightings. Add measurements in explicit units, advanced JSON
  specifications, notes, dates, optional location, a thumbnail and source links.
  Robotics community research can also be filed here. A record's relationship
  is user supplied, not a claim inferred by a model.
- **Data** (`/data/`): built-in robot specifications, parts and individual
  recorded simulation checks. A notebook table exposes personal records.
  Users can create named tables, add/edit rows, import CSV/XLSX, and export CSV.
  Built-in rows are read-only; provenance and estimated descriptions remain
  visible. Table search filters the display, not statistical calculations. “Analyze matching rows” creates a separate source-labeled table for subgroup calculations; numeric checks with mixed recorded units are rejected.
- Personal records and tables persist in versioned browser localStorage;
  active robot context persists in sessionStorage. Storage errors are shown.
  Tabs synchronize changes through the storage event. There is **no cloud
  database, account isolation or cross-device sync**. JSON export/restore is
  the portable backup path. Shared browsers share local notebook data.
- CSV imports are capped at 2 MB, 10,000 rows and 100 columns. Headers must be
  unique; quoted fields/newlines are parsed. XLSX is read with the lazily loaded
  MIT-licensed `read-excel-file` package; worksheet number is selectable on the
  Data page. Formulas are not executed and cached values are not recalculated.
  Export escapes formula-like text to reduce spreadsheet formula injection.

## Calculations and grounded chat

The Guide reads the current robot and selected table. Local calculations use
actual cells, not generated arithmetic. Examples:

- `average mass_kg`
- `show statistics`
- `probability verdict = PASS`
- `probability mass_kg < 3`
- `correlation mass_kg length_m`
- `Find a lidar sensor for a rover`
- `Find 3 CAD models for a rover camera mount`

Summary: numeric count, excluded cells, mean, median, range and sample standard
deviation. Frequency: numerator/denominator plus a Wilson 95% interval, with the
representative independent-trial assumption explicitly stated. Linear fit:
Pearson r, slope/intercept and R² for complete numeric pairs. None of these
establishes causation, population reliability or success probability for a new
robot. Mixed units, estimates, repeated runs and heterogeneous robot classes
must be considered when interpreting results.

Part matching filters explicit component types and ranks catalogue matches.
Recommendations are candidates; unrecorded mounting, electrical and performance
constraints remain unknown. Supplier references are curated in
`catalog/suppliers.json`; checked dates travel with links. Generic product-family
pages do not prove exact fit. The app never claims live price or stock. Unknown
retailers lead to an explicit search, not a fabricated seller listing.

The live `/chat` request can include bounded selected catalogue context and
four recent text messages. A user must enable **Include my current spec in
live replies** to send private active-spec values. Raw spreadsheet rows and
notebook photos are not included in that context. The server validates context
and history bounds, rejects injected system-role history and treats all supplied
records as untrusted data. Model interpretations stay labeled as such.

## Photos

Forge, chat and the notebook use the same capture/review dialog: upload or
explicitly open the camera, review, rotate and retake. In chat, the attachment dialog only attaches the
photo; the guide then asks whether it shows a robot/component or printed
specifications. The optional manual interfaces retain explicit mode fields. Camera tracks stop when the dialog
closes. Images are decoded/downscaled locally and re-encoded as JPEG.

Chat sends a resized image to the existing `/photo` vision route only when the
user chooses analysis. A robot photo remains ESTIMATED; document mode preserves
printed-value transcription and unknown fields. Drafts become shared active
robot context. The guide asks for ownership and missing record details in chat, then saves
through the same guided record flow; saving does not imply validation. Notebook-only capture saves a local thumbnail
without invoking a vision model.

## Google Sheets

`POST /sheet {id, gid}` reads a CSV export from a Google Sheet that is already
readable without signing in. The server permits only fixed Google export hosts,
checks redirects, rejects login HTML, bounds response size, and never changes
permissions or writes to the source sheet. Imports are snapshots, not live sync.

**Private account-connected Sheets require application OAuth, which is not
configured.** The user's Codex Google Drive connection is not a credential that
can be embedded in the deployed app. Private sheets can be exported by their
owner and uploaded as CSV/XLSX. The UI clearly distinguishes this limitation.

## Sourced discovery

`/research/` lets each user enter a city/region/university and robotics interest,
including rover, underwater/RoboSub, drone/UAV, manipulator and related groups.
Official RoboSub, University Rover Challenge and SUAS pages are linked as
starting indexes. There is no inferred home location or claimed distance ranking.

- `POST /research {query}` uses Brave Web Search if the optional
  `BRAVE_SEARCH_API_KEY` Worker secret is configured. Otherwise it retrieves
  Wikipedia background excerpts with attribution and explicitly limited local
  coverage. Broader web and university searches remain direct user links.
- `POST /models {query}` queries public GitHub repositories, checks a bounded
  set of source trees and returns **up to three** repositories containing real
  STEP/STL/OBJ/SCAD/GLB/DAE/URDF files. File links are pinned to commit SHA.
  Repository license metadata is shown, with per-file licensing and fit review
  required. Search can return fewer than three useful matches or be rate limited.
- Research results can be saved as research records with source URLs; they are
  never automatically labeled owned or simulated.

External reads use fixed hosts, timeouts and existing Worker budgets/CORS/kill
switches. The UI handles unavailable routes and source failures. New routes and
chat grounding require deploying the updated Worker; existing production code
is not changed by local development. No secrets or API keys are included here.

## Verification

Local regression result: **349 passed** (including built-export links). Production package build
compiled and statically exported all 22 pages with the TypeScript check enabled.

`pytest -q` includes the Worker mock suite and the table-math/CSV/notebook schema
suite (the latter needs frontend dependencies). `tsc --noEmit` checks the UI.
The production static export passes with webpack and the installed TypeScript compiler API. Browser checks cover owned-record save/reload, selecting a robot for chat,
creating/editing a table, and chat statistics/probability over its real rows.
Online source routes and vision provider failures are covered with mocked
upstreams, without spending inference credits. Real private OAuth, deployed
Worker integration, camera hardware and broader club-directory coverage remain
separate integration checks.

Chat-first browser verification: created an owned rover with explicit dimensions,
confirmed automatic SI conversion/save and updated mass through “Edit in chat”
with the saved record count remaining one.
