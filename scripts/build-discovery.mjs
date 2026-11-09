import OpenCC from "opencc-js";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

// Source: chinese-poetry@2.0.1 (MIT). Extract only the shards below
// from its npm archive into .source-corpus/package/dist before running.
const root = new URL("../.source-corpus/package/dist/", import.meta.url);
const simplify = OpenCC.Converter({ from: "t", to: "cn" });
const hash = text => createHash("sha256").update(text).digest("hex");
const specs = [
  { label: "唐诗", genre: "诗", era: "唐", quota: 1500, authorCap: 12, paths: [5000, 10000, 15000, 20000, 25000, 30000, 35000, 40000, 45000, 50000, 55000].map(n => "quantangshi/poet.tang." + n + ".json") },
  { label: "宋诗", genre: "诗", era: "宋", quota: 1500, authorCap: 10, paths: [0, 10000, 30000, 50000, 70000, 90000, 100000, 120000, 140000, 150000, 170000, 190000, 200000, 230000, 250000].map(n => "quantangshi/poet.song." + n + ".json") },
  { label: "宋词", genre: "词", era: "宋", quota: 1200, authorCap: 12, paths: [0, 1000, 3000, 5000, 7000, 9000, 10000, 11000, 13000, 15000, 17000, 19000, 20000, 21000].map(n => "songci/ci.song." + n + ".json") },
  { label: "元曲", genre: "曲", era: "元", quota: 350, authorCap: 6, paths: ["yuanqu/yuanqu.json"] },
  { label: "诗经", genre: "诗经", era: "先秦", quota: 240, authorCap: Infinity, paths: ["shijing/shijing.json"] },
  { label: "楚辞", genre: "楚辞", era: "先秦", quota: 30, authorCap: Infinity, paths: ["chuci/chuci.json"] },
  { label: "古文观止", genre: "古文", era: "古代", quota: 100, authorCap: 8, paths: ["mengxue/guwenguanzhi.json"] },
  { label: "古文短章", genre: "古文", era: "清", quota: 60, authorCap: Infinity, paths: ["youmengying/youmengying.json"] },
];
const themePatterns = {
  moon: /月|夜|星/, rain: /雨|水|雪|江|河|海/, journey: /行|路|归|客|乡/,
  nature: /山|林|花|树|草|鸟/, parting: /别|离|思|念/,
  time: /岁|年|古|今|春|秋/, solitude: /独|孤|寂/, hope: /光|明|晴|曙/
};
const sourcePath = path => {
  const [folder, filename] = path.split("/");
  const chineseFolder = { quantangshi: "全唐诗", songci: "宋词", yuanqu: "元曲", shijing: "诗经", chuci: "楚辞", mengxue: "蒙学", youmengying: "幽梦影" }[folder];
  return "https://github.com/chinese-poetry/chinese-poetry/blob/master/" + encodeURIComponent(chineseFolder) + "/" + encodeURIComponent(filename);
};
const clean = text => simplify(String(text || "").trim());
const validText = text => !/[□�\uFFFD]/.test(text) && /[\u3400-\u9fff]/.test(text);
const output = [];
const report = { source: "chinese-poetry@2.0.1 (MIT)", groups: [] };

for (const spec of specs) {
  const candidates = [];
  const files = [];
  for (const path of spec.paths) {
    const raw = await readFile(new URL(path, root), "utf8");
    const data = JSON.parse(raw);
    const rows = Array.isArray(data) ? data : data.content.flatMap(volume => volume.content);
    files.push({ path, sha256: hash(raw), received: rows.length, url: sourcePath(path) });
    for (const [index, row] of rows.entries()) {
      const isProse = spec.genre === "古文";
      const lines = (isProse ? row.paragraphs || [row.content] : row.paragraphs || row.content || []).map(clean).filter(Boolean);
      const authorField = clean(row.author || (spec.genre === "诗经" ? "佚名" : spec.genre === "古文" ? "张潮" : ""));
      const [era, author] = spec.label === "古文观止" && authorField.includes("：") ? authorField.split("：") : [spec.era, authorField];
      const bareTitle = clean(row.title || row.rhythmic || "");
      const title = spec.label === "古文短章" ? "幽梦影 · 札记" + (index + 1) : spec.label === "古文观止" ? clean(row.chapter) : spec.genre === "词" ? bareTitle + " · " + (lines[0] || "").replace(/[，。！？；：、\s]/g, "").slice(0, 9) : bareTitle;
      const body = lines.join("");
      if (!title || title.length > (spec.genre === "曲" ? 36 : 55) || !author || !validText(body) || /[□�\uFFFD]/.test(title + author)) continue;
      // Only standalone sanqu with a named mode; most other records are opera fragments.
      if (spec.genre === "曲" && !/^(?:双调|中吕|越调|南吕|正宫|仙吕|黄钟|商调|大石调|小石调|般涉调)・/.test(title)) continue;
      if (lines.length < (isProse ? 1 : 2) || lines.length > (spec.genre === "楚辞" ? 28 : 22)) continue;
      if (lines.some(line => line.length > (isProse ? 350 : 90)) || body.length > (isProse ? 850 : 800) || body.length < 18) continue;
      const id = "disc-" + hash(spec.genre + "|" + author + "|" + title + "|" + body).slice(0, 16);
      const themes = Object.entries(themePatterns).filter(([, pattern]) => pattern.test(title + body)).map(([name]) => name).slice(0, 4);
      const sad = /愁|悲|泪|哀|恨|怨|凄|寂/.test(body);
      const bright = /喜|欢|笑|晴|明|乐|暖/.test(body);
      const mood = sad && !bright ? 2 : bright && !sad ? 4 : 3;
      candidates.push({ id, title, author, era, language: "zh", genre: spec.genre, form: spec.label, lines, themes, mood, ...(sad !== bright ? { moodEvidence: "lexical" } : {}), quality: "imported", collection: "discovery", sourceUrl: sourcePath(path), sourceName: "chinese-poetry · " + spec.label + "（待校勘）", rights: { status: "public_domain", basis: "古典作品原文为公版；整理数据来自 chinese-poetry（MIT）。自动转写及抽样未经逐篇人工校勘。", textCredit: "Data from chinese-poetry/chinese-poetry (MIT License)." } });
    }
  }
  const authors = new Map();
  const unique = new Set();
  const chosen = [];
  for (const poem of candidates.sort((a, b) => hash(a.id).localeCompare(hash(b.id)))) {
    const key = poem.author + "|" + poem.title + "|" + poem.lines.join("");
    if (unique.has(key) || (authors.get(poem.author) || 0) >= spec.authorCap) continue;
    unique.add(key);
    authors.set(poem.author, (authors.get(poem.author) || 0) + 1);
    chosen.push(poem);
    if (chosen.length === spec.quota) break;
  }
  output.push(...chosen);
  report.groups.push({ label: spec.label, candidates: candidates.length, selected: chosen.length, authors: authors.size, files });
}
await writeFile(new URL("../src/data/discovery.json", import.meta.url), JSON.stringify(output), "utf8");
await writeFile(new URL("../src/data/discovery-report.json", import.meta.url), JSON.stringify(report, null, 2), "utf8");
console.log(report.groups.map(group => group.label + ": " + group.selected + "/" + group.candidates + ", " + group.authors + " authors").join("\n"));
