import { describe, expect, it } from "vitest";
import { mergeLibraries, normalizeLibrary, syncSnapshot } from "./storage";

describe("library migration and multi-device merge", () => {
  it("keeps older local libraries usable", () => {
    const old = normalizeLibrary({ version: 1, savedIds: ["a"], seenIds: ["a", "b"], conversations: { a: [{ role: "user", content: "你好", createdAt: "2026-01-01T00:00:00.000Z" }] } });
    expect(old.savedChanges.a.saved).toBe(true);
    expect(old.readHistory.map(event => event.poemId)).toEqual(["a", "b"]);
    expect(old.conversations.a).toHaveLength(1);
  });

  it("combines independent visits, notes and conversations without duplicates", () => {
    const a = normalizeLibrary({ version: 1, readHistory: [{ id: "visit-a", poemId: "a", viewedAt: "2026-01-01T00:00:00.000Z" }], notes: [{ poemId: "a", text: "第一句", savedAt: "2026-01-01T00:00:00.000Z" }], conversations: { a: [{ id: "message-a", role: "user", content: "想聊聊", createdAt: "2026-01-01T00:00:00.000Z" }] } });
    const b = normalizeLibrary({ version: 1, readHistory: [{ id: "visit-b", poemId: "b", viewedAt: "2026-01-02T00:00:00.000Z" }], conversations: { a: [{ id: "message-b", role: "assistant", content: "好呀", createdAt: "2026-01-02T00:00:00.000Z" }] } });
    const merged = mergeLibraries(a, b);
    expect(merged.readHistory.map(event => event.poemId)).toEqual(["b", "a"]);
    expect(merged.notes).toHaveLength(1);
    expect(merged.conversations.a.map(message => message.id)).toEqual(["message-a", "message-b"]);
    expect(mergeLibraries(merged, b)).toBe(merged);
  });

  it("keeps the newer removal when an older device still has a saved copy", () => {
    const older = normalizeLibrary({ version: 1, savedIds: ["a"], savedChanges: { a: { saved: true, at: "2026-01-01T00:00:00.000Z", deviceId: "device-a" } } });
    const newer = normalizeLibrary({ version: 1, savedIds: [], savedChanges: { a: { saved: false, at: "2026-01-02T00:00:00.000Z", deviceId: "device-b" } } });
    expect(mergeLibraries(older, newer).savedIds).toEqual([]);
    expect(mergeLibraries(newer, older).savedIds).toEqual([]);
  });

  it("does not sync local AI configuration", () => {
    const snapshot = syncSnapshot(normalizeLibrary({ aiBaseUrl: "https://private.example/v1", aiModel: "private-model" }));
    expect(snapshot).not.toHaveProperty("aiBaseUrl");
    expect(snapshot).not.toHaveProperty("aiModel");
  });
});
