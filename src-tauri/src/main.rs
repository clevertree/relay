// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;
use std::process::Command as StdCommand;
use tauri::async_runtime::spawn_blocking;
use serde::Serialize;
use std::path::PathBuf;

fn main() {
  // Build and run the tauri app. We'll redirect the main webview to the
  // FRONTEND_PORT if the env var is set (useful for dev orchestration).
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![init_repo])
    .setup(|app| {
      // On setup, if FRONTEND_PORT is provided, redirect the main webview.
      if let Ok(port) = std::env::var("FRONTEND_PORT") {
        let url = format!("http://localhost:{}", port);
        // `get_window` uses the label "main" by default in many templates;
        // check for a window called "main" and evaluate a redirect if found.
        if let Some(window) = app.get_webview_window("main") {
          // Use eval to replace the location in the webview context.
          let _ = window.eval(&format!("window.location.replace('{}')", url));
        }
      }
      Ok(())
    })
      .run(tauri::generate_context!("tauri.conf.json"))
    .expect("error while running tauri application");
}

#[derive(Serialize)]
struct InitResult {
  success: bool,
  message: String,
}

/// Initialize a repository by invoking the workspace `relay-cli` binary.
///
/// This command shells out to `cargo run -p relay-cli -- init --repo <name> --template <template> --path <path>`
/// and returns a JSON result describing success or failure. The host path is by
/// default `./host/repos` relative to the workspace root; you can pass an absolute
/// path using `path`.
#[tauri::command]
async fn init_repo(name: String, template: Option<String>, path: Option<String>) -> Result<InitResult, String> {
  // basic validation
  if name.trim().is_empty() {
    return Err("repo name is required".into());
  }

  let template = template.unwrap_or_else(|| "movies".to_string());
  // default path: workspace relative host/repos
  let repo_path = path.map(PathBuf::from).unwrap_or_else(|| PathBuf::from("host/repos"));

  // Build owned args vector so we can move it into the blocking closure
  let mut args_vec: Vec<String> = vec![
    "run".into(),
    "-p".into(),
    "relay-cli".into(),
    "--".into(),
    "init".into(),
    "--repo".into(),
    name.clone(),
    "--template".into(),
    template.clone(),
    "--path".into(),
    repo_path.to_string_lossy().to_string(),
  ];

  // make owned copies for error messages inside the blocking closure
  let name_for_err = name.clone();
  let repo_path_for_err = repo_path.clone();

  let res = spawn_blocking(move || {
    // invoke cargo synchronously
    let output = StdCommand::new("cargo").args(&args_vec).output();
    match output {
      Ok(o) => {
        let mut out = String::new();
        out.push_str(&String::from_utf8_lossy(&o.stdout));
        out.push_str(&String::from_utf8_lossy(&o.stderr));
        if o.status.success() {
          Ok(InitResult { success: true, message: out })
        } else {
          Err(format!("relay-cli failed (code {:?}): {}", o.status.code(), out))
        }
      }
  Err(e) => Err(format!("failed to run cargo for repo {} at {}: {}", name_for_err, repo_path_for_err.display(), e)),
    }
  }).await;

  res.map_err(|e| format!("background task failed: {}", e))?
}
