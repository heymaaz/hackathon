# Recipebox 🍲

Save cooking videos from TikTok, Instagram Reels, YouTube Shorts and Facebook. Paste or share a link and Recipebox
reads the caption, listens to the audio, looks at the video frames, and files a clean recipe card
(ingredients, method, time, cuisine) into a shared household box you can search.

Built solo in 3 hours at **UK's Shortest Hackathon 2026** (AI Tinkerers London), then finished properly. The real
reason it exists: my wife loves finding recipes on TikTok, and I wanted a way for her to save her favourites and
ask me to cook them.

Live: https://recipebox.heymaaz.workers.dev

## How it works

```
share link ──▶ Cloudflare Worker (Hono + Better Auth)              D1 (SQLite)
                 ├─ normalise URL, dedupe, record who saved it
                 ├─ oEmbed / og:tags → caption + thumbnail
                 ├─ Claude (AI SDK, structured output) → card, cuisine, tags   ← instant
                 └─ caption thin? → "needs a listen"
                                              │
   media runner (local Bun script, or Cloudflare Sandbox container on the paid plan)
                 ├─ yt-dlp → video ≤480p
                 ├─ ffmpeg → mono 16 kHz audio + up to 10 stills
                 └─ POST /api/recipes/:id/media
                        ├─ Workers AI Whisper → transcript (any language)
                        └─ Claude again with caption + transcript + frames → card upgraded, "from audio" / "from video frames"
```

Everything except the video download runs on Cloudflare: Workers, D1, Workers AI, static assets, cron. The download
step is a 100-line Bun script because TikTok and Instagram block many datacenter IPs and because Cloudflare Containers
need the Workers Paid plan; the same steps are packaged as a Sandbox container in `wrangler.containers.jsonc`.

**Household model.** Anyone with an account shares one box. Each recipe records who saved it. Pressing the heart
means "please cook this for me": the request lands on the "Cook this for me" shelf, the other person sees a "for you"
badge, and marking it cooked closes the request with their name.

## Stack

- Worker: Hono, Better Auth (email + password on D1), Vercel AI SDK with `@openrouter/ai-sdk-provider` or `@ai-sdk/anthropic` (Claude Opus 5), Workers AI Whisper
- Web: React 19, Vite, Tailwind v4, shadcn (Base UI, preset `b3kcuHeYj`), served from Worker static assets
- Scripts: Bun + yt-dlp + ffmpeg

## Run it

```bash
npm i && npm --prefix web i
cp .dev.vars.example .dev.vars      # fill BETTER_AUTH_SECRET and one LLM key
npx wrangler login
./setup.sh https://recipebox.<you>.workers.dev   # D1, migrations, secrets
npm run dev                          # Worker on :8787 (uses .dev.vars)
npm run dev:web                      # Vite on :5173, proxies /api
npm run deploy                       # build web + deploy Worker
npm test                             # vitest
```

Create your account in the app, then put your login in `.env` for the scripts:

```
RECIPEBOX_URL=https://recipebox.<you>.workers.dev
RECIPEBOX_EMAIL=you@example.com
RECIPEBOX_PASSWORD=...
```

```bash
bun scripts/seed.ts             # 30 recipes across cuisines (scripts/seed-urls.json)
bun scripts/runner.ts --watch   # keep pulling media for anything that needs it
```

### Cloud yt-dlp (Workers Paid plan)

`npm run deploy:containers` deploys the same Worker with a Sandbox container that has yt-dlp + ffmpeg. The
"Listen to the video" button and a cron every 2 minutes then process the queue with no laptop involved.

## Config

| Secret | Purpose |
|---|---|
| `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` | Better Auth; URL is the public origin |
| `OPENROUTER_API_KEY` / `ANTHROPIC_API_KEY` | LLM. `LLM_PROVIDER=openrouter\|anthropic` picks; default OpenRouter when set |
| `ANTHROPIC_WORKSPACE_ID` | Only for identity-linked Anthropic keys |
| `INVITE_CODE` | Optional. When set, sign-up must supply it (there is a field on the form) |
| `CLAUDE_MODEL` (var) | Defaults to `claude-opus-5` |

## API (session cookie required except `/api/auth/*`)

| Method | Path | What |
|---|---|---|
| POST | `/api/recipes` | `{url, note?, request?}` → saves and extracts in the background |
| GET | `/api/recipes?q=&cuisine=&filter=` | filter: `requests`, `mine`, `favorite`, `cooked`, `needs_transcript` |
| GET | `/api/recipes/:id` | one recipe, with saver / requester / cook names |
| PATCH | `/api/recipes/:id` | `favorite`, `request`, `cooked`, `note`, `cuisine`, `title`, `category` |
| POST | `/api/recipes/:id/media` | multipart `audio` + `frames[]` → Whisper + Claude |
| POST | `/api/recipes/:id/media-failed` | runner could not download; keep the caption card |
| POST | `/api/recipes/:id/listen` | cloud path via Sandbox (containers deploy only) |
| POST | `/api/recipes/:id/retry` | re-run extraction |
| GET | `/api/queue` | recipes still waiting for media |
| POST | `/api/keep` | `{url}` → queue the original video for download to the laptop |
| GET | `/api/keep`, `/api/keep/queue` | list kept videos; runner claims pending ones |
| POST | `/api/keep/:id/done` | runner reports `{filename, bytes}` or `{error}` |
| GET | `/api/me`, `/api/cuisines`, `/api/stats` | sidebar data |

## Keep the video file (no recipe)

Sometimes you just want the video. Paste a link and press **Keep** (or share to `/?keep=<url>`, or `POST /api/keep {url}`).
The runner downloads the original at best quality into `~/Documents/ytp-dlp-downloaded/` (override with `KEEP_DIR`)
and records the filename. Nothing is transcribed or extracted. `GET /api/keep` lists what has been kept.

## iOS share sheet

Shortcuts → new shortcut → **Show in Share Sheet**, accept URLs → action **Open URLs** with
`https://recipebox.<you>.workers.dev/?add=` + Shortcut Input. The page saves it using your browser session.
