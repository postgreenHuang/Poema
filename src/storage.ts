import type { Message, Note } from "./domain";

export interface Library {
  version: 1;
  savedIds: string[];
  notes: Note[];
  seenIds: string[];
  conversations: Record<string, Message[]>;
  lastPoemId?: string;
  aiBaseUrl: string;
  aiModel: string;
}

const key = "poema.library.v1";
const defaults: Library = { version: 1, savedIds: [], notes: [], seenIds: [], conversations: {}, aiBaseUrl: "https://api.openai.com/v1", aiModel: "" };

export function loadLibrary(): Library {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "null") as Partial<Library> | null;
    if (!value || value.version !== 1) return defaults;
    return { ...defaults, ...value, savedIds: Array.isArray(value.savedIds) ? value.savedIds : [], notes: Array.isArray(value.notes) ? value.notes : [], seenIds: Array.isArray(value.seenIds) ? value.seenIds : [], conversations: value.conversations && typeof value.conversations === "object" ? value.conversations : {} };
  } catch { return defaults; }
}

export function saveLibrary(library: Library) { localStorage.setItem(key, JSON.stringify(library)); }

export function exportLibrary(library: Library) {
  const blob = new Blob([JSON.stringify(library, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `poema-诗笺-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
