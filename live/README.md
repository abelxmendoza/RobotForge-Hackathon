# RobotForge live endpoint — deploy runbook

The RobotForge site is static (GitHub Pages) and cannot hold an API
key. This folder is the one server-side piece: a single-file
Cloudflare Worker (`worker.js`) that proxies the site's live calls
and holds the keys as Worker **secrets**. With no endpoint deployed,
the site is exactly the recorded site — the Forge Guide answers from
recorded data, the Forge runs its LOCAL browser checks (spec upload)
and RECORDED sample runs, and photo/list imports explain themselves
and offer the recorded samples. Deploying this Worker and setting
one constant lights the live steps up.

## What it serves

| Route | What it does | Key needed |
|---|---|---|
| `GET /health` | `{ok, mode, configured, kv, budget, routes}` — never spends a model call | — |
| `POST /describe` | `{description}` → validated spec JSON (provider chain below, RobotForge's describe prompt) | any one chain key |
| `POST /chat` | `{message}` → Forge Guide live-model answer (provider chain below) | any one chain key |
| `POST /list` | `{text}` → model-generated parts-list import matched against the site catalogue (provider chain below) | any one chain key |
| `POST /fix` | `{spec, findings}` → `{changes, summary}`: Muse Spark **proposes** bounded spec edits for the validator's findings (only allow-listed fields, typed and positive); the page re-validates — the model never sets a verdict | `BASETEN_API_KEY` |
| `POST /part` | `{image_data_url, note?}` → one inventory part identified from a photo (name, category, label-read specs, a confirming question; catalogue ids sanitized) | `META_API_KEY` (**optional**) |
| `POST /part-chat` | `{part, message, history?}` → `{reply, update, confirmed}`: talk a part through until its owner confirms it | any one chain key |
| `POST /photo` | `{image_data_url, note?, mode?}` → photo draft spec (Meta Model API vision, `muse-spark-1.3`). `mode` omitted/`"photo"`: an ESTIMATED draft from a robot photo. `mode: "document"`: a TRANSCRIBED draft from a spec-sheet/blueprint photo (below) | `META_API_KEY` (**optional**) |
| `POST /transcribe` | `{audio_b64}` → `{transcript, model}`: one spoken description transcribed by Muse Voice Transcribe (`muse-voice-transcribe-1.0`). WAV only — the batch endpoint rejects MP3/WebM containers (verified 2026-10-31), so the site encodes recordings to WAV in the browser | `META_API_KEY` (**optional**) |

`/photo` without the Meta key answers `501 photo_not_configured`
and the site falls back to its recorded photo sample — that is the
designed behavior, not an error. Malformed model output is a 502
with a plain error; raw model junk never reaches the page.

The text routes run a **three-provider chain in measured order**
(fixed 24-description sweep, Oct 2026): **Baseten** serving Muse
Spark Open (24/24) → **Meta Model API direct** serving the hosted
`muse-spark-1.3` (23/24) → **Fireworks** serving Muse Spark Open
(21/24, re-measured 18/24). A provider is attempted only when its
secret is set and every earlier attempt failed (HTTP error, network
failure, empty reply); any one key lights the text routes, and
`/health` reports each under `providers`. Responses report the
model that actually answered — the Meta attempt is a *different
model* (hosted Spark 1.3), not the same model on another host. A
request may pin one provider with `"provider": "baseten" | "meta"
| "fireworks"`; the site never sends it — it exists so the sweep
can be re-measured through this endpoint. Fireworks' transport
also remains in the Python CLI's describe chain (see the top-level
README, "Optional Fireworks transport").

## Document mode (`/photo` with `mode: "document"`)

For a photo of a spec sheet, datasheet or blueprint, the same route
runs the document prompt (a mirror of `DOCUMENT_INSTRUCTIONS` in
`src/robotforge/photo.py`): **transcription, not estimation**. The
response is marked `document_read: true` (and `estimated: false`),
and the draft is shaped differently on purpose:

- Values come back as a `values` list — each printed value with its
  printed unit and the spec field it fills — so the site can badge
  them DOCUMENT-READ.
- The draft's description is forced to start with the banner
  "Document draft (values transcribed from the document): ".
- A numeric spec value with **no transcribed value behind it is
  dropped server-side** and named in `dropped` — the endpoint
  under-claims rather than letting an unprinted number through.
- The spec may be **partial**: a field the document does not print
  stays absent, and only the fields present are type/enum-checked
  (`validateSpecPartial`). A partial document gives a partial draft,
  which the Forge shows as partial.

The Forge's fourth input — a `.ply` point-cloud **scan** — never
touches this endpoint at all: it is parsed and measured in the
visitor's browser (`assets/js/scan.js`, bounding-box measurement,
badged MEASURED (scan)).

## Guardrails (this spends real credits)

- **CORS locked** to the Vercel site (`https://robot-forge-hackathon.vercel.app`),
  the legacy `https://abelxmendoza.github.io`, and localhost for development. Any other browser Origin is rejected.
- **Model, temperature and max_tokens are fixed in the Worker.**
  Nothing a client sends can change them.
- **Body caps:** ~16 KB for text routes; ~3 MB for `/photo` (the
  site downscales photos in the browser before sending). Text
  inputs are length-capped (describe 4000 chars, chat 2000, list
  8000).
- **Daily budget:** a Workers KV counter caps total live calls per
  UTC day (`DAILY_LIMIT`; 450 in `wrangler.toml` for judging week, 200 when unset) across *all* routes, plus a
  per-visitor cap (`PER_IP_DAILY_LIMIT`, default 30). Over budget →
  `503`, and the site falls back to recorded/local modes and says
  so. Counters increment *before* the model call (slow/failed calls
  still count) and **fail closed**: if KV errors, live calls pause
  rather than spend uncounted.
- **Kill switch:** `LIVE_ENABLED=0` turns every live call away.

## Deploy steps (the site owner's ~15 minutes)

You need: a free Cloudflare account, this repo cloned, and your
Baseten API key (from your Baseten dashboard — the same key the
`custom.baseten` connector uses; copy it from Baseten yourself —
never paste it into chat, a file, or a commit).

1. **Create the free Cloudflare account** at
   <https://dash.cloudflare.com/sign-up> if you don't have one.
2. **Install Wrangler** (or use the dashboard paste path in the
   appendix instead):
   `npm install -g wrangler` then `wrangler login`.
3. **Create the KV namespace** for the budget counters:
   `wrangler kv namespace create RF_LIVE_KV`
   Copy the `id` it prints into `wrangler.toml`: uncomment the
   `[[kv_namespaces]]` block and paste the id.
4. **Add the secrets** (values are typed into Wrangler's prompt,
   stored encrypted by Cloudflare, never in this repo):
   - `wrangler secret put BASETEN_API_KEY` — paste your Baseten key.
   - Optional, for live photo drafts:
     `wrangler secret put META_API_KEY` — your Meta Model API key.
   - Optional, for the text-route fallback:
     `wrangler secret put FIREWORKS_API_KEY` — your Fireworks key.
5. **Deploy:** from this folder, `wrangler deploy`.
   Note the URL it prints, e.g.
   `https://robotforge-live.<your-subdomain>.workers.dev`.
6. **Verify:** open `<that URL>/health` in a browser. You want
   `{"ok": true, "mode": "live", "configured": true, "kv": true, …}`
   and a `routes` object showing which routes the keys you added
   enable (`photo` stays `false` until step 4's optional secret).
7. **Light up the site:** set the one constant in
   `src/robotforge/site.py` —
   `LIVE_ENDPOINT = "https://robotforge-live.<your-subdomain>.workers.dev"`
   — then regenerate and publish (`robotforge site`, commit, push).
   Torque can do this step for you once you share the workers.dev
   URL (the URL is not a secret; the keys are, and they never leave
   Cloudflare).

## Cost & abuse posture, in plain language

- Cloudflare's free tier includes 100,000 Worker requests/day and
  KV's 100,000 reads / 1,000 writes per day. The defaults here
  (450 live calls/day during judging, 30/visitor) stay below both:
  each live call writes two KV counters, so 450 calls is 900 of the
  1,000 free daily writes. Do not raise `DAILY_LIMIT` past ~480 on
  the free KV tier. Long model
  waits are network time, not Worker CPU, so they don't threaten
  the CPU limits either. If limits ever bite, Workers Paid is
  $5/month — you would see it coming in `/health`'s budget numbers
  long before.
- The real spend is Baseten (and Meta, if photo is on) credits:
  at the current cap, at most 450 model calls a day can ever be
  made through this endpoint, whoever asks. A typical describe
  call is a few thousand tokens.
- Strangers *can* call the endpoint directly (CORS stops other
  websites, not curl) — the daily budget is the actual wall, which
  is why it fails closed.

## Turning live mode off, instantly

Any one of these, fastest first:

1. Set `LIVE_ENABLED = "0"` in `wrangler.toml` and
   `wrangler deploy` (or flip the var in the Cloudflare dashboard)
   — every live call gets a 503 and the site falls back.
2. Set `LIVE_ENDPOINT = ""` in `src/robotforge/site.py`, regenerate
   and push — the site stops calling entirely.
3. Delete the Worker in the Cloudflare dashboard — the site sees
   the endpoint not answering and falls back the same way.

## Local development

- `cp .dev.vars.example .dev.vars`, put *test* keys in `.dev.vars`
  (gitignored — never commit it), then `wrangler dev`.
- The site dev loop: serve the repo root (`python3 -m http.server`)
  — `http://localhost:8000` and `http://127.0.0.1:8000` are on the
  CORS allowlist for exactly this.
- `node tests/worker_mock.mjs` (repo root `tests/`) exercises the
  Worker's request handling against stubbed upstreams — no network,
  no real keys. `tests/test_live.py` runs it too, and asserts the
  Worker's embedded prompts/catalogue still match their Python
  sources of truth.

## Appendix: dashboard paste path (no Wrangler install)

Cloudflare dashboard → Workers & Pages → Create → Worker: name it
`robotforge-live`, then Edit code → paste the whole of `worker.js`
→ Deploy. Then in the Worker's Settings: add the KV namespace
binding (`RF_LIVE_KV`), the variables (`LIVE_ENABLED`, `DAILY_LIMIT`,
`PER_IP_DAILY_LIMIT` — same values as `wrangler.toml`), and the
secrets (`BASETEN_API_KEY`, optionally `META_API_KEY`) under
Settings → Variables and Secrets (encrypt the keys). Same result;
`wrangler.toml` stays the record of the intended settings.
