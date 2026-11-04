# CLAUDE.md

Read `AGENTS.md` first. It holds the rules for every agent in this repo.

The most important one: **never run `wrangler deploy`, `rollback` or
`secret put` on the `robotforge-live` Cloudflare Worker unless the owner
asked for that exact action in this session, and only ever from the
`live/` folder.** A deploy from the wrong folder wiped the Worker and all
its API keys on 2026-11-03. Details and the recovery steps are in `AGENTS.md`.
