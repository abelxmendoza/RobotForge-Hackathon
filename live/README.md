# RobotForge live endpoint — deploy runbook

The RobotForge site is a static Next.js export deployed on Vercel and cannot
hold an API key. This folder is the one server-side piece: a single-file
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

**Every model route above is account-gated:** the request must
carry a session JWT (`Authorization: Bearer <token>` from
`/auth/login`, `/auth/register` or a social login — see
Accounts below). The check runs in the dispatcher before the
handler and before the budget gate, so an anonymous call gets
`401 auth_required`, never reaches a model and never spends the
daily budget. `/health`, `/auth/*` and `/admin/*` are the only
exemptions. If accounts are not configured (`AUTH_JWT_SECRET`
unset) the model routes fail closed with the same
`503 auth_not_configured` the `/auth/*` routes give. The site's
demo mode is unaffected — it makes no Worker calls at all.

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

## Accounts (`/auth/*`, `/admin/*`)

Accounts are **identity + role only** (v1). Robots and inventory
stay in the visitor's browser — there is no cloud sync, no email
verification and no password reset yet.

| Route | What it does | Secret needed |
|---|---|---|
| `POST /auth/register` | `{email, password, name?}` → `{token, user}` (role `user`) | `AUTH_JWT_SECRET` |
| `POST /auth/login` | `{email, password}` → `{token, user}`; wrong credentials are a generic 401 | `AUTH_JWT_SECRET` |
| `GET /auth/me` | Bearer token → `{user}` (role re-read from the record) | `AUTH_JWT_SECRET` |
| `POST /auth/logout` | `{ok}` — stateless; the client drops the token | — |
| `GET /auth/config` | `{metaLogin, providers: {meta, github, google}}` — which social logins are switched on (`metaLogin` is the original alias for `providers.meta`) | — |
| `GET /auth/meta/start` · `GET /auth/meta/callback` | Meta (Facebook) login: OAuth round trip, find-or-create by email, 302 back to the site with the session token in the URL fragment. Answers `501 meta_not_configured` until the app secrets exist | `META_APP_ID` + `META_APP_SECRET` |
| `GET /auth/github/start` · `GET /auth/github/callback` | GitHub login. Scopes `read:user user:email`; the account keys on the primary **verified** email from `/user/emails` (the profile email can be hidden or unverified, so it is never trusted). Answers `501 github_not_configured` until the secrets exist | `GITHUB_CLIENT_ID` + `GITHUB_CLIENT_SECRET` |
| `GET /auth/google/start` · `GET /auth/google/callback` | Google login (OpenID Connect: `openid email profile`); the account keys on the userinfo email only when `email_verified` is true. Answers `501 google_not_configured` until the secrets exist | `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` |
| `GET /admin/users` | Operator: list accounts (public fields only — never hashes) | `OPERATOR_TOKEN` |
| `POST /admin/seed-founder` | Operator: create/update the founder account (`abelxmendoza@gmail.com`, role `founder`) with the given password | `OPERATOR_TOKEN` |
| `POST /admin/grant-role` | Operator: set a user's role (`user` / `admin` / `founder`) | `OPERATOR_TOKEN` |

Users are KV records `auth:user:<email-lowercase>` in `RF_LIVE_KV`.
Social-login records also carry the provider's stable user ID
(`providerId`: Meta ID, GitHub numeric ID, Google `sub`). A social
login find-or-creates **by verified email only** and lands in the
existing account when that email already has one — there is no
cross-provider linking UI in v1. Passwords are PBKDF2-HMAC-SHA256 (WebCrypto, per-user salt,
100k iterations); sessions are HS256 JWTs signed with
`AUTH_JWT_SECRET` (7-day expiry, signature + expiry verified on
every protected route). The founder address is **reserved** — the
public register route refuses it (403); only the operator route
can seed it. Operator routes take the `X-Operator-Token` header;
that is how Muse administers accounts from the owner's
machines. `/health` reports `auth` plus `metaLogin`, `githubLogin`
and `googleLogin` booleans.

To switch Meta login on: create an app at developers.facebook.com
(Facebook Login), set its Valid OAuth Redirect URI to this
Worker's `/auth/meta/callback` URL, and add `META_APP_ID` and
`META_APP_SECRET` as Worker secrets. The button on the site
appears by itself once `/auth/config` reports `metaLogin: true`.

To switch GitHub login on: create an OAuth App at
github.com/settings/developers (homepage
`https://robot-forge-hackathon.vercel.app`, authorization
callback URL this Worker's `/auth/github/callback`), and add
`GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` as Worker secrets.

To switch Google login on: in a Google Cloud project, configure
the OAuth consent screen (External; scopes `openid`, `email`,
`profile` only — no verification needed for those), create a Web
application OAuth client with this Worker's
`/auth/google/callback` as an authorized redirect URI, publish
the consent screen, and add `GOOGLE_CLIENT_ID` and
`GOOGLE_CLIENT_SECRET` as Worker secrets.

Each provider's button appears by itself once `/auth/config`
reports that provider on. Secrets are **additive only** —
`wrangler secret put` one at a time; any full script deploy must
preserve the existing secret bindings (`keep_bindings`), or
`AUTH_JWT_SECRET` (every session) and `BASETEN_API_KEY` (the
live demo) are lost.

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
6. **Verify:** run `python ../tools/check_live_health.py <that URL>` (or open
   `<that URL>/health` in a browser). The checker is read-only, sends no
   credentials and requires
   `{"ok": true, "mode": "live", "configured": true, "kv": true, …}`
   with working budget state, authentication and the required text routes.
   Optional routes such as `photo` stay `false` until their provider secret is
   configured.
7. **Light up the site:** set `LIVE_ENDPOINT` in
   `web-next/src/components/forge/live.tsx` to the deployed Worker base URL,
   run `npm run build` from `web-next/`, then commit and deploy the static
   export through Vercel. The workers.dev URL is public configuration; provider
   keys remain encrypted in Cloudflare.

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
