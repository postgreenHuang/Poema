import { invoke } from "@tauri-apps/api/core";
import type { FinderPlan } from "./finder";
import type { Poem } from "./domain";

export interface OnlinePoem {
  id: string;
  title: string;
  author?: string;
  excerpt: string;
  sourceName: "维基文库" | "PoetryDB" | "诗泉";
  sourceUrl: string;
  language: "zh" | "en";
  lines?: string[];
  form?: string;
  genre?: Poem["genre"];
}

const desktop = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const themeTermsZh: Record<string, string> = { moon: "月", rain: "雨", journey: "归", nature: "山", parting: "别", time: "岁月", solitude: "孤", hope: "光" };
const themeTermsEn: Record<string, string> = { moon: "moon", rain: "rain", journey: "journey", nature: "nature", parting: "farewell", time: "time", solitude: "alone", hope: "hope" };

async function sourceJson(source: "wikisource" | "poetrydb" | "poetryspring", term: string): Promise<unknown> {
  if (desktop) return invoke("search_public_source", { source, term });
  const url = source === "poetryspring"
    ? term.length >= 3 ? `https://poetry.palemoky.com/api/search?q=${encodeURIComponent(term)}` : `https://poetry.palemoky.com/api/poems/random${term ? `?char=${encodeURIComponent(term[0])}` : ""}`
    : source === "wikisource"
    ? `https://zh.wikisource.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(term)}&srnamespace=0&srlimit=12&srprop=snippet%7Cwordcount&format=json&formatversion=2&origin=*`
    : term ? `https://poetrydb.org/lines,linecount,random/${encodeURIComponent(term)};-100;12` : "https://poetrydb.org/linecount,random/-100;8";
  const response = await fetch(url);
  if (source === "poetrydb" && response.status === 404) return [];
  if (!response.ok) throw new Error(`${source} 返回 ${response.status}`);
  return response.json();
}

function plainSnippet(html: string) {
  return html.replace(/<[^>]*>/g, "").replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/\s+/g, " ").trim().slice(0, 240);
}

export function fromWikisource(raw: unknown): OnlinePoem[] {
  const value = raw as { query?: { search?: unknown } } | null;
  const rows = value?.query?.search;
  if (!Array.isArray(rows)) return [];
  return rows.filter(row => row && typeof row === "object" && typeof row.pageid === "number" && typeof row.title === "string" && typeof row.snippet === "string")
    .filter(row => row.ns === 0 && !/^(?:Author:|Category:|File:)|\/卷\d+|消歧义/.test(row.title) && (typeof row.wordcount !== "number" || row.wordcount <= 2500))
    .map(row => ({ id: `wikisource:${row.pageid}`, title: row.title, excerpt: plainSnippet(row.snippet), sourceName: "维基文库" as const, sourceUrl: `https://zh.wikisource.org/wiki/${encodeURIComponent(row.title.replace(/ /g, "_"))}`, language: "zh" as const }))
    .filter(poem => poem.excerpt.length > 5);
}

export function fromPoetryDB(raw: unknown): OnlinePoem[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(row => row && typeof row.title === "string" && typeof row.author === "string" && Array.isArray(row.lines) && row.lines.some((line: unknown) => typeof line === "string" && line.trim()))
    .map(row => ({ id: `poetrydb:${row.author}:${row.title}`, title: row.title, author: row.author, excerpt: row.lines.filter((line: unknown): line is string => typeof line === "string" && !!line.trim()).slice(0, 2).join(" / ").slice(0, 240), lines: row.lines.filter((line: unknown): line is string => typeof line === "string").slice(0, 120), sourceName: "PoetryDB" as const, sourceUrl: `https://poetrydb.org/author,title/${encodeURIComponent(row.author)};${encodeURIComponent(row.title)}`, language: "en" as const }));
}

function fingerprint(value: string) {
  let left = 2166136261, right = 0x9e3779b9;
  for (const char of value.normalize("NFKC")) { const code = char.codePointAt(0)!; left = Math.imul(left ^ code, 16777619); right = Math.imul(right ^ code, 2246822519); }
  return [left, right].map(n => (n >>> 0).toString(16).padStart(8, "0")).join("");
}

const compact = (value: string) => value.normalize("NFKC").replace(/[\s·・，。！？、；：:;,.!?（）()]/g, "").toLowerCase();
export function poemIdentity(poem: { title: string; author?: string }) { return `${compact(poem.title)}|${compact(poem.author || "")}`; }

export function fromPoetrySpring(raw: unknown): OnlinePoem[] {
  const data = (raw as { data?: unknown } | null)?.data;
  const rows = Array.isArray(data) ? data : data ? [data] : [];
  return rows.flatMap((row): OnlinePoem[] => {
    if (!row || typeof row !== "object") return [];
    const entry = row as { id?: unknown; title?: unknown; content?: unknown; author?: { name?: unknown }; type?: { name?: unknown } };
    if (!Number.isSafeInteger(entry.id) || Number(entry.id) <= 0 || typeof entry.title !== "string" || !entry.title.trim() || !Array.isArray(entry.content) || typeof entry.author?.name !== "string") return [];
    const lines = entry.content.filter((line): line is string => typeof line === "string" && !!line.trim()).map(line => line.trim());
    if (!lines.length || lines.length > 120 || lines.some(line => line.length > 500) || lines.join("").length > 12_000) return [];
    const title = entry.title.trim().slice(0, 160), author = entry.author.name.trim().slice(0, 100);
    const form = typeof entry.type?.name === "string" ? entry.type.name.slice(0, 40) : "古典诗文";
    const genre = /诗经/.test(form) ? "诗经" : /楚辞/.test(form) ? "楚辞" : /词/.test(form) ? "词" : /曲/.test(form) ? "曲" : /论语|四书|五经|古文/.test(form) ? "古文" : "诗";
    const id = `poetryspring:${fingerprint(`${poemIdentity({ title, author })}|${compact(lines[0])}`)}`;
    return [{ id, title, author, excerpt: lines.slice(0, 2).join(" / ").slice(0, 240), lines, form, genre, sourceName: "诗泉", sourceUrl: `https://poetry.palemoky.com/api/poems/${entry.id}`, language: "zh" }];
  });
}

export async function randomPoetrySpring(seenIds: string[] = []): Promise<OnlinePoem> {
  const attempts = await Promise.allSettled(Array.from({ length: 3 }, () => sourceJson("poetryspring", "")));
  const poems = attempts.flatMap(result => result.status === "fulfilled" ? fromPoetrySpring(result.value) : []);
  const fresh = poems.find(poem => !seenIds.includes(poem.id));
  if (fresh) return fresh;
  if (poems[0]) return poems[0];
  throw new Error("诗泉暂不可用或未返回可阅读的正文");
}

export async function searchPoetrySpring(term: string, localPoems: Poem[] = []): Promise<OnlinePoem[]> {
  const query = term.trim();
  if (!query || !/[\u3400-\u9fff]/.test(query)) return [];
  const localKeys = new Set(localPoems.map(poemIdentity));
  return fromPoetrySpring(await sourceJson("poetryspring", query)).filter(poem => !localKeys.has(poemIdentity(poem)));
}

function decodeText(value: string) {
  return value.replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, digits: string) => String.fromCodePoint(Number(digits)))
    .replace(/&(nbsp|amp|lt|gt|quot|apos);/gi, (_, entity: string) => ({ nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" })[entity.toLowerCase() as "nbsp" | "amp" | "lt" | "gt" | "quot" | "apos"]);
}

export function parseWikisourcePage(raw: unknown): { lines: string[]; author?: string } | null {
  const html = (raw as { parse?: { text?: unknown } } | null)?.parse?.text;
  if (typeof html !== "string") return null;
  const author = html.match(/href="\/wiki\/Author:[^"]+"[^>]*>([^<]+)<\/a>/i)?.[1];
  const blocks = [...html.matchAll(/<div\b[^>]*class="[^"]*\bpoem\b[^"]*"[^>]*>([\s\S]*?)<\/div>/gi)];
  for (const block of blocks.slice(0, 5)) {
    const text = decodeText(block[1].replace(/<sup\b[\s\S]*?<\/sup>/gi, "")
      .replace(/<(?:script|style)\b[\s\S]*?<\/(?:script|style)>/gi, "")
      .replace(/<br\s*\/?\s*>|<\/p>/gi, "\n").replace(/<[^>]+>/g, ""));
    const lines = text.split(/\n/).map(line => line.trim()).filter(Boolean);
    if (lines.length >= 2 && lines.length <= 120 && lines.join("").length <= 12_000) return { lines, author: author ? decodeText(author.trim()) : undefined };
  }
  return null;
}

export async function previewOnlinePoem(item: OnlinePoem): Promise<{ poem: Poem; warning?: string }> {
  let lines = item.lines?.filter(line => typeof line === "string" && line.trim()).slice(0, 120) || [];
  let author = item.author;
  let warning: string | undefined;
  if (item.sourceName === "维基文库") {
    try {
      const pageId = Number(item.id.replace(/^wikisource:/, ""));
      if (!Number.isSafeInteger(pageId) || pageId <= 0) throw new Error("来源页面标识无效");
      const raw = desktop ? await invoke<unknown>("read_wikisource_page", { pageId }) : await fetch(`https://zh.wikisource.org/w/api.php?action=parse&pageid=${pageId}&prop=text&format=json&formatversion=2&origin=*`).then(response => { if (!response.ok) throw new Error(`维基文库返回 ${response.status}`); return response.json(); });
      const parsed = parseWikisourcePage(raw);
      if (!parsed) throw new Error("此页未找到可辨认的诗文正文");
      lines = parsed.lines; author = parsed.author || author;
    } catch (error) { warning = `只取得来源摘要，非完整正文：${String(error)}`; }
  }
  if (!lines.length) { lines = [item.excerpt]; warning ||= "只取得来源摘要，非完整正文。"; }
  const full = !warning;
  const poem: Poem = { id: item.id, title: item.title, author: author || "作者待来源页核对", era: "时代待核对", language: item.language, genre: item.genre || "诗", form: item.form || item.sourceName, lines, themes: [], mood: 3, sourceName: item.sourceName, sourceUrl: item.sourceUrl, rights: { status: "source_unverified", basis: "在线来源文本；作者、时代、版本与权利请到原站核对" }, quality: "imported", previewStatus: full ? "full" : "excerpt" };
  return { poem, warning };
}

export async function searchOnlineSources(plan: FinderPlan, request: string, localPoems: Poem[] = []): Promise<{ items: OnlinePoem[]; warnings: string[] }> {
  const tasks: { source: "wikisource" | "poetrydb" | "poetryspring"; term: string }[] = [];
  if (plan.language !== "en") {
    const chinese = plan.terms.filter(term => /[\u3400-\u9fff]/.test(term)).slice(0, 2);
    const fallback = plan.themes.map(theme => themeTermsZh[theme]).filter(Boolean).slice(0, 2);
    for (const term of (chinese.length ? chinese : fallback.length ? fallback : [request.match(/[\u3400-\u9fff]{2,8}/)?.[0] || "诗"]).slice(0, 2)) {
      tasks.push({ source: "poetryspring", term }, { source: "wikisource", term });
    }
  }
  if (plan.language !== "zh") {
    const english = plan.terms.filter(term => /[a-z]/i.test(term)).slice(0, 2);
    const fallback = plan.themes.map(theme => themeTermsEn[theme]).filter(Boolean).slice(0, 2);
    for (const term of (english.length ? english : fallback.length ? fallback : [""]).slice(0, 2)) tasks.push({ source: "poetrydb", term });
  }
  const settled = await Promise.allSettled(tasks.map(async task => ({ task, data: await sourceJson(task.source, task.term) })));
  const items: OnlinePoem[] = [];
  const warnings: string[] = [];
  for (const outcome of settled) {
    if (outcome.status === "rejected") { warnings.push(String(outcome.reason)); continue; }
    const { task, data } = outcome.value;
    items.push(...(task.source === "poetryspring" ? fromPoetrySpring(data) : task.source === "wikisource" ? fromWikisource(data) : fromPoetryDB(data)));
  }
  const localKeys = new Set(localPoems.map(poemIdentity));
  const found = new Set<string>();
  const unique = items.filter(item => {
    if (plan.genres.length && item.genre && !plan.genres.includes(item.genre)) return false;
    if (plan.short && item.lines && item.lines.length > 12) return false;
    const key = item.author ? poemIdentity(item) : item.id;
    if (localKeys.has(key) || found.has(key)) return false;
    found.add(key); return true;
  });
  const randomized = unique.sort((a, b) => fingerprint(`${request}|${a.id}`).localeCompare(fingerprint(`${request}|${b.id}`)));
  const authorCounts = new Map<string, number>();
  return { items: randomized.filter(item => { const key = item.author || item.id; const count = authorCounts.get(key) || 0; if (count >= 2) return false; authorCounts.set(key, count + 1); return true; }).slice(0, 32), warnings };
}
