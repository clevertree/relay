// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;
use tauri::Emitter;
use std::process::Command as StdCommand;
use tauri::async_runtime::spawn_blocking;
use serde::Serialize;
use std::path::PathBuf;
// Use relay-repo crate directly for fast, in-process repo initialization
use relay_repo::ops as repo_ops;
use std::fs;
use tracing::{info, warn, error, debug};
use directories::ProjectDirs;
use std::io::Write;
use serde::{Deserialize};
use std::time::{SystemTime, UNIX_EPOCH};

fn main() {
  // Build and run the tauri app. We'll redirect the main webview to the
  // FRONTEND_PORT if the env var is set (useful for dev orchestration).
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![init_repo, log_message, debug_state, get_app_host_path, get_repos, save_repos])
    .setup(|app| {
      // On setup, if FRONTEND_PORT is provided, redirect the main webview.
      if let Ok(port) = std::env::var("FRONTEND_PORT") {
        let url = format!("http://localhost:{}", port);
        // `get_window` uses the label "main" by default in many templates;
        // check for a window called "main" and evaluate a redirect if found.
        if let Some(window) = app.get_webview_window("main") {
              // Mark the webview as hosted inside the Relay desktop app. For dev
              // with a remote FRONTEND_PORT we append a query parameter so the
              // injected navigation retains the 'embedded' signal even after a
              // full document load.
              let sep = if url.contains('?') { '&' } else { '?' };
              let url_with_flag = format!("{}{}__RELAY_TAURI_EMBEDDED=1", url, sep);
              match window.eval("window.__RELAY_TAURI_EMBEDDED = true;") {
                Ok(_) => println!("[tauri] injected __RELAY_TAURI_EMBEDDED global"),
                Err(e) => eprintln!("[tauri] failed to inject embedded flag: {}", e),
              }
              match window.eval(&format!("window.location.replace('{}')", url_with_flag)) {
                Ok(_) => println!("[tauri] redirecting webview to {}", url_with_flag),
                Err(e) => eprintln!("[tauri] failed to redirect webview: {}", e),
              }
          }
      }
      // Also set the embedded flag when no FRONTEND_PORT redirect is used.
      if let Some(window) = app.get_webview_window("main") {
        match window.eval("window.__RELAY_TAURI_EMBEDDED = true;") {
          Ok(_) => println!("[tauri] injected __RELAY_TAURI_EMBEDDED global (no-redirect)"),
          Err(e) => eprintln!("[tauri] failed to inject embedded flag (no-redirect): {}", e),
        }
      }
      Ok(())
    })
      .run(tauri::generate_context!("tauri.conf.json"))
    .expect("error while running tauri application");
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct RepoEntry {
  name: String,
  #[serde(skip_serializing_if = "Option::is_none")] title: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")] lastSize: Option<u64>,
  #[serde(skip_serializing_if = "Option::is_none")] lastUpdate: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")] lastURL: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")] localPath: Option<String>,
  // transient marker for UI; not part of strict spec but harmless
  #[serde(skip_serializing_if = "Option::is_none")] missing: Option<bool>,
}

#[derive(Serialize)]
struct InitResult {
  success: bool,
  message: String,
}

#[tauri::command]
async fn log_message(level: String, message: String, window: tauri::WebviewWindow) -> Result<(), String> {
  // Append to app log file and emit to UI
  if let Err(e) = append_log(&level, &message) {
    eprintln!("[log] failed to write log: {}", e);
  }
  let payload = serde_json::json!({"level": level, "message": message, "ts": chrono::Utc::now().timestamp_millis()});
  let _ = window.emit("relay://log", payload);
  Ok(())
}

#[tauri::command]
async fn debug_state() -> Result<String, String> {
  let cwd = std::env::current_dir().map(|p| p.display().to_string()).unwrap_or_else(|_| "<unknown>".into());
  let has_port = std::env::var("FRONTEND_PORT").ok();
  let msg = format!(
    "relay-desktop debug\ncwd: {}\nFRONTEND_PORT: {:?}\n",
    cwd, has_port
  );
  if let Err(e) = append_log("debug", &format!("debug_state requested\n{}", msg)) {
    eprintln!("[log] failed to write debug_state: {}", e);
  }
  Ok(msg)
}

fn append_log(level: &str, message: &str) -> std::io::Result<()> {
  let path = app_log_path();
  if let Some(parent) = path.parent() { let _ = std::fs::create_dir_all(parent); }
  let mut f = std::fs::OpenOptions::new().create(true).append(true).open(path)?;
  let ts = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
  writeln!(f, "[{}][{}] {}", ts, level, message)?;
  Ok(())
}

fn sanitize_name(input: &str) -> String {
  let s = input.to_lowercase();
  let mut out = String::with_capacity(s.len());
  let mut prev_dash = false;
  for ch in s.chars() {
    if ch.is_ascii_alphanumeric() {
      out.push(ch);
      prev_dash = false;
    } else if ch == '-' || ch == '_' {
      out.push(ch);
      prev_dash = false;
    } else {
      if !prev_dash {
        out.push('-');
        prev_dash = true;
      }
    }
  }
  // trim leading/trailing dashes
  let trimmed = out.trim_matches('-').to_string();
  if trimmed.is_empty() { "repo".into() } else { trimmed }
}

fn app_log_path() -> PathBuf {
  if let Some(dirs) = ProjectDirs::from("org", "relay", "relay") {
    return dirs.data_dir().join("app.log");
  }
  PathBuf::from("app.log")
}

/// Default host path for storing repositories. Uses OS app data dir
/// e.g. on Windows: %AppData%/org/relay/relay/repos
fn app_host_default_path() -> PathBuf {
  if let Some(dirs) = ProjectDirs::from("org", "relay", "relay") {
    return dirs.data_dir().join("repos");
  }
  PathBuf::from("host/repos")
}

#[tauri::command]
async fn get_app_host_path() -> Result<String, String> {
  Ok(app_host_default_path().to_string_lossy().to_string())
}

fn repos_config_path() -> PathBuf {
  if let Some(dirs) = ProjectDirs::from("org", "relay", "relay") {
    return dirs.data_dir().join("repos.json");
  }
  PathBuf::from("repos.json")
}

fn load_repos_file() -> Vec<RepoEntry> {
  let p = repos_config_path();
  if let Ok(data) = std::fs::read_to_string(&p) {
    match serde_json::from_str::<Vec<RepoEntry>>(&data) {
      Ok(mut arr) => {
        // normalize names to non-empty
        arr.retain(|e| !e.name.trim().is_empty());
        return arr;
      }
      Err(e) => {
        eprintln!("failed to parse repos.json: {}", e);
      }
    }
  }
  Vec::new()
}

fn save_repos_file(repos: &Vec<RepoEntry>) -> Result<(), String> {
  let p = repos_config_path();
  if let Some(parent) = p.parent() { let _ = std::fs::create_dir_all(parent); }
  let data = serde_json::to_string_pretty(repos).map_err(|e| e.to_string())?;
  std::fs::write(&p, data).map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_repos() -> Result<Vec<RepoEntry>, String> {
  let mut arr = load_repos_file();
  // Mark missing local repos
  let mut missing_count = 0usize;
  for e in arr.iter_mut() {
    if let Some(lp) = &e.localPath {
      let exists = std::path::Path::new(lp).exists();
      let miss = !exists;
      e.missing = Some(miss);
      if miss { missing_count += 1; }
    }
  }
  let _ = append_log("debug", &format!("get_repos: {} entries ({} missing)", arr.len(), missing_count));
  Ok(arr)
}

#[tauri::command]
async fn save_repos(repos: Vec<RepoEntry>) -> Result<(), String> {
  let res = save_repos_file(&repos);
  match &res {
    Ok(_) => { let _ = append_log("info", &format!("save_repos: {} entries written to {}", repos.len(), repos_config_path().display())); }
    Err(e) => { let _ = append_log("error", &format!("save_repos failed: {}", e)); }
  }
  res
}

/// Initialize a repository by invoking the workspace `relay-cli` binary.
///
/// This command shells out to `cargo run -p relay-cli -- init --repo <name> --template <template> --path <path>`
/// and returns a JSON result describing success or failure. The host path is by
/// default `./host/repos` relative to the workspace root; you can pass an absolute
/// path using `path`.
#[tauri::command]
async fn init_repo(name: String, template: Option<String>, path: Option<String>, title: Option<String>, description: Option<String>) -> Result<InitResult, String> {
  // basic validation
  if name.trim().is_empty() {
    return Err("repo name is required".into());
  }

  let template = template.unwrap_or_else(|| "movies".to_string());
  // base dir for repos
  let base_dir = path.map(PathBuf::from).unwrap_or_else(app_host_default_path);
  // sanitize name to file-safe
  let safe_name = sanitize_name(&name);
  let repo_path = base_dir.join(&safe_name);

  info!("init_repo starting: name={}, template={}, path={}", name, template, repo_path.display());
  let _ = append_log("info", &format!("init_repo: {} (template={}) at {}", name, template, repo_path.display()));

  // Build owned args so we can move into the blocking closure
  let repo_path_arg = repo_path.to_string_lossy().to_string();
  let name_arg = name.clone();
  let template_arg = template.clone();
  let title_arg = title.clone().unwrap_or_else(|| name.clone());
  let desc_arg = description.clone().unwrap_or_default();

    // We'll try four strategies in order:
  // 0) perform an in-process init using `relay-repo` ops (create minimal relay.yaml)
  // 1) run a compiled binary in ./target/debug/relay-cli (dev build)
  // 2) run a `relay-cli` binary found on PATH
  // 3) fall back to `cargo run -p relay-cli -- init ...` (slow, requires Rust toolchain)

  let repo_path_str = repo_path.to_string_lossy().to_string();
  let res = spawn_blocking(move || {
    // helper to collect output
    let collect = |o: std::process::Output| {
      let mut out = String::new();
      out.push_str(&String::from_utf8_lossy(&o.stdout));
      out.push_str(&String::from_utf8_lossy(&o.stderr));
      (o.status.success(), out, o.status.code())
    };

    // 0) try in-process init via relay-repo ops
    // create relay.yaml in the target path and validate
    let repo_root = PathBuf::from(&repo_path_arg);
    if !repo_root.exists() {
      if let Err(e) = fs::create_dir_all(&repo_root) {
        eprintln!("failed to create repo root {}: {}", repo_root.display(), e);
      }
    }
    // write relay.yaml with provided title/description
    let yaml = format!("version: 1\ntitle: \"{}\"\n{}", title_arg.replace('"', "'"), if !desc_arg.is_empty() { format!("description: \"{}\"\n", desc_arg.replace('"', "'")) } else { String::new() });
    let yaml_path = repo_root.join("relay.yaml");
    if let Err(e) = fs::write(&yaml_path, yaml) {
      eprintln!("failed to write relay.yaml: {}", e);
    } else {
      // run validate_repo to see if basic layout is acceptable
      match repo_ops::validate_repo(&repo_root) {
        Ok(v) => {
          if v.is_empty() {
            return Ok(InitResult { success: true, message: "initialized repository".into() });
          } else {
            // collect validation messages
            let mut msg = String::new();
            for viol in v {
              msg.push_str(&format!("[{}] {} - {}\n", viol.code, viol.path, viol.message));
            }
            // continue to other strategies if validation failed
            eprintln!("validation warnings/errors:\n{}", msg);
          }
        }
        Err(e) => {
          eprintln!("validate_repo failed: {}", e);
        }
      }
    }

    // 1) try target/debug/relay-cli relative to workspace
    let target_bin = std::env::current_dir()
      .ok()
      .and_then(|cwd| {
        // workspace root is two levels up from src-tauri in dev layout; try relative paths
        let cand = cwd.join("../target/debug/relay-cli");
        if cand.exists() {
          Some(cand)
        } else {
          None
        }
      });

    let args = ["init", "--repo", &name_arg, "--template", &template_arg, "--path", &repo_path_arg];

    if let Some(bin) = target_bin {
      match StdCommand::new(bin).args(&args).output() {
        Ok(o) => {
          let (ok, out, code) = collect(o);
          if ok {
            return Ok(InitResult { success: true, message: out });
          }
          return Err(format!("relay-cli binary failed (code {:?}): {}", code, out));
        }
        Err(e) => {
          // fallthrough to next strategy
          eprintln!("failed to run target/debug/relay-cli: {}", e);
        }
      }
    }

    // 2) try `relay-cli` on PATH
    match StdCommand::new("relay-cli").args(&args).output() {
      Ok(o) => {
        let (ok, out, code) = collect(o);
        if ok {
          return Ok(InitResult { success: true, message: out });
        }
        return Err(format!("relay-cli on PATH failed (code {:?}): {}", code, out));
      }
      Err(e) => {
        eprintln!("relay-cli not found on PATH: {}", e);
      }
    }

    // 3) fallback: cargo run -p relay-cli -- init ...
    let cargo_args = [
      "run",
      "-p",
      "relay-cli",
      "--",
      "init",
      "--repo",
      &name_arg,
      "--template",
      &template_arg,
      "--path",
      &repo_path_arg,
    ];

    match StdCommand::new("cargo").args(&cargo_args).output() {
      Ok(o) => {
        let (ok, out, code) = collect(o);
        if ok {
          Ok(InitResult { success: true, message: out })
        } else {
          Err(format!("cargo-run relay-cli failed (code {:?}): {}", code, out))
        }
      }
      Err(e) => Err(format!("failed to run cargo for repo {} at {}: {}", name_arg, repo_path_arg, e)),
    }
  }).await;

  let result = res.map_err(|e| format!("background task failed: {}", e))?;
  // If success, update repos.json with localPath and metadata
  if let Ok(r) = &result {
    if r.success {
      let mut repos = load_repos_file();
      let mut found = false;
      for entry in repos.iter_mut() {
        if entry.name == name {
          entry.title = Some(title.clone().unwrap_or_else(|| name.clone()));
          entry.localPath = Some(repo_path_str.clone());
          entry.lastUpdate = Some(chrono::Utc::now().to_rfc3339());
          entry.missing = Some(false);
          found = true;
          break;
        }
      }
      if !found {
        repos.push(RepoEntry {
          name: name.clone(),
          title: Some(title.clone().unwrap_or_else(|| name.clone())),
          lastSize: None,
          lastUpdate: Some(chrono::Utc::now().to_rfc3339()),
          lastURL: None,
          localPath: Some(repo_path_str.clone()),
          missing: Some(false),
        });
      }
      if let Err(e) = save_repos_file(&repos) {
        let _ = append_log("error", &format!("failed to save repos.json after init: {}", e));
      } else {
        let _ = append_log("info", &format!("repo '{}' recorded in config at {}", name, repos_config_path().display()));
      }
    }
  }
  result
}
