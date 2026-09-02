#!/usr/bin/env bun
/**
 * yt-dlp runner: pulls audio for recipes that need a transcript and uploads it to the Worker,
 * which transcribes with Workers AI Whisper and re-extracts the recipe with Claude.
 *
 *   bun scripts/runner.ts                # drain the queue once
 *   bun scripts/runner.ts --watch        # poll every 15s
 *   bun scripts/runner.ts <url> [...]    # save these links AND transcribe them right away
 *
 * Env: RECIPEBOX_URL (default http://localhost:8787), RECIPEBOX_EMAIL, RECIPEBOX_PASSWORD (your app login)
 */
import { $ } from "bun";
import { signIn } from "./auth";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = (process.env.RECIPEBOX_URL ?? "http://localhost:8787").replace(/\/$/, "");
const headers: Record<string, string> = await signIn(BASE);

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(BASE + path, { ...init, headers: { ...headers, ...(init?.headers as Record<string, string>) } });
  if (!r.ok) throw new Error(`${init?.method ?? "GET"} ${path} -> ${r.status} ${await r.text()}`);
  return (await r.json()) as T;
}

async function downloadAudio(url: string): Promise<Uint8Array> {
  const dir = mkdtempSync(join(tmpdir(), "recipebox-"));
  try {
    const out = join(dir, "audio.m4a");
    // Small mono AAC keeps uploads tiny; recipe shorts are 30s–3min.
    await $`yt-dlp -q --no-warnings --js-runtimes node -x --audio-format m4a --audio-quality 6 --postprocessor-args "ffmpeg:-ac 1 -ar 16000" -o ${out} ${url}`.quiet();
    return readFileSync(out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function transcribe(id: string, url: string, title?: string | null) {
  process.stdout.write(`▶ ${id} ${title ?? url} … downloading`);
  const audio = await downloadAudio(url);
  process.stdout.write(` ${(audio.byteLength / 1024).toFixed(0)}KB, transcribing`);
  const res = await api<{ transcript_chars: number; recipe: { title: string; status: string; cuisine: string } }>(
    `/api/recipes/${id}/audio`,
    { method: "POST", body: audio, headers: { "content-type": "audio/mp4" } },
  );
  console.log(` ✓ ${res.transcript_chars} chars -> ${res.recipe.title} [${res.recipe.cuisine}] ${res.recipe.status}`);
}

async function drain() {
  const queue = await api<{ id: string; url: string; title: string | null }[]>("/api/queue");
  if (!queue.length) return 0;
  for (const item of queue) {
    try {
      await transcribe(item.id, item.url, item.title);
    } catch (e) {
      console.log(` ✗ ${String(e).split("\n")[0]}`);
    }
  }
  return queue.length;
}

const args = process.argv.slice(2);
if (args.includes("--watch")) {
  console.log(`Watching ${BASE} for recipes that need audio…`);
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
    try {
      await transcribe(saved.id, saved.url);
    } catch (e) {
      console.log(` ✗ ${String(e).split("\n")[0]}`);
    }
  }
} else {
  const n = await drain();
  console.log(n ? `done, processed ${n}` : "queue empty");
}
