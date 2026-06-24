// OpenRouter integration living in the Rust backend so the API key never reaches
// the frontend bundle. The key is resolved from (in priority order):
//   1. the saved settings file in the app config dir (written from the UI)
//   2. the OPENROUTER_API_KEY environment variable (loaded from .env in dev)

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{ipc::Channel, AppHandle, Manager};

const DEFAULT_MODEL: &str = "anthropic/claude-sonnet-4.6";

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

/// Token + cost usage returned by OpenRouter (cost requires `usage.include`).
#[derive(Serialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    pub prompt_tokens: u64,
    pub completion_tokens: u64,
    pub total_tokens: u64,
    pub cost: f64,
}

fn extract_usage(json: &serde_json::Value) -> Usage {
    let u = &json["usage"];
    Usage {
        prompt_tokens: u["prompt_tokens"].as_u64().unwrap_or(0),
        completion_tokens: u["completion_tokens"].as_u64().unwrap_or(0),
        total_tokens: u["total_tokens"].as_u64().unwrap_or(0),
        cost: u["cost"].as_f64().unwrap_or(0.0),
    }
}

#[derive(Serialize, Deserialize, Default)]
struct Settings {
    api_key: Option<String>,
    model: Option<String>,
    /// Cheap model used for the recurrent-depth thinking/reflection phases.
    thinking_model: Option<String>,
    /// High-performance model used for the final synthesis phase.
    synthesis_model: Option<String>,
    /// OpenAI-compatible API base URL (e.g. Ollama: http://localhost:11434/v1).
    /// Empty/unset → OpenRouter.
    base_url: Option<String>,
}

/// OpenAI-compatible base URL when none is configured.
const DEFAULT_BASE: &str = "https://openrouter.ai/api/v1";

fn resolve_base(app: &AppHandle) -> String {
    load_settings(app)
        .base_url
        .filter(|b| !b.trim().is_empty())
        .map(|b| b.trim().trim_end_matches('/').to_string())
        .unwrap_or_else(|| DEFAULT_BASE.to_string())
}

fn is_default_base(base: &str) -> bool {
    base.starts_with("https://openrouter.ai")
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
    /// True when the user has explicitly chosen a default model (not the fallback).
    pub model_configured: bool,
    /// "config" | "env" | "none" — where the active key comes from.
    pub key_source: String,
    /// Empty string if unset (falls back to `model`).
    pub thinking_model: String,
    pub synthesis_model: String,
    /// Configured API base URL (empty = OpenRouter default).
    pub base_url: String,
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
        model_configured: cfg.model.as_deref().is_some_and(|m| !m.trim().is_empty()),
        key_source: key_source.to_string(),
        thinking_model: cfg.thinking_model.unwrap_or_default(),
        synthesis_model: cfg.synthesis_model.unwrap_or_default(),
        base_url: cfg.base_url.unwrap_or_default(),
    }
}

#[tauri::command]
pub fn save_settings(
    app: AppHandle,
    api_key: Option<String>,
    model: Option<String>,
    thinking_model: Option<String>,
    synthesis_model: Option<String>,
    base_url: Option<String>,
) -> Result<(), String> {
    let mut cfg = load_settings(&app);
    if let Some(k) = api_key {
        cfg.api_key = if k.trim().is_empty() { None } else { Some(k) };
    }
    if let Some(m) = model {
        cfg.model = if m.trim().is_empty() { None } else { Some(m) };
    }
    if let Some(m) = thinking_model {
        cfg.thinking_model = if m.trim().is_empty() { None } else { Some(m) };
    }
    if let Some(m) = synthesis_model {
        cfg.synthesis_model = if m.trim().is_empty() { None } else { Some(m) };
    }
    if let Some(b) = base_url {
        cfg.base_url = if b.trim().is_empty() { None } else { Some(b) };
    }
    let path = config_path(&app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(&cfg).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub id: String,
    pub name: String,
    /// USD per prompt (input) token. 0 when unknown/free.
    pub prompt_price: f64,
    /// USD per completion (output) token. 0 when unknown/free.
    pub completion_price: f64,
    /// Context window in tokens. 0 when unknown.
    pub context_length: u64,
    /// Whether the model advertises function/tool calling support.
    pub supports_tools: bool,
    /// Artificial Analysis indices when OpenRouter exposes them (else null).
    pub intelligence_index: Option<f64>,
    pub coding_index: Option<f64>,
}

/// Fetch the list of models currently available on OpenRouter so the picker is
/// always up to date (no hardcoded list to maintain). This endpoint is public.
#[tauri::command]
pub async fn list_models(app: AppHandle) -> Result<Vec<ModelInfo>, String> {
    let base = resolve_base(&app);
    let key = resolve_key(&app);
    let client = reqwest::Client::new();
    let mut req = client
        .get(format!("{base}/models"))
        .header("HTTP-Referer", "http://localhost")
        .header("X-Title", "lokicode");
    if let Some(k) = &key {
        req = req.bearer_auth(k);
    }
    let resp = req
        .send()
        .await
        .map_err(|e| format!("通信エラー: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("モデル一覧の取得に失敗 (HTTP {})", resp.status()));
    }

    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let mut models: Vec<ModelInfo> = json["data"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|m| {
                    let id = m["id"].as_str()?.to_string();
                    let name = m["name"].as_str().unwrap_or(&id).to_string();
                    // Pricing: a real value >= 0 is used as-is (0 = genuinely
                    // free). Variable/router models (e.g. openrouter/fusion)
                    // report "-1"; missing/unparseable is unknown. Both map to
                    // -1.0, a sentinel the UI shows as "変動" (not "無料").
                    let price = |k: &str| match m["pricing"][k]
                        .as_str()
                        .and_then(|s| s.parse::<f64>().ok())
                    {
                        Some(v) if v.is_finite() && v >= 0.0 => v,
                        _ => -1.0,
                    };
                    let supports_tools = m["supported_parameters"]
                        .as_array()
                        .map(|a| a.iter().any(|v| v.as_str() == Some("tools")))
                        .unwrap_or(false);
                    // Defensive: only present if OpenRouter actually exposes it.
                    let bench = &m["benchmarks"]["artificial_analysis"];
                    Some(ModelInfo {
                        id,
                        name,
                        prompt_price: price("prompt"),
                        completion_price: price("completion"),
                        context_length: m["context_length"].as_u64().unwrap_or(0),
                        supports_tools,
                        intelligence_index: bench["intelligence_index"].as_f64(),
                        coding_index: bench["coding_index"].as_f64(),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    models.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(models)
}

/// Plain non-streaming completion with an explicit model override. Used by the
/// recurrent-depth reasoning core (draft / reflection / synthesis phases), each of
/// which may run on a different model (cost-efficient routing).
#[tauri::command]
pub async fn complete(
    app: AppHandle,
    messages: serde_json::Value,
    model: Option<String>,
) -> Result<CompleteResult, String> {
    let base = resolve_base(&app);
    let key = resolve_key(&app);
    if key.is_none() && is_default_base(&base) {
        return Err("APIキーが未設定です。右上の設定からキーを入力してください。".to_string());
    }
    let model = model
        .filter(|m| !m.trim().is_empty())
        .unwrap_or_else(|| resolve_model(&app));

    let body = serde_json::json!({
        "model": model,
        "messages": messages,
        "usage": { "include": true },
    });

    let client = reqwest::Client::new();
    let mut req = client
        .post(format!("{base}/chat/completions"))
        .header("HTTP-Referer", "http://localhost")
        .header("X-Title", "lokicode")
        .json(&body);
    if let Some(k) = &key {
        req = req.bearer_auth(k);
    }
    let resp = req.send().await.map_err(|e| format!("通信エラー: {e}"))?;

    let status = resp.status();
    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        let detail = json["error"]["message"].as_str().unwrap_or("unknown error");
        return Err(format!("API エラー (HTTP {status}): {detail}"));
    }
    Ok(CompleteResult {
        content: json["choices"][0]["message"]["content"]
            .as_str()
            .unwrap_or("")
            .to_string(),
        usage: extract_usage(&json),
    })
}

#[derive(Serialize)]
pub struct CompleteResult {
    content: String,
    usage: Usage,
}

/// One non-streaming completion that supports tool calling. Returns the raw
/// assistant message (which may contain `content` and/or `tool_calls`). The agent
/// loop on the frontend drives the multi-step tool use.
#[tauri::command]
pub async fn chat_once(
    app: AppHandle,
    messages: serde_json::Value,
    tools: serde_json::Value,
    model: Option<String>,
) -> Result<ChatOnceResult, String> {
    let base = resolve_base(&app);
    let key = resolve_key(&app);
    if key.is_none() && is_default_base(&base) {
        return Err("APIキーが未設定です。右上の設定からキーを入力してください。".to_string());
    }
    let model = model
        .filter(|m| !m.trim().is_empty())
        .unwrap_or_else(|| resolve_model(&app));

    let mut body = serde_json::json!({
        "model": model,
        "messages": messages,
        "usage": { "include": true },
    });
    if tools.as_array().is_some_and(|a| !a.is_empty()) {
        body["tools"] = tools;
        body["tool_choice"] = serde_json::json!("auto");
    }

    let client = reqwest::Client::new();
    let mut req = client
        .post(format!("{base}/chat/completions"))
        .header("HTTP-Referer", "http://localhost")
        .header("X-Title", "lokicode")
        .json(&body);
    if let Some(k) = &key {
        req = req.bearer_auth(k);
    }
    let resp = req.send().await.map_err(|e| format!("通信エラー: {e}"))?;

    let status = resp.status();
    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        let detail = json["error"]["message"].as_str().unwrap_or("unknown error");
        return Err(format!("API エラー (HTTP {status}): {detail}"));
    }
    Ok(ChatOnceResult {
        message: json["choices"][0]["message"].clone(),
        usage: extract_usage(&json),
    })
}

#[derive(Serialize)]
pub struct ChatOnceResult {
    message: serde_json::Value,
    usage: Usage,
}

/// Streamed agent turn: text deltas arrive live; the assembled assistant message
/// (content + tool_calls) and usage are delivered in the final `Done` event.
#[derive(Serialize, Clone)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum AgentStreamEvent {
    Delta { content: String },
    Done { message: serde_json::Value, usage: Usage },
    Error { message: String },
}

/// Like `chat_once` but streams assistant text as it is generated. Tool calls are
/// accumulated from the stream and returned whole in the `Done` event.
#[tauri::command]
pub async fn chat_once_stream(
    app: AppHandle,
    messages: serde_json::Value,
    tools: serde_json::Value,
    model: Option<String>,
    on_event: Channel<AgentStreamEvent>,
) -> Result<(), String> {
    let base = resolve_base(&app);
    let key = resolve_key(&app);
    if key.is_none() && is_default_base(&base) {
        let msg = "APIキーが未設定です。右上の設定からキーを入力してください。".to_string();
        let _ = on_event.send(AgentStreamEvent::Error { message: msg.clone() });
        return Err(msg);
    }
    let model = model
        .filter(|m| !m.trim().is_empty())
        .unwrap_or_else(|| resolve_model(&app));

    let mut body = serde_json::json!({
        "model": model,
        "messages": messages,
        "stream": true,
        "usage": { "include": true },
        "stream_options": { "include_usage": true },
    });
    if tools.as_array().is_some_and(|a| !a.is_empty()) {
        body["tools"] = tools;
        body["tool_choice"] = serde_json::json!("auto");
    }

    let client = reqwest::Client::new();
    let mut req = client
        .post(format!("{base}/chat/completions"))
        .header("HTTP-Referer", "http://localhost")
        .header("X-Title", "lokicode")
        .json(&body);
    if let Some(k) = &key {
        req = req.bearer_auth(k);
    }
    let resp = req.send().await.map_err(|e| format!("通信エラー: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        let msg = format!("API エラー (HTTP {status}): {text}");
        let _ = on_event.send(AgentStreamEvent::Error { message: msg.clone() });
        return Err(msg);
    }

    let mut stream = resp.bytes_stream();
    let mut buffer = String::new();
    let mut content = String::new();
    // Accumulate tool calls by their stream index.
    let mut tool_calls: Vec<ToolCallAcc> = Vec::new();
    let mut usage = Usage::default();

    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|e| e.to_string())?;
        buffer.push_str(&String::from_utf8_lossy(&bytes));

        while let Some(newline) = buffer.find('\n') {
            let line: String = buffer.drain(..=newline).collect();
            let line = line.trim();
            if line.is_empty() || line.starts_with(':') {
                continue;
            }
            let Some(data) = line.strip_prefix("data:") else {
                continue;
            };
            let data = data.trim();
            if data == "[DONE]" {
                let message = assemble_message(&content, &tool_calls);
                let _ = on_event.send(AgentStreamEvent::Done { message, usage });
                return Ok(());
            }
            let Ok(json) = serde_json::from_str::<serde_json::Value>(data) else {
                continue;
            };
            if json.get("usage").is_some() {
                usage = extract_usage(&json);
            }
            let delta = &json["choices"][0]["delta"];
            if let Some(text) = delta["content"].as_str() {
                if !text.is_empty() {
                    content.push_str(text);
                    let _ = on_event.send(AgentStreamEvent::Delta {
                        content: text.to_string(),
                    });
                }
            }
            if let Some(calls) = delta["tool_calls"].as_array() {
                for tc in calls {
                    let idx = tc["index"].as_u64().unwrap_or(0) as usize;
                    while tool_calls.len() <= idx {
                        tool_calls.push(ToolCallAcc::default());
                    }
                    let slot = &mut tool_calls[idx];
                    if let Some(id) = tc["id"].as_str() {
                        slot.id = id.to_string();
                    }
                    if let Some(name) = tc["function"]["name"].as_str() {
                        slot.name.push_str(name);
                    }
                    if let Some(args) = tc["function"]["arguments"].as_str() {
                        slot.arguments.push_str(args);
                    }
                }
            }
        }
    }

    // Stream ended without an explicit [DONE].
    let message = assemble_message(&content, &tool_calls);
    let _ = on_event.send(AgentStreamEvent::Done { message, usage });
    Ok(())
}

#[derive(Default)]
struct ToolCallAcc {
    id: String,
    name: String,
    arguments: String,
}

fn assemble_message(content: &str, tool_calls: &[ToolCallAcc]) -> serde_json::Value {
    let mut msg = serde_json::json!({ "role": "assistant" });
    msg["content"] = if content.is_empty() {
        serde_json::Value::Null
    } else {
        serde_json::Value::String(content.to_string())
    };
    if !tool_calls.is_empty() {
        let calls: Vec<serde_json::Value> = tool_calls
            .iter()
            .filter(|c| !c.name.is_empty())
            .map(|c| {
                serde_json::json!({
                    "id": c.id,
                    "type": "function",
                    "function": { "name": c.name, "arguments": c.arguments },
                })
            })
            .collect();
        if !calls.is_empty() {
            msg["tool_calls"] = serde_json::Value::Array(calls);
        }
    }
    msg
}

#[tauri::command]
pub async fn send_chat(
    app: AppHandle,
    messages: Vec<ChatMessage>,
    on_event: Channel<StreamEvent>,
) -> Result<(), String> {
    let base = resolve_base(&app);
    let key = resolve_key(&app);
    if key.is_none() && is_default_base(&base) {
        let msg = "APIキーが未設定です。右上の設定からキーを入力してください。".to_string();
        let _ = on_event.send(StreamEvent::Error { message: msg.clone() });
        return Err(msg);
    }
    let model = resolve_model(&app);

    let body = serde_json::json!({
        "model": model,
        "messages": messages,
        "stream": true,
    });

    let client = reqwest::Client::new();
    let mut req = client
        .post(format!("{base}/chat/completions"))
        .header("HTTP-Referer", "http://localhost")
        .header("X-Title", "lokicode")
        .json(&body);
    if let Some(k) = &key {
        req = req.bearer_auth(k);
    }
    let resp = req.send().await.map_err(|e| format!("通信エラー: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        let msg = format!("API エラー (HTTP {status}): {text}");
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
