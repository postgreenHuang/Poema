import { invoke } from "@tauri-apps/api/core";
import OpenCC from "opencc-js";

export interface DictionaryReading {
  pinyin: string;
  bopomofo?: string;
  definitions: { type?: string; text: string }[];
}
export interface DictionaryEntry {
  title: string;
  sourceUrl: string;
  readings: DictionaryReading[];
}

const desktop = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const toTraditional = OpenCC.Converter({ from: "cn", to: "t" });

async function rawEntry(term: string): Promise<unknown | null> {
  if (desktop) return invoke<unknown | null>("lookup_dictionary", { term });
  const response = await fetch(`https://www.moedict.tw/raw/${encodeURIComponent(term)}.json`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`萌典返回 ${response.status}`);
  return response.json();
}

export function parseDictionaryEntry(raw: unknown, queriedTerm: string): DictionaryEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as { title?: unknown; heteronyms?: unknown };
  if (typeof value.title !== "string" || !Array.isArray(value.heteronyms)) return null;
  const readings = value.heteronyms.slice(0, 8).flatMap((item): DictionaryReading[] => {
    if (!item || typeof item !== "object") return [];
    const row = item as { pinyin?: unknown; bopomofo?: unknown; definitions?: unknown };
    if (typeof row.pinyin !== "string" || !Array.isArray(row.definitions)) return [];
    const definitions = row.definitions.slice(0, 8).flatMap((part): DictionaryReading["definitions"] => {
      if (!part || typeof part !== "object") return [];
      const definition = part as { def?: unknown; type?: unknown };
      if (typeof definition.def !== "string" || !definition.def.trim()) return [];
      return [{ text: definition.def.trim(), type: typeof definition.type === "string" ? definition.type : undefined }];
    });
    if (!definitions.length) return [];
    return [{ pinyin: row.pinyin, bopomofo: typeof row.bopomofo === "string" ? row.bopomofo : undefined, definitions }];
  });
  if (!readings.length) return null;
  return { title: value.title, sourceUrl: `https://www.moedict.tw/a/${encodeURIComponent(queriedTerm)}`, readings };
}

export async function lookupDictionary(term: string): Promise<DictionaryEntry | null> {
  const word = term.trim();
  if (!word || [...word].length > 20 || !/^[\p{Script=Han}·・]+$/u.test(word)) return null;
  const candidates = [...new Set([word, toTraditional(word)])];
  for (const candidate of candidates) {
    const entry = parseDictionaryEntry(await rawEntry(candidate), candidate);
    if (entry) return entry;
  }
  return null;
}
