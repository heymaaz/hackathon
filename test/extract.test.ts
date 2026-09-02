import { describe, expect, it } from "vitest";
import { detectPlatform, normalizeUrl, RecipeSchema } from "../src/extract";

describe("detectPlatform", () => {
  it("recognises the supported platforms", () => {
    expect(detectPlatform("https://www.tiktok.com/@x/video/1")).toBe("tiktok");
    expect(detectPlatform("https://vm.tiktok.com/ZGeAbc/")).toBe("tiktok");
    expect(detectPlatform("https://www.instagram.com/reel/ABC/")).toBe("instagram");
    expect(detectPlatform("https://youtube.com/shorts/abc")).toBe("youtube");
    expect(detectPlatform("https://youtu.be/abc")).toBe("youtube");
    expect(detectPlatform("https://fb.watch/abc")).toBe("facebook");
    expect(detectPlatform("https://example.com/x")).toBe("other");
  });
});

describe("normalizeUrl", () => {
  it("adds https, strips tracking params and trailing slash", async () => {
    expect(await normalizeUrl("www.tiktok.com/@x/video/123/?is_from_webapp=1&sender_device=pc")).toBe("https://www.tiktok.com/@x/video/123");
  });
  it("keeps the YouTube v param", async () => {
    expect(await normalizeUrl("https://www.youtube.com/watch?v=abc&feature=share")).toBe("https://www.youtube.com/watch?v=abc");
  });
  it("dedupes case-insensitively on host but not path", async () => {
    expect(await normalizeUrl("https://WWW.Instagram.com/reel/AbC/")).toBe("https://www.instagram.com/reel/AbC");
  });
});

describe("RecipeSchema", () => {
  it("accepts a complete card", () => {
    const card = RecipeSchema.parse({
      is_recipe: true,
      title: "Dal Makhani",
      cuisine: "Indian",
      category: "Dinner",
      summary: "Slow-cooked black lentils.",
      servings: "4",
      total_minutes: 90,
      ingredients: [{ item: "urad dal", quantity: "1 cup", note: null }],
      steps: ["Soak the dal overnight."],
      tags: ["vegetarian", "slow-cooked"],
      confidence: 0.9,
      needs_transcript: false,
    });
    expect(card.ingredients[0].item).toBe("urad dal");
  });
  it("rejects a confidence outside 0..1", () => {
    expect(() =>
      RecipeSchema.parse({
        is_recipe: true, title: "x", cuisine: "x", category: "x", summary: "x", servings: null, total_minutes: null,
        ingredients: [], steps: [], tags: [], confidence: 1.5, needs_transcript: false,
      }),
    ).toThrow();
  });
});
