export type Language = "zh" | "en";
export type Genre = "诗" | "词" | "曲" | "诗经" | "楚辞" | "古文";
export type Theme = "moon" | "rain" | "journey" | "nature" | "parting" | "time" | "solitude" | "hope";
export type PathKind = "image" | "mood" | "form" | "contrast";
export interface Poem {
  id: string;
  title: string;
  author: string;
  era: string;
  language: Language;
  genre?: Genre;
  collection?: "discovery";
  moodEvidence?: "lexical";
  form: string;
  lines: string[];
  themes: Theme[];
  mood: number;
  sourceUrl: string;
  sourceName: string;
  rights: { status: "public_domain"; basis: string; textCredit?: string };
  quality?: "curated" | "imported";
}
export interface Note { poemId: string; line?: string; text: string; savedAt: string }
export interface Message { role: "user" | "assistant"; content: string; createdAt: string }

export const themeLabels: Record<Theme, string> = {
  moon: "月与夜", rain: "雨与水", journey: "远行", nature: "山野", parting: "离别", time: "时间", solitude: "独处", hope: "微光"
};
export const genreLabels: Genre[] = ["诗", "词", "曲", "诗经", "楚辞", "古文"];
export function genreOf(poem: Poem): Genre { return poem.genre || "诗"; }

export function matches(poem: Poem, query: string, language: "all" | Language, theme: "all" | Theme) {
  if (language !== "all" && poem.language !== language) return false;
  if (theme !== "all" && !poem.themes.includes(theme)) return false;
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const haystack = [poem.title, poem.author, poem.era, poem.form, genreOf(poem), poem.lines.join(" "), ...poem.themes.map(t => themeLabels[t])].join(" ").toLocaleLowerCase();
  return words.every(word => haystack.includes(word));
}

const themeWords: Record<Theme, RegExp> = {
  moon: /月亮|明月|月|夜|moon|night/i,
  rain: /雨|水|雪|rain|water|snow/i,
  journey: /远行|旅|路|故乡|归|travel|journey|road|home/i,
  nature: /山|林|花|树|自然|nature|forest|flower|tree/i,
  parting: /离别|告别|想念|相思|别离|parting|farewell|miss/i,
  time: /时间|岁月|往事|过去|time|past|memory/i,
  solitude: /孤独|独处|寂寞|一个人|solitude|alone|lonely/i,
  hope: /希望|温暖|光|明亮|hope|bright|light/i
};

export interface SearchIntent {
  included: Theme[];
  excluded: Theme[];
  mood?: "lighter" | "darker";
  short: boolean;
  language?: Language;
  author?: string;
  residual: string;
  labels: string[];
}

export function parseSearchIntent(input: string, poems: Poem[]): SearchIntent {
  let rest = input.trim();
  const included: Theme[] = [];
  const excluded: Theme[] = [];
  const labels: string[] = [];
  const author = [...new Set(poems.map(p => p.author))].find(name => rest.toLocaleLowerCase().includes(name.toLocaleLowerCase()));
  if (author) { rest = rest.replace(author, " "); labels.push(`作者：${author}`); }
  const language: Language | undefined = /英文|英语|english/i.test(rest) ? "en" : /中文|汉语|古诗/i.test(rest) ? "zh" : undefined;
  if (language) { rest = rest.replace(/英文|英语|english|中文|汉语|古诗/ig, " "); labels.push(language === "en" ? "英文" : "中文"); }
  const short = /短诗|短一点|短些|简短|short/i.test(rest);
  if (short) { rest = rest.replace(/短诗|短一点|短些|简短|short/ig, " "); labels.push("短诗"); }
  const negativeMood = /不悲伤|不要悲伤|别太悲伤|不伤感|明亮|轻快|温暖|not sad/i.test(rest);
  const darkMood = /悲伤|伤感|忧郁|低沉|sad|melancholy/i.test(rest) && !negativeMood;
  const mood = negativeMood ? "lighter" : darkMood ? "darker" : undefined;
  if (mood) { rest = rest.replace(/不悲伤|不要悲伤|别太悲伤|不伤感|明亮|轻快|温暖|not sad|悲伤|伤感|忧郁|低沉|sad|melancholy/ig, " "); labels.push(mood === "lighter" ? "情绪较明亮" : "情绪较低沉"); }
  for (const [theme, pattern] of Object.entries(themeWords) as [Theme, RegExp][]) {
    const found = rest.match(pattern);
    if (!found) continue;
    const before = rest.slice(Math.max(0, found.index! - 5), found.index!);
    const isExcluded = /(?:不要|不想|避开|排除|没有|无|not|no)\s*$/i.test(before);
    (isExcluded ? excluded : included).push(theme);
    labels.push(`${isExcluded ? "避开" : "意象"}：${themeLabels[theme]}`);
    rest = rest.replace(found[0], " ");
  }
  rest = rest.replace(/想找|找一首|帮我找|推荐|写|关于|带有|一首|的|但|而且|不要|不想|避开|排除|没有|无|诗歌|诗|please|find|about|with/ig, " ").trim();
  return { included, excluded, mood, short, language, author, residual: rest, labels };
}

export function searchPoems(poems: Poem[], query: string, language: "all" | Language, theme: "all" | Theme) {
  const intent = parseSearchIntent(query, poems);
  const results = poems.filter(poem => {
    if (language !== "all" && poem.language !== language) return false;
    if (theme !== "all" && !poem.themes.includes(theme)) return false;
    if (query.trim() && matches(poem, query.trim(), "all", "all")) return true;
    if (intent.language && poem.language !== intent.language) return false;
    if (intent.author && poem.author !== intent.author) return false;
    if (intent.included.some(t => !poem.themes.includes(t))) return false;
    if (intent.excluded.some(t => poem.themes.includes(t))) return false;
    if (intent.mood && poem.quality === "imported" && poem.moodEvidence !== "lexical") return false;
    if (intent.mood === "lighter" && poem.mood < 3) return false;
    if (intent.mood === "darker" && poem.mood > 2) return false;
    if (intent.short && poem.lines.filter(Boolean).length > 8) return false;
    return !intent.residual || matches(poem, intent.residual, "all", "all");
  });
  if (!query.trim()) results.sort((a, b) => Number(b.collection === "discovery") - Number(a.collection === "discovery") || stableHash(a.id) - stableHash(b.id));
  return { results, intent };
}

export function relation(from: Poem, to: Poem, kind: PathKind): { score: number; reason: string } {
  if (from.id === to.id) return { score: -1, reason: "" };
  const shared = from.themes.filter(t => to.themes.includes(t));
  const moodGap = Math.abs(from.mood - to.mood);
  if (kind === "image") return { score: shared.length * 4 + Number(from.language !== to.language) + (from.author !== to.author ? 1 : 0), reason: shared.length ? `同写${themeLabels[shared[0]]}，${from.language !== to.language ? "换一种语言抵达" : "却有另一种目光"}` : "从一个画面走向另一个画面" };
  if (kind === "mood") return { score: 5 - moodGap + shared.length + Number(from.author !== to.author), reason: shared.length ? `同有${themeLabels[shared[0]]}，情绪的温度相近` : "在不同题材里保留相近的心绪" };
  if (kind === "form") return { score: Number(from.form === to.form) * 5 + Number(from.language !== to.language) + shared.length, reason: from.form === to.form ? `同为${to.form}，读一读它们不同的呼吸` : "换一种诗体，听节奏如何改变" };
  return { score: moodGap * 2 + shared.length * 3 + Number(from.language !== to.language), reason: shared.length ? `同写${themeLabels[shared[0]]}，却朝着相反的情绪走去` : "让另一种情绪与它相望" };
}

export function relatedPoems(poem: Poem, poems: Poem[], kind: PathKind, count = 4) {
  const ranked = poems.filter(p => (kind === "mood" || kind === "contrast") ? p.quality !== "imported" || p.moodEvidence === "lexical" : true)
    .map(p => ({ poem: p, ...relation(poem, p, kind) }))
    .filter(p => p.score >= 0)
    .sort((a, b) => b.score - a.score || Number(b.poem.collection === "discovery") - Number(a.poem.collection === "discovery") || stableHash(poem.id + kind + a.poem.id) - stableHash(poem.id + kind + b.poem.id));
  const chosen: typeof ranked = [];
  const authors = new Set<string>();
  for (const item of ranked) {
    if (authors.has(item.poem.author)) continue;
    chosen.push(item); authors.add(item.poem.author);
    if (chosen.length >= count) return chosen;
  }
  for (const item of ranked) {
    if (!chosen.includes(item)) chosen.push(item);
    if (chosen.length >= count) break;
  }
  return chosen;
}

function stableHash(value: string) {
  let result = 2166136261;
  for (let i = 0; i < value.length; i++) result = Math.imul(result ^ value.charCodeAt(i), 16777619);
  return result >>> 0;
}

export function chooseNext(poems: Poem[], seen: string[], currentId?: string, random: () => number = Math.random) {
  const recent = new Set(seen.slice(-12));
  const pool = poems.filter(p => p.id !== currentId && !recent.has(p.id));
  const candidates = pool.length ? pool : poems.filter(p => p.id !== currentId);
  const desiredLanguage = random() < 0.75 ? "zh" : "en";
  const languagePool = candidates.filter(p => p.language === desiredLanguage);
  let drawFrom = languagePool.length ? languagePool : candidates;
  if (desiredLanguage === "zh") {
    const discovery = drawFrom.filter(p => p.collection === "discovery");
    const familiar = drawFrom.filter(p => p.collection !== "discovery");
    if (discovery.length && (random() < 0.85 || !familiar.length)) {
      drawFrom = discovery;
      const genres: Genre[] = ["诗", "词", "曲", "诗经", "楚辞", "古文"];
      const weights = [0.32, 0.27, 0.18, 0.11, 0.07, 0.05];
      let draw = random();
      let chosenGenre: Genre = "诗";
      for (let i = 0; i < genres.length; i++) {
        draw -= weights[i];
        if (draw < 0) { chosenGenre = genres[i]; break; }
      }
      const genrePool = drawFrom.filter(p => genreOf(p) === chosenGenre);
      if (genrePool.length) drawFrom = genrePool;
    } else if (familiar.length) drawFrom = familiar;
  }
  const recentAuthors = new Set(poems.filter(p => recent.has(p.id) || p.id === currentId).map(p => p.author));
  const otherAuthors = drawFrom.filter(p => !recentAuthors.has(p.author));
  if (otherAuthors.length) drawFrom = otherAuthors;
  return drawFrom[Math.floor(random() * drawFrom.length)] || poems[0];
}
