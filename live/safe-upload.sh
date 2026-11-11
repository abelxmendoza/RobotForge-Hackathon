#!/usr/bin/env bash
# Safe upload of robotforge-live as a NEW VERSION. It does NOT go live.
#
# Why this exists: since the 2026-11-03 incident the Worker's keys live
# only inside the old version 31dfa75d. Cloudflare builds a new version's
# secrets from the latest *uploaded* version, which has none, so a plain
# `wrangler deploy` would ship a keyless Worker, and a plain
# `wrangler secret put` would deploy each half-keyed step straight to live.
#
# This script instead:
#   1. uploads the current code as a version (not deployed), then
#   2. runs `wrangler versions secret put NAME` once per key. Each one
#      prompts you to type (or paste) the value at your own terminal, the
#      same way as `wrangler secret put`, and makes a new version that is
#      also NOT deployed. Nothing is written to a file, nothing is printed.
# Live traffic stays on the old version until you test the last version's
# preview and promote it yourself (see "Safe deploy" in README.md).
#
# Usage, from anywhere:   live/safe-upload.sh
# Only the owner runs this (AGENTS.md rules 1 and 4).
set -euo pipefail

cd "$(dirname "$0")"

# Rule 2 of AGENTS.md: wrangler only ever runs from live/, next to this config.
if [ ! -f wrangler.toml ] || ! grep -q '^name = "robotforge-live"' wrangler.toml \
   || [ ! -f worker.js ]; then
  echo "STOP: not in the live/ folder with the robotforge-live wrangler.toml." >&2
  exit 1
fi

if ! npx --yes wrangler versions secret put --help >/dev/null 2>&1; then
  echo "STOP: this wrangler has no 'versions secret put'. Update it:" >&2
  echo "  npm install -g wrangler@latest   (or use npx wrangler@latest)" >&2
  exit 1
fi

# The 8 secrets the known-good version 31dfa75d had, plus GOOGLE_CLIENT_ID,
# which used to be a dashboard variable and is not in wrangler.toml.
REQUIRED="AUTH_JWT_SECRET BASETEN_API_KEY FIRECRAWL_API_KEY GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET META_API_KEY META_APP_ID META_APP_SECRET OPERATOR_TOKEN"
# Worker code reads these too; skip them unless you use them.
# MESHY_API_KEY turns on Wrench one-part 3D edits (PR #192).
OPTIONAL="FIREWORKS_API_KEY GITHUB_CLIENT_ID GITHUB_CLIENT_SECRET MESHY_API_KEY"

echo "Step 1/2: uploading the code as a new version (NOT deploying)..."
npx --yes wrangler versions upload \
  --message "Safe upload $(git rev-parse --short HEAD 2>/dev/null || echo local), code only"

echo
echo "Step 2/2: adding each key to a new version (still NOT deploying)."
echo "Type or paste each value when wrangler asks. It is not shown or saved here."
for name in $REQUIRED; do
  echo
  echo "== $name =="
  npx --yes wrangler versions secret put "$name" \
    --message "Safe upload: add $name"
done

for name in $OPTIONAL; do
  printf '\nAdd optional %s too? [y/N] ' "$name"
  read -r answer
  case "$answer" in
    y|Y) npx --yes wrangler versions secret put "$name" --message "Safe upload: add $name" ;;
  esac
done

cat <<'NEXT'

Done. Nothing is live yet. Next (README.md, "Safe deploy"):
  1. npx wrangler versions list      -> the newest Version ID is the one with every key.
     Its preview URL is https://<first 8 chars of that ID>-robotforge-live.abelxmendoza.workers.dev
  2. Test the preview:  python3 ../tools/check_live_health.py <preview URL>
  3. Only if it passes: npx wrangler versions deploy <Version ID>@100% --yes
  4. Check live:        python3 ../tools/check_live_health.py https://robotforge-live.abelxmendoza.workers.dev
  5. If anything is wrong: npx wrangler rollback 31dfa75d-2453-4bb3-9df1-fbe718f78987
NEXT
