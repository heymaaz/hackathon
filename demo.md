# Recipebox — 3-minute demo script

**Live:** https://recipebox.heymaaz.workers.dev  ·  **Repo:** github.com/heymaaz/hackathon
**Before you start:** `bun scripts/runner.ts --watch` running in a visible terminal. App open, signed in, "Everything" shelf.

---

## The one-liner

> My wife finds recipes on TikTok. I wanted her to be able to save them and ask me to cook them. Recipebox turns any TikTok, Reel or Short into a real recipe card, and files it into a shared kitchen we both use.

## Why it needed building (judging criterion: "could simpler tools suffice?")

Captions are useless. Of the 30 videos I seeded tonight, almost every caption was "full recipe on my website" or just hashtags. Eight of them have **no speech at all**, only music, with the ingredients as on-screen text. So the app reads three sources: the caption, a Whisper transcript of the audio, and stills sampled from the video. Claude combines them into one structured card. No bookmark tool does that.

## Demo flow (do it in this order)

1. **Show the shelves.** 27 recipes, filed by cuisine in the sidebar. Click **#indian**, then **#thai**. Click a card, e.g. *Dal Makhani*. Point at the badge **"from video frames"**: that video has no speech, the quantities came from the on-screen text.
2. **Search.** Type `paneer` or `chilli` in the search box: it searches ingredients, not just titles.
3. **Live paste.** Paste a fresh TikTok link. Within ~10 seconds a card appears with thumbnail, creator, and a caption-only draft marked *needs a listen*. Switch to the terminal: the runner picks it up, pulls audio + 10 frames, uploads. Back in the app the badge flips to **from audio** and the ingredients fill in with quantities.
4. **The heart.** On any card press **"Please cook this for me"**. Show the **Cook this for me** shelf. Explain: she saves, she presses the heart, it lands on my shelf with a "for you" badge; I mark it cooked and it closes with my name. Two accounts, one kitchen, invite-code locked.
5. **Close:** "Everything except the download runs on Cloudflare. Auth, database, transcription, extraction, cron, static site."

Fallback if the live paste is slow: open *Molcajete Salsa* (1,354-char transcript) and expand **Source text** to show the Whisper transcript next to the card.

## Stack (say this when asked)

| Layer | What |
|---|---|
| Runtime | Cloudflare Worker (Hono). Static React app served from Worker assets. Cron trigger every 2 min. |
| Data | D1 (SQLite). One `recipes` table plus Better Auth tables. |
| Auth | Better Auth 1.7, email + password, D1 adapter built in. Optional invite code. |
| LLM | Vercel AI SDK, structured output with Zod. Claude Opus 5 via Anthropic (OpenRouter as fallback provider). |
| Speech | Workers AI, `whisper-large-v3-turbo`, transcribes in the original language; Claude writes the card in English. |
| Vision | Up to 10 JPEG stills per video sent as image parts in the same Claude call. |
| Download | yt-dlp + ffmpeg. Tonight: Bun runner on my laptop. Also packaged as a Cloudflare Sandbox container (`wrangler.containers.jsonc`) — needs Workers Paid, which is why it is not live. |
| Frontend | React 19, Vite, Tailwind v4, shadcn (Base UI). |
| Repo hygiene | TypeScript strict, vitest, ESLint clean, GitHub connected to Workers Builds (push = deploy). |

## Pipeline in one breath

Link → normalise + dedupe → oEmbed/og tags for caption + thumbnail → Claude drafts card instantly → runner downloads video → ffmpeg splits mono 16 kHz audio + frames → Worker: Whisper → Claude again with caption + transcript + frames → card upgraded → filed under cuisine.

## Numbers from tonight

- 30 videos seeded, 27 recipe cards, 3 correctly rejected as "not a recipe".
- 20 cards from audio transcript, 7 from video frames (music-only videos, would have been empty otherwise).
- Instagram, TikTok and YouTube Shorts all work. One Instagram reel that blocked the first download succeeded on retry.

## Likely questions

- **Why not embed the video?** Thumbnail opens the original. Keeps the creator's view count, no third-party scripts.
- **Cost per recipe?** One Whisper call (free tier) plus one Claude call with ~10 small images: a few cents.
- **What breaks?** Sites that block anonymous downloads. The card still exists from the caption and says why the audio failed. Nothing loops forever.
- **Why local yt-dlp?** Containers are a paid feature; the container is built and deployable with one command. Also datacenter IPs get blocked by TikTok more than a home IP does.
- **Privacy?** Emails never leave the API. Only names are shared inside the kitchen.

## Commands if something goes wrong

```
bun scripts/runner.ts --watch          # media runner (must be running for the live paste)
bun scripts/runner.ts <url>            # save + process one link immediately
npm run deploy                         # redeploy web + worker
```
