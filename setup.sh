#!/usr/bin/env bash
# One-time Cloudflare setup: creates the D1 database, patches wrangler.jsonc, runs migrations, sets the Claude secret.
set -euo pipefail
cd "$(dirname "$0")"
npx wrangler whoami >/dev/null 2>&1 || { echo "Run: npx wrangler login"; exit 1; }
if grep -q REPLACE_ME wrangler.jsonc; then
  out=$(npx wrangler d1 create recipebox 2>&1 || true)
  id=$(echo "$out" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
  if [ -z "$id" ]; then id=$(npx wrangler d1 list --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const d=JSON.parse(s).find(x=>x.name==="recipebox");console.log(d?d.uuid:"")}'); fi
  [ -n "$id" ] || { echo "Could not determine D1 id:"; echo "$out"; exit 1; }
  sed -i '' "s/REPLACE_ME/$id/" wrangler.jsonc
  echo "D1 recipebox = $id"
fi
npx wrangler d1 migrations apply recipebox --local
npx wrangler d1 migrations apply recipebox --remote
# Push every non-empty secret from .dev.vars (BETTER_AUTH_URL is set to the workers.dev URL, not localhost)
if [ -f .dev.vars ]; then
  for name in BETTER_AUTH_SECRET OPENROUTER_API_KEY ANTHROPIC_API_KEY; do
    val=$(grep "^$name=" .dev.vars | cut -d= -f2-)
    [ -n "$val" ] && printf '%s' "$val" | npx wrangler secret put "$name"
  done
fi
echo "Setup done. Deploy with: npm run deploy"
