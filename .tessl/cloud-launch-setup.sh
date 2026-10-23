#!/usr/bin/env bash
set -eo pipefail

echo "Installing root dependencies from package-lock.json"
CI=true npm ci

echo "Installing web dependencies from web/package-lock.json"
CI=true npm --prefix web ci

echo "Preparing example-only local variables for type generation"
if [ ! -e .dev.vars ]; then
  cp .dev.vars.example .dev.vars
fi

echo "Generating local Cloudflare Worker types (no deployment)"
npm run types
