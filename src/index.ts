import { Hono } from "hono";
import { cors } from "hono/cors";
import { extractRecipe, fetchMeta, normalizeUrl, type Meta } from "./extract";

export interface Env {
  DB: D1Database;
  AI: Ai;
  ASSETS: Fetcher;
  ANTHROPIC_API_KEY: string;
  CLAUDE_MODEL: string;
  APP_KEY?: string; // optional shared secret for write endpoints
}

const app = new Hono<{ Bindings: Env }>();
app.use("/api/*", cors());

// Optional write protection: if APP_KEY is set, mutating requests must send it.
app.use("/api/*", async (c, next) => {
  if (c.env.APP_KEY && c.req.method !== "GET") {
    const key = c.req.header("x-app-key") ?? c.req.query("key");
    if (key !== c.env.APP_KEY) return c.json({ error: "unauthorized" }, 401);
  }
  await next();
});

const jsonCols = new Set(["ingredients", "steps", "tags"]);
function row(r: Record<string, unknown> | null) {
  if (!r) return null;
  const out: Record<string, unknown> = { ...r };
  for (const k of jsonCols) {
    const v = out[k];
    out[k] = typeof v === "string" && v ? JSON.parse(v) : [];
  }
  for (const k of ["favorite", "cook_for_her", "cooked"]) out[k] = Boolean(out[k]);
  return out;
}

app.get("/api/recipes", async (c) => {
  const q = c.req.query("q")?.trim();
  const cuisine = c.req.query("cuisine")?.trim();
  const filter = c.req.query("filter"); // favorite | cook_for_her | cooked | needs_transcript
  const where: string[] = [];
  const args: unknown[] = [];
  if (q) {
    where.push("(title LIKE ? OR ingredients LIKE ? OR tags LIKE ? OR summary LIKE ? OR creator LIKE ? OR caption LIKE ?)");
    for (let i = 0; i < 6; i++) args.push(`%${q}%`);
  }
  if (cuisine) {
    where.push("cuisine = ?");
    args.push(cuisine);
  }
  if (filter === "favorite" || filter === "cook_for_her" || filter === "cooked") where.push(`${filter} = 1`);
  if (filter === "needs_transcript") where.push("status = 'needs_transcript'");
  const sql = `SELECT * FROM recipes ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY created_at DESC LIMIT 500`;
  const { results } = await c.env.DB.prepare(sql).bind(...args).all();
  return c.json(results.map((r) => row(r as Record<string, unknown>)));
});

app.get("/api/cuisines", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT cuisine, COUNT(*) AS n FROM recipes WHERE cuisine IS NOT NULL GROUP BY cuisine ORDER BY n DESC, cuisine",
  ).all();
  return c.json(results);
});

app.get("/api/recipes/:id", async (c) => {
  const r = await c.env.DB.prepare("SELECT * FROM recipes WHERE id = ?").bind(c.req.param("id")).first();
  if (!r) return c.json({ error: "not found" }, 404);
  return c.json(row(r as Record<string, unknown>));
});

/** Save a link. Returns immediately; extraction runs in the background. */
app.post("/api/recipes", async (c) => {
  type SaveBody = { url?: string; note?: string; cook_for_her?: boolean };
  const body: SaveBody = await c.req.json<SaveBody>().catch(() => ({}));
  if (!body.url) return c.json({ error: "url required" }, 400);
  let url: string;
  try {
    url = await normalizeUrl(body.url);
  } catch {
    return c.json({ error: "invalid url" }, 400);
  }
  const existing = await c.env.DB.prepare("SELECT * FROM recipes WHERE url = ?").bind(url).first();
  if (existing) return c.json({ ...row(existing as Record<string, unknown>), duplicate: true });

  const id = crypto.randomUUID().slice(0, 8);
  const platform = new URL(url).hostname.replace(/^www\./, "").split(".").slice(-2, -1)[0];
  await c.env.DB.prepare(
    "INSERT INTO recipes (id, url, platform, status, note, cook_for_her) VALUES (?, ?, ?, 'pending', ?, ?)",
  )
    .bind(id, url, platform, body.note ?? null, body.cook_for_her ? 1 : 0)
    .run();

  c.executionCtx.waitUntil(processRecipe(c.env, id, url, null));
  return c.json({ id, url, status: "pending" }, 202);
});

/** Re-run extraction for a recipe (e.g. after a failure). */
app.post("/api/recipes/:id/retry", async (c) => {
  const r = await c.env.DB.prepare("SELECT url, transcript FROM recipes WHERE id = ?").bind(c.req.param("id")).first<{ url: string; transcript: string | null }>();
  if (!r) return c.json({ error: "not found" }, 404);
  await c.env.DB.prepare("UPDATE recipes SET status = 'pending', error = NULL WHERE id = ?").bind(c.req.param("id")).run();
  c.executionCtx.waitUntil(processRecipe(c.env, c.req.param("id"), r.url, r.transcript));
  return c.json({ ok: true });
});

/**
 * Audio upload -> Workers AI Whisper -> re-extract with transcript.
 * Body: raw audio bytes (m4a/mp3/wav/webm). Used by scripts/runner.ts (yt-dlp) and the Sandbox worker.
 */
app.post("/api/recipes/:id/audio", async (c) => {
  const id = c.req.param("id");
  const r = await c.env.DB.prepare("SELECT url FROM recipes WHERE id = ?").bind(id).first<{ url: string }>();
  if (!r) return c.json({ error: "not found" }, 404);
  const buf = await c.req.arrayBuffer();
  if (buf.byteLength < 1000) return c.json({ error: "audio too small" }, 400);
  if (buf.byteLength > 24 * 1024 * 1024) return c.json({ error: "audio too large (24MB max)" }, 413);

  await c.env.DB.prepare("UPDATE recipes SET status = 'transcribing', updated_at = datetime('now') WHERE id = ?").bind(id).run();
  let text: string;
  try {
    const audio = bytesToBase64(new Uint8Array(buf));
    const out = (await c.env.AI.run("@cf/openai/whisper-large-v3-turbo" as keyof AiModels, {
      audio,
      task: "transcribe",
      vad_filter: true,
      initial_prompt: "A cooking video. Ingredients, quantities in grams, cups, tablespoons; cooking steps.",
    } as never)) as { text?: string };
    text = (out.text ?? "").trim();
  } catch (e) {
    await c.env.DB.prepare("UPDATE recipes SET status = 'needs_transcript', error = ? WHERE id = ?")
      .bind(`whisper: ${String(e)}`, id)
      .run();
    return c.json({ error: `whisper failed: ${String(e)}` }, 502);
  }
  await c.env.DB.prepare("UPDATE recipes SET transcript = ? WHERE id = ?").bind(text, id).run();
  await processRecipe(c.env, id, r.url, text);
  const updated = await c.env.DB.prepare("SELECT * FROM recipes WHERE id = ?").bind(id).first();
  return c.json({ transcript_chars: text.length, recipe: row(updated as Record<string, unknown>) });
});

/** Recipes waiting for audio (polled by the yt-dlp runner). */
app.get("/api/queue", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT id, url, title, status FROM recipes WHERE status IN ('needs_transcript','failed') AND transcript IS NULL ORDER BY created_at ASC LIMIT 50",
  ).all();
  return c.json(results);
});

app.patch("/api/recipes/:id", async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  const allowed = ["favorite", "cook_for_her", "cooked", "note", "cuisine", "title", "category"];
  const sets: string[] = [];
  const args: unknown[] = [];
  for (const k of allowed) {
    if (k in body) {
      sets.push(`${k} = ?`);
      const v = body[k];
      args.push(typeof v === "boolean" ? (v ? 1 : 0) : v);
    }
  }
  if (!sets.length) return c.json({ error: "nothing to update" }, 400);
  args.push(c.req.param("id"));
  await c.env.DB.prepare(`UPDATE recipes SET ${sets.join(", ")}, updated_at = datetime('now') WHERE id = ?`).bind(...args).run();
  const r = await c.env.DB.prepare("SELECT * FROM recipes WHERE id = ?").bind(c.req.param("id")).first();
  return c.json(row(r as Record<string, unknown>));
});

app.delete("/api/recipes/:id", async (c) => {
  await c.env.DB.prepare("DELETE FROM recipes WHERE id = ?").bind(c.req.param("id")).run();
  return c.json({ ok: true });
});

app.get("/api/stats", async (c) => {
  const r = await c.env.DB.prepare(
    "SELECT COUNT(*) total, SUM(status='ready') ready, SUM(status='needs_transcript') needs_transcript, SUM(status='pending') pending, SUM(status='failed') failed, SUM(cook_for_her) cook_for_her, SUM(cooked) cooked, SUM(source='transcript') from_transcript FROM recipes",
  ).first();
  return c.json(r);
});

async function processRecipe(env: Env, id: string, url: string, transcript: string | null): Promise<void> {
  try {
    const meta: Meta = await fetchMeta(url);
    await env.DB.prepare(
      "UPDATE recipes SET platform = ?, title = COALESCE(title, ?), creator = ?, thumbnail = ?, caption = ?, updated_at = datetime('now') WHERE id = ?",
    )
      .bind(meta.platform, meta.title, meta.creator, meta.thumbnail, meta.caption, id)
      .run();

    if (!meta.caption && !transcript) {
      await env.DB.prepare(
        "UPDATE recipes SET status = 'needs_transcript', title = COALESCE(title, ?), error = 'No caption available; waiting for audio transcript', updated_at = datetime('now') WHERE id = ?",
      )
        .bind(meta.title ?? url, id)
        .run();
      return;
    }

    const recipe = await extractRecipe(env.ANTHROPIC_API_KEY, env.CLAUDE_MODEL, meta, transcript);
    const status = !recipe.is_recipe ? "failed" : recipe.needs_transcript && !transcript ? "needs_transcript" : "ready";
    await env.DB.prepare(
      `UPDATE recipes SET title = ?, cuisine = ?, category = ?, summary = ?, servings = ?, total_minutes = ?,
        ingredients = ?, steps = ?, tags = ?, confidence = ?, status = ?, source = ?, error = ?, updated_at = datetime('now') WHERE id = ?`,
    )
      .bind(
        recipe.title,
        recipe.cuisine,
        recipe.category,
        recipe.summary,
        recipe.servings,
        recipe.total_minutes,
        JSON.stringify(recipe.ingredients),
        JSON.stringify(recipe.steps),
        JSON.stringify(recipe.tags),
        recipe.confidence,
        status,
        transcript ? "transcript" : "caption",
        !recipe.is_recipe ? "Does not look like a recipe" : status === "needs_transcript" ? "Caption is thin; queued for audio transcript" : null,
        id,
      )
      .run();
  } catch (e) {
    await env.DB.prepare("UPDATE recipes SET status = 'failed', error = ?, updated_at = datetime('now') WHERE id = ?")
      .bind(String(e).slice(0, 500), id)
      .run();
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}

export default app;
