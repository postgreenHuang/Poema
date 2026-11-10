#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use reqwest::Url;
use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use std::time::Duration;
use tauri_plugin_opener::OpenerExt;

fn endpoint(raw: &str) -> Result<Url, String> {
    let trimmed = raw.trim().trim_end_matches('/');
    let parsed = Url::parse(trimmed).map_err(|_| "服务地址无效".to_string())?;
    let local = matches!(parsed.host_str(), Some("localhost" | "127.0.0.1" | "::1"));
    if parsed.scheme() != "https" && !(local && parsed.scheme() == "http") {
        return Err("仅允许 HTTPS 服务，或本机 HTTP 服务".into());
    }
    if !parsed.username().is_empty() || parsed.password().is_some() || parsed.query().is_some() || parsed.fragment().is_some() {
        return Err("服务地址不能包含凭据、查询参数或片段".into());
    }
    Ok(parsed)
}

fn credential(base_url: &str) -> Result<keyring::Entry, String> {
    let url = endpoint(base_url)?;
    keyring::Entry::new("app.poema.reader", url.as_str()).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_api_key(base_url: String, key: String) -> Result<(), String> {
    let entry = credential(&base_url)?;
    if key.trim().is_empty() {
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    } else {
        entry.set_password(key.trim()).map_err(|e| e.to_string())
    }
}

#[tauri::command]
fn has_api_key(base_url: String) -> Result<bool, String> {
    match credential(&base_url)?.get_password() {
        Ok(_) => Ok(true),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
async fn ai_chat(base_url: String, payload: Value) -> Result<String, String> {
    let base = endpoint(&base_url)?;
    let key = credential(&base_url)?.get_password().map_err(|_| "请先在设置里配置 API Key".to_string())?;
    let model = payload.get("model").and_then(Value::as_str).unwrap_or("");
    let messages = payload.get("messages").and_then(Value::as_array);
    if model.is_empty() || model.len() > 200 || messages.is_none() || messages.unwrap().len() > 16 {
        return Err("共读请求格式无效".into());
    }
    let url = Url::parse(&format!("{}/chat/completions", base.as_str().trim_end_matches('/')))
        .map_err(|_| "服务地址无效".to_string())?;
    let client = reqwest::Client::builder().timeout(Duration::from_secs(90)).build().map_err(|e| e.to_string())?;
    let response = client.post(url).bearer_auth(key).json(&payload).send().await.map_err(|e| format!("模型服务连接失败：{e}"))?;
    if !response.status().is_success() {
        return Err(format!("模型服务返回 {}", response.status()));
    }
    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    if bytes.len() > 2_000_000 { return Err("模型响应过大".into()); }
    let value: Value = serde_json::from_slice(&bytes).map_err(|_| "模型响应无法解析".to_string())?;
    value.pointer("/choices/0/message/content").and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty()).map(str::trim).map(str::to_string)
        .ok_or_else(|| "模型没有返回可读文字".to_string())
}

#[tauri::command]
async fn search_public_source(source: String, term: String) -> Result<Value, String> {
    let term = term.trim();
    if term.chars().count() > 80 || source != "wikisource" && source != "poetrydb" {
        return Err("在线检索参数无效".into());
    }
    if source == "wikisource" && term.is_empty() { return Err("维基文库需要检索词".into()); }
    let url = if source == "wikisource" {
        let mut url = Url::parse("https://zh.wikisource.org/w/api.php").map_err(|e| e.to_string())?;
        url.query_pairs_mut()
            .append_pair("action", "query").append_pair("list", "search")
            .append_pair("srsearch", term).append_pair("srnamespace", "0")
            .append_pair("srlimit", "12").append_pair("srprop", "snippet|wordcount")
            .append_pair("format", "json").append_pair("formatversion", "2");
        url
    } else if term.is_empty() {
        Url::parse("https://poetrydb.org/linecount,random/-100;8").map_err(|e| e.to_string())?
    } else {
        let mut url = Url::parse("https://poetrydb.org/lines,linecount,random/").map_err(|e| e.to_string())?;
        url.path_segments_mut().map_err(|_| "英文诗接口地址无效".to_string())?.push(&format!("{term};-100;12"));
        url
    };
    let client = reqwest::Client::builder().timeout(Duration::from_secs(18))
        .user_agent("Poema/0.1 (https://github.com/postgreenHuang/Poema)")
        .build().map_err(|e| e.to_string())?;
    let response = client.get(url.as_str()).send().await.map_err(|e| format!("在线诗源连接失败：{e}"))?;
    if !response.status().is_success() { return Err(format!("在线诗源返回 {}", response.status())); }
    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    if bytes.len() > 1_500_000 { return Err("在线诗源返回过多内容".into()); }
    serde_json::from_slice(&bytes).map_err(|_| "在线诗源响应无法解析".into())
}

#[tauri::command]
async fn read_wikisource_page(page_id: u64) -> Result<Value, String> {
    if page_id == 0 { return Err("作品页面标识无效".into()); }
    let mut url = Url::parse("https://zh.wikisource.org/w/api.php").map_err(|e| e.to_string())?;
    url.query_pairs_mut().append_pair("action", "parse").append_pair("pageid", &page_id.to_string())
        .append_pair("prop", "text").append_pair("format", "json").append_pair("formatversion", "2");
    let client = reqwest::Client::builder().timeout(Duration::from_secs(20))
        .user_agent("Poema/0.1 (https://github.com/postgreenHuang/Poema)")
        .build().map_err(|e| e.to_string())?;
    let response = client.get(url).send().await.map_err(|e| format!("读取维基文库页面失败：{e}"))?;
    if !response.status().is_success() { return Err(format!("维基文库返回 {}", response.status())); }
    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    if bytes.len() > 2_000_000 { return Err("来源页面过长，暂不支持站内预览".into()); }
    serde_json::from_slice(&bytes).map_err(|_| "来源页面无法解析".into())
}

#[tauri::command]
fn open_external(url: String, app: tauri::AppHandle) -> Result<(), String> {
    let parsed = Url::parse(&url).map_err(|_| "来源链接无效".to_string())?;
    if parsed.scheme() != "https" || !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("仅允许打开 HTTPS 来源链接".into());
    }
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}

fn sync_dir(folder: &str) -> Result<PathBuf, String> {
    if folder.trim().is_empty() { return Err("请先选择坚果云在本机的同步文件夹".into()); }
    let base = PathBuf::from(folder.trim()).canonicalize().map_err(|_| "同步文件夹不存在，请先在坚果云客户端同步到本机".to_string())?;
    if !base.is_dir() { return Err("同步路径不是文件夹".into()); }
    Ok(base.join("Poema").join("devices"))
}

fn valid_device_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
}

#[tauri::command]
fn read_sync_snapshots(folder: String) -> Result<Value, String> {
    let dir = sync_dir(&folder)?;
    if !dir.exists() { return Ok(serde_json::json!({ "snapshots": [], "skipped": 0 })); }
    let mut snapshots = Vec::new();
    let mut skipped = 0;
    for entry in fs::read_dir(dir).map_err(|e| format!("读取同步目录失败：{e}"))? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if path.extension().and_then(|x| x.to_str()) != Some("json") { continue; }
        if !name.strip_suffix(".json").is_some_and(valid_device_id) || !entry.file_type().map_err(|e| e.to_string())?.is_file() {
            skipped += 1; continue;
        }
        let metadata = entry.metadata().map_err(|e| e.to_string())?;
        if metadata.len() > 10_000_000 || snapshots.len() >= 64 { skipped += 1; continue; }
        match fs::read(&path).ok().and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok()) {
            Some(value) if value.is_object() && value.get("version").and_then(Value::as_u64) == Some(1) => snapshots.push(value),
            _ => skipped += 1,
        }
    }
    Ok(serde_json::json!({ "snapshots": snapshots, "skipped": skipped }))
}

#[tauri::command]
fn write_sync_snapshot(folder: String, device_id: String, payload: Value) -> Result<(), String> {
    if !valid_device_id(&device_id) { return Err("设备标识无效".into()); }
    if payload.get("version").and_then(Value::as_u64) != Some(1) { return Err("诗笺数据版本不兼容".into()); }
    let bytes = serde_json::to_vec(&payload).map_err(|e| e.to_string())?;
    if bytes.len() > 10_000_000 { return Err("诗笺数据过大，请先导出备份".into()); }
    let dir = sync_dir(&folder)?;
    fs::create_dir_all(&dir).map_err(|e| format!("创建同步目录失败：{e}"))?;
    let target = dir.join(format!("{device_id}.json"));
    let temporary = dir.join(format!("{device_id}.tmp"));
    let backup = dir.join(format!("{device_id}.bak"));
    fs::write(&temporary, bytes).map_err(|e| format!("写入同步临时文件失败：{e}"))?;
    if target.exists() {
        fs::copy(&target, &backup).map_err(|e| format!("备份同步文件失败：{e}"))?;
        fs::remove_file(&target).map_err(|e| format!("替换同步文件失败：{e}"))?;
    }
    if let Err(error) = fs::rename(&temporary, &target) {
        if backup.exists() && !target.exists() { let _ = fs::copy(&backup, &target); }
        return Err(format!("保存同步文件失败：{error}"));
    }
    if backup.exists() { let _ = fs::remove_file(backup); }
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![save_api_key, has_api_key, ai_chat, search_public_source, read_wikisource_page, open_external, read_sync_snapshots, write_sync_snapshot])
        .run(tauri::generate_context!())
        .expect("Poema 启动失败");
}
