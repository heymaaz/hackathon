---
marp: true
theme: default
paginate: true
---

# 🍲 Recipebox

### Save a TikTok. Get a recipe. Ask someone to cook it.

UK's Shortest Hackathon 2026 · AI Tinkerers London · solo build

**https://recipebox.heymaaz.workers.dev**

---

## The problem

My wife finds recipes on TikTok, Reels and Shorts.

- Saving them means a folder of links nobody reopens
- The caption says *"full recipe on my website"* or is just hashtags
- 8 of 30 videos tonight had **no speech at all**, only music and on-screen text
- And sometimes she wishes I would cook one of them

---

## What Recipebox does

Paste or share a link →

1. **Instantly**: caption + thumbnail → Claude drafts a card
2. **Seconds later**: audio → Whisper → transcript
3. **Same call**: 10 video stills → Claude reads on-screen ingredients
4. Filed under its cuisine in a **shared kitchen** for two

Press the ❤️ → *"please cook this for me"* lands on the other person's shelf.

---

## The pipeline

```
link ─▶ Worker: normalise · dedupe · oEmbed/og tags
      ├─▶ Claude (structured output) ─▶ caption card        ~10 s
      └─▶ media runner: yt-dlp ─▶ ffmpeg ─▶ audio + 10 frames
              └─▶ Worker: Whisper ─▶ transcript
                         Claude(caption + transcript + frames) ─▶ final card
```

Every card records **which source carried the recipe**: caption · audio · video frames.

---

## Tonight's numbers

| | |
|---|---|
| Videos seeded | 30 |
| Recipe cards produced | 27 |
| From audio transcript | 20 |
| From video frames (music-only videos) | 7 |
| Correctly rejected as "not a recipe" | 3 |
| Platforms working | TikTok · Instagram · YouTube Shorts |

---

## Stack

| Layer | |
|---|---|
| Runtime | Cloudflare Worker · Hono · static React assets · cron |
| Data | D1 |
| Auth | Better Auth on D1 · email + password · invite code |
| Speech | Workers AI `whisper-large-v3-turbo` |
| LLM | Vercel AI SDK · Zod structured output · **Claude Opus 5** |
| Vision | JPEG stills as image parts in the same Claude call |
| Download | yt-dlp + ffmpeg · Bun runner · packaged as a Cloudflare Sandbox container |
| Web | React 19 · Vite · Tailwind v4 · shadcn |

---

## Why it needed building

> *"Could simpler tools suffice?"*

- Bookmark apps store the link. They cannot read a video.
- Captions are marketing, not recipes.
- Transcription alone fails on music-only videos.
- **Three sources, one structured card** is the product.

---

## Robust by design

- Save returns in <1 s; extraction runs in the background, UI polls
- Duplicate links dedupe to the existing card
- Failed downloads keep the caption card and record *why*; nothing loops
- Whisper returns nothing → frames take over
- Strict Zod schema: no JSON parsing, no malformed cards
- TypeScript strict · vitest · ESLint clean · push-to-deploy via Workers Builds

---

## Runs in the cloud

Everything except the download runs on Cloudflare:
auth, database, transcription, extraction, cron, static site.

The download is packaged as a **Cloudflare Sandbox container** with yt-dlp + ffmpeg.
Image builds. Button and cron are wired. One plan upgrade and

```
npm run deploy:containers
```

and no laptop is involved at all.

---

## The heart

She saves → she presses ❤️ → it lands on **my** shelf with a *"for you"* badge
→ I cook it → I mark it cooked → it closes with my name.

Two nullable columns and a filter.
Identity comes from the session, so it just works.

---

# Demo

1. Shelves by cuisine · a *"from video frames"* card
2. Search by ingredient
3. Live paste → terminal runner → card upgrades
4. ❤️ → *Cook this for me*

**github.com/heymaaz/hackathon**

---

# Thank you

*Three hours, one Worker,*
*and my wife can ask me to cook something by pressing a heart.*
