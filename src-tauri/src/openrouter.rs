// OpenRouter integration living in the Rust backend so the API key never reaches
// the frontend bundle. The key is resolved from (in priority order):
//   1. the saved settings file in the app config dir (written from the UI)
//   2. the OPENROUTER_API_KEY environment variable (loaded from .env in dev)

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{ipc::Channel, AppHandle, Manager};

const API_URL: &str = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL: &str = "anthropic/claude-3.5-sonnet";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

/// Streamed back to the frontend over a Tauri Channel.
#[derive(Serialize, Clone)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum StreamEvent {
    Delta { content: String },
    Done,
    Error { message: String },
}

#[derive(Serialize, Deserialize, Default)]
struct Settings {
    api_key: Option<String>,
    model: Option<String>,
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("openrouter.json"))
}

fn load_settings(app: &AppHandle) -> Settings {
    config_path(app)
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn env_key() -> Option<String> {
    std::env::var("OPENROUTER_API_KEY")
        .ok()
        .filter(|k| !k.trim().is_empty())
}

fn resolve_key(app: &AppHandle) -> Option<String> {
    load_settings(app)
        .api_key
        .filter(|k| !k.trim().is_empty())
        .or_else(env_key)
}

fn resolve_model(app: &AppHandle) -> String {
    load_settings(app)
        .model
        .filter(|m| !m.trim().is_empty())
        .or_else(|| std::env::var("OPENROUTER_MODEL").ok())
        .filter(|m| !m.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_MODEL.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsStatus {
    pub has_key: bool,
    pub model: String,
    /// "config" | "env" | "none" — where the active key comes from.
    pub key_source: String,
}

#[tauri::command]
pub fn get_settings(app: AppHandle) -> SettingsStatus {
    let cfg = load_settings(&app);
    let (has_key, key_source) = if cfg.api_key.as_ref().is_some_and(|k| !k.trim().is_empty()) {
        (true, "config")
    } else if env_key().is_some() {
        (true, "env")
    } else {
        (false, "none")
    };
    SettingsStatus {
        has_key,
        model: resolve_model(&app),
        key_source: key_source.to_string(),
    }
}

#[tauri::command]
pub fn save_settings(
    app: AppHandle,
    api_key: Option<String>,
    model: Option<String>,
) -> Result<(), String> {
    let mut cfg = load_settings(&app);
    if let Some(k) = api_key {
        cfg.api_key = if k.trim().is_empty() { None } else { Some(k) };
    }
    if let Some(m) = model {
        cfg.model = if m.trim().is_empty() { None } else { Some(m) };
    }
    let path = config_path(&app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(&cfg).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn send_chat(
    app: AppHandle,
    messages: Vec<ChatMessage>,
    on_event: Channel<StreamEvent>,
) -> Result<(), String> {
    let Some(key) = resolve_key(&app) else {
        let msg = "APIキーが未設定です。右上の設定からキーを入力してください。".to_string();
        let _ = on_event.send(StreamEvent::Error { message: msg.clone() });
        return Err(msg);
    };
    let model = resolve_model(&app);

    let body = serde_json::json!({
        "model": model,
        "messages": messages,
        "stream": true,
    });

    let client = reqwest::Client::new();
    let resp = client
        .post(API_URL)
        .bearer_auth(key)
        .header("HTTP-Referer", "http://localhost")
        .header("X-Title", "lokicode")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("通信エラー: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        let msg = format!("OpenRouter エラー (HTTP {status}): {text}");
        let _ = on_event.send(StreamEvent::Error { message: msg.clone() });
        return Err(msg);
    }

    let mut stream = resp.bytes_stream();
    let mut buffer = String::new();

    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|e| e.to_string())?;
        buffer.push_str(&String::from_utf8_lossy(&bytes));

        // Process complete SSE lines.
        while let Some(newline) = buffer.find('\n') {
            let line: String = buffer.drain(..=newline).collect();
            let line = line.trim();
            if line.is_empty() || line.starts_with(':') {
                continue; // keep-alive comment or blank separator
            }
            let Some(data) = line.strip_prefix("data:") else {
                continue;
            };
            let data = data.trim();
            if data == "[DONE]" {
                let _ = on_event.send(StreamEvent::Done);
                return Ok(());
            }
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(data) {
                if let Some(content) = json["choices"][0]["delta"]["content"].as_str() {
                    if !content.is_empty() {
                        let _ = on_event.send(StreamEvent::Delta {
                            content: content.to_string(),
                        });
                    }
                }
            }
        }
    }

    let _ = on_event.send(StreamEvent::Done);
    Ok(())
}
