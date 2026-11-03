Read `AGENTS.md` at the repo root before doing anything. Never run
`wrangler deploy`, `rollback` or `secret put` on the `robotforge-live`
Cloudflare Worker unless the owner asked for that exact action, and only
ever from `live/`. A wrong-folder deploy wiped the Worker and its API keys
on 2026-11-03.
