import { invoke } from "@tauri-apps/api/core";
import type { Message, Poem } from "./domain";
import { candidatePoems, normalizeFinderPlan, verifiedPicks, type FinderPick, type FinderPlan } from "./finder";
import { searchOnlineSources } from "./online";

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

async function complete(baseUrl: string, model: string, messages: { role: string; content: string }[], signal?: AbortSignal) {
  if (!model.trim()) throw new Error("请先在设置里填写模型名称");
  const payload = { model: model.trim(), temperature: 0.6, messages };
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

function parseJson(answer: string): unknown {
  const cleaned = answer.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  try { return JSON.parse(start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned); }
  catch { throw new Error("模型未按约定返回寻诗计划，请再试一次"); }
}

async function interpretRequest(baseUrl: string, model: string, request: string): Promise<FinderPlan> {
  const planAnswer = await complete(baseUrl, model, [
    { role: "system", content: "你是一位谨慎而富有文学感受力的寻诗向导。把用户需求转成检索计划，只输出 JSON 对象，不要 Markdown。字段：interpretation（简短中文理解）、terms（0-8 个可在题名作者原文中检索的具体检索词；中文写中文词，英文写英文词，不要自造诗句）、genres（诗/词/曲/诗经/楚辞/古文的数组）、language（all/zh/en）、themes（moon/rain/journey/nature/parting/time/solitude/hope 的数组）、excludeThemes（同前）、mood（all/lighter/darker）、short（布尔）。不要把用户没有提出的文体或语言变成硬限制。" },
    { role: "user", content: request },
  ]);
  return normalizeFinderPlan(parseJson(planAnswer));
}

export async function seekPoems(args: { baseUrl: string; model: string; request: string; poems: Poem[]; seenIds: string[]; onPlan?: (plan: FinderPlan) => void }) {
  const { baseUrl, model, request, poems, seenIds, onPlan } = args;
  const plan = await interpretRequest(baseUrl, model, request);
  onPlan?.(plan);
  const candidates = candidatePoems(poems, plan, seenIds, 32, request);
  if (!candidates.length) return { plan, picks: [] as FinderPick[], candidates };
  const candidateText = candidates.map(poem => `${poem.id}｜${poem.title}｜${poem.author}｜${poem.era}｜${poem.form}｜主题标签:${poem.themes.join(",")}｜首句:${poem.lines.find(Boolean)?.slice(0, 55) || ""}`).join("\n");
  const selectionAnswer = await complete(baseUrl, model, [
    { role: "system", content: "你只可从提供的本地候选作品中选 4-6 篇，不可编造作品或诗句。根据用户的细微需求，兼顾文体与作者多样性，优先挖掘不太耳熟的作品。只输出 JSON 对象：{\"picks\":[{\"id\":\"候选 ID\",\"reason\":\"一句具体且审慎的中文推荐理由\"}]}。理由只能根据候选信息推断，不要捏造写作背景；若只看到首句就不要声称通篇内容。" },
    { role: "user", content: `需求：${request}\n理解：${plan.interpretation}\n候选：\n${candidateText}` },
  ]);
  const picks = verifiedPicks(parseJson(selectionAnswer), candidates);
  return { plan, picks: picks.length ? picks : candidates.slice(0, 6).map(poem => ({ id: poem.id, reason: "这篇作品与所述意象或心绪相近，值得从原文读起。" })), candidates };
}

export async function seekOnlinePoems(args: { baseUrl: string; model: string; request: string; localPoems?: Poem[]; onPlan?: (plan: FinderPlan) => void }) {
  const { baseUrl, model, request, localPoems = [], onPlan } = args;
  const plan = await interpretRequest(baseUrl, model, request);
  onPlan?.(plan);
  const { items, warnings } = await searchOnlineSources(plan, request, localPoems);
  if (!items.length) return { plan, items, picks: [] as FinderPick[], warnings };
  const candidates = items.map(item => `${item.id}｜${item.title}｜${item.author || "作者待来源页核对"}｜${item.sourceName}｜摘要:${item.excerpt}`).join("\n");
  const selectionAnswer = await complete(baseUrl, model, [
    { role: "system", content: "你是谨慎的寻诗向导。候选来自实时诗歌来源，中文诗泉可能有完整正文，但这里只给了摘要；维基文库候选也可能只是搜索摘要。作者、时代、版本与权利都未独立核对。只可从候选 ID 中选最多 6 项；不可编造诗句、作者、背景、版权或未展示的正文。优先相关且多样的作品，尽量避开过熟名篇及重复作者。只输出 JSON：{\"picks\":[{\"id\":\"候选 ID\",\"reason\":\"根据题名或摘要写一句审慎的中文推荐理由\"}]}。" },
    { role: "user", content: `用户需求：${request}\n理解：${plan.interpretation}\n实时来源候选：\n${candidates}` },
  ]);
  let picks: FinderPick[] = [];
  try { picks = verifiedPicks(parseJson(selectionAnswer), items); }
  catch { warnings.push("AI 未返回可解析的候选，以下是来源检索结果"); }
  return { plan, items, picks: picks.length ? picks : items.slice(0, 6).map(item => ({ id: item.id, reason: "实时来源中的相关线索，请到原站核对全文与版本。" })), warnings };
}

export async function chat(args: { baseUrl: string; model: string; poem: Poem; selectedLine?: string; messages: Message[]; signal?: AbortSignal }) {
  const { baseUrl, model, poem, selectedLine, messages, signal } = args;
  const system = `你是一位谦逊、敏锐的古典文学共读者。只依据下方作品的已知文本回答。区分文本可见、历史事实与个人解读；无资料时不要编造作者生平、写作背景、译者或版本事实。允许多义，不要强行总结中心思想。回答简洁而具体，优先从具体文句出发。不要续写或声称未给出的文句属于原作。${poem.previewStatus ? `这是一篇在线来源文本，当前仅有${poem.previewStatus === "excerpt" ? "搜索摘要，绝不可称为全文" : "网页解析文本，尚未校勘"}；作者、版本和权利未核验。` : ""}\n作品：${poem.title}；作者：${poem.author}；时代：${poem.era}；文体：${poem.form}。\n${poem.previewStatus === "excerpt" ? "来源摘要" : "原文"}：\n${poem.lines.map((line, i) => `${i + 1}. ${line}`).join("\n")}\n${selectedLine ? `用户选中的文句：${selectedLine}` : ""}`;
  return complete(baseUrl, model, [{ role: "system", content: system }, ...messages.slice(-12).map(m => ({ role: m.role, content: m.content }))], signal);
}

export async function lookupWord(args: { baseUrl: string; model: string; poem: Poem; term: string; context?: string }) {
  const { baseUrl, model, poem, context } = args;
  const term = args.term.trim().slice(0, 60);
  if (!term) throw new Error("请输入想查询的字或词语");
  return complete(baseUrl, model, [
    { role: "system", content: "你是一位审慎的中英文诗歌词典助手。只回答指定字词，不做整首赏析。先给读音：中文标拼音（含声调），英文标 IPA；有异读须结合给出的原句说明，不确定时明确说不确定，不可编造。再用简洁中文解释它在当前文句中的含义；若只是来源摘要，勿推断未展示的上下文。只输出读音与释义，不要假装提供了真人发音。" },
    { role: "user", content: `查询：${term}\n作品：${poem.title}（${poem.language === "zh" ? "中文" : "英文"}）\n原句：${(context || poem.lines.find(line => line.includes(term)) || "未指定").slice(0, 240)}` },
  ]);
}
