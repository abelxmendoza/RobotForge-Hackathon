#!/usr/bin/env bash
# Safe upload of robotforge-live as a NEW VERSION. It does NOT go live.
#
# Why this exists: since the 2026-11-03 incident the Worker's keys live
# only inside the old version 31dfa75d. Cloudflare builds a new version's
# secrets from the latest *uploaded* version, which has none, so a plain
# `wrangler deploy` would ship a keyless Worker. This script uploads the
# current code together with every secret from a local file, so nothing
# is lost, and leaves the live traffic on the old version until you
# promote the new one yourself (see "Safe deploy" in README.md).
#
# Usage, from anywhere:
#   live/safe-upload.sh [path/to/secrets.env]
# Default secrets file: ~/.robotforge-live.secrets.env (outside the repo).
# The script never prints a secret value.
set -euo pipefail

cd "$(dirname "$0")"

# Rule 2 of AGENTS.md: wrangler only ever runs from live/, next to this config.
if [ ! -f wrangler.toml ] || ! grep -q '^name = "robotforge-live"' wrangler.toml \
   || [ ! -f worker.js ]; then
  echo "STOP: not in the live/ folder with the robotforge-live wrangler.toml." >&2
  exit 1
fi

SECRETS="${1:-$HOME/.robotforge-live.secrets.env}"
if [ ! -f "$SECRETS" ]; then
  echo "STOP: no secrets file at $SECRETS" >&2
  echo "Copy live/secrets.env.example there and fill in the values." >&2
  exit 1
fi
case "$(cd "$(dirname "$SECRETS")" && pwd)/" in
  "$(cd .. && pwd)"/*)
    echo "STOP: keep the secrets file outside the repo, not in $(cd .. && pwd)." >&2
    exit 1 ;;
esac
chmod 600 "$SECRETS"

# The 8 secrets the known-good version 31dfa75d had, plus GOOGLE_CLIENT_ID,
# which used to be a dashboard variable and is not in wrangler.toml.
REQUIRED="AUTH_JWT_SECRET BASETEN_API_KEY FIRECRAWL_API_KEY GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET META_API_KEY META_APP_ID META_APP_SECRET OPERATOR_TOKEN"
# Worker code reads these too; they are fine to leave out.
OPTIONAL="FIREWORKS_API_KEY GITHUB_CLIENT_ID GITHUB_CLIENT_SECRET"

missing=0
echo "Secrets file check (names only, values are never shown):"
for name in $REQUIRED; do
  value="$(grep -E "^${name}=" "$SECRETS" | tail -n 1 | cut -d= -f2- || true)"
  if [ -z "$value" ] || [ "$value" = "paste-here" ]; then
    echo "  MISSING  $name"; missing=1
  else
    echo "  ok       $name"
  fi
done
for name in $OPTIONAL; do
  if grep -qE "^${name}=.+" "$SECRETS" && ! grep -qE "^${name}=paste-here$" "$SECRETS"; then
    echo "  ok       $name (optional)"
  fi
done
if grep -qE '^[A-Z_]+=paste-here$' "$SECRETS"; then
  echo "STOP: some lines still say paste-here. Fill them or delete those lines." >&2
  exit 1
fi
if [ "$missing" -ne 0 ]; then
  echo "STOP: fill in every MISSING name above, then run this again." >&2
  exit 1
fi

if ! npx --yes wrangler versions upload --help 2>/dev/null | grep -q -- '--secrets-file'; then
  echo "STOP: this wrangler has no 'versions upload --secrets-file'. Update it:" >&2
  echo "  npm install -g wrangler@latest   (or use npx wrangler@latest)" >&2
  exit 1
fi

echo
echo "Uploading a new version (NOT deploying; live traffic stays where it is)..."
npx --yes wrangler versions upload \
  --secrets-file "$SECRETS" \
  --message "Safe upload $(git rev-parse --short HEAD 2>/dev/null || echo local) with all secrets"

cat <<'NEXT'

Uploaded. Nothing is live yet. Next (README.md, "Safe deploy"):
  1. Copy the "Version ID" and "Version Preview URL" printed above.
  2. Test the preview:  python3 ../tools/check_live_health.py <Version Preview URL>
  3. Only if it passes: npx wrangler versions deploy <Version ID>@100% --yes
  4. Check the live URL:  python3 ../tools/check_live_health.py https://robotforge-live.abelxmendoza.workers.dev
  5. If anything is wrong: npx wrangler rollback 31dfa75d-2453-4bb3-9df1-fbe718f78987
NEXT
