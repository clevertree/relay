#![cfg_attr(all(not(debug_assertions), target_os = "windows"), windows_subsystem = "windows")]

use std::collections::HashMap;
use std::sync::Arc;
use tauri::{Manager, State};
use tauri::ShellExt;
use streaming_files::{StreamingService, TorrentFile, TorrentStatus, AddResult, PlayDecision, StreamingError};
use tauri_plugin_dialog::DialogExt;
use serde_json::Value as JsonValue;

struct AppState {
    service: tokio::sync::Mutex<StreamingService>,
    // cancellation flags for resume-wait operations, keyed by "<info_hash>#<file_index>"
    resume_flags: tokio::sync::Mutex<HashMap<String, std::sync::Arc<std::sync::atomic::AtomicBool>>>,
}

impl AppState {
    fn new_blocking() -> Self {
        // Fallback constructor; we'll try to auto-select backend asynchronously after startup
        let svc = StreamingService::new().unwrap_or_else(|_| {
            // As a last resort, still create a default service (may use NullClient)
            StreamingService::new().expect("streaming service")
        });
        Self {
            service: tokio::sync::Mutex::new(svc),
            resume_flags: tokio::sync::Mutex::new(HashMap::new()),
        }
    }
}

// Minimal UiPrompt implementation using native dialogs
struct TauriUiPrompt<'a> {
    app: &'a tauri::AppHandle,
}

#[async_trait::async_trait]
impl<'a> streaming_files::ui::UiPrompt for TauriUiPrompt<'a> {
    async fn pick_download_dir(&self, suggested: Option<&str>) -> Result<Option<String>, StreamingError> {
        let mut builder = self.app.dialog().file().pick_folder();
        if let Some(s) = suggested {
            builder = builder.default_path(s);
        }
        let sel = builder.await;
        Ok(sel.map(|p| p.to_string_lossy().to_string()))
    }

    async fn confirm_play(&self, title: &str, file_path: &str, _size_bytes: u64) -> Result<streaming_files::ui::PlayConfirm, StreamingError> {
        // Basic confirm dialog; Tauri v2 dialog plugin supports checkbox via custom dialog UIs, but here we emulate:
        // Show a Yes/No and default remember=false; the UI can toggle auto-play via settings separately.
        let message = format!("Play '{}' now?\nFile: {}\nPlayback may start before download completes.", title, file_path);
        let confirm = self.app.dialog().message(message).title("Confirm playback").kind(tauri_plugin_dialog::MessageDialogKind::Info).buttons(tauri_plugin_dialog::MessageDialogButtons::OkCancel).show().await;
        let proceed = matches!(confirm, Some(tauri_plugin_dialog::MessageDialogResult::Ok));
        Ok(streaming_files::ui::PlayConfirm { proceed, remember: false })
    }
}

#[tauri::command]
async fn streaming_add_magnet(state: State<'_, AppState>, app: tauri::AppHandle, magnet: String, save_path: Option<String>, seeding: Option<bool>) -> Result<AddResult, String> {
    let mut svc = state.service.lock().await;
    // Ensure download dir exists – prompt if missing
    #[cfg(feature = "client")]
    {
        let ui = TauriUiPrompt { app: &app };
        if svc.config().download_dir.is_none() {
            let _ = svc.get_or_prompt_download_dir(&ui).await.map_err(|e| e.to_string())?;
        }
    }
    svc.add_magnet(&magnet, save_path.as_deref(), seeding).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn streaming_status(state: State<'_, AppState>, info_hash_or_magnet: String) -> Result<TorrentStatus, String> {
    let svc = state.service.lock().await;
    svc.get_status(&info_hash_or_magnet).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn streaming_list_files(state: State<'_, AppState>, info_hash: String) -> Result<Vec<TorrentFile>, String> {
    let svc = state.service.lock().await;
    svc.list_files(&info_hash).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn streaming_set_seeding(state: State<'_, AppState>, info_hash: String, on: bool) -> Result<(), String> {
    let svc = state.service.lock().await;
    svc.set_seeding(&info_hash, on).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn streaming_pick_download_dir(state: State<'_, AppState>, app: tauri::AppHandle) -> Result<String, String> {
    let mut svc = state.service.lock().await;
    let ui = TauriUiPrompt { app: &app };
    let dir = svc.get_or_prompt_download_dir(&ui).await.map_err(|e| e.to_string())?;
    Ok(dir)
}

#[tauri::command]
async fn streaming_request_play(state: State<'_, AppState>, app: tauri::AppHandle, info_hash: String, file_index: Option<usize>) -> Result<PlayDecision, String> {
    let mut svc = state.service.lock().await;
    let ui = TauriUiPrompt { app: &app };
    let decision = svc.request_play(&info_hash, file_index, &ui).await.map_err(|e| e.to_string())?;

    // Auto-open player if allowed and configured
    if decision.allow {
        // read a snapshot of config
        let auto_open = svc.config().auto_open_player_on_allow;
        let target = svc.config().playback_target.clone();
        if auto_open {
            if let Some(path) = &decision.path {
                // Choose playback path based on target
                match target.as_str() {
                    "system" => { let _ = streaming_open_with_system(state, app.clone(), path.clone()).await; },
                    "tauri" => { let _ = streaming_play_path(state, path.clone()).await; },
                    _ => {
                        // auto: prefer tauri videoplayer when compiled, else system
                        #[cfg(feature = "videoplayer")]
                        { let _ = streaming_play_path(state, path.clone()).await; }
                        #[cfg(not(feature = "videoplayer"))]
                        { let _ = streaming_open_with_system(state, app.clone(), path.clone()).await; }
                    }
                }
            }
        }
    }

    Ok(decision)
}

fn key_for_resume(info_hash: &str, file_index: Option<usize>) -> String {
    format!("{}#{}", info_hash, file_index.map(|i| i.to_string()).unwrap_or_else(|| "-".into()))
}

// Helper to compute playability without prompting UI (thresholds only)
async fn is_playable_by_thresholds(svc: &StreamingService, info_hash: &str, file_index: Option<usize>) -> Result<bool, String> {
    // We reuse list_files and the same threshold math as request_play by calling request_play with a no-op UI
    // but request_play triggers confirmation; instead, copy threshold logic inline here via list_files.
    let files = svc.list_files(info_hash).await.map_err(|e| e.to_string())?;
    // pick file: provided index or largest media
    let chosen = if let Some(i) = file_index { files.into_iter().find(|f| f.index == i) } else { files.into_iter().filter(|f| f.is_media).max_by_key(|f| f.length) };
    let file = if let Some(f) = chosen { f } else { return Ok(false); };
    let cfg = svc.config();
    let first_bytes = (cfg.play_min_first_bytes_mb as u64) * 1024 * 1024;
    let min_total_mb = (cfg.play_min_total_mb as u64) * 1024 * 1024;
    let pct_req = cfg.play_min_total_percent as f64 / 100.0;
    let length = file.length;
    let downloaded = file.downloaded.min(length);
    let need_first = std::cmp::min(first_bytes, length);
    let need_percent = ((length as f64) * pct_req).round() as u64;
    let need_total = std::cmp::min(min_total_mb, need_percent.max(0));
    Ok(downloaded >= need_first || downloaded >= need_total)
}

#[tauri::command]
async fn streaming_resume_when_available(state: State<'_, AppState>, info_hash: String, file_index: Option<usize>) -> Result<(), String> {
    // Single-flight per (hash, index)
    let key = key_for_resume(&info_hash, file_index);
    {
        let mut map = state.resume_flags.lock().await;
        if map.contains_key(&key) {
            return Err("already waiting for this hash/file".into());
        }
        map.insert(key.clone(), Arc::new(std::sync::atomic::AtomicBool::new(false)));
    }

    // Borrow config values (interval/timeout)
    let (interval_s, timeout_min) = {
        let svc = state.service.lock().await;
        (svc.config().resume_poll_interval_sec as u64, svc.config().resume_timeout_min as u64)
    };

    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(timeout_min * 60);
    loop {
        // Check cancel flag
        {
            let map = state.resume_flags.lock().await;
            if let Some(flag) = map.get(&key) {
                if flag.load(std::sync::atomic::Ordering::Relaxed) {
                    // remove and exit
                    drop(map);
                    let mut map2 = state.resume_flags.lock().await;
                    map2.remove(&key);
                    return Err("canceled".into());
                }
            } else {
                return Err("no active wait".into());
            }
        }

        // Check playability
        {
            let svc = state.service.lock().await;
            if is_playable_by_thresholds(&*svc, &info_hash, file_index).await? {
                // remove and resolve
                drop(svc);
                let mut map = state.resume_flags.lock().await;
                map.remove(&key);
                return Ok(());
            }
        }

        if std::time::Instant::now() >= deadline {
            let mut map = state.resume_flags.lock().await;
            map.remove(&key);
            return Err("timeout".into());
        }
        tauri::async_runtime::sleep(std::time::Duration::from_secs(interval_s.max(1))).await;
    }
}

#[tauri::command]
async fn streaming_cancel_resume(state: State<'_, AppState>, info_hash: String, file_index: Option<usize>) -> Result<(), String> {
    let key = key_for_resume(&info_hash, file_index);
    let mut map = state.resume_flags.lock().await;
    if let Some(flag) = map.get(&key) {
        flag.store(true, std::sync::atomic::Ordering::Relaxed);
        Ok(())
    } else {
        Err("no active wait".into())
    }
}

#[tauri::command]
async fn streaming_play_path(_state: State<'_, AppState>, path: String) -> Result<(), String> {
    use std::path::Path;
    if !Path::new(&path).exists() {
        return Err("file not found".into());
    }
    #[cfg(feature = "videoplayer")]
    {
        // TODO: Integrate with tauri-plugin-videoplayer when available.
        // For now, succeed to unblock flow; real player wiring will be added in next steps.
        return Ok(());
    }
    #[cfg(not(feature = "videoplayer"))]
    {
        Err("videoplayer not available (build without 'videoplayer' feature)".into())
    }
}

#[tauri::command]
async fn streaming_open_with_system(_state: State<'_, AppState>, app: tauri::AppHandle, path: String) -> Result<(), String> {
    use std::path::Path;
    if !Path::new(&path).exists() {
        return Err("file not found".into());
    }
    app.shell().open(path, None).map_err(|e| e.to_string())
}

// === Day 2: Config get/set and backend refresh ===
#[tauri::command]
async fn streaming_get_config(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let svc = state.service.lock().await;
    serde_json::to_value(svc.get_config()).map_err(|e| e.to_string())
}

#[tauri::command]
async fn streaming_set_config(state: State<'_, AppState>, patch: JsonValue) -> Result<serde_json::Value, String> {
    let mut svc = state.service.lock().await;
    let updated = svc.apply_config_patch(patch).map_err(|e| e.to_string())?;
    serde_json::to_value(updated).map_err(|e| e.to_string())
}

#[tauri::command]
async fn streaming_refresh_backend(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let mut svc = state.service.lock().await;
    // Try to refresh; ignore error for active name, but surface error to caller
    match svc.refresh_backend().await {
        Ok(()) => {
            let name = svc.active_backend_name();
            Ok(serde_json::json!({ "active": name }))
        },
        Err(e) => {
            let name = svc.active_backend_name();
            Ok(serde_json::json!({ "active": name, "error": e.to_string() }))
        }
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        // Videoplayer plugin is optional; enable with --features videoplayer
        // to avoid build break if the plugin isn't present.
        #[cfg(feature = "videoplayer")]
        .plugin(tauri_plugin_videoplayer::init())
        // Videoplayer plugin is optional; gate with feature to avoid build break if missing
        .setup(|app| {
            // Initialize state
            app.manage(AppState::new_blocking());
            // Try to auto-select a healthy backend asynchronously
            let handle = app.handle();
            tauri::async_runtime::spawn(async move {
                if let Some(state) = handle.try_state::<AppState>() {
                    let mut svc = state.service.lock().await;
                    // Try the auto backend creation; if it fails, keep current and continue
                    match StreamingService::new_auto().await {
                        Ok(new_svc) => { *svc = new_svc; },
                        Err(_e) => { /* keep existing; UI can show errors on command calls */ }
                    }
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            streaming_add_magnet,
            streaming_status,
            streaming_list_files,
            streaming_set_seeding,
            streaming_pick_download_dir,
            streaming_request_play,
            streaming_resume_when_available,
            streaming_cancel_resume,
            streaming_play_path,
            streaming_open_with_system,
            streaming_get_config,
            streaming_set_config,
            streaming_refresh_backend
        ])
        .run();
}
