#!/usr/bin/env bun
/**
 * Local media runner: for every recipe still waiting on media, download the video with yt-dlp,
 * split it into a small audio track (Whisper) and up to 10 stills (on-screen ingredient text),
 * and upload both to the Worker, which transcribes, re-reads the recipe with Claude and files it.
 *
 *   bun scripts/runner.ts                # drain the queue once
 *   bun scripts/runner.ts --watch        # poll every 15s (leave running during the demo)
 *   bun scripts/runner.ts <url> [...]    # save these links AND process them right away
 *
 * Env (.env is loaded by Bun): RECIPEBOX_URL, RECIPEBOX_EMAIL, RECIPEBOX_PASSWORD
 */
import { $ } from "bun";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { signIn } from "./auth";

const BASE = (process.env.RECIPEBOX_URL ?? "http://localhost:8787").replace(/\/$/, "");
const MAX_FRAMES = 10;
const headers: Record<string, string> = await signIn(BASE);

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(BASE + path, { ...init, headers: { ...headers, ...(init?.headers as Record<string, string>) } });
  if (!r.ok) throw new Error(`${init?.method ?? "GET"} ${path} -> ${r.status} ${await r.text()}`);
  return (await r.json()) as T;
}

/** yt-dlp -> video.mp4 -> audio.m4a + frame_NN.jpg (same recipe as src/sandbox.ts mediaScript). */
async function downloadMedia(url: string): Promise<{ audio: Uint8Array | null; frames: Uint8Array[] }> {
  const dir = mkdtempSync(join(tmpdir(), "recipebox-"));
  try {
    const video = join(dir, "video.mp4");
    await $`yt-dlp -q --no-warnings --no-playlist --js-runtimes node -f "bv*[height<=480]+ba/b[height<=480]/b" --merge-output-format mp4 -o ${video} ${url}`.quiet();
    const audioPath = join(dir, "audio.m4a");
    const audioOk = (await $`ffmpeg -v error -y -i ${video} -vn -ac 1 -ar 16000 -c:a aac -b:a 48k ${audioPath}`.quiet().nothrow()).exitCode === 0;
    const durText = (await $`ffprobe -v error -show_entries format=duration -of csv=p=0 ${video}`.quiet().nothrow()).stdout.toString().trim();
    const dur = Math.max(1, Math.floor(Number(durText) || 30));
    const fps = Math.max(0.05, Math.min(1, MAX_FRAMES / dur));
    await $`ffmpeg -v error -y -i ${video} -vf ${`fps=${fps},scale=640:-2`} -frames:v ${MAX_FRAMES} -q:v 4 ${join(dir, "frame_%02d.jpg")}`.quiet();
    const frames = readdirSync(dir)
      .filter((f) => f.startsWith("frame_"))
      .sort()
      .map((f) => readFileSync(join(dir, f)));
    return { audio: audioOk ? readFileSync(audioPath) : null, frames };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function handle(id: string, url: string, title?: string | null) {
  process.stdout.write(`▶ ${id} ${(title ?? url).slice(0, 60)} … downloading`);
  let media;
  try {
    media = await downloadMedia(url);
  } catch (e) {
    const msg = String(e).split("\n")[0].slice(0, 300);
    await api(`/api/recipes/${id}/media-failed`, { method: "POST", body: JSON.stringify({ error: msg }), headers: { "content-type": "application/json" } });
    console.log(` ✗ download failed (${msg})`);
    return;
  }
  const form = new FormData();
  if (media.audio) form.append("audio", new Blob([media.audio], { type: "audio/mp4" }), "audio.m4a");
  media.frames.forEach((f, i) => form.append("frames", new Blob([f], { type: "image/jpeg" }), `frame_${i}.jpg`));
  process.stdout.write(` ${media.audio ? (media.audio.byteLength / 1024).toFixed(0) + "KB audio" : "no audio"} + ${media.frames.length} frames, extracting`);
  const res = await api<{ transcript_chars: number; recipe: { title: string; status: string; cuisine: string; source: string } }>(`/api/recipes/${id}/media`, {
    method: "POST",
    body: form,
  });
  console.log(` ✓ ${res.transcript_chars} chars -> ${res.recipe.title} [${res.recipe.cuisine}] ${res.recipe.status} (${res.recipe.source})`);
}

async function drain() {
  const queue = await api<{ id: string; url: string; title: string | null }[]>("/api/queue");
  for (const item of queue) {
    try {
      await handle(item.id, item.url, item.title);
    } catch (e) {
      console.log(` ✗ ${String(e).split("\n")[0]}`);
    }
  }
  return queue.length;
}

const args = process.argv.slice(2);
if (args.includes("--watch")) {
  console.log(`Watching ${BASE} for recipes that need media…`);
  for (;;) {
    const n = await drain().catch((e) => (console.error(e), 0));
    if (!n) await Bun.sleep(15_000);
  }
} else if (args.length) {
  for (const url of args) {
    const saved = await api<{ id: string; url: string }>("/api/recipes", {
      method: "POST",
      body: JSON.stringify({ url }),
      headers: { "content-type": "application/json" },
    });
    console.log(`saved ${saved.id} ${saved.url}`);
    await handle(saved.id, saved.url).catch((e) => console.log(` ✗ ${String(e).split("\n")[0]}`));
  }
} else {
  const n = await drain();
  console.log(n ? `done, processed ${n}` : "queue empty");
}
