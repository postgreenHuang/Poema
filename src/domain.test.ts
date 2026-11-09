import { describe, expect, it } from "vitest";
import { chooseNext, parseSearchIntent, relatedPoems, searchPoems } from "./domain";
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
});
