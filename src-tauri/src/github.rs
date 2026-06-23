// GitHub OAuth Device Flow + account storage. The token lives only in the
// backend config dir (never in the frontend bundle), mirroring the OpenRouter
// key handling. push/pull auth (in git.rs) reads the token via `load_token`.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

// Public (non-secret) OAuth App client id. Replace with the registered app's
// Client ID. Device Flow does not use a client secret.
const GITHUB_CLIENT_ID: &str = "Ov23lig75a8JEoAjQPfO";
const SCOPE: &str = "repo read:user";
const USER_AGENT: &str = "lokicode";

#[derive(Serialize, Deserialize, Default)]
struct GithubSettings {
    token: Option<String>,
    login: Option<String>,
    name: Option<String>,
    avatar_url: Option<String>,
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("github.json"))
}

fn load_settings(app: &AppHandle) -> GithubSettings {
    config_path(app)
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_settings(app: &AppHandle, cfg: &GithubSettings) -> Result<(), String> {
    let path = config_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())
}

/// Token used by git.rs for push/pull HTTPS auth. None when logged out.
pub fn load_token(app: &AppHandle) -> Option<String> {
    load_settings(app)
        .token
        .filter(|t| !t.trim().is_empty())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceCode {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub interval: u64,
    pub expires_in: u64,
    /// True when no OAuth App client id has been configured yet.
    pub not_configured: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubUser {
    pub login: String,
    pub name: String,
    pub avatar_url: String,
}

#[derive(Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum PollResult {
    Pending,
    SlowDown,
    Ok { user: GithubUser },
    Error { message: String },
}

#[tauri::command]
pub async fn github_device_start() -> Result<DeviceCode, String> {
    if GITHUB_CLIENT_ID.starts_with("__") {
        return Ok(DeviceCode {
            device_code: String::new(),
            user_code: String::new(),
            verification_uri: String::new(),
            interval: 5,
            expires_in: 0,
            not_configured: true,
        });
    }
    let client = reqwest::Client::new();
    let resp = client
        .post("https://github.com/login/device/code")
        .header("Accept", "application/json")
        .header("User-Agent", USER_AGENT)
        .form(&[("client_id", GITHUB_CLIENT_ID), ("scope", SCOPE)])
        .send()
        .await
        .map_err(|e| format!("通信エラー: {e}"))?;
    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    if let Some(err) = json["error"].as_str() {
        return Err(err.to_string());
    }
    Ok(DeviceCode {
        device_code: json["device_code"].as_str().unwrap_or("").to_string(),
        user_code: json["user_code"].as_str().unwrap_or("").to_string(),
        verification_uri: json["verification_uri"].as_str().unwrap_or("").to_string(),
        interval: json["interval"].as_u64().unwrap_or(5),
        expires_in: json["expires_in"].as_u64().unwrap_or(900),
        not_configured: false,
    })
}

async fn fetch_user(token: &str) -> Result<GithubUser, String> {
    let client = reqwest::Client::new();
    let resp = client
        .get("https://api.github.com/user")
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", USER_AGENT)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| format!("通信エラー: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("ユーザー情報の取得に失敗 (HTTP {})", resp.status()));
    }
    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    Ok(GithubUser {
        login: json["login"].as_str().unwrap_or("").to_string(),
        name: json["name"].as_str().unwrap_or("").to_string(),
        avatar_url: json["avatar_url"].as_str().unwrap_or("").to_string(),
    })
}

#[tauri::command]
pub async fn github_device_poll(app: AppHandle, device_code: String) -> Result<PollResult, String> {
    let client = reqwest::Client::new();
    let resp = client
        .post("https://github.com/login/oauth/access_token")
        .header("Accept", "application/json")
        .header("User-Agent", USER_AGENT)
        .form(&[
            ("client_id", GITHUB_CLIENT_ID),
            ("device_code", device_code.as_str()),
            ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
        ])
        .send()
        .await
        .map_err(|e| format!("通信エラー: {e}"))?;
    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;

    if let Some(token) = json["access_token"].as_str() {
        let user = fetch_user(token).await?;
        let cfg = GithubSettings {
            token: Some(token.to_string()),
            login: Some(user.login.clone()),
            name: Some(user.name.clone()),
            avatar_url: Some(user.avatar_url.clone()),
        };
        save_settings(&app, &cfg)?;
        return Ok(PollResult::Ok { user });
    }
    match json["error"].as_str() {
        Some("authorization_pending") => Ok(PollResult::Pending),
        Some("slow_down") => Ok(PollResult::SlowDown),
        Some(other) => Ok(PollResult::Error {
            message: other.to_string(),
        }),
        None => Ok(PollResult::Error {
            message: "不明なエラー".to_string(),
        }),
    }
}

#[tauri::command]
pub fn github_user(app: AppHandle) -> Option<GithubUser> {
    let cfg = load_settings(&app);
    let token = cfg.token.filter(|t| !t.trim().is_empty())?;
    let _ = token; // presence indicates logged in
    Some(GithubUser {
        login: cfg.login.unwrap_or_default(),
        name: cfg.name.unwrap_or_default(),
        avatar_url: cfg.avatar_url.unwrap_or_default(),
    })
}

#[tauri::command]
pub fn github_logout(app: AppHandle) -> Result<(), String> {
    save_settings(&app, &GithubSettings::default())
}
