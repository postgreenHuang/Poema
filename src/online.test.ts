import { describe, expect, it } from "vitest";
import { fromPoetryDB, fromWikisource, parseWikisourcePage } from "./online";

describe("verified online poetry source parsing", () => {
  it("keeps only real Wikisource pages and strips search markup", () => {
    const items = fromWikisource({ query: { search: [
      { ns: 0, pageid: 12949, title: "夜雨寄北", snippet: "巴山<span class=\"searchmatch\">夜雨</span>漲秋池", wordcount: 87 },
      { ns: 0, pageid: 2, title: "古书/卷1", snippet: "许多文字", wordcount: 100 },
      { ns: 0, pageid: 3, title: "长篇", snippet: "很长的内容", wordcount: 9000 },
      { ns: 1, pageid: 4, title: "讨论", snippet: "夜雨", wordcount: 40 },
    ] } });
    expect(items).toHaveLength(1);
    expect(items[0].excerpt).toBe("巴山夜雨漲秋池");
    expect(items[0].sourceUrl).toContain("zh.wikisource.org/wiki/");
  });

  it("accepts structured PoetryDB poems but no missing text", () => {
    const items = fromPoetryDB([{ title: "Moon", author: "A Poet", lines: ["First line", "Second line"] }, { title: "Empty", author: "A Poet", lines: [] }]);
    expect(items).toHaveLength(1);
    expect(items[0].excerpt).toBe("First line / Second line");
    expect(items[0].lines).toEqual(["First line", "Second line"]);
    expect(items[0].sourceName).toBe("PoetryDB");
  });

  it("extracts poem lines and author without footnotes or license text", () => {
    const parsed = parseWikisourcePage({ parse: { text: '<div id="headerContainer"><a href="/wiki/Author:%E6%9D%8E%E5%95%86%E9%9A%B1">李商隱</a></div><div class="poem"><p>君問歸期未有期<br />巴山夜雨漲秋池<sup class="reference">[1]</sup><br />何當共剪西窗燭<br />卻話巴山夜雨時</p></div><div class="licenseContainer">许可说明</div>' } });
    expect(parsed).toEqual({ author: "李商隱", lines: ["君問歸期未有期", "巴山夜雨漲秋池", "何當共剪西窗燭", "卻話巴山夜雨時"] });
    expect(parseWikisourcePage({ parse: { text: "<p>没有可辨认的正文</p>" } })).toBeNull();
  });
});
