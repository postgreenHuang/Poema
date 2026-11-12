import { afterEach, describe, expect, it, vi } from "vitest";
import { lookupDictionary, parseDictionaryEntry } from "./dictionary";

afterEach(() => vi.restoreAllMocks());

describe("dictionary lookup", () => {
  const entry = { title: "徘徊", heteronyms: [{ pinyin: "pái huái", bopomofo: "ㄆㄞˊ ㄏㄨㄞˊ", definitions: [{ type: "動", def: "來回走動。" }] }] };

  it("preserves a sourced pronunciation and definition", () => {
    expect(parseDictionaryEntry(entry, "徘徊")).toEqual({
      title: "徘徊",
      sourceUrl: "https://www.moedict.tw/a/%E5%BE%98%E5%BE%8A",
      readings: [{ pinyin: "pái huái", bopomofo: "ㄆㄞˊ ㄏㄨㄞˊ", definitions: [{ type: "動", text: "來回走動。" }] }],
    });
  });

  it("tries traditional characters when a simplified word is absent", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({ status: 404 } as Response)
      .mockResolvedValueOnce({ status: 200, ok: true, json: async () => ({ ...entry, title: "詩" }) } as Response);
    expect((await lookupDictionary("诗"))?.readings[0].pinyin).toBe("pái huái");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toContain(encodeURIComponent("詩"));
  });

  it("rejects non-Chinese and excessive queries before fetching", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    expect(await lookupDictionary("wander")).toBeNull();
    expect(await lookupDictionary("诗".repeat(21))).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
