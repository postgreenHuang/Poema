import type { Message, Note, Poem } from "./domain";

export interface ReadEvent { id: string; poemId: string; viewedAt: string }
export interface SavedChange { saved: boolean; at: string; deviceId: string }
export interface Library {
  version: 1;
  savedIds: string[];
  savedChanges: Record<string, SavedChange>;
  notes: Note[];
  seenIds: string[];
  readHistory: ReadEvent[];
  conversations: Record<string, Message[]>;
  onlinePoems: Record<string, Poem>;
  lastPoemId?: string;
  aiBaseUrl: string;
  aiModel: string;
}

const key = "poema.library.v1";
const syncKey = "poema.sync.folder.v1";
const deviceKey = "poema.device.id.v1";
const defaults: Library = { version: 1, savedIds: [], savedChanges: {}, notes: [], seenIds: [], readHistory: [], conversations: {}, onlinePoems: {}, aiBaseUrl: "https://api.openai.com/v1", aiModel: "" };

export function getDeviceId() {
  let id = localStorage.getItem(deviceKey);
  if (!id) { id = crypto.randomUUID(); localStorage.setItem(deviceKey, id); }
  return id;
}
export function loadSyncFolder() { return localStorage.getItem(syncKey) || ""; }
export function saveSyncFolder(folder: string) { if (folder) localStorage.setItem(syncKey, folder); else localStorage.removeItem(syncKey); }

export function normalizeLibrary(raw: unknown): Library {
  const value = raw && typeof raw === "object" ? raw as Partial<Library> : {};
  const savedIds = Array.isArray(value.savedIds) ? value.savedIds.filter((id): id is string => typeof id === "string") : [];
  const seenIds = Array.isArray(value.seenIds) ? value.seenIds.filter((id): id is string => typeof id === "string") : [];
  const savedChanges: Record<string, SavedChange> = {};
  if (value.savedChanges && typeof value.savedChanges === "object") {
    for (const [id, change] of Object.entries(value.savedChanges)) {
      if (change && typeof change.saved === "boolean" && typeof change.at === "string" && typeof change.deviceId === "string") savedChanges[id] = change;
    }
  }
  for (const id of savedIds) if (!savedChanges[id]) savedChanges[id] = { saved: true, at: "", deviceId: "legacy" };
  const readHistory = Array.isArray(value.readHistory)
    ? value.readHistory.filter((event): event is ReadEvent => !!event && typeof event.id === "string" && typeof event.poemId === "string" && typeof event.viewedAt === "string")
    : seenIds.map((id, index) => ({ id: "legacy:" + id, poemId: id, viewedAt: new Date(index * 1000).toISOString() }));
  const conversations: Record<string, Message[]> = {};
  if (value.conversations && typeof value.conversations === "object") {
    for (const [id, items] of Object.entries(value.conversations)) if (Array.isArray(items)) {
      conversations[id] = items.filter((message): message is Message => !!message && (message.role === "user" || message.role === "assistant") && typeof message.content === "string" && typeof message.createdAt === "string");
    }
  }
  const onlinePoems: Record<string, Poem> = {};
  if (value.onlinePoems && typeof value.onlinePoems === "object") for (const [id, poem] of Object.entries(value.onlinePoems)) {
    if (!poem || !/^(?:wikisource:\d+|poetrydb:.+|poetryspring:[0-9a-f]{16})$/.test(id) || poem.id !== id || typeof poem.title !== "string" || typeof poem.author !== "string" || !Array.isArray(poem.lines) || poem.lines.length > 120 || !poem.lines.every(line => typeof line === "string" && line.length <= 500) || poem.rights?.status !== "source_unverified") continue;
    try { const url = new URL(poem.sourceUrl); if (url.protocol !== "https:" || !["zh.wikisource.org", "poetrydb.org", "poetry.palemoky.com"].includes(url.hostname)) continue; }
    catch { continue; }
    onlinePoems[id] = poem;
  }
  return {
    ...defaults, savedIds, savedChanges, seenIds, readHistory, conversations, onlinePoems,
    notes: Array.isArray(value.notes) ? value.notes.filter((note): note is Note => !!note && typeof note.poemId === "string" && typeof note.text === "string" && typeof note.savedAt === "string") : [],
    lastPoemId: typeof value.lastPoemId === "string" ? value.lastPoemId : undefined,
    aiBaseUrl: typeof value.aiBaseUrl === "string" ? value.aiBaseUrl : defaults.aiBaseUrl,
    aiModel: typeof value.aiModel === "string" ? value.aiModel : defaults.aiModel,
  };
}

export function loadLibrary(): Library {
  try { return normalizeLibrary(JSON.parse(localStorage.getItem(key) || "null")); }
  catch { return normalizeLibrary(null); }
}
export function saveLibrary(library: Library) { localStorage.setItem(key, JSON.stringify(library)); }

export function recordVisit(library: Library, poemId: string): Library {
  const event = { id: crypto.randomUUID(), poemId, viewedAt: new Date().toISOString() };
  return { ...library, lastPoemId: poemId, seenIds: [...library.seenIds.filter(id => id !== poemId), poemId].slice(-100), readHistory: [event, ...library.readHistory].slice(0, 300) };
}

export function setSaved(library: Library, poemId: string, saved: boolean): Library {
  const change = { saved, at: new Date().toISOString(), deviceId: getDeviceId() };
  return { ...library, savedChanges: { ...library.savedChanges, [poemId]: change }, savedIds: saved ? [poemId, ...library.savedIds.filter(id => id !== poemId)] : library.savedIds.filter(id => id !== poemId) };
}

const messageKey = (message: Message) => message.id || [message.role, message.createdAt, message.content].join("|");
const noteKey = (note: Note) => [note.poemId, note.line || "", note.savedAt, note.text].join("|");
const newer = (left: SavedChange | undefined, right: SavedChange) => !left || right.at > left.at || (right.at === left.at && right.deviceId > left.deviceId);

export function mergeLibraries(local: Library, remote: unknown): Library {
  const a = normalizeLibrary(local), b = normalizeLibrary(remote);
  const savedChanges = { ...a.savedChanges };
  for (const [id, change] of Object.entries(b.savedChanges)) if (newer(savedChanges[id], change)) savedChanges[id] = change;
  const savedIds = Object.entries(savedChanges).filter(([, change]) => change.saved).sort((x, y) => y[1].at.localeCompare(x[1].at) || x[0].localeCompare(y[0])).map(([id]) => id);
  const history = new Map<string, ReadEvent>();
  for (const event of [...a.readHistory, ...b.readHistory]) history.set(event.id, event);
  const readHistory = [...history.values()].sort((x, y) => y.viewedAt.localeCompare(x.viewedAt) || y.id.localeCompare(x.id)).slice(0, 300);
  const seenIds = [...new Set([...a.seenIds, ...b.seenIds, ...readHistory.slice().reverse().map(event => event.poemId)])].slice(-100);
  const notes = [...new Map([...a.notes, ...b.notes].map(note => [noteKey(note), note])).values()].sort((x, y) => y.savedAt.localeCompare(x.savedAt));
  const conversations: Record<string, Message[]> = {};
  for (const id of [...new Set([...Object.keys(a.conversations), ...Object.keys(b.conversations)])].sort()) {
    const messages = [...(a.conversations[id] || []), ...(b.conversations[id] || [])];
    conversations[id] = [...new Map(messages.map(message => [messageKey(message), message])).values()].sort((x, y) => x.createdAt.localeCompare(y.createdAt) || messageKey(x).localeCompare(messageKey(y)));
  }
  const onlinePoems = { ...a.onlinePoems };
  for (const [id, poem] of Object.entries(b.onlinePoems)) {
    const existing = onlinePoems[id];
    if (!existing || (poem.previewStatus === "full" && existing.previewStatus !== "full") || (poem.previewStatus === existing.previewStatus && poem.lines.join("").length > existing.lines.join("").length)) onlinePoems[id] = poem;
  }
  const merged = { ...a, savedIds, savedChanges, notes, seenIds, readHistory, conversations, onlinePoems, lastPoemId: readHistory.find(event => event.viewedAt)?.poemId || a.lastPoemId || b.lastPoemId };
  return JSON.stringify(merged) === JSON.stringify(local) ? local : merged;
}

export function syncSnapshot(library: Library) {
  const { version, savedIds, savedChanges, notes, seenIds, readHistory, conversations, onlinePoems, lastPoemId } = library;
  return { version, savedIds, savedChanges, notes, seenIds, readHistory, conversations, onlinePoems, lastPoemId };
}

export function exportLibrary(library: Library) {
  const blob = new Blob([JSON.stringify(library, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `poema-诗笺-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
