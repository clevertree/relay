// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;

fn main() {
  // Build and run the tauri app. We'll redirect the main webview to the
  // FRONTEND_PORT if the env var is set (useful for dev orchestration).
  tauri::Builder::default()
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
