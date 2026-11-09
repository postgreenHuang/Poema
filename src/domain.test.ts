import { describe, expect, it } from "vitest";
import { chooseNext, genreOf, parseSearchIntent, relatedPoems, searchPoems } from "./domain";
import { poems } from "./catalog";

describe("寻诗", () => {
  it("理解雨、明亮情绪和短诗条件", () => {
    const { results, intent } = searchPoems(poems, "写雨但不悲伤的短诗", "all", "all");
    expect(intent.included).toContain("rain");
    expect(intent.mood).toBe("lighter");
    expect(intent.short).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    expect(results.every(p => p.themes.includes("rain") && p.mood >= 3 && p.lines.filter(Boolean).length <= 8)).toBe(true);
  });

  it("保留准确题名检索，并识别排除项", () => {
    expect(searchPoems(poems, "夜雨寄北", "all", "all").results.map(p => p.id)).toContain("zh-yeyu");
    const intent = parseSearchIntent("月亮，不要离别", poems);
    expect(intent.included).toContain("moon");
    expect(intent.excluded).toContain("parting");
  });
});

describe("诗路和偶遇", () => {
  it("诗路不推荐当前诗，并解释共享意象", () => {
    const links = relatedPoems(poems[0], poems, "image");
    expect(links.every(link => link.poem.id !== poems[0].id)).toBe(true);
    expect(links[0].reason).toContain("月与夜");
  });

  it("有其他候选时不会立刻重复最近读过的诗", () => {
    const next = chooseNext(poems, [poems[1].id, poems[2].id], poems[0].id);
    expect([poems[0].id, poems[1].id, poems[2].id]).not.toContain(next.id);
  });

  it("中文偶遇优先从扩展语料发现作品，而非总回到名篇", () => {
    const next = chooseNext(poems, [], undefined, () => 0.1);
    expect(next.language).toBe("zh");
    expect(next.collection).toBe("discovery");
  });

  it("大量偶遇中仍分散作者，并保持发现语料占多数", () => {
    let seed = 71;
    const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
    const picks = Array.from({ length: 500 }, () => chooseNext(poems, [], undefined, random));
    expect(picks.filter(p => p.collection === "discovery").length).toBeGreaterThan(275);
    expect(new Set(picks.map(p => p.author)).size).toBeGreaterThan(100);
  });

  it("扩展语料覆盖多种文体，且可按文体名寻觅", () => {
    const discoveries = poems.filter(p => p.collection === "discovery");
    expect(discoveries.length).toBeGreaterThan(4500);
    for (const genre of ["诗", "词", "曲", "诗经", "楚辞", "古文"] as const) {
      expect(discoveries.some(p => genreOf(p) === genre)).toBe(true);
    }
    expect(searchPoems(poems, "诗经", "zh", "all").results.some(p => genreOf(p) === "诗经")).toBe(true);
  });
});
