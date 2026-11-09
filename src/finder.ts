import { genreOf, themeLabels, type Genre, type Language, type Poem, type Theme } from "./domain";

export interface FinderPlan {
  interpretation: string;
  terms: string[];
  genres: Genre[];
  language: "all" | Language;
  themes: Theme[];
  excludeThemes: Theme[];
  mood: "all" | "lighter" | "darker";
  short: boolean;
}
export interface FinderPick { id: string; reason: string }

const genres: Genre[] = ["诗", "词", "曲", "诗经", "楚辞", "古文"];
const themes = Object.keys(themeLabels) as Theme[];

export function normalizeFinderPlan(raw: unknown): FinderPlan {
  const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const list = (item: unknown) => Array.isArray(item) ? item.filter((part): part is string => typeof part === "string") : [];
  return {
    interpretation: typeof value.interpretation === "string" ? value.interpretation.slice(0, 300) : "从本地文库寻找贴近你此刻心意的文字。",
    terms: list(value.terms).map(term => term.trim()).filter(Boolean).slice(0, 8),
    genres: list(value.genres).filter((genre): genre is Genre => genres.includes(genre as Genre)),
    language: value.language === "zh" || value.language === "en" ? value.language : "all",
    themes: list(value.themes).filter((theme): theme is Theme => themes.includes(theme as Theme)),
    excludeThemes: list(value.excludeThemes).filter((theme): theme is Theme => themes.includes(theme as Theme)),
    mood: value.mood === "lighter" || value.mood === "darker" ? value.mood : "all",
    short: value.short === true,
  };
}

function hash(value: string) { let n = 2166136261; for (const char of value) n = Math.imul(n ^ char.charCodeAt(0), 16777619); return n >>> 0; }

export function candidatePoems(poems: Poem[], plan: FinderPlan, seenIds: string[], count = 32, seed = "") {
  const seen = new Set(seenIds.slice(-30));
  const scored = poems.filter(poem => {
    if (plan.language !== "all" && poem.language !== plan.language) return false;
    if (plan.genres.length && !plan.genres.includes(genreOf(poem))) return false;
    if (plan.excludeThemes.some(theme => poem.themes.includes(theme))) return false;
    if (plan.short && poem.lines.filter(Boolean).length > 12) return false;
    if (plan.mood !== "all" && poem.quality === "imported" && poem.moodEvidence !== "lexical") return false;
    return true;
  }).map(poem => {
    const title = `${poem.title} ${poem.author}`.toLocaleLowerCase();
    const body = poem.lines.join(" ").toLocaleLowerCase();
    const termScore = plan.terms.reduce((score, term) => score + (title.includes(term.toLocaleLowerCase()) ? 8 : body.includes(term.toLocaleLowerCase()) ? 3 : 0), 0);
    const themeScore = plan.themes.reduce((score, theme) => score + (poem.themes.includes(theme) ? 6 : 0), 0);
    const moodScore = plan.mood === "all" ? 0 : plan.mood === "lighter" ? poem.mood >= 3 ? 4 : -4 : poem.mood <= 2 ? 4 : -4;
    return { poem, score: termScore + themeScore + moodScore + (poem.collection === "discovery" ? 2 : 0) - (seen.has(poem.id) ? 5 : 0) };
  });
  const ranked = scored.sort((a, b) => b.score - a.score || hash(seed + a.poem.id) - hash(seed + b.poem.id));
  const distinct: typeof ranked = [];
  const authors = new Set<string>();
  for (const item of ranked) {
    if (authors.has(item.poem.author)) continue;
    distinct.push(item); authors.add(item.poem.author);
    if (distinct.length === count) break;
  }
  if (distinct.length < count) for (const item of ranked) {
    if (!distinct.includes(item)) distinct.push(item);
    if (distinct.length === count) break;
  }
  return distinct.map(item => item.poem);
}

export function verifiedPicks(raw: unknown, candidates: Poem[], count = 6): FinderPick[] {
  const ids = new Set(candidates.map(poem => poem.id));
  const picks = raw && typeof raw === "object" && Array.isArray((raw as { picks?: unknown }).picks) ? (raw as { picks: unknown[] }).picks : [];
  const seen = new Set<string>();
  return picks.filter((item): item is FinderPick => !!item && typeof item === "object" && typeof (item as FinderPick).id === "string" && typeof (item as FinderPick).reason === "string")
    .filter(item => { if (!ids.has(item.id) || seen.has(item.id)) return false; seen.add(item.id); return true; })
    .slice(0, count).map(item => ({ id: item.id, reason: item.reason.slice(0, 150) }));
}
