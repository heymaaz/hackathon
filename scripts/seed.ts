#!/usr/bin/env bun
/**
 * Seed the box with links from scripts/seed-urls.json (or files/urls passed as args).
 *   bun scripts/seed.ts                    # uses scripts/seed-urls.json
 *   bun scripts/seed.ts urls.txt           # one url per line
 * Env: RECIPEBOX_URL (default http://localhost:8787), RECIPEBOX_EMAIL, RECIPEBOX_PASSWORD (your app login)
 */
import { readFileSync } from "node:fs";
import { signIn } from "./auth";

const BASE = (process.env.RECIPEBOX_URL ?? "http://localhost:8787").replace(/\/$/, "");
const headers = await signIn(BASE);

const src = process.argv[2] ?? new URL("./seed-urls.json", import.meta.url).pathname;
const text = readFileSync(src, "utf8");
const urls: string[] = src.endsWith(".json")
  ? (JSON.parse(text) as { url: string }[]).map((x) => x.url)
  : text.split("\n").map((s) => s.trim()).filter((s) => s && !s.startsWith("#"));

let ok = 0;
for (const url of urls) {
  const r = await fetch(`${BASE}/api/recipes`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ url }),
  });
  const j = (await r.json()) as { id?: string; duplicate?: boolean; error?: string };
  console.log(r.status, j.duplicate ? "dup" : j.id ?? j.error, url);
  if (r.ok) ok++;
  await new Promise((res) => setTimeout(res, 400)); // let the worker fan out
}
console.log(`queued ${ok}/${urls.length}`);
