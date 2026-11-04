# Instructions for AI coding agents

This file is for every AI agent working in this repo: Codex, Claude, Gemini /
Antigravity, Grok, Muse, Copilot and anything else. `CLAUDE.md` and
`GEMINI.md` point here. Read this before running any deploy command.

## Cloudflare Worker (`live/`): deploy rules

The live endpoint is the Cloudflare Worker **`robotforge-live`**
(https://robotforge-live.abelxmendoza.workers.dev). It holds every API key
the site uses (Meta / Muse Spark, Google and Meta login, Firecrawl, auth
signing) as Worker **secrets**. These are not in this repo and cannot be
restored from it.

**Incident, 2026-11-03.** Between 22:22 and 22:36 UTC, three `wrangler deploy`
runs were made from outside `live/`. With no `wrangler.toml` to follow,
wrangler auto-generated an empty Worker: no `worker.js`, no KV binding,
no secrets. That empty Worker replaced the real one. `/health` returned
404, and every AI feature and sign-in went down the day before judging.
The fix was a rollback to the last good version.

Rules:

1. **Do not deploy, re-deploy, roll back, or `secret put` / `secret delete`
   on `robotforge-live` unless the owner (Abel) asked for that exact action
   in this session.** This applies to every agent, every machine, and
   every reason, including "just testing" or "fixing CI". Until judging
   ends (2026-11-09), the answer is no.
2. Only ever run wrangler **from the `live/` folder**, the one that contains
   `live/wrangler.toml`. Before any wrangler command, check `pwd` and
   confirm `wrangler.toml` is in it. Never run `wrangler deploy` from the
   repo root, `web-next/`, a fresh checkout's root, or with `--name`
   pointing at `robotforge-live`.
3. Never let wrangler "auto-configure" or create a config for
   `robotforge-live`. If wrangler says it can't find a config, stop.
4. Never print, log, commit or paste a secret value. Set secrets only with
   `npx wrangler secret put NAME`, typed by the owner at their terminal.
5. Don't connect this repo to Cloudflare Workers Builds (git
   auto-deploy). It builds from the repo root and caused the incident
   above. Deploys of `live/` are manual.
6. Before saying the endpoint works, check
   `GET https://robotforge-live.abelxmendoza.workers.dev/health`. It must
   return 200 with `"configured": true`.

**If `/health` returns 404, or `configured` is false**, the Worker was
replaced. Don't redeploy over it. Tell the owner, and have them roll back
to the last version that has the secrets (find it with
`npx wrangler deployments list` in `live/`). As of 2026-11-03 the known-good
version is `31dfa75d-2453-4bb3-9df1-fbe718f78987`:

```
cd live && npx wrangler rollback 31dfa75d-2453-4bb3-9df1-fbe718f78987
```

The full Worker runbook is in `live/README.md`.

## Other standing rules

- Never expose API keys, and never remove or raise the Worker's rate limits
  to make demos easier. `DAILY_LIMIT` goes back to 200 after 2026-11-09.
- The web app is `web-next/` (Next.js static export on Vercel). Also read
  `web-next/AGENTS.md`.
- Don't merge pull requests without checking CI and that they're compatible
  with the other open PRs.
