import OpenCC from "opencc-js";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const simplify = OpenCC.Converter({ from: "t", to: "cn" });
const chineseUrl = "https://raw.githubusercontent.com/chinese-poetry/chinese-poetry/master/%E5%85%A8%E5%94%90%E8%AF%97/%E5%94%90%E8%AF%97%E4%B8%89%E7%99%BE%E9%A6%96.json";
const chinesePage = "https://github.com/chinese-poetry/chinese-poetry/blob/master/%E5%85%A8%E5%94%90%E8%AF%97/%E5%94%90%E8%AF%97%E4%B8%89%E7%99%BE%E9%A6%96.json";
const englishUrl = "https://poetrydb.org/random/100:author";
const themePatterns = {
  moon: /月|夜|星|moon|night|star/i,
  rain: /雨|水|雪|江|河|海|rain|water|snow|river|sea/i,
  journey: /行|路|归|客|乡|travel|journey|road|home/i,
  nature: /山|林|花|树|草|鸟|nature|forest|flower|tree|bird/i,
  parting: /告别|别离|送别|别|离|parting|farewell|miss/i,
  time: /岁|年|古|今|春|秋|time|past|year|spring|autumn/i,
  solitude: /独|孤|寂|alone|lonely|solitude/i,
  hope: /希望|微光|曙光|hope|bright|light/i
};

async function getJson(localName) {
  const text = await readFile(new URL(`../src/data/${localName}`, import.meta.url), "utf8");
  return { data: JSON.parse(text), sha256: createHash("sha256").update(text).digest("hex") };
}

function themes(text) { return Object.entries(themePatterns).filter(([, pattern]) => pattern.test(text)).map(([name]) => name).slice(0, 4); }
function cleanLines(lines) { return lines.map(x => String(x).trimEnd()).filter(x => x.length <= 180); }
function formFromTags(tags, count) { return tags?.find(x => /绝句|律诗|古诗|乐府|排律/.test(x)) || (count === 4 ? "四句诗" : count === 8 ? "八句诗" : "唐诗"); }

const [{ data: chinese, sha256: chineseSha }, { data: english, sha256: englishSha }] = await Promise.all([getJson("source-chinese.json"), getJson("source-english.json")]);
if (!Array.isArray(chinese) || !Array.isArray(english)) throw new Error("语料格式与预期不符");

const zh = chinese.map(row => {
  const lines = cleanLines(row.paragraphs || []).map(simplify);
  const title = simplify(String(row.title || "").trim());
  const author = simplify(String(row.author || "").trim());
  if (!row.id || !title || !author || lines.length < 2 || lines.length > 18 || lines.join("").length > 700) return null;
  return { id: `cp-${row.id}`, title, author, era: "唐", language: "zh", form: formFromTags(row.tags, lines.length), lines,
    themes: themes(`${title} ${lines.join(" ")}`), mood: 3, quality: "imported", sourceUrl: chinesePage,
    sourceName: "chinese-poetry · 唐诗三百首（简化字转写，待校勘）",
    rights: { status: "public_domain", basis: "唐代作品原文为公版；数据整理来自 chinese-poetry（MIT）。正文由繁体自动转简体，需核对底本与异文。", textCredit: "Data from chinese-poetry/chinese-poetry (MIT License)." } };
}).filter(Boolean);

const en = english.map(row => {
  const lines = cleanLines(row.lines || []);
  const title = String(row.title || "").trim();
  const author = String(row.author || "").trim();
  if (!title || !author || lines.filter(Boolean).length < 2 || lines.filter(Boolean).length > 30 || lines.join("").length > 2500) return null;
  const id = createHash("sha1").update(`${author}\0${title}\0${lines.join("\n")}`).digest("hex").slice(0, 16);
  return { id: `pdb-${id}`, title, author, era: "公版原作", language: "en", form: lines.filter(Boolean).length === 14 ? "Sonnet" : "English poem", lines,
    themes: themes(`${title} ${lines.join(" ")}`), mood: 3, quality: "imported", sourceUrl: `https://poetrydb.org/title/${encodeURIComponent(title)}`,
    sourceName: "PoetryDB · 公版文本集", rights: { status: "public_domain", basis: "PoetryDB 收录的公版诗文本；其整理数据依 CC BY 4.0 署名。", textCredit: "Poetry data from PoetryDB (https://poetrydb.org), licensed under CC BY 4.0." } };
}).filter(Boolean);

const unique = new Map();
for (const poem of [...zh, ...en]) unique.set(`${poem.language}|${poem.author}|${poem.title}|${poem.lines.join("")}`, poem);
const data = [...unique.values()];
const report = { generatedAt: new Date().toISOString(), sources: [
  { url: chineseUrl, sha256: chineseSha, received: chinese.length, accepted: zh.length },
  { url: englishUrl, sha256: englishSha, received: english.length, accepted: en.length }
], total: data.length, note: "中文底本与异文未逐首校勘；英文随机来源每次重导可能变化。" };
await writeFile(new URL("../src/data/generated.json", import.meta.url), JSON.stringify(data), "utf8");
await writeFile(new URL("../src/data/import-report.json", import.meta.url), JSON.stringify(report, null, 2), "utf8");
console.log(report);
