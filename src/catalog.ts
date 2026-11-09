import generated from "./data/generated.json";
import discovery from "./data/discovery.json";
import { poems as curated } from "./poems";
import type { Poem } from "./domain";

const unique = new Map<string, Poem>();
for (const poem of [...curated.map(p => ({ ...p, quality: "curated" as const })), ...(generated as Poem[]), ...(discovery as Poem[])]) {
  const key = `${poem.language}|${poem.author.toLocaleLowerCase()}|${poem.title.toLocaleLowerCase()}`;
  if (!unique.has(key)) unique.set(key, poem);
}

export const poems = [...unique.values()];
