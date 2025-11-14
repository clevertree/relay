// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;
use std::process::Command as StdCommand;
use tauri::async_runtime::spawn_blocking;
use serde::Serialize;
use std::path::PathBuf;
// Use relay-repo crate directly for fast, in-process repo initialization
use relay_repo::ops as repo_ops;
use std::fs;

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

  // Build owned args so we can move into the blocking closure
  let repo_path_arg = repo_path.to_string_lossy().to_string();
  let name_arg = name.clone();
  let template_arg = template.clone();

    // We'll try four strategies in order:
  // 0) perform an in-process init using `relay-repo` ops (create minimal relay.yaml)
  // 1) run a compiled binary in ./target/debug/relay-cli (dev build)
  // 2) run a `relay-cli` binary found on PATH
  // 3) fall back to `cargo run -p relay-cli -- init ...` (slow, requires Rust toolchain)

  let res = spawn_blocking(move || {
    // helper to collect output
    let collect = |o: std::process::Output| {
      let mut out = String::new();
      out.push_str(&String::from_utf8_lossy(&o.stdout));
      out.push_str(&String::from_utf8_lossy(&o.stderr));
      (o.status.success(), out, o.status.code())
    };

    // 0) try in-process init via relay-repo ops
    // create a minimal relay.yaml in the target path if it doesn't exist and validate
    let repo_root = PathBuf::from(&repo_path_arg);
    if !repo_root.exists() {
      if let Err(e) = fs::create_dir_all(&repo_root) {
        eprintln!("failed to create repo root {}: {}", repo_root.display(), e);
      } else {
        // write a minimal relay.yaml to the repo root
        let yaml = "version: 1\ntitle: \"New repository\"\n";
        let yaml_path = repo_root.join("relay.yaml");
        if let Err(e) = fs::write(&yaml_path, yaml) {
          eprintln!("failed to write relay.yaml: {}", e);
        } else {
          // run validate_repo to see if basic layout is acceptable
          match repo_ops::validate_repo(&repo_root) {
            Ok(v) => {
              if v.is_empty() {
                return Ok(InitResult { success: true, message: "initialized repository (minimal)".into() });
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

  res.map_err(|e| format!("background task failed: {}", e))?
}
