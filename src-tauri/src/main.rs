#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use reqwest::Url;
use serde_json::Value;
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
fn open_external(url: String, app: tauri::AppHandle) -> Result<(), String> {
    let parsed = Url::parse(&url).map_err(|_| "来源链接无效".to_string())?;
    if parsed.scheme() != "https" || !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("仅允许打开 HTTPS 来源链接".into());
    }
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![save_api_key, has_api_key, ai_chat, open_external])
        .run(tauri::generate_context!())
        .expect("Poema 启动失败");
}
