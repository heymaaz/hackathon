import { Hono } from "hono";
import { auth, type Session } from "./auth";
import { extractRecipe, fetchMeta, normalizeUrl, pickLlm, type Meta } from "./extract";

type Vars = { session: Session };
const app = new Hono<{ Bindings: Env; Variables: Vars }>();

// ---------- auth ----------
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
  const { results: members } = await c.env.DB.prepare('SELECT id, name, email, image FROM "user" ORDER BY "createdAt"').all();
  return c.json({ user: s.user, members });
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
    `SELECT COUNT(*) total, SUM(status='ready') ready, SUM(status IN ('needs_transcript','transcribing')) needs_transcript,
       SUM(status='pending') pending, SUM(status='failed') failed, SUM(favorite) favorite, SUM(cooked) cooked,
       SUM(requested_by IS NOT NULL AND cooked = 0) requests, SUM(requested_by IS NOT NULL AND requested_by != ? AND cooked = 0) requests_for_me,
       SUM(saved_by = ?) mine, SUM(source='transcript') from_transcript
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

/** Audio upload -> Workers AI Whisper -> re-extract with transcript. Body: raw audio bytes. */
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
    const out = (await c.env.AI.run("@cf/openai/whisper-large-v3-turbo", {
      audio: bytesToBase64(new Uint8Array(buf)),
      task: "transcribe",
      vad_filter: true,
      initial_prompt: "A cooking video. Ingredients with quantities in grams, cups, tablespoons; cooking steps.",
    })) as { text?: string };
    text = (out.text ?? "").trim();
  } catch (e) {
    await c.env.DB.prepare("UPDATE recipes SET status = 'needs_transcript', error = ? WHERE id = ?").bind(`whisper: ${String(e)}`, id).run();
    return c.json({ error: `whisper failed: ${String(e)}` }, 502);
  }
  await c.env.DB.prepare("UPDATE recipes SET transcript = ? WHERE id = ?").bind(text, id).run();
  await processRecipe(c.env, id, r.url, text);
  return c.json({ transcript_chars: text.length, recipe: await getRecipe(c.env.DB, id) });
});

/** Recipes still waiting for audio (polled by the yt-dlp runner / Sandbox). Every recipe gets audio once. */
app.get("/api/queue", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT id, url, title, status FROM recipes WHERE transcript IS NULL AND status != 'transcribing' ORDER BY created_at ASC LIMIT 50",
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

// ---------- pipeline ----------
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
        "UPDATE recipes SET status = 'needs_transcript', title = COALESCE(title, ?), error = 'No caption; waiting for the audio transcript', updated_at = datetime('now') WHERE id = ?",
      )
        .bind(meta.title ?? url, id)
        .run();
      return;
    }

    const recipe = await extractRecipe(pickLlm(env), meta, transcript);
    const status = !recipe.is_recipe ? "failed" : transcript ? "ready" : recipe.needs_transcript ? "needs_transcript" : "ready";
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
        !recipe.is_recipe ? "Does not look like a recipe" : status === "needs_transcript" ? "Caption is thin; waiting for the audio transcript" : null,
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
