import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText, Output, type LanguageModel } from "ai";
import { z } from "zod";

export type Platform = "tiktok" | "instagram" | "youtube" | "facebook" | "other";

export interface Meta {
  platform: Platform;
  title: string | null;
  creator: string | null;
  thumbnail: string | null;
  caption: string | null;
}

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

export function detectPlatform(url: string): Platform {
  const h = new URL(url).hostname.replace(/^www\./, "");
  if (h.endsWith("tiktok.com")) return "tiktok";
  if (h.endsWith("instagram.com")) return "instagram";
  if (h.endsWith("youtube.com") || h === "youtu.be") return "youtube";
  if (h.endsWith("facebook.com") || h === "fb.watch") return "facebook";
  return "other";
}

/** Follow share-link redirects (vm.tiktok.com, youtu.be, etc.) and strip tracking params. */
export async function normalizeUrl(raw: string): Promise<string> {
  let url = raw.trim();
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  const u = new URL(url);
  if (/^(vm|vt)\.tiktok\.com$/.test(u.hostname) || u.hostname === "youtu.be" || u.hostname === "fb.watch") {
    try {
      const r = await fetch(url, { redirect: "follow", headers: { "user-agent": UA } });
      if (r.url) url = r.url;
    } catch {}
  }
  const n = new URL(url);
  const keep = new Set(["v"]);
  for (const k of [...n.searchParams.keys()]) if (!keep.has(k)) n.searchParams.delete(k);
  n.hash = "";
  return n.toString().replace(/\/$/, "");
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)));
}

function metaTag(html: string, prop: string): string | null {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']*)["']`, "i");
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${prop}["']`, "i");
  const m = html.match(re) ?? html.match(re2);
  return m ? decodeEntities(m[1]) : null;
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, {
      headers: { "user-agent": UA, accept: "text/html,application/json;q=0.9,*/*;q=0.8", "accept-language": "en-GB,en;q=0.9" },
      redirect: "follow",
    });
    if (!r.ok) return null;
    return await r.text();
  } catch {
    return null;
  }
}

export async function fetchMeta(url: string): Promise<Meta> {
  const platform = detectPlatform(url);
  const meta: Meta = { platform, title: null, creator: null, thumbnail: null, caption: null };

  // 1. oEmbed where available (TikTok + YouTube are unauthenticated).
  const oembed =
    platform === "tiktok"
      ? `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`
      : platform === "youtube"
        ? `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`
        : null;
  if (oembed) {
    const txt = await fetchText(oembed);
    if (txt) {
      try {
        const j = JSON.parse(txt) as Record<string, string>;
        meta.title = j.title ?? null;
        meta.creator = j.author_name ?? null;
        meta.thumbnail = j.thumbnail_url ?? null;
        if (platform === "tiktok") meta.caption = j.title ?? null; // TikTok oEmbed title is the full caption
      } catch {}
    }
  }

  // 2. Page HTML for description (YouTube shortDescription, Instagram/Facebook og tags).
  const html = await fetchText(url);
  if (html) {
    if (platform === "youtube") {
      const m = html.match(/"shortDescription":"((?:[^"\\]|\\.)*)"/);
      if (m) {
        try {
          meta.caption = JSON.parse(`"${m[1]}"`);
        } catch {
          meta.caption = m[1];
        }
      }
    }
    meta.title ??= metaTag(html, "og:title");
    meta.thumbnail ??= metaTag(html, "og:image");
    meta.caption ??= metaTag(html, "og:description") ?? metaTag(html, "description");
    if (platform === "instagram" && meta.caption) {
      const m = meta.caption.match(/^[\d,.]+[KM]? likes, [\d,.]+[KM]? comments - [\w.]+ on [^:]+: "([\s\S]*)"\.?\s*$/);
      if (m) meta.caption = m[1];
    }
    if (!meta.creator) {
      const t = metaTag(html, "og:title");
      const m = t?.match(/^(.*?) on (Instagram|TikTok)/i) ?? t?.match(/\((@[\w.]+)\)/);
      if (m) meta.creator = m[1];
    }
  }
  return meta;
}

export const RecipeSchema = z.object({
  is_recipe: z.boolean().describe("false if the content clearly is not a cooking recipe"),
  title: z.string().describe("Short dish name, e.g. 'Butter Chicken' or 'Basque Cheesecake'"),
  cuisine: z
    .string()
    .describe("One word or two: Indian, Chinese, Thai, Italian, Mexican, Japanese, Korean, Middle Eastern, British, American, Mediterranean, Dessert, Other"),
  category: z.string().describe("Meal type: Breakfast, Lunch, Dinner, Snack, Dessert, Drink, Side, Sauce"),
  summary: z.string().describe("One or two friendly sentences describing the dish"),
  servings: z.string().nullable(),
  total_minutes: z.number().int().nullable().describe("Estimated total time in minutes"),
  ingredients: z.array(
    z.object({
      item: z.string(),
      quantity: z.string().nullable().describe("e.g. '2 tbsp', '500g', null if unknown"),
      note: z.string().nullable(),
    }),
  ),
  steps: z.array(z.string()).describe("Ordered, imperative, one action per step"),
  tags: z.array(z.string()).describe("3-6 lowercase tags: e.g. 'vegetarian', 'quick', 'one-pot', 'spicy'"),
  confidence: z.number().min(0).max(1).describe("How complete and faithful the recipe is to the source text"),
  needs_transcript: z
    .boolean()
    .describe("true if the caption does not contain enough detail to cook this and an audio transcript would help"),
});
export type Recipe = z.infer<typeof RecipeSchema>;

const SYSTEM = `You turn social-media cooking videos (TikTok, Instagram Reels, YouTube Shorts) into clean, cookable recipe cards.
You are given the video's caption and, when available, a speech transcript and a handful of still frames sampled from the video. Many creators put the ingredients and quantities as on-screen text rather than speech, so read the frames carefully. Extract faithfully: never invent quantities that are not stated or strongly implied, use null instead. Fix obvious transcription errors of ingredient names. Always write the card in English even if the speech or text is in another language, keeping dish and ingredient names (e.g. kasuri methi). Ingredients in the order they are used. Set needs_transcript to true only when the caption alone is too thin to cook from AND you were given neither a transcript nor frames.`;

export interface LlmConfig {
  /** "openrouter" (default when OPENROUTER_API_KEY is set) or "anthropic" */
  provider: "openrouter" | "anthropic";
  /** Anthropic model id, e.g. "claude-opus-5". Mapped to "anthropic/claude-opus-5" on OpenRouter. */
  model: string;
  openrouterApiKey?: string;
  anthropicApiKey?: string;
  /** Required by identity-linked Anthropic API keys (Console > Settings > Workspaces). */
  anthropicWorkspaceId?: string;
}

export function pickLlm(env: {
  OPENROUTER_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_WORKSPACE_ID?: string;
  LLM_PROVIDER?: string;
  CLAUDE_MODEL?: string;
}): LlmConfig {
  const provider =
    env.LLM_PROVIDER === "anthropic" || (!env.OPENROUTER_API_KEY && env.ANTHROPIC_API_KEY) ? "anthropic" : "openrouter";
  return {
    provider,
    model: env.CLAUDE_MODEL ?? "claude-opus-5",
    openrouterApiKey: env.OPENROUTER_API_KEY,
    anthropicApiKey: env.ANTHROPIC_API_KEY,
    anthropicWorkspaceId: env.ANTHROPIC_WORKSPACE_ID,
  };
}

function languageModel(cfg: LlmConfig): LanguageModel {
  if (cfg.provider === "anthropic") {
    if (!cfg.anthropicApiKey) throw new Error("ANTHROPIC_API_KEY not set");
    return createAnthropic({
      apiKey: cfg.anthropicApiKey,
      headers: cfg.anthropicWorkspaceId ? { "anthropic-workspace-id": cfg.anthropicWorkspaceId } : undefined,
    })(cfg.model);
  }
  if (!cfg.openrouterApiKey) throw new Error("OPENROUTER_API_KEY not set");
  const slug = cfg.model.includes("/") ? cfg.model : `anthropic/${cfg.model}`;
  return createOpenRouter({ apiKey: cfg.openrouterApiKey })(slug);
}

/** `frames` are base64-encoded JPEGs sampled from the video (on-screen ingredient text lives there). */
export async function extractRecipe(cfg: LlmConfig, meta: Meta, transcript: string | null, frames: string[] = []): Promise<Recipe> {
  const text = [
    `Platform: ${meta.platform}`,
    meta.creator ? `Creator: ${meta.creator}` : null,
    meta.title && meta.title !== meta.caption ? `Title: ${meta.title}` : null,
    `Caption:\n${meta.caption ?? "(none)"}`,
    transcript === null
      ? "Speech transcript: (not available)"
      : transcript.trim()
        ? `Speech transcript:\n${transcript}`
        : "Speech transcript: (the video has no speech, only music)",
    frames.length ? `${frames.length} frames sampled evenly from the video follow, in order.` : null,
  ]
    .filter(Boolean)
    .join("\n\n");
  const { output } = await generateText({
    model: languageModel(cfg),
    system: SYSTEM,
    output: Output.object({ schema: RecipeSchema }),
    messages: [
      {
        role: "user",
        content: [{ type: "text", text }, ...frames.map((data) => ({ type: "file" as const, mediaType: "image/jpeg", data }))],
      },
    ],
    maxOutputTokens: 8000,
  });
  return output;
}
