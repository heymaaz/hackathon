# Recipebox 🍲

Save cooking videos from TikTok, Instagram Reels, YouTube Shorts and Facebook. Paste a link and Recipebox
reads the caption, listens to the audio when the caption is thin, and files a clean recipe card
(ingredients, method, time, cuisine) into a Slack-style shelf you can search.

Built solo in 3 hours at **UK's Shortest Hackathon 2026** (AI Tinkerers London). The real reason it exists:
my wife loves finding recipes on TikTok, and I wanted a way to save her favourites so I can cook them for her.

## How it works

```
share link ──▶ Cloudflare Worker (Hono)
                 ├─ normalise URL, dedupe            D1: recipes
                 ├─ oEmbed / og:tags → caption       ─────────────
                 ├─ Claude (structured output) → recipe card, cuisine, tags
                 └─ caption too thin? → status "needs a listen"
                                                 │
   yt-dlp runner (local now, Sandbox next) ◀─────┘  pulls audio, POSTs it back
                 └─▶ Workers AI Whisper → transcript → Claude again → "ready"
```

Everything but the yt-dlp download runs on Cloudflare (Workers, D1, Workers AI, static assets). The downloader is
a 60-line Bun script because TikTok/Instagram sometimes block datacenter IPs; the same script is designed to run
inside a Cloudflare Sandbox container.

## Run it

```bash
npm i
cp .dev.vars.example .dev.vars        # add ANTHROPIC_API_KEY
npx wrangler login
./setup.sh                            # creates D1, runs migrations, sets the secret
npm run dev                           # http://localhost:8787
npm run deploy
```

Seed with 30 recipes and transcribe the ones that need it:

```bash
RECIPEBOX_URL=https://recipebox.<you>.workers.dev bun scripts/seed.ts
RECIPEBOX_URL=https://recipebox.<you>.workers.dev bun scripts/runner.ts          # drain once
RECIPEBOX_URL=https://recipebox.<you>.workers.dev bun scripts/runner.ts --watch  # keep listening
```

## API

| Method | Path | What |
|---|---|---|
| POST | `/api/recipes` | `{url, note?, cook_for_her?}` → saves and extracts in the background |
| GET | `/api/recipes?q=&cuisine=&filter=` | list / search (ingredients, tags, creator, caption) |
| GET | `/api/recipes/:id` | one recipe |
| PATCH | `/api/recipes/:id` | `favorite`, `cook_for_her`, `cooked`, `note`, `cuisine`, `title` |
| POST | `/api/recipes/:id/audio` | raw audio bytes → Whisper → re-extract |
| POST | `/api/recipes/:id/retry` | re-run extraction |
| GET | `/api/queue` | recipes waiting for audio |
| GET | `/api/cuisines`, `/api/stats` | sidebar data |

Set `APP_KEY` as a secret to lock the write endpoints; send it as `x-app-key`.

## iOS share sheet (Shortcut)

1. Shortcuts → new shortcut → enable **Show in Share Sheet**, accept **URLs**.
2. Action **Get Contents of URL**: `https://recipebox.<you>.workers.dev/api/recipes`, method POST, JSON body `url` = Shortcut Input.
   (Add header `x-app-key` if you set `APP_KEY`.)
3. Optional: **Show Notification** "Saved to Recipebox".

Or simpler: open `https://recipebox.<you>.workers.dev/?add=<url>` and the page saves it.
