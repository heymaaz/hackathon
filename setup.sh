#!/usr/bin/env bash
# One-time Cloudflare setup: creates the D1 database, writes its id into wrangler config, runs migrations,
# and uploads secrets from .dev.vars. Usage: ./setup.sh [https://recipebox.<you>.workers.dev]
set -euo pipefail
cd "$(dirname "$0")"
PUBLIC_URL="${1:-}"
npx wrangler whoami >/dev/null 2>&1 || { echo "Run: npx wrangler login"; exit 1; }

if grep -q REPLACE_ME wrangler.jsonc; then
  out=$(npx wrangler d1 create recipebox 2>&1 || true)
  id=$(echo "$out" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
  [ -n "$id" ] || { echo "Could not determine D1 id:"; echo "$out"; exit 1; }
  # portable in-place edit (BSD and GNU sed differ on -i)
  for f in wrangler.jsonc wrangler.containers.jsonc; do
    tmp=$(mktemp) && sed "s/REPLACE_ME/$id/" "$f" > "$tmp" && mv "$tmp" "$f"
  done
  echo "D1 recipebox = $id"
fi

npx wrangler d1 migrations apply recipebox --local
npx wrangler d1 migrations apply recipebox --remote

if [ -f .dev.vars ]; then
  for name in BETTER_AUTH_SECRET OPENROUTER_API_KEY ANTHROPIC_API_KEY ANTHROPIC_WORKSPACE_ID LLM_PROVIDER INVITE_CODE; do
    val=$(grep "^$name=" .dev.vars | cut -d= -f2- | sed 's/[[:space:]]*#.*$//' | tr -d '\r\n')
    [ -n "$val" ] && printf '%s' "$val" | npx wrangler secret put "$name"
  done
fi
if [ -n "$PUBLIC_URL" ]; then
  printf '%s' "$PUBLIC_URL" | npx wrangler secret put BETTER_AUTH_URL
else
  echo "Note: pass your public URL to set BETTER_AUTH_URL, e.g. ./setup.sh https://recipebox.<you>.workers.dev"
fi
echo "Setup done. Deploy with: npm run deploy"
