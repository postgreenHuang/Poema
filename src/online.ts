import { invoke } from "@tauri-apps/api/core";
import type { FinderPlan } from "./finder";

export interface OnlinePoem {
  id: string;
  title: string;
  author?: string;
  excerpt: string;
  sourceName: "维基文库" | "PoetryDB";
  sourceUrl: string;
  language: "zh" | "en";
}

const desktop = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const themeTermsZh: Record<string, string> = { moon: "月", rain: "雨", journey: "归", nature: "山", parting: "别", time: "岁月", solitude: "孤", hope: "光" };
const themeTermsEn: Record<string, string> = { moon: "moon", rain: "rain", journey: "journey", nature: "nature", parting: "farewell", time: "time", solitude: "alone", hope: "hope" };

async function sourceJson(source: "wikisource" | "poetrydb", term: string): Promise<unknown> {
  if (desktop) return invoke("search_public_source", { source, term });
  const url = source === "wikisource"
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
    .map(row => ({ id: `poetrydb:${row.author}:${row.title}`, title: row.title, author: row.author, excerpt: row.lines.filter((line: unknown): line is string => typeof line === "string" && !!line.trim()).slice(0, 2).join(" / ").slice(0, 240), sourceName: "PoetryDB" as const, sourceUrl: `https://poetrydb.org/author,title/${encodeURIComponent(row.author)};${encodeURIComponent(row.title)}`, language: "en" as const }));
}

export async function searchOnlineSources(plan: FinderPlan, request: string): Promise<{ items: OnlinePoem[]; warnings: string[] }> {
  const tasks: { source: "wikisource" | "poetrydb"; term: string }[] = [];
  if (plan.language !== "en") {
    const chinese = plan.terms.filter(term => /[\u3400-\u9fff]/.test(term)).slice(0, 2);
    const fallback = plan.themes.map(theme => themeTermsZh[theme]).filter(Boolean).slice(0, 2);
    for (const term of (chinese.length ? chinese : fallback.length ? fallback : [request.match(/[\u3400-\u9fff]{2,8}/)?.[0] || "诗"]).slice(0, 2)) tasks.push({ source: "wikisource", term });
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
    items.push(...(task.source === "wikisource" ? fromWikisource(data) : fromPoetryDB(data)));
  }
  return { items: [...new Map(items.map(item => [item.id, item])).values()].slice(0, 32), warnings };
}
