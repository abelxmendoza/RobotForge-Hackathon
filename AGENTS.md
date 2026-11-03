# Agent rules for RobotForge

These rules apply to every AI coding agent working in this repo, including
Claude, Codex, Gemini, Antigravity, Grok and Muse.

## Deploying the live Worker (`robotforge-live`)

Read this before running any `wrangler` command. A wrong deploy takes the live
site's AI calls and logins down.

**The only allowed deploy command, run from a clean, up-to-date `main`:**

```bash
cd live && npx wrangler deploy
```

**Before you deploy**

- Ask the owner first, every time.
- Check that `live/wrangler.toml` is the config in use. If you can't see that
  file in your current directory, you are in the wrong place, so stop.

**Never do these**

- Never run `wrangler deploy` from the repo root, a fresh scaffold or any folder
  other than `live/`.
- Never pass `--name robotforge-live`, or any other flag that points a deploy at
  this Worker from outside `live/`.
- Never run `wrangler delete` on this Worker.
- Never upload the script through the Cloudflare API without preserving existing
  bindings (`keep_bindings`).
- Never print, log or commit a secret value. Set secrets one at a time with
  `wrangler secret put`.

**After every deploy**, check health:

```bash
curl -s https://robotforge-live.abelxmendoza.workers.dev/health
```

`configured` and `kv` must both be `true`, and the routes must be on. If they
aren't, tell the owner straight away and recover as described below.

`git push` doesn't deploy this Worker. If you only changed code, pushing is
enough, so don't run `wrangler` just to "sync" it.

### Current freeze

Don't run `wrangler deploy`, `wrangler versions upload` or `wrangler secret put`
on this Worker unless the owner explicitly approves it. Version
`31dfa75d-2453-4bb3-9df1-fbe718f78987` is live and working, but
`wrangler secret list` returns `[]`, so the next deploy may lose the secrets.
That hasn't been tested. Judging runs Nov 4-9, 2026.

### Recovery

Worker versions keep their own secrets, so a rollback can bring them back
without re-entering any keys:

1. Run `npx wrangler deployments list` in `live/` to find the last good version.
2. Run `npx wrangler versions view <id>` and confirm it lists the secret bindings.
3. Run `npx wrangler rollback <id>`.
4. Check `/health` again.

### What happened on 2026-11-03

Three `wrangler deploy` runs on the owner's Cloudflare account (22:22, 22:32 and
22:36 UTC) replaced the Worker with versions that had no bindings, no fetch
handler and that day's date as the compatibility date. That fits deploys run
without `live/wrangler.toml`. `/health` returned 404 and all secrets were
dropped. Rolling back to `31dfa75d` restored them. Which machine or agent ran
those deploys is still unknown.
