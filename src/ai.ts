import { invoke } from "@tauri-apps/api/core";
import type { Message, Poem } from "./domain";

export const isDesktop = "__TAURI_INTERNALS__" in window;

export async function openSource(url: string) {
  if (isDesktop) await invoke("open_external", { url });
  else window.open(url, "_blank", "noopener,noreferrer");
}

export async function saveKey(baseUrl: string, key: string) {
  if (isDesktop) await invoke("save_api_key", { baseUrl, key });
  else sessionStorage.setItem("poema.preview.key", key);
}

export async function hasKey(baseUrl: string) {
  if (isDesktop) return invoke<boolean>("has_api_key", { baseUrl });
  return !!sessionStorage.getItem("poema.preview.key");
}

export async function chat(args: { baseUrl: string; model: string; poem: Poem; selectedLine?: string; messages: Message[]; signal?: AbortSignal }) {
  const { baseUrl, model, poem, selectedLine, messages, signal } = args;
  if (!model.trim()) throw new Error("请先在设置里填写模型名称");
  const system = `你是一位谦逊、敏锐的中文诗歌共读者。只依据下方这首诗的已知文本回答。区分文本可见、历史事实与个人解读；无资料时不要编造作者生平、写作背景、译者或版本事实。允许多义，不要强行总结中心思想。回答简洁而具体，优先从具体诗句出发。不要续写诗歌或声称未给出的诗句属于原作。\n作品：${poem.title}；作者：${poem.author}；时代：${poem.era}；诗体：${poem.form}。\n原文：\n${poem.lines.map((line, i) => `${i + 1}. ${line}`).join("\n")}\n${selectedLine ? `用户选中的诗句：${selectedLine}` : ""}`;
  const payload = { model: model.trim(), temperature: 0.6, messages: [{ role: "system", content: system }, ...messages.slice(-12).map(m => ({ role: m.role, content: m.content }))] };
  if (isDesktop) return invoke<string>("ai_chat", { baseUrl, payload });
  const key = sessionStorage.getItem("poema.preview.key");
  if (!key) throw new Error("请先在设置里填写 API Key");
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body: JSON.stringify(payload), signal });
  if (!response.ok) throw new Error(`模型服务返回 ${response.status}`);
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw new Error("模型没有返回可读文字");
  return content.trim();
}
