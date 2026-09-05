import { Hono } from "hono";
import { auth, type Session } from "./auth";
import { extractRecipe, fetchMeta, normalizeUrl, pickLlm, type Meta } from "./extract";
import { downloadMediaInSandbox } from "./sandbox";

export { Sandbox } from "./sandbox";

type Vars = { session: Session };
const app = new Hono<{ Bindings: Env; Variables: Vars }>();

// ---------- auth ----------
// Optional household lock: when INVITE_CODE is set, sign-up must carry it.
app.post("/api/auth/sign-up/email", async (c, next) => {
  if (c.env.INVITE_CODE && c.req.header("x-invite-code") !== c.env.INVITE_CODE) {
    return c.json({ code: "INVALID_INVITE_CODE", message: "That invite code is not right." }, 403);
  }
  await next();
});
app.all("/api/auth/*", (c) => auth.handler(c.req.raw));

app.use("/api/*", async (c, next) => {
  if (c.req.path.startsWith("/api/auth/")) return next();
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "unauthorized" }, 401);
  c.set("session", session);
  await next();
});

app.get("/api/me", async (c) => {
  const s = c.get("session");
  // Members are exposed by id and name only; emails stay private to their owner.
  const { results: members } = await c.env.DB.prepare('SELECT id, name, image FROM "user" ORDER BY "createdAt"').all();
  return c.json({ user: s.user, members, inviteRequired: Boolean(c.env.INVITE_CODE) });
});

// ---------- helpers ----------
const jsonCols = new Set(["ingredients", "steps", "tags"]);
function row(r: Record<string, unknown> | null) {
  if (!r) return null;
  const out: Record<string, unknown> = { ...r };
  for (const k of jsonCols) {
    const v = out[k];
    out[k] = typeof v === "string" && v ? JSON.parse(v) : [];
  }
  for (const k of ["favorite", "cooked"]) out[k] = Boolean(out[k]);
  return out;
}
const SELECT = `SELECT r.*, su.name AS saved_by_name, ru.name AS requested_by_name, cu.name AS cooked_by_name
  FROM recipes r
  LEFT JOIN "user" su ON su.id = r.saved_by
  LEFT JOIN "user" ru ON ru.id = r.requested_by
  LEFT JOIN "user" cu ON cu.id = r.cooked_by`;
async function getRecipe(db: D1Database, id: string) {
  return row((await db.prepare(`${SELECT} WHERE r.id = ?`).bind(id).first()) as Record<string, unknown> | null);
}

// ---------- recipes ----------
app.get("/api/recipes", async (c) => {
  const q = c.req.query("q")?.trim();
  const cuisine = c.req.query("cuisine")?.trim();
  const filter = c.req.query("filter"); // requests | mine | favorite | cooked | needs_transcript
  const me = c.get("session").user.id;
  const where: string[] = [];
  const args: unknown[] = [];
  if (q) {
    where.push("(r.title LIKE ? OR r.ingredients LIKE ? OR r.tags LIKE ? OR r.summary LIKE ? OR r.creator LIKE ? OR r.caption LIKE ? OR r.cuisine LIKE ?)");
    for (let i = 0; i < 7; i++) args.push(`%${q}%`);
  }
  if (cuisine) {
    where.push("r.cuisine = ?");
    args.push(cuisine);
  }
  if (filter === "favorite") where.push("r.favorite = 1");
  if (filter === "cooked") where.push("r.cooked = 1");
  if (filter === "requests") where.push("r.requested_by IS NOT NULL AND r.cooked = 0");
  if (filter === "mine") {
    where.push("r.saved_by = ?");
    args.push(me);
  }
  if (filter === "needs_transcript") where.push("r.status IN ('needs_transcript','transcribing')");
  const sql = `${SELECT} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY r.created_at DESC LIMIT 500`;
  const { results } = await c.env.DB.prepare(sql).bind(...args).all();
  return c.json(results.map((r) => row(r as Record<string, unknown>)));
});

app.get("/api/cuisines", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT cuisine, COUNT(*) AS n FROM recipes WHERE cuisine IS NOT NULL GROUP BY cuisine ORDER BY n DESC, cuisine",
  ).all();
  return c.json(results);
});

app.get("/api/stats", async (c) => {
  const me = c.get("session").user.id;
  const r = await c.env.DB.prepare(
    `SELECT COUNT(*) total, COALESCE(SUM(status='ready'),0) ready, COALESCE(SUM(status IN ('needs_transcript','transcribing')),0) needs_transcript,
       COALESCE(SUM(status='pending'),0) pending, COALESCE(SUM(status='failed'),0) failed, COALESCE(SUM(favorite),0) favorite, COALESCE(SUM(cooked),0) cooked,
       COALESCE(SUM(requested_by IS NOT NULL AND cooked = 0),0) requests, COALESCE(SUM(requested_by IS NOT NULL AND requested_by != ? AND cooked = 0),0) requests_for_me,
       COALESCE(SUM(saved_by = ?),0) mine, COALESCE(SUM(source='transcript'),0) from_transcript
     FROM recipes`,
  )
    .bind(me, me)
    .first();
  return c.json(r);
});

app.get("/api/recipes/:id", async (c) => {
  const r = await getRecipe(c.env.DB, c.req.param("id"));
  return r ? c.json(r) : c.json({ error: "not found" }, 404);
});

/** Save a link. Returns immediately; extraction runs in the background. */
app.post("/api/recipes", async (c) => {
  type SaveBody = { url?: string; note?: string; request?: boolean };
  const body: SaveBody = await c.req.json<SaveBody>().catch(() => ({}));
  if (!body.url) return c.json({ error: "url required" }, 400);
  let url: string;
  try {
    url = await normalizeUrl(body.url);
  } catch {
    return c.json({ error: "invalid url" }, 400);
  }
  const me = c.get("session").user.id;
  const existing = await c.env.DB.prepare("SELECT id FROM recipes WHERE url = ?").bind(url).first<{ id: string }>();
  if (existing) return c.json({ ...(await getRecipe(c.env.DB, existing.id)), duplicate: true });

  const id = crypto.randomUUID().slice(0, 8);
  const platform = new URL(url).hostname.replace(/^www\./, "").split(".").slice(-2, -1)[0];
  await c.env.DB.prepare(
    "INSERT INTO recipes (id, url, platform, status, note, saved_by, requested_by, requested_at) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?)",
  )
    .bind(id, url, platform, body.note ?? null, me, body.request ? me : null, body.request ? new Date().toISOString() : null)
    .run();

  c.executionCtx.waitUntil(processRecipe(c.env, id, url, null));
  return c.json({ id, url, status: "pending" }, 202);
});

app.post("/api/recipes/:id/retry", async (c) => {
  const id = c.req.param("id");
  const r = await c.env.DB.prepare("SELECT url, transcript FROM recipes WHERE id = ?").bind(id).first<{ url: string; transcript: string | null }>();
  if (!r) return c.json({ error: "not found" }, 404);
  await c.env.DB.prepare("UPDATE recipes SET status = 'pending', error = NULL WHERE id = ?").bind(id).run();
  c.executionCtx.waitUntil(processRecipe(c.env, id, r.url, r.transcript));
  return c.json({ ok: true });
});

/**
 * Media upload from the local runner: multipart with optional `audio` (m4a/mp3/wav) and up to 10 `frames` (jpeg).
 * Whisper transcribes the audio, Claude re-reads the recipe with transcript + frames, and the card is filed.
 */
app.post("/api/recipes/:id/media", async (c) => {
  const id = c.req.param("id");
  const r = await c.env.DB.prepare("SELECT url FROM recipes WHERE id = ?").bind(id).first<{ url: string }>();
  if (!r) return c.json({ error: "not found" }, 404);
  const form = await c.req.formData();
  const audioFile = form.get("audio");
  const frameFiles = form.getAll("frames").filter((f): f is File => f instanceof File).slice(0, 10);
  const audio = audioFile instanceof File && audioFile.size > 1000 ? bytesToBase64(new Uint8Array(await audioFile.arrayBuffer())) : null;
  if (audioFile instanceof File && audioFile.size > 24 * 1024 * 1024) return c.json({ error: "audio too large (24MB max)" }, 413);
  const frames: string[] = [];
  for (const f of frameFiles) frames.push(bytesToBase64(new Uint8Array(await f.arrayBuffer())));
  if (!audio && !frames.length) return c.json({ error: "send audio and/or frames" }, 400);
  try {
    const chars = await transcribeAndExtract(c.env, id, r.url, audio, frames);
    return c.json({ transcript_chars: chars, recipe: await getRecipe(c.env.DB, id) });
  } catch (e) {
    return c.json({ error: String(e) }, 502);
  }
});

/** Audio-only upload (raw bytes). Kept for simple clients; prefer /media. */
app.post("/api/recipes/:id/audio", async (c) => {
  const id = c.req.param("id");
  const r = await c.env.DB.prepare("SELECT url FROM recipes WHERE id = ?").bind(id).first<{ url: string }>();
  if (!r) return c.json({ error: "not found" }, 404);
  const buf = await c.req.arrayBuffer();
  if (buf.byteLength < 1000) return c.json({ error: "audio too small" }, 400);
  if (buf.byteLength > 24 * 1024 * 1024) return c.json({ error: "audio too large (24MB max)" }, 413);
  try {
    const chars = await transcribeAndExtract(c.env, id, r.url, bytesToBase64(new Uint8Array(buf)), []);
    return c.json({ transcript_chars: chars, recipe: await getRecipe(c.env.DB, id) });
  } catch (e) {
    return c.json({ error: String(e) }, 502);
  }
});

/** The runner could not download the video. Keep the caption card if there is one, and stop re-queueing. */
app.post("/api/recipes/:id/media-failed", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{ error?: string }>().catch(() => ({}) as { error?: string });
  const r = await c.env.DB.prepare("SELECT ingredients FROM recipes WHERE id = ?").bind(id).first<{ ingredients: string | null }>();
  if (!r) return c.json({ error: "not found" }, 404);
  const hasCard = !!r.ingredients && r.ingredients !== "[]";
  await c.env.DB.prepare("UPDATE recipes SET status = ?, transcript = COALESCE(transcript, ''), error = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(hasCard ? "ready" : "failed", `Video download failed, card is from the caption only: ${(body.error ?? "unknown").slice(0, 300)}`, id)
    .run();
  return c.json({ ok: true });
});

/** Cloud path: yt-dlp inside a Cloudflare Sandbox container -> Whisper -> Claude. Runs in the background. */
app.post("/api/recipes/:id/listen", async (c) => {
  const id = c.req.param("id");
  const r = await c.env.DB.prepare("SELECT url, status FROM recipes WHERE id = ?").bind(id).first<{ url: string; status: string }>();
  if (!r) return c.json({ error: "not found" }, 404);
  if (!(c.env as Partial<Env>).Sandbox) {
    return c.json({ error: "Cloud listening is not enabled on this deployment (Containers need the Workers Paid plan). Run `bun scripts/runner.ts` instead." }, 501);
  }
  if (r.status === "transcribing") return c.json({ ok: true, already: true });
  await c.env.DB.prepare("UPDATE recipes SET status = 'transcribing', error = NULL, updated_at = datetime('now') WHERE id = ?").bind(id).run();
  c.executionCtx.waitUntil(listenInCloud(c.env, id, r.url));
  return c.json({ ok: true }, 202);
});

/** Drain the audio queue through the Sandbox (also runs on the cron trigger). */
app.post("/api/queue/run", async (c) => {
  const n = await drainQueueInCloud(c.env, c.executionCtx, Number(c.req.query("limit") ?? 3));
  return c.json({ started: n });
});

/** Recipes still waiting for audio (polled by the yt-dlp runner / Sandbox). Every recipe gets audio once. */
app.get("/api/queue", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT id, url, title, status FROM recipes WHERE (transcript IS NULL OR status = 'needs_transcript') AND status NOT IN ('transcribing','pending') ORDER BY created_at ASC LIMIT 50",
  ).all();
  return c.json(results);
});

app.patch("/api/recipes/:id", async (c) => {
  const id = c.req.param("id");
  const me = c.get("session").user.id;
  const body = await c.req.json<Record<string, unknown>>();
  const sets: string[] = [];
  const args: unknown[] = [];
  for (const k of ["favorite", "note", "cuisine", "title", "category"]) {
    if (k in body) {
      sets.push(`${k} = ?`);
      const v = body[k];
      args.push(typeof v === "boolean" ? (v ? 1 : 0) : v);
    }
  }
  if ("request" in body) {
    // "please cook this for me": the requester is whoever presses it
    sets.push("requested_by = ?", "requested_at = ?");
    args.push(body.request ? me : null, body.request ? new Date().toISOString() : null);
  }
  if ("cooked" in body) {
    sets.push("cooked = ?", "cooked_by = ?", "cooked_at = ?");
    args.push(body.cooked ? 1 : 0, body.cooked ? me : null, body.cooked ? new Date().toISOString() : null);
  }
  if (!sets.length) return c.json({ error: "nothing to update" }, 400);
  args.push(id);
  await c.env.DB.prepare(`UPDATE recipes SET ${sets.join(", ")}, updated_at = datetime('now') WHERE id = ?`).bind(...args).run();
  return c.json(await getRecipe(c.env.DB, id));
});

app.delete("/api/recipes/:id", async (c) => {
  await c.env.DB.prepare("DELETE FROM recipes WHERE id = ?").bind(c.req.param("id")).run();
  return c.json({ ok: true });
});

// ---------- keeps: "just save the video file to my laptop" ----------
/** Queue a video for the local runner to download in full to KEEP_DIR (default ~/Documents/ytp-dlp-downloaded). */
app.post("/api/keep", async (c) => {
  const body = await c.req.json<{ url?: string }>().catch(() => ({}) as { url?: string });
  if (!body.url) return c.json({ error: "url required" }, 400);
  let url: string;
  try {
    url = await normalizeUrl(body.url);
  } catch {
    return c.json({ error: "invalid url" }, 400);
  }
  const existing = await c.env.DB.prepare("SELECT * FROM keeps WHERE url = ?").bind(url).first();
  if (existing) return c.json({ ...existing, duplicate: true });
  const id = crypto.randomUUID().slice(0, 8);
  const platform = new URL(url).hostname.replace(/^www\./, "").split(".").slice(-2, -1)[0];
  await c.env.DB.prepare("INSERT INTO keeps (id, url, platform, requested_by) VALUES (?, ?, ?, ?)").bind(id, url, platform, c.get("session").user.id).run();
  return c.json({ id, url, status: "pending" }, 202);
});

app.get("/api/keep", async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT k.*, u.name AS requested_by_name FROM keeps k LEFT JOIN "user" u ON u.id = k.requested_by ORDER BY k.created_at DESC LIMIT 200',
  ).all();
  return c.json(results);
});

/** Polled by the runner. Claims the rows it returns so two runners do not fight. */
app.get("/api/keep/queue", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT id, url FROM keeps WHERE status = 'pending' ORDER BY created_at ASC LIMIT 20").all<{ id: string; url: string }>();
  for (const k of results) await c.env.DB.prepare("UPDATE keeps SET status = 'downloading', updated_at = datetime('now') WHERE id = ?").bind(k.id).run();
  return c.json(results);
});

app.post("/api/keep/:id/done", async (c) => {
  const body = await c.req.json<{ filename?: string; bytes?: number; title?: string; error?: string }>().catch(() => ({}) as Record<string, never>);
  const ok = !body.error;
  await c.env.DB.prepare("UPDATE keeps SET status = ?, filename = ?, bytes = ?, title = COALESCE(?, title), error = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(ok ? "done" : "failed", body.filename ?? null, body.bytes ?? null, body.title ?? null, body.error?.slice(0, 300) ?? null, c.req.param("id"))
    .run();
  return c.json({ ok: true });
});

app.delete("/api/keep/:id", async (c) => {
  await c.env.DB.prepare("DELETE FROM keeps WHERE id = ?").bind(c.req.param("id")).run();
  return c.json({ ok: true });
});

// ---------- pipeline ----------
async function processRecipe(env: Env, id: string, url: string, transcript: string | null, frames: string[] = []): Promise<void> {
  try {
    const meta: Meta = await fetchMeta(url);
    await env.DB.prepare(
      "UPDATE recipes SET platform = ?, title = COALESCE(title, ?), creator = ?, thumbnail = ?, caption = ?, updated_at = datetime('now') WHERE id = ?",
    )
      .bind(meta.platform, meta.title, meta.creator, meta.thumbnail, meta.caption, id)
      .run();

    const haveMedia = transcript !== null || frames.length > 0;
    if (!meta.caption && !haveMedia) {
      await env.DB.prepare(
        "UPDATE recipes SET status = 'needs_transcript', title = COALESCE(title, ?), error = 'No caption; waiting for the audio transcript', updated_at = datetime('now') WHERE id = ?",
      )
        .bind(meta.title ?? url, id)
        .run();
      return;
    }

    const recipe = await extractRecipe(pickLlm(env), meta, transcript, frames);
    const status = !recipe.is_recipe ? "failed" : haveMedia ? "ready" : recipe.needs_transcript ? "needs_transcript" : "ready";
    const source = transcript?.trim() ? "transcript" : frames.length ? "frames" : "caption";
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
        source,
        !recipe.is_recipe ? "Does not look like a recipe" : status === "needs_transcript" ? "Caption is thin; waiting for the video" : null,
        id,
      )
      .run();
  } catch (e) {
    await env.DB.prepare("UPDATE recipes SET status = 'failed', error = ?, updated_at = datetime('now') WHERE id = ?")
      .bind(String(e).slice(0, 500), id)
      .run();
  }
}

/** Whisper (Workers AI) on base64 audio, then re-run Claude with the transcript. Returns transcript length. */
async function transcribeAndExtract(env: Env, id: string, url: string, audioBase64: string | null, frames: string[]): Promise<number> {
  await env.DB.prepare("UPDATE recipes SET status = 'transcribing', updated_at = datetime('now') WHERE id = ?").bind(id).run();
  let text = "";
  if (audioBase64) try {
    const out = (await env.AI.run("@cf/openai/whisper-large-v3-turbo", {
      audio: audioBase64,
      task: "transcribe",
      vad_filter: true,
      initial_prompt: "A cooking video. Ingredients with quantities in grams, cups, tablespoons; cooking steps.",
    })) as { text?: string };
    text = (out.text ?? "").trim();
  } catch (e) {
    await env.DB.prepare("UPDATE recipes SET status = 'needs_transcript', error = ? WHERE id = ?").bind(`whisper: ${String(e)}`, id).run();
    throw new Error(`whisper failed: ${String(e)}`);
  }
  await env.DB.prepare("UPDATE recipes SET transcript = ? WHERE id = ?").bind(text, id).run();
  await processRecipe(env, id, url, text, frames);
  return text.length;
}

async function listenInCloud(env: Env, id: string, url: string): Promise<void> {
  try {
    const media = await downloadMediaInSandbox(env, id, url);
    await transcribeAndExtract(env, id, url, media.audio, media.frames);
  } catch (e) {
    await env.DB.prepare("UPDATE recipes SET status = 'needs_transcript', error = ?, updated_at = datetime('now') WHERE id = ? AND transcript IS NULL")
      .bind(`cloud listen: ${String(e).slice(0, 400)}`, id)
      .run();
  }
}

async function drainQueueInCloud(env: Env, ctx: { waitUntil(p: Promise<unknown>): void }, limit: number): Promise<number> {
  if (!(env as Partial<Env>).Sandbox) return 0; // deployed without the container binding
  const { results } = await env.DB.prepare(
    "SELECT id, url FROM recipes WHERE transcript IS NULL AND status IN ('needs_transcript','ready','failed') AND (error IS NULL OR error NOT LIKE 'cloud listen:%') ORDER BY created_at ASC LIMIT ?",
  )
    .bind(limit)
    .all<{ id: string; url: string }>();
  for (const r of results) {
    await env.DB.prepare("UPDATE recipes SET status = 'transcribing', updated_at = datetime('now') WHERE id = ?").bind(r.id).run();
    ctx.waitUntil(listenInCloud(env, r.id, r.url));
  }
  return results.length;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(drainQueueInCloud(env, ctx, 3));
  },
};
