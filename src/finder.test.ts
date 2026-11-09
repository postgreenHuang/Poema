import { describe, expect, it } from "vitest";
import { candidatePoems, normalizeFinderPlan, verifiedPicks } from "./finder";
import type { Poem } from "./domain";

const poem = (id: string, title: string, author: string, lines: string[], overrides: Partial<Poem> = {}): Poem => ({
  id, title, author, lines, language: "zh", form: "五言", era: "宋", genre: "诗", themes: ["rain"], mood: 3,
  sourceUrl: "https://example.org", sourceName: "test", rights: { status: "public_domain", basis: "test" }, ...overrides,
});

describe("AI poem finder guardrails", () => {
  it("drops unsupported filters rather than trusting model output", () => {
    const plan = normalizeFinderPlan({ language: "fr", genres: ["词", "小说"], themes: ["rain", "invented"], terms: ["雨"] });
    expect(plan.language).toBe("all");
    expect(plan.genres).toEqual(["词"]);
    expect(plan.themes).toEqual(["rain"]);
  });

  it("prioritizes matching less-familiar candidates and diversifies authors", () => {
    const poems = [poem("popular", "春雨", "甲", ["雨落"], { collection: undefined }), poem("hidden", "夜雨", "乙", ["夜里有雨"], { collection: "discovery" }), poem("other", "溪水", "乙", ["溪水"] )];
    const plan = normalizeFinderPlan({ terms: ["雨"], themes: ["rain"] });
    expect(candidatePoems(poems, plan, [], 2).map(item => item.id)).toEqual(["hidden", "popular"]);
  });

  it("rejects hallucinated IDs and duplicate selections", () => {
    const candidates = [poem("real", "夜雨", "乙", ["夜里有雨"])];
    expect(verifiedPicks({ picks: [{ id: "fake", reason: "编造" }, { id: "real", reason: "首句有夜雨" }, { id: "real", reason: "重复" }] }, candidates)).toEqual([{ id: "real", reason: "首句有夜雨" }]);
  });
});
