use std::collections::HashMap;
use std::fs;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager};

/// Windows Credential Manager target. Keys never land in the webview or on disk.
const SERVICE: &str = "com.emmgg.octo";
const SETTINGS_FILE: &str = "api.json";

#[derive(Clone, Copy)]
pub struct Spec {
    pub id: &'static str,
    pub name: &'static str,
    pub key_url: &'static str,
    pub default_model: &'static str,
    pub presets: &'static [&'static str],
}

pub const PROVIDERS: &[Spec] = &[
    Spec {
        id: "gemini",
        name: "Google Gemini",
        key_url: "https://aistudio.google.com/apikey",
        default_model: "gemini-3.8-flash",
        presets: &[
            "gemini-3.8-flash",
            "gemini-3.6-flash",
            "gemini-3.5-flash-lite",
            "gemini-4-argon",
        ],
    },
    Spec {
        id: "claude",
        name: "Anthropic Claude",
        key_url: "https://console.anthropic.com/settings/keys",
        default_model: "claude-haiku-5.5",
        presets: &[
            "claude-haiku-5.5",
            "claude-sonnet-5.5",
            "claude-opus-5-5",
        ],
    },
    Spec {
        id: "openrouter",
        name: "OpenRouter",
        key_url: "https://openrouter.ai/settings/keys",
        default_model: "anthropic/claude-haiku-5.5",
        presets: &[
            "anthropic/claude-haiku-5.5",
            "anthropic/claude-sonnet-5.5",
            "google/gemini-3.8-flash",
            "openai/gpt-6.1-sol",
        ],
    },
    Spec {
        id: "nvidia",
        name: "NVIDIA NIM",
        key_url: "https://build.nvidia.com/settings/api-keys",
        default_model: "nvidia/llama-3.1-nemotron-70b-instruct",
        presets: &[
            "nvidia/llama-3.1-nemotron-70b-instruct",
            "deepseek-ai/deepseek-v4.1-flash",
            "meta/llama3-chatqa-1.5-70b",
            "z-ai/glm-5.3-flash",
        ],
    },
];

fn spec(id: &str) -> Result<Spec, String> {
    PROVIDERS
        .iter()
        .find(|p| p.id == id)
        .copied()
        .ok_or_else(|| format!("bilinmeyen sağlayıcı: {id}"))
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    active: Option<String>,
    models: HashMap<String, String>,
}

impl Settings {
    fn model_for(&self, provider: &str) -> String {
        self.models.get(provider).cloned().unwrap_or_else(|| {
            spec(provider)
                .map(|s| s.default_model.to_string())
                .unwrap_or_default()
        })
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderInfo {
    id: String,
    name: String,
    key_url: String,
    presets: Vec<String>,
    default_model: String,
    has_key: bool,
    hint: String,
    is_active: bool,
    model: String,
}

fn credential(provider: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, &format!("api-key:{provider}"))
        .map_err(|err| format!("kimlik deposuna erişilemedi: {err}"))
}

fn read_key(provider: &str) -> Option<String> {
    credential(provider)
        .ok()?
        .get_password()
        .ok()
        .filter(|value| !value.is_empty())
}

fn mask(key: &str) -> String {
    let tail: String = key.chars().rev().take(4).collect::<Vec<_>>().into_iter().rev().collect();
    format!("••••{tail}")
}

fn settings_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|err| format!("config dizini bulunamadı: {err}"))?;
    fs::create_dir_all(&dir).map_err(|err| format!("config dizini açılamadı: {err}"))?;
    Ok(dir.join(SETTINGS_FILE))
}

fn load_settings(app: &AppHandle) -> Settings {
    settings_path(app)
        .ok()
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn save_settings(app: &AppHandle, settings: &Settings) -> Result<(), String> {
    let path = settings_path(app)?;
    let text = serde_json::to_string_pretty(settings).map_err(|err| err.to_string())?;
    fs::write(path, text).map_err(|err| format!("ayarlar kaydedilemedi: {err}"))
}

fn provider_list(app: &AppHandle) -> Vec<ProviderInfo> {
    let settings = load_settings(app);
    PROVIDERS
        .iter()
        .map(|provider| {
            let key = read_key(provider.id);
            ProviderInfo {
                id: provider.id.into(),
                name: provider.name.into(),
                key_url: provider.key_url.into(),
                presets: provider.presets.iter().map(|id| (*id).to_string()).collect(),
                default_model: provider.default_model.into(),
                model: settings.model_for(provider.id),
                has_key: key.is_some(),
                hint: key.as_deref().map(mask).unwrap_or_default(),
                is_active: settings.active.as_deref() == Some(provider.id),
            }
        })
        .collect()
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Probe {
    ok: bool,
    message: String,
    latency_ms: u64,
}

fn agent() -> ureq::Agent {
    ureq::config::Config::builder()
        .timeout_global(Some(Duration::from_secs(15)))
        .build()
        .new_agent()
}

/// Non-2xx arrives back as a status code instead of an error, so the UI can name the reason.
fn finish(result: Result<http::Response<ureq::Body>, ureq::Error>) -> Result<(u16, Value), String> {
    match result {
        Ok(mut response) => {
            let status = response.status().as_u16();
            let text = response
                .body_mut()
                .read_to_string()
                .map_err(|err| format!("{err}"))?;
            Ok((status, serde_json::from_str(&text).unwrap_or_default()))
        }
        Err(ureq::Error::StatusCode(code)) => Ok((code, Value::Null)),
        Err(err) => Err(format!("{err}")),
    }
}

fn get(url: &str, headers: &[(&str, &str)]) -> Result<(u16, Value), String> {
    let mut request = agent().get(url);
    for (name, value) in headers {
        request = request.header(*name, *value);
    }
    finish(request.call())
}

fn post(url: &str, headers: &[(&str, &str)], body: &Value) -> Result<(u16, Value), String> {
    let mut request = agent().post(url);
    for (name, value) in headers {
        request = request.header(*name, *value);
    }
    finish(request.send_json(body))
}

fn error_text(value: &Value) -> Option<String> {
    value
        .get("error")
        .and_then(|error| error.get("message").or_else(|| error.get("type")))
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn fail(status: u16, provider: &str, value: &Value) -> String {
    match error_text(value) {
        Some(text) => text,
        None => format!("{status} — {}", describe(status, provider)),
    }
}

/// Cheap authenticated round-trip that proves the key works without spending tokens.
fn probe_blocking(provider: &str, key: &str, model: &str) -> Result<u16, String> {
    let bearer = format!("Bearer {key}");
    let status = match provider {
        "gemini" => get(
            &format!("https://generativelanguage.googleapis.com/v1beta/models?key={key}&pageSize=1"),
            &[],
        )?
        .0,
        "claude" => get(
            "https://api.anthropic.com/v1/models",
            &[("x-api-key", key), ("anthropic-version", "2023-06-01")],
        )?
        .0,
        "openrouter" => get("https://openrouter.ai/api/v1/key", &[("authorization", &bearer)])?.0,
        "nvidia" => {
            let body = serde_json::json!({
                "model": model,
                "messages": [{ "role": "user", "content": "ping" }],
                "max_tokens": 1,
            });
            post(NVIDIA_CHAT, &[("authorization", bearer.as_str())], &body)?.0
        }
        other => return Err(format!("bilinmeyen sağlayıcı: {other}")),
    };
    Ok(status)
}

fn describe(status: u16, provider: &str) -> String {
    match status {
        200..=299 => "Bağlantı tamam".into(),
        // Gemini answers an invalid key with 400, the others with 401/403.
        400 | 401 | 403 => "Anahtar reddedildi".into(),
        404 if provider == "nvidia" => "Anahtar geçerli, model bulunamadı".into(),
        429 => "İstek limiti aşıldı".into(),
        other => format!("Sunucu {other} döndürdü"),
    }
}

/// Model ids straight from the provider, so the list is never stale.
fn list_models(provider: &str, key: &str) -> Result<Vec<String>, String> {
    let bearer = format!("Bearer {key}");
    let (status, value) = match provider {
        "gemini" => get(
            &format!("https://generativelanguage.googleapis.com/v1beta/models?key={key}"),
            &[],
        )?,
        "claude" => get(
            "https://api.anthropic.com/v1/models",
            &[("x-api-key", key), ("anthropic-version", "2023-06-01")],
        )?,
        "openrouter" => get("https://openrouter.ai/api/v1/models", &[("authorization", &bearer)])?,
        "nvidia" => get("https://integrate.api.nvidia.com/v1/models", &[("authorization", &bearer)])?,
        other => return Err(format!("bilinmeyen sağlayıcı: {other}")),
    };

    if !(200..=299).contains(&status) {
        return Err(format!("sağlayıcı {status} döndürdü"));
    }

    let mut ids: Vec<String> = value
        .get("data")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    item.get("id")
                        .or_else(|| item.get("name"))
                        .and_then(Value::as_str)
                        .map(|id| id.trim_start_matches("models/").to_string())
                })
                .collect()
        })
        .unwrap_or_default();

    ids.sort();
    ids.dedup();
    ids.truncate(150);
    Ok(ids)
}

#[tauri::command]
pub fn api_providers(app: AppHandle) -> Vec<ProviderInfo> {
    provider_list(&app)
}

#[tauri::command]
pub fn api_save_key(app: AppHandle, provider: String, key: String) -> Result<Vec<ProviderInfo>, String> {
    let provider = spec(&provider)?.id;
    let key = key.trim();
    if key.is_empty() {
        return Err("Boş anahtar kaydedilemez".into());
    }
    credential(provider)?
        .set_password(key)
        .map_err(|err| format!("anahtar kaydedilemedi: {err}"))?;

    // Read it straight back: a store that silently drops the write must not look like success.
    let back = credential(provider)?
        .get_password()
        .map_err(|err| format!("kayıt sonrası kasadan okunamadı: {err}"))?;
    if back != key {
        return Err("Kayıt sonrası kasadan farklı bir değer okundu".into());
    }

    Ok(provider_list(&app))
}

#[tauri::command]
pub fn api_clear_key(app: AppHandle, provider: String) -> Result<Vec<ProviderInfo>, String> {
    let provider = spec(&provider)?.id;
    match credential(provider)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(provider_list(&app)),
        Err(err) => Err(format!("anahtar silinemedi: {err}")),
    }
}

#[tauri::command]
pub fn api_select(
    app: AppHandle,
    provider: Option<String>,
    model: Option<String>,
) -> Result<Vec<ProviderInfo>, String> {
    let mut settings = load_settings(&app);

    if let Some(id) = provider {
        settings.active = Some(spec(&id)?.id.to_string());
    }
    if let Some(model) = model.map(|value| value.trim().to_string()).filter(|value| !value.is_empty()) {
        let id = settings
            .active
            .clone()
            .ok_or_else(|| "önce bir sağlayıcı seç".to_string())?;
        settings.models.insert(id, model);
    }

    save_settings(&app, &settings)?;
    Ok(provider_list(&app))
}

#[tauri::command]
pub async fn api_test(app: AppHandle, provider: String) -> Result<Probe, String> {
    let spec = spec(&provider)?;
    let key = read_key(spec.id).ok_or_else(|| "Bu sağlayıcı için kayıtlı anahtar yok".to_string())?;
    let model = load_settings(&app).model_for(spec.id);

    let started = std::time::Instant::now();
    let status = tauri::async_runtime::spawn_blocking(move || probe_blocking(spec.id, &key, &model))
        .await
        .map_err(|err| err.to_string())??;

    Ok(Probe {
        ok: (200..=299).contains(&status),
        message: describe(status, spec.id),
        latency_ms: started.elapsed().as_millis() as u64,
    })
}

#[tauri::command]
pub async fn api_models(provider: String) -> Result<Vec<String>, String> {
    let spec = spec(&provider)?;
    let key = read_key(spec.id).ok_or_else(|| "Bu sağlayıcı için kayıtlı anahtar yok".to_string())?;

    tauri::async_runtime::spawn_blocking(move || list_models(spec.id, &key))
        .await
        .map_err(|err| err.to_string())?
}

#[tauri::command]
pub fn open_key_page(provider: String) -> Result<(), String> {
    let url = spec(&provider)?.key_url;

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let mut command = std::process::Command::new("explorer");
        command.arg(url).creation_flags(0x0800_0000);
        let _ = command.spawn();
    }
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open").arg(url).spawn();
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let _ = std::process::Command::new("xdg-open").arg(url).spawn();
    }

    Ok(())
}

const NVIDIA_CHAT: &str = "https://integrate.api.nvidia.com/v1/chat/completions";
const OPENROUTER_CHAT: &str = "https://openrouter.ai/api/v1/chat/completions";

const PERSONA: &str = concat!(
    "Sen Octo'sun: ekranın üst kenarında asılı duran, pixel-art bir ahtapot evcil hayvanısın. ",
    "Sekiz kolun var; Ctrl+Q'ye basılınca en yakın kolun fareye uzanır, yetişemeyince kolundan ",
    "halatlı kanca fırlatır. Altında yazı varsa kendini kenara çeker. ",
    "Kullanıcıyla Türkçe konuşursun. En fazla iki kısa cümle yaz, markdown ve madde işareti kullanma. ",
    "Meraklı, biraz yaramaz, sıcak bir tonun var; kendi bedenin ve kolların hakkında konuşmayı seversin."
);

#[derive(Clone, Deserialize)]
pub struct Turn {
    role: String,
    text: String,
}

impl Turn {
    fn is_user(&self) -> bool {
        self.role == "user"
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Answer {
    text: String,
    provider: String,
    model: String,
    latency_ms: u64,
}

fn texts(items: &[Value], keys: &[&str]) -> Option<String> {
    let joined = items
        .iter()
        .filter_map(|item| {
            keys.iter()
                .filter_map(|key| item.get(*key).and_then(Value::as_str))
                .next()
        })
        .collect::<Vec<_>>()
        .join(" ");
    if joined.trim().is_empty() {
        return None;
    }
    Some(joined.trim().to_string())
}

fn ask(provider: &str, key: &str, model: &str, turns: &[Turn]) -> Result<String, String> {
    let bearer = format!("Bearer {key}");
    let (status, value) = match provider {
        "gemini" => {
            let contents: Vec<Value> = turns
                .iter()
                .map(|turn| {
                    serde_json::json!({
                        "role": if turn.is_user() { "user" } else { "model" },
                        "parts": [{ "text": turn.text }],
                    })
                })
                .collect();
            let body = serde_json::json!({
                "systemInstruction": { "parts": [{ "text": PERSONA }] },
                "contents": contents,
                "generationConfig": { "maxOutputTokens": 220, "temperature": 0.9 },
            });
            post(
                &format!(
                    "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}"
                ),
                &[],
                &body,
            )?
        }
        "claude" => {
            let messages: Vec<Value> = turns
                .iter()
                .map(|turn| {
                    serde_json::json!({
                        "role": if turn.is_user() { "user" } else { "assistant" },
                        "content": [{ "type": "text", "text": turn.text }],
                    })
                })
                .collect();
            let body = serde_json::json!({
                "model": model,
                "max_tokens": 220,
                "system": PERSONA,
                "messages": messages,
            });
            post(
                "https://api.anthropic.com/v1/messages",
                &[
                    ("x-api-key", key),
                    ("anthropic-version", "2023-06-01".into()),
                ],
                &body,
            )?
        }
        other @ ("openrouter" | "nvidia") => {
            let url = if other == "nvidia" { NVIDIA_CHAT } else { OPENROUTER_CHAT };
            let mut messages = vec![serde_json::json!({ "role": "system", "content": PERSONA })];
            messages.extend(turns.iter().map(|turn| {
                serde_json::json!({
                    "role": if turn.is_user() { "user" } else { "assistant" },
                    "content": turn.text,
                })
            }));
            let body = serde_json::json!({ "model": model, "max_tokens": 220, "messages": messages });
            post(url, &[("authorization", bearer.as_str())], &body)?
        }
        unknown => return Err(format!("bilinmeyen sağlayıcı: {unknown}")),
    };

    if !(200..=299).contains(&status) {
        return Err(fail(status, provider, &value));
    }

    let reply = match provider {
        "gemini" => value
            .get("candidates")
            .and_then(Value::as_array)
            .and_then(|list| list.first())
            .and_then(|first| first.get("content"))
            .and_then(|content| content.get("parts"))
            .and_then(Value::as_array)
            .and_then(|parts| texts(parts, &["text"])),
        "claude" => value
            .get("content")
            .and_then(Value::as_array)
            .and_then(|blocks| texts(blocks, &["text"])),
        _ => value
            .get("choices")
            .and_then(Value::as_array)
            .and_then(|list| list.first())
            .and_then(|first| first.get("message"))
            .and_then(|message| message.get("content"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|text| !text.is_empty())
            .map(str::to_string),
    };

    reply.ok_or_else(|| "Model boş bir cevap döndürdü".into())
}

#[tauri::command]
pub fn clipboard_key() -> Result<String, String> {
    let mut clipboard =
        arboard::Clipboard::new().map_err(|err| format!("pano açılamadı: {err}"))?;
    let text = clipboard
        .get_text()
        .map_err(|_| "Panoda metin yok".to_string())?
        .trim()
        .to_string();
    if text.is_empty() {
        return Err("Panoda metin yok".into());
    }
    Ok(text)
}

#[tauri::command]
pub async fn chat_send(app: AppHandle, history: Vec<Turn>) -> Result<Answer, String> {
    let settings = load_settings(&app);
    let id = settings
        .active
        .clone()
        .ok_or_else(|| "Önce API bölümünden bir sağlayıcı seç".to_string())?;
    let name = spec(&id)?.name;
    let key = read_key(&id).ok_or_else(|| format!("{name} için kayıtlı anahtar yok"))?;
    let model = settings.model_for(&id);

    let mut turns: Vec<Turn> = history.into_iter().rev().take(12).collect();
    turns.reverse();
    while turns.first().is_some_and(|turn| !turn.is_user()) {
        turns.remove(0);
    }
    if !turns.last().is_some_and(Turn::is_user) {
        return Err("Son mesaj kullanıcıdan gelmeli".into());
    }

    let started = std::time::Instant::now();
    let request = (id.clone(), key, model.clone(), turns);
    let text = tauri::async_runtime::spawn_blocking(move || {
        let (provider, key, model, turns) = request;
        ask(&provider, &key, &model, &turns)
    })
    .await
    .map_err(|err| err.to_string())??;

    Ok(Answer {
        text,
        provider: id,
        model,
        latency_ms: started.elapsed().as_millis() as u64,
    })
}

