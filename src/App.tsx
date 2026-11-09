import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Bookmark, BookOpen, Check, ChevronDown, Compass, Download, ExternalLink, Feather, MessageCircle, Moon, Search, Send, Settings, Shuffle, Sparkles, X } from "lucide-react";
import { chat, hasKey, saveKey, isDesktop, openSource } from "./ai";
import { chooseNext, genreLabels, genreOf, relatedPoems, searchPoems, themeLabels, type Genre, type Language, type Message, type PathKind, type Poem, type Theme } from "./domain";
import { poems } from "./catalog";
import { exportLibrary, getDeviceId, loadLibrary, loadSyncFolder, mergeLibraries, recordVisit, saveLibrary, saveSyncFolder, setSaved, type Library } from "./storage";
import { readSyncSnapshots, writeSyncSnapshot } from "./sync";
import { applyTheme, defaultTheme, loadTheme, saveTheme, themeParts, themePresets, type ThemeColors, type ThemePart } from "./theme";

type Page = "today" | "search" | "notebook" | "settings";
const pathLabels: Record<PathKind, string> = { image: "同一意象", mood: "相近心绪", form: "同一种呼吸", contrast: "与它相反" };
const pathKinds: PathKind[] = ["image", "mood", "form", "contrast"];
const first = poems[0];

function PoemBody({ poem, selectedLine, onSelect }: { poem: Poem; selectedLine?: string; onSelect: (line?: string) => void }) {
  return <div className={`poem-body ${poem.language === "en" ? "english" : "chinese"} ${genreOf(poem) === "古文" ? "prose" : ""}`} lang={poem.language === "zh" ? "zh-CN" : "en"}>
    {poem.lines.map((line, index) => line ? <button key={index} className={`poem-line ${selectedLine === line ? "selected" : ""}`} onClick={() => onSelect(selectedLine === line ? undefined : line)} title="点亮这一句">{line}</button> : <div key={index} className="stanza-gap" />)}
  </div>;
}

function PoemCard({ poem, reason, onOpen }: { poem: Poem; reason?: string; onOpen: () => void }) {
  return <button className="poem-card" onClick={onOpen}>
    <span className="card-overline">{poem.language === "zh" ? genreOf(poem) : "ENGLISH"} · {poem.form}</span>
    <strong>{poem.title}</strong><span className="card-author">{poem.author} · {poem.era}</span>
    <span className="card-line">{poem.lines.find(Boolean)}</span>
    {reason && <span className="card-reason">↗ {reason}</span>}
  </button>;
}

function ThemeControl({ part, value, onChange }: { part: typeof themeParts[number]; value: string; onChange: (key: ThemePart, value: string) => void }) {
  const [draftColor, setDraftColor] = useState(value);
  useEffect(() => setDraftColor(value), [value]);
  return <div className="theme-control"><span><strong>{part.label}</strong><small>{part.hint}</small></span><input type="color" value={value} onChange={e => onChange(part.key, e.target.value)} aria-label={`${part.label}选色`}/><input type="text" value={draftColor} onChange={e => { const next = e.target.value; setDraftColor(next); if (/^#[0-9a-fA-F]{6}$/.test(next)) onChange(part.key, next); }} onBlur={() => setDraftColor(value)} aria-label={`${part.label}色值`}/></div>;
}

export default function App() {
  const [library, setLibrary] = useState<Library>(loadLibrary);
  const [syncFolder, setSyncFolder] = useState(loadSyncFolder);
  const [syncDraft, setSyncDraft] = useState(loadSyncFolder);
  const [syncReady, setSyncReady] = useState(false);
  const [syncStatus, setSyncStatus] = useState("");
  const writeQueue = useRef<Promise<void>>(Promise.resolve());
  const initialVisitLogged = useRef(false);
  const [themeColors, setThemeColors] = useState<ThemeColors>(loadTheme);
  const [page, setPage] = useState<Page>("today");
  const [currentId, setCurrentId] = useState(() => loadLibrary().lastPoemId || chooseNext(poems, []).id);
  const [selectedLine, setSelectedLine] = useState<string>();
  const [pathKind, setPathKind] = useState<PathKind>("image");
  const [query, setQuery] = useState("");
  const [language, setLanguage] = useState<"all" | Language>("all");
  const [genre, setGenre] = useState<"all" | Genre>("all");
  const [theme, setTheme] = useState<"all" | Theme>("all");
  const [visibleLimit, setVisibleLimit] = useState(24);
  const [historyLimit, setHistoryLimit] = useState(12);
  const [readingOpen, setReadingOpen] = useState(false);
  const [rightsOpen, setRightsOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [keyReady, setKeyReady] = useState(false);
  const [settingsNotice, setSettingsNotice] = useState("");
  const [pathHistory, setPathHistory] = useState<string[]>([]);
  const current = poems.find(p => p.id === currentId) || first;
  const saved = library.savedIds.includes(current.id);
  const messages = library.conversations[current.id] || [];
  const { results, intent } = useMemo(() => {
    const found = searchPoems(poems, query, language, theme);
    return { ...found, results: genre === "all" ? found.results : found.results.filter(poem => genreOf(poem) === genre) };
  }, [query, language, theme, genre]);
  const paths = useMemo(() => relatedPoems(current, poems, pathKind), [current, pathKind]);
  const savedPoems = library.savedIds.map(id => poems.find(p => p.id === id)).filter((p): p is Poem => !!p);
  const recentReads = useMemo(() => {
    const found = new Set<string>();
    const byId = new Map(poems.map(poem => [poem.id, poem]));
    return library.readHistory.filter(event => {
      if (found.has(event.poemId) || !byId.has(event.poemId)) return false;
      found.add(event.poemId); return true;
    }).map(event => ({ event, poem: byId.get(event.poemId)! }));
  }, [library.readHistory]);
  const recentConversations = useMemo(() => Object.entries(library.conversations)
    .filter(([, messages]) => messages.length > 0)
    .map(([id, messages]) => ({ poem: poems.find(poem => poem.id === id), last: messages[messages.length - 1] }))
    .filter((entry): entry is { poem: Poem; last: Message } => !!entry.poem)
    .sort((a, b) => b.last.createdAt.localeCompare(a.last.createdAt)).slice(0, 8), [library.conversations]);

  useEffect(() => { saveLibrary(library); }, [library]);
  useEffect(() => {
    if (initialVisitLogged.current) return;
    initialVisitLogged.current = true;
    setLibrary(old => recordVisit(old, currentId));
  }, []);
  useEffect(() => {
    if (!isDesktop || !syncFolder) return;
    let active = true;
    async function refresh() {
      try {
        const { snapshots, skipped } = await readSyncSnapshots(syncFolder);
        if (!active) return;
        setLibrary(old => snapshots.reduce(mergeLibraries, old));
        setSyncReady(true);
        setSyncStatus(`已读取 ${snapshots.length} 台设备 · ${new Date().toLocaleTimeString("zh-CN")}${skipped ? ` · 跳过 ${skipped} 个无效文件` : ""}`);
      } catch (error) {
        if (active) { setSyncReady(false); setSyncStatus(`同步读取失败：${String(error)}`); }
      }
    }
    void refresh();
    const timer = window.setInterval(refresh, 20_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [syncFolder]);
  useEffect(() => {
    if (!isDesktop || !syncFolder || !syncReady) return;
    const timer = window.setTimeout(() => {
      writeQueue.current = writeQueue.current.then(() => writeSyncSnapshot(syncFolder, getDeviceId(), library))
        .then(() => setSyncStatus(`已保存到同步文件夹 · ${new Date().toLocaleTimeString("zh-CN")}`))
        .catch(error => setSyncStatus(`同步写入失败：${String(error)}`));
    }, 800);
    return () => window.clearTimeout(timer);
  }, [library, syncFolder, syncReady]);
  useEffect(() => { applyTheme(themeColors); saveTheme(themeColors); }, [themeColors]);
  useEffect(() => { hasKey(library.aiBaseUrl).then(setKeyReady).catch(() => setKeyReady(false)); }, [library.aiBaseUrl]);
  useEffect(() => { setVisibleLimit(24); }, [query, language, theme, genre]);

  function update(patch: Partial<Library>) { setLibrary(old => ({ ...old, ...patch })); }
  async function connectSync() {
    const folder = syncDraft.trim();
    if (!isDesktop) { setSyncStatus("坚果云文件夹同步仅在桌面版可用。"); return; }
    try {
      const { snapshots, skipped } = await readSyncSnapshots(folder);
      setLibrary(old => snapshots.reduce(mergeLibraries, old));
      saveSyncFolder(folder); setSyncFolder(folder); setSyncReady(true);
      setSyncStatus(`已连接，读到 ${snapshots.length} 台设备${skipped ? `；跳过 ${skipped} 个无效文件` : ""}。本机改动将自动写入。`);
    } catch (error) { setSyncStatus(`连接失败：${String(error)}`); }
  }
  function disconnectSync() {
    saveSyncFolder(""); setSyncFolder(""); setSyncReady(false); setSyncStatus("已停止同步；坚果云中的 Poema 文件未删除。");
  }
  function updateTheme(key: ThemePart, value: string) { setThemeColors(old => ({ ...old, [key]: value })); }
  function openPoem(poem: Poem, fromPath = false) {
    if (fromPath) setPathHistory(old => [...old, current.id].slice(-30));
    setCurrentId(poem.id); setSelectedLine(undefined); setReadingOpen(false); setRightsOpen(false); setError(""); setPage("today");
    setLibrary(old => recordVisit(old, poem.id));
    window.scrollTo(0, 0);
  }
  function nextPoem() { openPoem(chooseNext(poems, library.seenIds, current.id)); }
  function toggleSaved() { setLibrary(old => setSaved(old, current.id, !old.savedIds.includes(current.id))); }
  function saveNote() {
    if (!noteDraft.trim()) return;
    setLibrary(old => {
      const withNote = { ...old, notes: [{ poemId: current.id, line: selectedLine, text: noteDraft.trim(), savedAt: new Date().toISOString() }, ...old.notes] };
      return old.savedIds.includes(current.id) ? withNote : setSaved(withNote, current.id, true);
    });
    setNoteDraft("");
  }
  async function send(text = draft) {
    const content = text.trim();
    if (!content || busy) return;
    setDraft(""); setError(""); setReadingOpen(true); setBusy(true);
    const userMessage: Message = { id: crypto.randomUUID(), role: "user", content: selectedLine ? `关于「${selectedLine}」：${content}` : content, createdAt: new Date().toISOString() };
    const next = [...messages, userMessage];
    setLibrary(old => ({ ...old, conversations: { ...old.conversations, [current.id]: next } }));
    try {
      const answer = await chat({ baseUrl: library.aiBaseUrl, model: library.aiModel, poem: current, selectedLine, messages: next });
      setLibrary(old => ({ ...old, conversations: { ...old.conversations, [current.id]: [...(old.conversations[current.id] || next), { id: crypto.randomUUID(), role: "assistant", content: answer, createdAt: new Date().toISOString() }] } }));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  async function storeKey() {
    setSettingsNotice("");
    if (!apiKey.trim()) { setSettingsNotice("请输入新密钥；已有密钥不会被替换。"); return; }
    try { await saveKey(library.aiBaseUrl, apiKey.trim()); setKeyReady(!!apiKey.trim()); setApiKey(""); setSettingsNotice(apiKey.trim() ? "密钥已保存，可以开始共读。" : "密钥已清除。"); }
    catch (e) { setSettingsNotice(`保存失败：${String(e)}`); }
  }
  async function clearKey() {
    try { await saveKey(library.aiBaseUrl, ""); setKeyReady(false); setSettingsNotice("密钥已清除。"); }
    catch (e) { setSettingsNotice(`清除失败：${String(e)}`); }
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <button className="brand" onClick={() => setPage("today")}><span className="brand-mark"><Feather size={25} strokeWidth={1.5}/></span><span><strong>Poema</strong><small>一座会与你谈诗的私人诗库</small></span></button>
      <nav className="nav">
        <button className={page === "today" ? "active" : ""} onClick={() => setPage("today")}><Compass size={18}/> 今日偶遇 <span>01</span></button>
        <button className={page === "search" ? "active" : ""} onClick={() => setPage("search")}><Search size={18}/> 寻诗 <span>02</span></button>
        <button className={page === "notebook" ? "active" : ""} onClick={() => setPage("notebook")}><Bookmark size={18}/> 我的诗笺 <span>{library.savedIds.length || "03"}</span></button>
        <button className={`mobile-settings ${page === "settings" ? "active" : ""}`} onClick={() => setPage("settings")} aria-label="偏好与主题"><Settings size={18}/> 偏好 <span>04</span></button>
      </nav>
      <div className="sidebar-spacer"/>
      <div className="sidebar-note"><Moon size={18}/><p>有些诗不必立刻读懂。<br/>先让它在这里停一会儿。</p></div>
      <button className={`settings-link ${page === "settings" ? "active" : ""}`} onClick={() => setPage("settings")}><Settings size={17}/> 偏好与 AI</button>
      <span className="sidebar-footer">POEMA · PRIVATE READING SPACE</span>
    </aside>

    <main className="main-content">
      {page === "today" && <>
        <header className="topbar"><div className="eyebrow">A TEXT, A MOMENT</div><div className="top-actions"><span className="edition-pill">本地文库 · {poems.length} 篇</span><button className={`primary-soft ${saved ? "is-saved" : ""}`} onClick={toggleSaved} aria-label={saved ? "已留入诗笺，点击移除" : "留入诗笺"}>{saved ? <Check size={16}/> : <Bookmark size={16}/>}<span className="full-label">{saved ? "已留入诗笺" : "留入诗笺"}</span><span className="compact-label">{saved ? "已留" : "留诗笺"}</span></button><button className="ghost-button" onClick={() => setReadingOpen(true)}><MessageCircle size={16}/><span className="full-label">与它谈谈</span><span className="compact-label">共读</span></button><button className="ghost-button" onClick={nextPoem}><Shuffle size={16}/> {genreOf(current) === "古文" ? "再遇一篇" : "再遇一首"}</button></div></header>
        <div className="reader-layout">
          <section className="reader-main">
            {pathHistory.length > 0 && <button className="text-button back-path" onClick={() => { const prev = pathHistory[pathHistory.length - 1]; setPathHistory(pathHistory.slice(0, -1)); openPoem(poems.find(p => p.id === prev) || first); }}><ArrowLeft size={15}/> 回到上一首</button>}
            <div className="chapter-label"><span className="chapter-line"/> 今日与你相遇的诗 <span className="chapter-line"/></div>
            <div className="poem-heading"><div className="meta-line">{current.language === "zh" ? genreOf(current) : "ENGLISH POETRY"} <span>·</span> {current.era} <span>·</span> {current.form}</div><h1>{current.title}</h1><p>{current.author}</p></div>
            <PoemBody poem={current} selectedLine={selectedLine} onSelect={setSelectedLine}/>
            {selectedLine && <div className="line-hint"><Sparkles size={15}/> 已点亮「{selectedLine}」<button onClick={() => { setReadingOpen(true); setDraft("这一句可以怎样读？"); }}>谈谈这一句 <ArrowRight size={14}/></button></div>}
            <div className="source-line"><BookOpen size={14}/> 文本来源：<button onClick={() => openSource(current.sourceUrl)}>{current.sourceName} <ExternalLink size={12}/></button><button onClick={() => setRightsOpen(true)}>版权与版本说明</button></div>
          </section>
          <aside className="reader-aside"><div className="aside-kicker">沿 此 而 去</div><h2>一篇作品的岔路</h2><p className="aside-intro">选择一种关联，看看文字会把你带到哪里。</p><div className="path-tabs">{pathKinds.map(kind => <button key={kind} className={kind === pathKind ? "selected" : ""} onClick={() => setPathKind(kind)}>{pathLabels[kind]}</button>)}</div><div className="path-list">{paths.slice(0, 3).map(({ poem, reason }) => <button key={poem.id} onClick={() => openPoem(poem, true)}><span className="path-num">↗</span><span><strong>{poem.title}</strong><small>{poem.author} · {reason}</small></span><ArrowRight size={15}/></button>)}</div><div className="aside-bottom">每条路都有来处，也可以随时返回。</div></aside>
        </div>
      </>}

      {page === "search" && <div className="page-wrap">
        <div className="page-eyebrow">FIND YOUR TEXT</div>
        <h1 className="page-title">你想遇见怎样的文字？</h1>
        <p className="page-description">诗、词、曲、歌赋与古文，一个词、一位作者、一句记得不完整的话，都可以从这里开始。</p>
        <div className="search-box"><Search size={21}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="试试：写雨但不悲伤的短诗、诗经、王维、night..." autoFocus/>{query && <button onClick={() => setQuery("")} title="清空"><X size={17}/></button>}</div>
        {intent.labels.length > 0 && <div className="intent-chips"><span>已理解为</span>{intent.labels.map((label, i) => <span key={i}>{label}</span>)}{intent.residual && <span>关键词：{intent.residual}</span>}</div>}
        <div className="filters">
          <label>语言 <select value={language} onChange={e => setLanguage(e.target.value as typeof language)}><option value="all">中英皆可</option><option value="zh">中文</option><option value="en">英文</option></select><ChevronDown size={13}/></label>
          <label>文体 <select value={genre} onChange={e => setGenre(e.target.value as typeof genre)}><option value="all">全部</option>{genreLabels.map(label => <option key={label} value={label}>{label}</option>)}</select><ChevronDown size={13}/></label>
          <label>意象 <select value={theme} onChange={e => setTheme(e.target.value as typeof theme)}><option value="all">任意</option>{Object.entries(themeLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select><ChevronDown size={13}/></label>
          <span>{results.length} 篇作品</span>
        </div>
        <div className="results-grid">{results.slice(0, visibleLimit).map(p => <PoemCard key={p.id} poem={p} onOpen={() => openPoem(p)}/>)}</div>
        {results.length > visibleLimit && <button className="load-more" onClick={() => setVisibleLimit(n => n + 24)}>再看 24 篇 <ArrowRight size={16}/></button>}
        {!results.length && <div className="empty-state">暂时没有符合条件的作品。试着减少一个词，或换一种文体。</div>}
      </div>}

      {page === "notebook" && <div className="page-wrap">
        <div className="page-eyebrow">YOUR PRIVATE ANTHOLOGY</div>
        <div className="title-row"><div><h1 className="page-title">我的诗笺</h1><p className="page-description">读过、谈过、想留下的，都能从这里继续。</p></div><button className="outline-button" onClick={() => exportLibrary(library)}><Download size={16}/> 导出诗笺</button></div>
        <section className="library-section"><h2>最近读过</h2><p>回到一篇文字，也回到当时停留的地方。</p>
          {recentReads.length ? <><div className="recent-grid">{recentReads.slice(0, historyLimit).map(({ event, poem }) => <button className="recent-item" key={event.id} onClick={() => openPoem(poem)}><span>{genreOf(poem)} · {event.id.startsWith("legacy:") ? "旧版记录" : new Date(event.viewedAt).toLocaleString("zh-CN")}</span><strong>{poem.title}</strong><small>{poem.author}</small></button>)}</div>{recentReads.length > historyLimit && <button className="load-more" onClick={() => setHistoryLimit(old => old + 24)}>展开更多浏览记录</button>}</> : <div className="quiet-empty">尚无浏览记录。</div>}
        </section>
        <section className="library-section"><h2>最近共读</h2><p>每篇作品的对话分开保存，打开后可以接着谈。</p>
          {recentConversations.length ? <div className="recent-grid">{recentConversations.map(({ poem, last }) => <button className="recent-item" key={poem.id} onClick={() => { openPoem(poem); setReadingOpen(true); }}><span>{new Date(last.createdAt).toLocaleString("zh-CN")}</span><strong>{poem.title}</strong><small>{last.content.slice(0, 70)}</small></button>)}</div> : <div className="quiet-empty">还没有共读对话。</div>}
        </section>
        <section className="library-section"><h2>留入诗笺</h2>{savedPoems.length ? <div className="results-grid">{savedPoems.map(p => <PoemCard key={p.id} poem={p} reason={library.notes.find(n => n.poemId === p.id)?.text} onOpen={() => openPoem(p)}/>)}</div> : <div className="quiet-empty">还没有收藏。遇到喜欢的作品，就把它留在这里。</div>}</section>
        {library.notes.length > 0 && <section className="notes-section"><h2>留下的话</h2>{library.notes.map((note, i) => <div className="note-item" key={`${note.savedAt}-${i}`}><span>{poems.find(p => p.id === note.poemId)?.title}</span>{note.line && <em>「{note.line}」</em>}<p>{note.text}</p><small>{new Date(note.savedAt).toLocaleDateString("zh-CN")}</small></div>)}</section>}
      </div>}

      {page === "settings" && <div className="page-wrap settings-page">
        <div className="page-eyebrow">YOUR READING SPACE</div><h1 className="page-title">偏好与 AI</h1>
        <p className="page-description">诗笺默认保存在这台设备上；也可以用坚果云同步收藏、足迹与对话。配置兼容 Chat Completions 的模型后，可以开始持续共读。</p>
        <section className="setting-card"><h2>坚果云 · 多设备诗笺</h2><p>先在每台电脑安装坚果云客户端，并让同一个文件夹同步到本机。填写这台电脑上的文件夹路径后，Poema 会在其中建立 Poema/devices，定期合并各设备的记录。</p><label>本机同步文件夹<input value={syncDraft} onChange={e => setSyncDraft(e.target.value)} placeholder="例如 D:\Nutstore\我的坚果云" disabled={!isDesktop}/></label><div className="sync-actions"><button className="primary-soft" onClick={connectSync} disabled={!isDesktop || !syncDraft.trim()}>连接 / 立即同步</button>{syncFolder && <button className="ghost-button" onClick={disconnectSync}>停止同步</button>}</div><p className="setting-notice">{isDesktop ? (syncStatus || (syncFolder ? `已连接：${syncFolder}` : "尚未连接同步文件夹。")) : "浏览器预览不支持文件夹同步，请使用桌面版。"}</p><p className="sync-warning">同步文件包含明文收藏、笔记、浏览记录和共读对话；API Key 不会同步。请选择仅自己可访问的文件夹。</p></section>
        <section className="setting-card"><h2>为阅读调一盏灯</h2><p>从一套色调开始，再逐项调整页面、卡片、文字与按钮。更改即时生效，并只保存在这台设备上。</p><div className="theme-presets">{themePresets.map(preset => <button key={preset.name} className={themeParts.every(part => themeColors[part.key].toLowerCase() === preset.colors[part.key].toLowerCase()) ? "active" : ""} onClick={() => setThemeColors({ ...preset.colors })}>{preset.name}</button>)}</div><div className="theme-grid">{themeParts.map(part => <ThemeControl key={part.key} part={part} value={themeColors[part.key]} onChange={updateTheme}/>)}</div><button className="ghost-button theme-reset" onClick={() => setThemeColors({ ...defaultTheme })}>恢复默认色彩</button></section>
        <section className="setting-card"><h2>共读模型</h2><p>桌面版密钥保存到系统凭据库；浏览器预览只保留在当前会话。发送问题时会附上当前作品的原文和本篇最近的对话。</p><label>服务地址<input value={library.aiBaseUrl} onChange={e => update({ aiBaseUrl: e.target.value })} placeholder="https://api.openai.com/v1"/></label><label>模型名称<input value={library.aiModel} onChange={e => update({ aiModel: e.target.value })} placeholder="填写服务商提供的模型 ID"/></label><label>API Key <span className="key-status">{keyReady ? "已配置" : "未配置"}</span><input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder={keyReady ? "输入新密钥可替换" : "输入密钥"}/></label><button className="primary-soft" onClick={storeKey}>保存密钥</button>{keyReady && <button className="clear-key" onClick={clearKey}>清除已存密钥</button>}{settingsNotice && <p className="setting-notice">{settingsNotice}</p>}</section>
        <section className="setting-card"><h2>关于文本与来源</h2><p>当前内置 {poems.length} 篇公版作品，含诗、词、曲、《诗经》、楚辞与古文。英文原文来自 PoetryDB；中文扩充文本来自 chinese-poetry，均保留来源链接。中文自动转写文本尚未逐篇校勘。</p><p>本地诗笺和历史不会自动发送给模型。模型只接收当前作品、当前选句和本篇最近的对话。</p><p className="license-credit">Poetry data from <button className="inline-link" onClick={() => openSource("https://poetrydb.org")}>PoetryDB</button>, licensed under CC BY 4.0.</p></section>
        <span className="settings-footnote">运行环境：{isDesktop ? "Poema 桌面版" : "浏览器预览"}</span>
      </div>}
    </main>

    {rightsOpen && <div className="modal-backdrop" onClick={() => setRightsOpen(false)}><section className="rights-modal" role="dialog" aria-modal="true" aria-label="版权与版本说明" onClick={e => e.stopPropagation()}><button className="modal-close" onClick={() => setRightsOpen(false)} title="关闭"><X size={18}/></button><div className="page-eyebrow">SOURCE & EDITION</div><h2>{current.title}</h2><p className="rights-author">{current.author} · {current.era}</p><dl><dt>文本来源</dt><dd>{current.sourceName}</dd><dt>权利与整理</dt><dd>{current.rights.basis}</dd><dt>校勘状态</dt><dd>{current.quality === "imported" ? "公开语料导入，尚未逐首人工校勘" : "精选样本，仍需在正式发行前核对具体底本"}</dd>{current.rights.textCredit && <><dt>署名</dt><dd>{current.rights.textCredit}</dd></>}</dl><button className="primary-soft" onClick={() => openSource(current.sourceUrl)}>打开来源 <ExternalLink size={14}/></button></section></div>}

    {page === "today" && readingOpen && <div className="reading-panel"><div className="panel-header"><div><span>共读 · {current.title}</span><h2>和这首诗再待一会儿</h2></div><button className="icon-button" onClick={() => setReadingOpen(false)} title="关闭"><X size={19}/></button></div>{selectedLine && <div className="selected-quote">「{selectedLine}」<button onClick={() => setSelectedLine(undefined)} title="取消选句"><X size={14}/></button></div>}<div className="conversation">{messages.length === 0 && <div className="conversation-start"><Feather size={25}/><p>你可以从一个字、一种声音，或者读完后的感觉开始。</p><div className="prompt-chips"><button onClick={() => send("先不要讲背景，带我慢慢读这首诗。")}>慢慢读</button><button onClick={() => send("这首诗的声音和节奏有什么特别？")}>听它的声音</button><button onClick={() => send("能给出另一种不同的读法吗？")}>另一种读法</button></div></div>}{messages.map((m, i) => <div className={`message ${m.role}`} key={i}><span>{m.role === "user" ? "我" : "POEMA"}</span><p>{m.content}</p></div>)}{busy && <div className="thinking">Poema 正在细读…</div>}{error && <div className="chat-error">{error} <button onClick={() => setPage("settings")}>检查设置</button></div>}</div><div className="chat-compose"><textarea value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} placeholder="写下你想问的，Enter 发送…" rows={2}/><button disabled={busy || !draft.trim()} onClick={() => send()} title="发送"><Send size={18}/></button></div><div className="note-compose"><span>只写给自己</span><div><input value={noteDraft} onChange={e => setNoteDraft(e.target.value)} onKeyDown={e => { if (e.key === "Enter") saveNote(); }} placeholder="记下此刻的一句话"/><button onClick={saveNote} disabled={!noteDraft.trim()}>留在诗笺</button></div></div></div>}
  </div>;
}
