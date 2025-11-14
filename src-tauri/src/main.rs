#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{Manager};

fn main() {
    tracing_subscriber::fmt::init();

    tauri::Builder::default()
        // Example Tauri command placeholder; expand as needed
        .invoke_handler(tauri::generate_handler![])
        .setup(|app| {
            let main_window = app.get_window("main");
            if main_window.is_none() {
                // Create a main window if not auto-created by Tauri
                app.create_window(
                    "main".to_string(),
                    tauri::WindowUrl::App("/".into()),
                    |win, webview| {
                        win.title("Relay");
                        (win, webview)
                    },
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running relay desktop application");
}
