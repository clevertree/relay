use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use directories::ProjectDirs;
use eframe::egui::{self, Color32, Context as EguiContext, RichText, TextEdit, TopBottomPanel};
use eframe::{App, Frame, NativeOptions};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use time::format_description::well_known::Rfc3339;
use tracing::{debug, error, info, warn};
use tracing_appender::rolling;
use tracing_subscriber::EnvFilter;

#[cfg(all(feature = "webview", not(target_os = "macos")))]
use std::thread;
#[cfg(all(feature = "webview", not(target_os = "macos")))]
use tao::event::{Event, WindowEvent};
#[cfg(all(feature = "webview", not(target_os = "macos")))]
use tao::event_loop::{ControlFlow, EventLoop};
#[cfg(all(feature = "webview", not(target_os = "macos")))]
use tao::window::WindowBuilder;
#[cfg(all(feature = "webview", not(target_os = "macos")))]
use wry::http::Request as WryRequest;
#[cfg(all(feature = "webview", not(target_os = "macos")))]
use wry::WebViewBuilder;

// Windows-embedded WebView2 integration (embed inside main window)
#[cfg(all(windows, feature = "webview"))]
use std::sync::{Arc, Mutex};
#[cfg(all(windows, feature = "webview"))]
use webview2::{Controller, Environment, WebMessageReceivedEventArgs, WebView};
#[cfg(all(windows, feature = "webview"))]
use widestring::U16CString;
#[cfg(all(windows, feature = "webview"))]
use winapi::shared::windef::{HWND, RECT};
#[cfg(all(windows, feature = "webview"))]
use winapi::um::combaseapi::CoInitializeEx;
#[cfg(all(windows, feature = "webview"))]
use winapi::um::libloaderapi::GetModuleHandleW;
#[cfg(all(windows, feature = "webview"))]
use winapi::um::objbase::COINIT_APARTMENTTHREADED;
#[cfg(all(windows, feature = "webview"))]
use winapi::um::winuser::{
    CreateWindowExW, FindWindowW, SetWindowPos, ShowWindow, SWP_NOZORDER, SW_HIDE, SW_SHOW,
    WS_CHILD, WS_CLIPSIBLINGS, WS_EX_NOPARENTNOTIFY, WS_VISIBLE,
};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
enum NavSide {
    Left,
    Right,
}

impl Default for NavSide {
    fn default() -> Self {
        NavSide::Left
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct Settings {
    tracker_url: String,
    // Domains/hosts allowed to open inside embedded webview and to use the JS bridge
    allowed_hosts: Vec<String>,
    // Optional default repository URL to open
    default_repo_url: Option<String>,
    /// Where to show the navigation rail
    #[serde(default)]
    nav_side: NavSide,
    /// Whether the sidebar is visible
    #[serde(default = "default_true")]
    sidebar_visible: bool,
    /// Optional: URL for Torrent/Web UI (e.g., qBittorrent Web UI)
    #[serde(default)]
    torrent_url: String,
    /// Optional credentials (if applicable)
    #[serde(default)]
    torrent_username: String,
    #[serde(default)]
    torrent_password: String,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PeerDto {
    id: String,
    socket: String,
    #[serde(rename = "updatedAt")]
    updated_at: String,
}

#[derive(Debug, Clone)]
struct RepoTab {
    title: String,
    url: String,
}

// Bridge request coming from the webview (JSON-based)
#[derive(Debug, Clone, Serialize, Deserialize)]
struct BridgeRequest {
    id: Option<String>,
    action: String,
    #[serde(default)]
    payload: serde_json::Value,
}

// No BridgeResponse is necessary for now since the page will perform its own fetches

#[derive(Default)]
struct RelayClientApp {
    http: Option<Client>,
    settings: Settings,
    settings_dirty: bool,
    recent_sockets: Vec<String>,
    peers: Vec<PeerDto>,
    status: String,
    new_socket_input: String,
    logs: Vec<String>,
    console_input: String,
    // Sidebar visibility (toggleable)
    sidebar_visible: bool,
    repo_tabs: Vec<RepoTab>,
    active_tab: Screen,
    // If user connects to a host not whitelisted, ask for approval here
    pending_host_approval: Option<String>,
    // async plumbing for background tasks
    peer_tx: Option<std::sync::mpsc::Sender<Result<Vec<PeerDto>>>>,
    peer_rx: Option<std::sync::mpsc::Receiver<Result<Vec<PeerDto>>>>,
    #[cfg(all(windows, feature = "webview"))]
    embedded: Option<EmbeddedWebViewWin>,
    // apply theme spacing once
    theme_applied: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Screen {
    Home,
    Settings,
    Torrent,
    Console,
    Repo(usize), // index into repo_tabs
}

impl Default for Screen {
    fn default() -> Self {
        Screen::Home
    }
}

impl RelayClientApp {
    fn new() -> Self {
        let mut app = RelayClientApp::default();
        app.http = Some(
            Client::builder()
                .timeout(Duration::from_secs(20))
                .build()
                .unwrap(),
        );
        app.settings = load_settings().unwrap_or_else(|_| {
            let mut s = Settings::default();
            s.tracker_url = std::env::var("RELAY_TRACKER_URL")
                .unwrap_or_else(|_| "https://relaynet.online".to_string());
            s.allowed_hosts = vec!["localhost".into(), "127.0.0.1".into(), "[::1]".into()];
            s.default_repo_url = std::env::var("RELAY_PEER_DEFAULT_URL").ok();
            s
        });
        app.recent_sockets = load_recent_sockets().unwrap_or_default();
        // Default the socket input to RELAY_PEER_DEFAULT_URL (or localhost:8088)
        app.new_socket_input = app
            .settings
            .default_repo_url
            .clone()
            .unwrap_or_else(|| "http://localhost:8088".to_string());
        app.status = "Ready".to_string();
        // Sidebar visible by default (override from settings if present)
        app.sidebar_visible = app.settings.sidebar_visible;
        app.theme_applied = false;
        let (tx, rx) = std::sync::mpsc::channel();
        app.peer_tx = Some(tx);
        app.peer_rx = Some(rx);

        // Restore previously open repository tabs (respect whitelist)
        if let Ok(urls) = load_open_tabs() {
            for url in urls {
                if is_host_allowed(&app.settings.allowed_hosts, &url) {
                    app.repo_tabs.push(RepoTab {
                        title: url.clone(),
                        url,
                    });
                } else {
                    app.log(format!("Skipped restoring non-allowed host for tab"));
                }
            }
        }
        // Seed some initial console lines so the user sees content immediately when toggled
        app.log("Console initialized. Press F12 or use the top bar to toggle.".into());
        app.log(format!("Tracker: {}", app.settings.tracker_url));
        let def = app
            .settings
            .default_repo_url
            .clone()
            .unwrap_or_else(|| "http://localhost:8088".into());
        app.log(format!("Default repo URL: {}", def));
        app.log(format!("Restored {} tab(s)", app.repo_tabs.len()));
        app
    }
}

impl App for RelayClientApp {
    fn update(&mut self, ctx: &EguiContext, frame: &mut Frame) {
        // One-time theme adjustments: larger paddings and control sizes
        if !self.theme_applied {
            apply_theme(ctx);
            self.theme_applied = true;
        }
        // Keyboard shortcuts
        // Toggle console
        if ctx.input(|i| i.key_pressed(egui::Key::F12)) {
            self.active_tab = Screen::Console;
        }
        // Toggle sidebar: Ctrl+B (or Cmd+B on macOS)
        if ctx.input(|i| i.key_pressed(egui::Key::B) && (i.modifiers.ctrl || i.modifiers.command)) {
            self.sidebar_visible = !self.sidebar_visible;
            // Persist immediately (best-effort)
            self.settings_dirty = true;
            self.settings.sidebar_visible = self.sidebar_visible;
            if let Err(e) = save_settings(&self.settings) {
                self.log(format!("Failed to save settings: {e:#}"));
            }
        }
        // Poll background results
        if let Some(rx) = &self.peer_rx {
            match rx.try_recv() {
                Ok(Ok(peers)) => {
                    self.peers = peers;
                    self.status = format!("Loaded {} peers", self.peers.len());
                    self.log(self.status.clone());
                }
                Ok(Err(e)) => {
                    self.status = format!("Peer load failed: {e:#}");
                    self.log(self.status.clone());
                }
                Err(std::sync::mpsc::TryRecvError::Empty) => {}
                Err(std::sync::mpsc::TryRecvError::Disconnected) => {
                    self.peer_rx = None;
                }
            }
        }
        // App menu bar (always visible, minimal height)
        TopBottomPanel::top("app_menu").show(ctx, |ui| {
            egui::menu::bar(ui, |ui| {
                ui.menu_button("File", |ui| {
                    if ui.button("Exit").clicked() {
                        ui.close_menu();
                        ctx.send_viewport_cmd(egui::ViewportCommand::Close);
                    }
                });

                ui.menu_button("View", |ui| {
                    let c = matches!(self.active_tab, Screen::Console);
                    if ui.selectable_label(c, "Console (F12)").clicked() {
                        self.active_tab = Screen::Console;
                        ui.close_menu();
                    }
                    let s = self.sidebar_visible;
                    if ui.selectable_label(s, "Sidebar (Ctrl+B)").clicked() {
                        self.sidebar_visible = !self.sidebar_visible;
                        ui.close_menu();
                        self.settings_dirty = true;
                        self.settings.sidebar_visible = self.sidebar_visible;
                        if let Err(e) = save_settings(&self.settings) {
                            self.log(format!("Failed to save settings: {e:#}"));
                        }
                    }
                });

                // Repo menu is contextual
                let is_repo = matches!(self.active_tab, Screen::Repo(_));
                ui.add_enabled_ui(is_repo, |ui| {
                    ui.menu_button("Repo", |ui| {
                        if let Screen::Repo(i) = self.active_tab {
                            // Avoid mutable/immutable borrow conflict by cloning URL first
                            if let Some(url) = self.repo_tabs.get(i).map(|t| t.url.clone()) {
                                // Open in external browser
                                if ui.button("Open in browser").clicked() {
                                    let _ = open::that(&url);
                                    self.log(format!("Opened {} in browser", url));
                                    ui.close_menu();
                                }
                                // Copy URL
                                if ui.button("Copy URL").clicked() {
                                    let clip = url.clone();
                                    ui.output_mut(|o| o.copied_text = clip);
                                    self.log("URL copied".into());
                                    ui.close_menu();
                                }
                                // Refresh
                                if ui.button("Refresh").clicked() {
                                    #[cfg(all(windows, feature = "webview"))]
                                    if let Some(emb) = &mut self.embedded {
                                        emb.reload();
                                    }
                                    self.log("Refresh requested".into());
                                    ui.close_menu();
                                }
                                // DevTools (Windows)
                                #[cfg(all(windows, feature = "webview"))]
                                {
                                    if ui.button("Open DevTools").clicked() {
                                        if let Some(emb) = &mut self.embedded {
                                            emb.open_devtools();
                                        }
                                        self.log("DevTools requested".into());
                                        ui.close_menu();
                                    }
                                }
                            }
                        }
                    });
                });

                ui.menu_button("Help", |ui| {
                    if ui.button("Open logs folder").clicked() {
                        if let Some(dir) = project_dirs().map(|d| d.data_local_dir().to_path_buf())
                        {
                            let _ = open::that(dir);
                        }
                        ui.close_menu();
                    }
                });
            });
        });

        // Side navigation: left or right based on settings.
        // When "sidebar_visible" is false we show a compact icon-only rail.
        let draw_nav = |ui: &mut egui::Ui, this: &mut RelayClientApp, expanded: bool| {
            // ui.vertical(|ui| {
            //     ui.horizontal(|ui| {
            //         if ui
            //             .small_button("⟨ hide")
            //             .on_hover_text("Hide sidebar")
            //             .clicked()
            //         {
            //             this.sidebar_visible = false;
            //             this.settings_dirty = true;
            //             this.settings.sidebar_visible = false;
            //             if let Err(e) = save_settings(&this.settings) {
            //                 this.log(format!("Failed to save settings: {e:#}"));
            //             }
            //         }
            //     });
            // });
            ui.separator();

            // Helper to render a nav item with icon and optional text
            let mut nav_item = |icon: &str, text: &str, selected: bool| {
                if expanded {
                    let label = format!("{icon}  {text}");
                    ui.selectable_label(selected, label).clicked()
                } else {
                    // Chain to avoid moving `resp` then using it again
                    ui.selectable_label(selected, icon)
                        .on_hover_text(text)
                        .clicked()
                }
            };

            if nav_item("🏠", "Home", matches!(this.active_tab, Screen::Home)) {
                this.active_tab = Screen::Home;
            }
            if nav_item("⚙️", "Settings", matches!(this.active_tab, Screen::Settings)) {
                this.active_tab = Screen::Settings;
            }
            if nav_item("🧲", "Torrent", matches!(this.active_tab, Screen::Torrent)) {
                this.active_tab = Screen::Torrent;
            }
            if nav_item("🖥️", "Console", matches!(this.active_tab, Screen::Console)) {
                this.active_tab = Screen::Console;
            }

            // Repositories list is shown only in expanded mode
            if expanded {
                ui.separator();
                ui.label(RichText::new("Repositories").strong());
                let mut to_close: Option<usize> = None;
                for (i, tab) in this.repo_tabs.iter().enumerate() {
                    ui.horizontal(|ui| {
                        if ui
                            .selectable_label(
                                matches!(this.active_tab, Screen::Repo(j) if j==i),
                                &tab.title,
                            )
                            .clicked()
                        {
                            this.active_tab = Screen::Repo(i);
                        }
                        if ui.small_button("x").on_hover_text("Close").clicked() {
                            to_close = Some(i);
                        }
                    });
                }
                if let Some(i) = to_close {
                    this.repo_tabs.remove(i);
                    this.active_tab = Screen::Home;
                    let _ = save_open_tabs(&this.repo_tabs.iter().map(|t| t.url.clone()).collect());
                }
            }
        };

        // Always show a side panel; expanded vs compact based on `sidebar_visible`.
        let expanded = self.sidebar_visible;
        match self.settings.nav_side {
            NavSide::Left => {
                let mut panel = egui::SidePanel::left("nav_left");
                if expanded {
                    panel = panel.resizable(true).default_width(240.0).min_width(180.0);
                } else {
                    // Compact fixed width rail
                    panel = panel.resizable(false).min_width(56.0).max_width(56.0).default_width(56.0);
                }
                panel.show(ctx, |ui| draw_nav(ui, self, expanded));
            }
            NavSide::Right => {
                let mut panel = egui::SidePanel::right("nav_right");
                if expanded {
                    panel = panel.resizable(true).default_width(240.0).min_width(180.0);
                } else {
                    panel = panel.resizable(false).min_width(56.0).max_width(56.0).default_width(56.0);
                }
                panel.show(ctx, |ui| draw_nav(ui, self, expanded));
            }
        }

        // Whitelist approval banner
        if let Some(host) = self.pending_host_approval.clone() {
            TopBottomPanel::top("whitelist_banner").show(ctx, |ui| {
                ui.horizontal_wrapped(|ui| {
                    ui.colored_label(Color32::YELLOW, format!("Allow repository host '{host}' to open in embedded webview and use the bridge?"));
                    if ui.button("Allow").clicked() {
                        if !self.settings.allowed_hosts.iter().any(|h| h.eq_ignore_ascii_case(&host)) {
                            self.settings.allowed_hosts.push(host.clone());
                            if let Err(e) = save_settings(&self.settings) { self.log(format!("Failed to save settings: {e:#}")); }
                        }
                        self.settings_dirty = false;
                        self.log(format!("Host '{host}' allowed"));
                        self.pending_host_approval = None;
                        // After allowing, open a repo tab if there was a pending connect input
                        if !self.new_socket_input.trim().is_empty() {
                            let url = self.new_socket_input.trim().to_string();
                            self.open_repo_tab(url);
                            self.new_socket_input.clear();
                        }
                    }
                    if ui.button("Deny").clicked() {
                        self.log(format!("Host '{host}' denied"));
                        self.pending_host_approval = None;
                    }
                });
            });
        }

        // Console moved to its own tab (see ui_console)

        // Central content (remove inner margins so the embedded WebView can truly fill it)
        egui::CentralPanel::default()
            .frame(egui::Frame::none())
            .show(ctx, |ui| match self.active_tab {
                Screen::Home => {
                    // Hide embedded webview when leaving repo screen
                    #[cfg(all(windows, feature = "webview"))]
                    if let Some(emb) = &mut self.embedded {
                        emb.hide();
                    }
                    self.ui_home(ui, ctx)
                }
                Screen::Settings => {
                    #[cfg(all(windows, feature = "webview"))]
                    if let Some(emb) = &mut self.embedded {
                        emb.hide();
                    }
                    self.ui_settings(ui)
                }
                Screen::Torrent => {
                    #[cfg(all(windows, feature = "webview"))]
                    if let Some(emb) = &mut self.embedded {
                        emb.hide();
                    }
                    self.ui_torrent(ui)
                }
                Screen::Console => {
                    #[cfg(all(windows, feature = "webview"))]
                    if let Some(emb) = &mut self.embedded {
                        emb.hide();
                    }
                    self.ui_console(ui, ctx)
                }
                Screen::Repo(i) => self.ui_repo(ui, i, frame),
            });
    }
}

impl RelayClientApp {
    fn ui_home(&mut self, ui: &mut egui::Ui, _ctx: &EguiContext) {
        ui.heading("Home");
        ui.label("Connect to tracker and recent master peers");

        ui.separator();
        ui.horizontal(|ui| {
            ui.label("Tracker URL:");
            let resp =
                ui.add(TextEdit::singleline(&mut self.settings.tracker_url).desired_width(500.0));
            if resp.changed() {
                self.settings_dirty = true;
            }
            if ui.button("Refresh peers").clicked() {
                self.refresh_peers();
            }
        });

        ui.separator();
        ui.horizontal(|ui| {
            if ui
                .button("Open default repo")
                .on_hover_text("Opens RELAY_PEER_DEFAULT_URL if set, or http://localhost:8088")
                .clicked()
            {
                let url = self
                    .settings
                    .default_repo_url
                    .clone()
                    .unwrap_or_else(|| "http://localhost:8088".into());
                self.connect_to_socket(url);
            }
        });

        ui.separator();
        ui.label("Recent sockets:");
        egui::ScrollArea::vertical()
            .id_source("recent_sockets")
            .max_height(100.0)
            .show(ui, |ui| {
                // avoid borrowing self across UI closures
                let sockets: Vec<String> = self.recent_sockets.clone();
                for sock in sockets {
                    let sock_clone = sock.clone();
                    ui.horizontal(|ui| {
                        ui.monospace(&sock);
                        if ui.button("Connect").clicked() {
                            self.connect_to_socket(sock_clone.clone());
                        }
                        if ui
                            .small_button("Open")
                            .on_hover_text("Open in external browser")
                            .clicked()
                        {
                            let _ = open::that(&sock_clone);
                        }
                    });
                }
            });

        ui.separator();
        ui.horizontal(|ui| {
            ui.label("Socket:");
            let resp = ui.add(
                TextEdit::singleline(&mut self.new_socket_input)
                    .hint_text("ws://host:port or http(s)://..."),
            );
            if resp.lost_focus() && ui.input(|i| i.key_pressed(egui::Key::Enter)) {
                let s = self.new_socket_input.trim().to_string();
                if !s.is_empty() {
                    self.connect_to_socket(s);
                }
            }
            if ui.button("Connect").clicked() {
                let s = self.new_socket_input.trim().to_string();
                if !s.is_empty() {
                    self.connect_to_socket(s);
                }
            }
        });

        ui.separator();
        ui.label("Peers from Tracker:");
        egui::ScrollArea::vertical()
            .id_source("peers_tracker")
            .max_height(240.0)
            .show(ui, |ui| {
                let peers: Vec<PeerDto> = self.peers.clone();
                for p in peers {
                    let sock = p.socket.clone();
                    let updated = p.updated_at.clone();
                    ui.horizontal(|ui| {
                        ui.monospace(sock.clone());
                        if ui.button("Connect").clicked() {
                            self.connect_to_socket(sock.clone());
                        }
                        if ui.small_button("Open").clicked() {
                            let _ = open::that(&sock);
                        }
                        ui.label(egui::RichText::new(format!("updated {}", updated)).small());
                    });
                }
            });
    }

    fn ui_settings(&mut self, ui: &mut egui::Ui) {
        ui.heading("Settings");
        ui.separator();
        ui.label("Environment and Paths");
        if let Some(dirs) = project_dirs() {
            ui.monospace(format!("Config dir: {}", dirs.config_dir().display()));
            ui.monospace(format!("Data dir: {}", dirs.data_dir().display()));
            ui.monospace(format!("Log dir: {}", dirs.data_local_dir().display()));
        }

        ui.separator();
        ui.label("UI Preferences");
        ui.horizontal(|ui| {
            ui.label("Navigation side:");
            let mut side = self.settings.nav_side.clone();
            if ui.radio(side == NavSide::Left, "Left").clicked() {
                side = NavSide::Left;
            }
            if ui.radio(side == NavSide::Right, "Right").clicked() {
                side = NavSide::Right;
            }
            if side != self.settings.nav_side {
                self.settings.nav_side = side;
                self.settings_dirty = true;
            }
        });

        ui.separator();
        ui.label("Torrent/Web UI (optional)");
        ui.horizontal(|ui| {
            ui.label("URL:");
            let resp =
                ui.add(TextEdit::singleline(&mut self.settings.torrent_url).desired_width(400.0));
            if resp.changed() {
                self.settings_dirty = true;
            }
        });
        ui.horizontal(|ui| {
            ui.label("Username:");
            let resp = ui.add(
                TextEdit::singleline(&mut self.settings.torrent_username).desired_width(200.0),
            );
            if resp.changed() {
                self.settings_dirty = true;
            }
            ui.label("Password:");
            let resp = ui.add(
                TextEdit::singleline(&mut self.settings.torrent_password)
                    .password(true)
                    .desired_width(200.0),
            );
            if resp.changed() {
                self.settings_dirty = true;
            }
        });

        ui.separator();
        if ui.button("Save settings").clicked() {
            if let Err(e) = save_settings(&self.settings) {
                self.log(format!("Error saving settings: {e:#}"));
            } else {
                self.log("Settings saved".into());
                self.settings_dirty = false;
            }
        }

        ui.separator();
        ui.label("Media playback");
        ui.horizontal(|ui| {
            if ui.button("Choose file and Open with OS default").clicked() {
                if let Some(path) = rfd::FileDialog::new().pick_file() {
                    if let Err(e) = play_with_default_app(&path) {
                        self.log(format!("Open failed: {e:#}"));
                    }
                }
            }
            if ui
                .button("Choose file and Try Internal Fullscreen")
                .clicked()
            {
                if let Some(path) = rfd::FileDialog::new().pick_file() {
                    if let Err(e) = play_fullscreen_internal(&path) {
                        self.log(format!("Internal player not available: {e:#}"));
                    }
                }
            }
        });

        ui.separator();
        if ui.button("Open logs folder").clicked() {
            if let Some(dir) = project_dirs().map(|d| d.data_local_dir().to_path_buf()) {
                let _ = open::that(dir);
            }
        }
    }

    fn ui_repo(&mut self, ui: &mut egui::Ui, i: usize, frame: &mut Frame) {
        let Some(tab) = self.repo_tabs.get(i).cloned() else {
            return;
        };
        // Allocate a persistent rectangle where the embedded webview should live
        let desired = egui::vec2(ui.available_width(), ui.available_height());
        let mut rect = ui.available_rect_before_wrap();
        // Clamp rect to desired size
        rect.max.x = rect.min.x + desired.x;
        rect.max.y = rect.min.y + desired.y;
        let _resp = ui.allocate_rect(rect, egui::Sense::hover());

        // Convert logical points (egui) to physical pixels for Win32 bounds
        #[cfg(all(windows, feature = "webview"))]
        {
            let scale = ui.ctx().pixels_per_point();
            // Use floor for origin and ceil for size to avoid 1px gaps due to rounding
            let x = (rect.min.x * scale).floor() as i32;
            let y = (rect.min.y * scale).floor() as i32;
            let w = (rect.width() * scale).ceil() as i32;
            let h = (rect.height() * scale).ceil() as i32;
            // Ensure embedded view exists and is positioned
            if self.embedded.is_none() {
                if let Some(hwnd) = find_main_hwnd() {
                    let mut emb =
                        EmbeddedWebViewWin::new(hwnd, self.settings.allowed_hosts.clone());
                    emb.ensure_created(x, y, w, h, &tab.url);
                    self.embedded = Some(emb);
                } else {
                    self.log("Failed to find main window handle for embedding".into());
                }
            } else if let Some(emb) = &mut self.embedded {
                emb.ensure_created(x, y, w, h, &tab.url);
            }
        }

        #[cfg(not(all(windows, feature = "webview")))]
        {
            ui.label("Embedded WebView is only implemented on Windows in this build. Use the external browser link below.");
            ui.hyperlink_to(&url_clone, &url_clone);
        }
    }

    fn ui_console(&mut self, ui: &mut egui::Ui, ctx: &EguiContext) {
        ui.heading("Console");
        ui.separator();
        egui::ScrollArea::vertical()
            .id_source("console_scroll")
            .auto_shrink([false, false])
            .stick_to_bottom(true)
            .show(ui, |ui| {
                if self.logs.is_empty() {
                    ui.label("No logs yet. Actions will appear here.");
                } else {
                    for line in &self.logs {
                        ui.monospace(line);
                    }
                }
            });
        ui.horizontal(|ui| {
            let resp = ui.add(
                TextEdit::singleline(&mut self.console_input)
                    .hint_text("Type a command (e.g., help) and press Enter"),
            );
            if resp.lost_focus() && ui.input(|i| i.key_pressed(egui::Key::Enter)) {
                let cmd = self.console_input.trim().to_string();
                if !cmd.is_empty() {
                    self.log(format!("> {}", cmd));
                    self.handle_command(cmd);
                }
                self.console_input.clear();
            }
        });
    }

    fn ui_torrent(&mut self, ui: &mut egui::Ui) {
        ui.heading("Torrent");
        ui.separator();
        ui.label("Configure a local or remote torrent client (e.g., qBittorrent Web UI). Use the Settings page to persist defaults.");
        ui.horizontal(|ui| {
            ui.label("Web UI URL:");
            ui.add(TextEdit::singleline(&mut self.settings.torrent_url).desired_width(400.0));
        });
        ui.horizontal(|ui| {
            ui.label("Username:");
            ui.add(TextEdit::singleline(&mut self.settings.torrent_username).desired_width(200.0));
            ui.label("Password:");
            ui.add(
                TextEdit::singleline(&mut self.settings.torrent_password)
                    .password(true)
                    .desired_width(200.0),
            );
        });

        ui.horizontal(|ui| {
            if ui.button("Open Web UI in browser").clicked() {
                let url = self.settings.torrent_url.trim().to_string();
                if url.is_empty() {
                    self.log("Torrent URL is empty".into());
                } else {
                    let _ = open::that(&url);
                    self.log(format!("Opened {}", url));
                }
            }
            if ui.button("Save").clicked() {
                if let Err(e) = save_settings(&self.settings) {
                    self.log(format!("Error saving settings: {e:#}"));
                } else {
                    self.log("Torrent settings saved".into());
                    self.settings_dirty = false;
                }
            }
        });

        ui.separator();
        ui.label("Add magnet or .torrent URL:");
        static mut MAGNET_INPUT: Option<String> = None;
        // Safe-ish single-threaded GUI context usage
        let mi = unsafe { MAGNET_INPUT.get_or_insert_with(|| String::new()) };
        ui.horizontal(|ui| {
            let resp = ui.add(
                TextEdit::singleline(mi)
                    .hint_text("magnet:?xt=... or http(s)://...")
                    .desired_width(500.0),
            );
            if resp.lost_focus() && ui.input(|i| i.key_pressed(egui::Key::Enter)) {
                if !mi.trim().is_empty() {
                    self.log(format!("Add torrent: {}", mi.trim()));
                    // Future: send to configured RPC client
                    mi.clear();
                }
            }
            if ui.button("Add").clicked() {
                if !mi.trim().is_empty() {
                    self.log(format!("Add torrent: {}", mi.trim()));
                    mi.clear();
                }
            }
        });

        ui.separator();
        ui.label("Transfers (placeholder)");
        ui.colored_label(
            Color32::GRAY,
            "Torrent list and controls will appear here in a future update.",
        );
    }

    fn handle_command(&mut self, cmd: String) {
        match cmd.as_str() {
            "help" => {
                self.log("Commands: help, peers, open <url>, clear".into());
            }
            "peers" => {
                self.refresh_peers();
            }
            _ if cmd.starts_with("open ") => {
                let url = cmd[5..].trim().to_string();
                let _ = open::that(&url);
                self.log(format!("Opened {url}"));
            }
            "clear" => {
                self.logs.clear();
            }
            other => {
                self.log(format!("Unknown command: {other}"));
            }
        }
    }

    fn log(&mut self, msg: String) {
        let ts = time::OffsetDateTime::now_utc()
            .format(&Rfc3339)
            .unwrap_or_else(|_| "".into());
        let line = format!("[{ts}] {msg}");
        self.logs.push(line.clone());
        info!(target: "ui", "{}", line);
    }

    fn refresh_peers(&mut self) {
        let Some(http) = self.http.clone() else {
            return;
        };
        let Some(tx) = self.peer_tx.clone() else {
            return;
        };
        let url = format!(
            "{}/api/peers",
            self.settings.tracker_url.trim_end_matches('/')
        );
        self.status = "Loading peers...".into();
        self.log(format!("GET {}", url));
        std::thread::spawn(move || {
            let res: Result<Vec<PeerDto>> = (|| {
                let rt = tokio::runtime::Runtime::new()?;
                rt.block_on(async {
                    let resp = http.get(&url).send().await?;
                    if !resp.status().is_success() {
                        return Err(anyhow!("HTTP {}", resp.status()));
                    }
                    let peers: Vec<PeerDto> = resp.json().await?;
                    Ok(peers)
                })
            })();
            let _ = tx.send(res);
        });
    }

    fn connect_to_socket(&mut self, socket: String) {
        self.log(format!("Connecting to {socket}"));
        if !self.recent_sockets.contains(&socket) {
            self.recent_sockets.insert(0, socket.clone());
            let _ = save_recent_sockets(&self.recent_sockets);
        }
        // Upsert to tracker
        let Some(http) = self.http.clone() else {
            return;
        };
        let url = format!(
            "{}/api/peers/upsert",
            self.settings.tracker_url.trim_end_matches('/')
        );
        let body = serde_json::json!({"socket": socket});
        self.log(format!("POST {}", url));
        std::thread::spawn(move || {
            let rt = tokio::runtime::Runtime::new().unwrap();
            let _ = rt.block_on(async move {
                let _ = http.post(url).json(&body).send().await;
            });
        });
        // Check whitelist
        let host_allowed = is_host_allowed(&self.settings.allowed_hosts, &socket);
        if !host_allowed {
            if let Some(host) = extract_host(&socket) {
                self.pending_host_approval = Some(host);
                // Remember intent so approval banner can open it after allow
                self.new_socket_input = socket;
                self.log("Host not in whitelist. Asking for approval...".into());
                return;
            }
        }
        self.open_repo_tab(socket);
    }

    fn open_repo_tab(&mut self, url: String) {
        let title = url.clone();
        self.repo_tabs.push(RepoTab { title, url });
        let idx = self.repo_tabs.len() - 1;
        self.active_tab = Screen::Repo(idx);
        // Persist open tabs
        let _ = save_open_tabs(&self.repo_tabs.iter().map(|t| t.url.clone()).collect());
        // On Windows we embed into the main view; on other platforms keep separate window fallback
        #[cfg(all(feature = "webview", not(windows)))]
        if let Some(tab) = self.repo_tabs.get(idx).cloned() {
            let allow = self.settings.allowed_hosts.clone();
            spawn_webview_window(tab.title.clone(), tab.url.clone(), allow, self.http.clone());
        }
    }
}

fn project_dirs() -> Option<ProjectDirs> {
    ProjectDirs::from("online", "Relay", "RelayClient")
}

fn settings_path() -> Option<PathBuf> {
    project_dirs().map(|d| d.config_dir().join("settings.json"))
}
fn recent_sockets_path() -> Option<PathBuf> {
    project_dirs().map(|d| d.data_dir().join("recent_sockets.json"))
}
fn open_tabs_path() -> Option<PathBuf> {
    project_dirs().map(|d| d.data_dir().join("open_tabs.json"))
}

fn load_settings() -> Result<Settings> {
    if let Some(path) = settings_path() {
        if path.exists() {
            // Backward compatible load with defaults for new fields
            let mut s: Settings = serde_json::from_slice(&fs::read(&path)?)?;
            if s.allowed_hosts.is_empty() {
                s.allowed_hosts = vec!["localhost".into(), "127.0.0.1".into(), "[::1]".into()];
            }
            if s.default_repo_url.is_none() {
                s.default_repo_url = std::env::var("RELAY_PEER_DEFAULT_URL").ok();
            }
            Ok(s)
        } else {
            Err(anyhow!("no settings"))
        }
    } else {
        Err(anyhow!("no dirs"))
    }
}
fn save_settings(s: &Settings) -> Result<()> {
    if let Some(path) = settings_path() {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(path, serde_json::to_vec_pretty(s)?)?;
        Ok(())
    } else {
        Err(anyhow!("no dirs"))
    }
}

fn load_recent_sockets() -> Result<Vec<String>> {
    if let Some(path) = recent_sockets_path() {
        if path.exists() {
            Ok(serde_json::from_slice(&fs::read(path)?)?)
        } else {
            Ok(vec![])
        }
    } else {
        Err(anyhow!("no dirs"))
    }
}
fn save_recent_sockets(list: &Vec<String>) -> Result<()> {
    if let Some(path) = recent_sockets_path() {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(path, serde_json::to_vec_pretty(list)?)?;
        Ok(())
    } else {
        Err(anyhow!("no dirs"))
    }
}

fn load_open_tabs() -> Result<Vec<String>> {
    if let Some(path) = open_tabs_path() {
        if path.exists() {
            Ok(serde_json::from_slice(&fs::read(path)?)?)
        } else {
            Ok(vec![])
        }
    } else {
        Err(anyhow!("no dirs"))
    }
}

fn save_open_tabs(list: &Vec<String>) -> Result<()> {
    if let Some(path) = open_tabs_path() {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(path, serde_json::to_vec_pretty(list)?)?;
        Ok(())
    } else {
        Err(anyhow!("no dirs"))
    }
}

fn init_logging() -> Result<()> {
    let dirs = project_dirs().ok_or_else(|| anyhow!("no project dirs"))?;
    fs::create_dir_all(dirs.data_local_dir()).ok();
    let file_appender = rolling::daily(dirs.data_local_dir(), "client.log");
    let (non_blocking, _guard) = tracing_appender::non_blocking(file_appender);
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .with_writer(non_blocking)
        .with_ansi(false)
        .try_init()
        .ok();
    Ok(())
}

fn extract_host(url: &str) -> Option<String> {
    url::Url::parse(url)
        .ok()
        .and_then(|u| u.host_str().map(|h| h.to_string()))
}

fn is_host_allowed(allowed: &Vec<String>, url: &str) -> bool {
    if let Some(host) = extract_host(url) {
        allowed.iter().any(|h| h.eq_ignore_ascii_case(&host))
    } else {
        false
    }
}

// ---------------------------
// Embedded WebView (separate window via Wry for non-Windows)
// ---------------------------
#[cfg(all(feature = "webview", not(target_os = "macos"), not(windows)))]
fn spawn_webview_window(
    title: String,
    url: String,
    allowed_hosts: Vec<String>,
    http_client: Option<reqwest::Client>,
) {
    // Spawn a dedicated thread to host the Wry event loop and window
    thread::spawn(move || {
        // Independent event loop for the WebView window
        let event_loop: EventLoop<()> = EventLoop::new();

        let window = WindowBuilder::new()
            .with_title(format!("Repository - {}", title))
            .build(&event_loop)
            .expect("Failed to create WebView window");

        // Initialization script: install window.relay bridge
        let init_js = r#"
            (function(){
              function post(msg){
                try { window.ipc.postMessage(JSON.stringify(msg)); } catch(e) { console.error('ipc.postMessage failed', e); }
              }
              window.relay = {
                send(action, payload){
                  post({ action, payload: payload ?? null });
                },
                log(level,...args){ try{ console[level]?.('[relay]',...args); }catch(_){} }
              };
              console.debug('[relay] simple bridge initialized');
            })();
        "#;

        // Build WebView
        let webview = WebViewBuilder::new(&window)
            .with_initialization_script(init_js)
            .with_url(&url)
            .with_ipc_handler(move |req: WryRequest<String>| {
                let arg = req.body().clone();
                // Handle JSON RPC from page
                match serde_json::from_str::<BridgeRequest>(&arg) {
                    Ok(req) => {
                        // We trust connect-time whitelist; the page performs its own fetches.
                        // Dispatch actions
                        if req.action == "app.openExternal" {
                            let href = req
                                .payload
                                .get("url")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();
                            let _ = open::that(&href);
                        } else if req.action == "media.play" {
                            if let Some(path) = req.payload.get("path").and_then(|v| v.as_str()) {
                                let _ = play_with_default_app(Path::new(path));
                            }
                        } else if req.action == "seed.start" {
                            // Stub seeding, return a fake task id
                            let _task_id = format!("seed-{}", req.id.as_deref().unwrap_or("0"));
                            // TODO: later wire to torrent/IPFS engine and send events back if needed
                        } else {
                            // Unknown action: log
                            eprintln!("[relay] unknown action from webview: {}", req.action);
                        }
                    }
                    Err(e) => {
                        eprintln!("[relay] bad webview message: {}", e);
                    }
                }
            })
            .build()
            .expect("Failed to create WebView");

        // Run loop; deliver JS responses from UserEvent strings
        event_loop.run(move |event, _, control_flow| {
            *control_flow = ControlFlow::Wait;
            match event {
                Event::WindowEvent {
                    event: WindowEvent::CloseRequested,
                    ..
                } => {
                    *control_flow = ControlFlow::Exit;
                }
                _ => {}
            }
        });
    });
}

// ---------------------------
// Windows Embedded WebView2 (child window inside main view)
// ---------------------------
#[cfg(all(windows, feature = "webview"))]
struct EmbeddedWebViewWin {
    parent: HWND,
    child: HWND,
    inner: Arc<Mutex<EmbeddedInner>>,
    allowed_hosts: Vec<String>,
}

#[cfg(all(windows, feature = "webview"))]
#[derive(Default)]
struct EmbeddedInner {
    controller: Option<Controller>,
    webview: Option<WebView>,
    current_url: String,
    created: bool,
}

#[cfg(all(windows, feature = "webview"))]
impl EmbeddedWebViewWin {
    fn new(parent: HWND, allowed_hosts: Vec<String>) -> Self {
        unsafe {
            let _ = CoInitializeEx(std::ptr::null_mut(), COINIT_APARTMENTTHREADED);
        }
        Self {
            parent,
            child: std::ptr::null_mut(),
            inner: Arc::new(Mutex::new(EmbeddedInner::default())),
            allowed_hosts,
        }
    }

    fn ensure_created(&mut self, x: i32, y: i32, w: i32, h: i32, url: &str) {
        if self.child.is_null() {
            // Create a child host window
            unsafe {
                let class_name = U16CString::from_str("Static").unwrap();
                let window_name = U16CString::from_str("WebViewHost").unwrap();
                let instance = GetModuleHandleW(std::ptr::null());
                self.child = CreateWindowExW(
                    0,
                    class_name.as_ptr(),
                    window_name.as_ptr(),
                    (WS_CHILD | WS_VISIBLE | WS_CLIPSIBLINGS) as u32,
                    x,
                    y,
                    w.max(1),
                    h.max(1),
                    self.parent,
                    std::ptr::null_mut(),
                    instance,
                    std::ptr::null_mut(),
                );
            }
            self.init_webview(url.to_string());
        }
        self.set_bounds(x, y, w, h);
        self.show();
        // Navigate if URL changed
        if let Ok(mut inner) = self.inner.lock() {
            if inner.current_url != url {
                if let Some(wv) = &inner.webview {
                    let _ = wv.navigate(url);
                }
                inner.current_url = url.to_string();
            }
        }
    }

    fn init_webview(&mut self, url: String) {
        let inner = self.inner.clone();
        let child = self.child;
        let init_js = r#"
            (function(){
              function post(msg){
                try { window.chrome.webview.postMessage(JSON.stringify(msg)); } catch(e) { console.error('postMessage failed', e); }
              }
              window.relay = {
                send(action, payload){ post({ action, payload: payload ?? null }); },
                log(level,...args){ try{ console[level]?.('[relay]',...args); }catch(_){} }
              };
              console.debug('[relay] bridge initialized');
            })();
        "#;
        // Build environment and controller asynchronously; callbacks set inner state
        if let Err(e) = Environment::builder().build(move |env| {
            let env = env?;
            let inner = inner.clone();
            env.create_controller(child, move |c| {
                let controller = c?;
                controller.put_is_visible(true)?;
                let webview = controller.get_webview()?;
                // Inject init script
                webview.add_script_to_execute_on_document_created(init_js, |_| Ok(()))?;
                // Message handler
                let inner_for_msg = inner.clone();
                let _ = webview.add_web_message_received(
                    move |_sender, args: WebMessageReceivedEventArgs| {
                        if let Ok(json) = args.try_get_web_message_as_string() {
                            if let Ok(req) = serde_json::from_str::<BridgeRequest>(&json) {
                                if req.action == "app.openExternal" {
                                    if let Some(href) =
                                        req.payload.get("url").and_then(|v| v.as_str())
                                    {
                                        let _ = open::that(href);
                                    }
                                } else if req.action == "media.play" {
                                    if let Some(path) =
                                        req.payload.get("path").and_then(|v| v.as_str())
                                    {
                                        let _ = play_with_default_app(Path::new(path));
                                    }
                                } else if req.action == "seed.start" {
                                    // stub
                                } else {
                                    eprintln!("[relay] unknown action: {}", req.action);
                                }
                            }
                        }
                        Ok(())
                    },
                );

                // Navigate to initial URL
                webview.navigate(&url)?;
                if let Ok(mut guard) = inner_for_msg.lock() {
                    guard.controller = Some(controller);
                    guard.webview = Some(webview);
                    guard.current_url = url.clone();
                    guard.created = true;
                }
                Ok(())
            })
        }) {
            eprintln!("WebView2 init error: {e:?}");
        }
    }

    fn set_bounds(&self, x: i32, y: i32, w: i32, h: i32) {
        unsafe {
            let _ = SetWindowPos(
                self.child,
                std::ptr::null_mut(),
                x,
                y,
                w.max(1),
                h.max(1),
                SWP_NOZORDER,
            );
        }
        if let Ok(inner) = self.inner.lock() {
            if let Some(controller) = &inner.controller {
                // Controller bounds are relative to its parent window (our child),
                // so use (0,0,w,h) to fully fill the child window.
                let rect = RECT {
                    left: 0,
                    top: 0,
                    right: w.max(1),
                    bottom: h.max(1),
                };
                let _ = controller.put_bounds(rect);
            }
        }
    }

    fn navigate(&mut self, url: &str) {
        if let Ok(mut inner) = self.inner.lock() {
            if let Some(wv) = &inner.webview {
                let _ = wv.navigate(url);
            }
            inner.current_url = url.to_string();
        }
    }

    fn show(&self) {
        unsafe {
            let _ = ShowWindow(self.child, SW_SHOW);
        }
        if let Ok(inner) = self.inner.lock() {
            if let Some(c) = &inner.controller {
                let _ = c.put_is_visible(true);
            }
        }
    }

    fn hide(&mut self) {
        // Hide controller and shrink/move the child so it does not paint over other screens
        if let Ok(inner) = self.inner.lock() {
            if let Some(c) = &inner.controller {
                let _ = c.put_is_visible(false);
                let _ = c.put_bounds(RECT {
                    left: 0,
                    top: 0,
                    right: 1,
                    bottom: 1,
                });
            }
        }
        unsafe {
            let _ = SetWindowPos(self.child, std::ptr::null_mut(), 0, 0, 1, 1, SWP_NOZORDER);
            let _ = ShowWindow(self.child, SW_HIDE);
        }
        // We intentionally keep it alive for quick re-show
    }

    fn open_devtools(&mut self) {
        if let Ok(inner) = self.inner.lock() {
            if let Some(wv) = &inner.webview {
                let _ = wv.open_dev_tools_window();
            }
        }
    }

    fn reload(&mut self) {
        if let Ok(inner) = self.inner.lock() {
            if let Some(wv) = &inner.webview {
                let _ = wv.reload();
            }
        }
    }
}

#[cfg(all(windows, feature = "webview"))]
fn find_main_hwnd() -> Option<HWND> {
    unsafe {
        let title = U16CString::from_str("Relay Client").ok()?;
        let hwnd = FindWindowW(std::ptr::null(), title.as_ptr());
        if hwnd.is_null() {
            None
        } else {
            Some(hwnd)
        }
    }
}

// Apply a slightly larger, more spacious theme: bigger paddings and controls
fn apply_theme(ctx: &EguiContext) {
    let mut style = (*ctx.style()).clone();
    // More generous padding and spacing
    style.spacing.item_spacing = egui::vec2(10.0, 10.0);
    style.spacing.button_padding = egui::vec2(12.0, 8.0);
    style.spacing.window_margin = egui::Margin::same(14.0);
    style.spacing.interact_size = egui::vec2(36.0, 28.0);
    // Slightly larger body text for readability
    if let Some(font_id) = style.text_styles.get_mut(&egui::TextStyle::Body) {
        font_id.size = (font_id.size + 1.0).max(12.0);
    }
    ctx.set_style(style);
}

fn play_with_default_app(path: &Path) -> Result<()> {
    info!(target: "media", "Open default app: {}", path.display());
    open::that(path).context("Failed to open with default app")?;
    Ok(())
}

#[allow(unused_variables)]
fn play_fullscreen_internal(path: &Path) -> Result<()> {
    #[cfg(feature = "internal_player")]
    {
        use std::process::Command;

        if !path.exists() {
            return Err(anyhow!("file does not exist: {}", path.display()));
        }

        // Try to auto-detect a sidecar subtitle next to the media
        let mut sub_arg: Option<String> = None;
        if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
            if let Some(parent) = path.parent() {
                let candidates = [".srt", ".ass", ".vtt", ".sub"]; 
                for ext in candidates { 
                    let p = parent.join(format!("{stem}{ext}"));
                    if p.exists() {
                        sub_arg = Some(format!("--sub-file={}", p.display()));
                        break;
                    }
                }
            }
        }

        info!(target: "media", "Launching mpv fullscreen: {}", path.display());
        if let Some(sa) = &sub_arg { info!(target: "media", "Using subtitles: {}", sa); }

        // Spawn mpv CLI as the internal fullscreen player. This provides robust
        // playback and subtitle support across platforms when mpv is installed.
        // Controls: Space=pause, arrows=seek, F=toggle fullscreen, V=toggle subs, Q/Esc=quit
        let mut cmd = Command::new("mpv");
        cmd.arg("--fs")
            .arg("--force-window=yes")
            .arg("--osc=yes")
            .arg("--input-default-bindings=yes")
            .arg(path.as_os_str());
        if let Some(sa) = sub_arg { cmd.arg(sa); }

        let status = cmd.status().map_err(|e| {
            anyhow!(
                "Failed to launch mpv. Ensure mpv is installed and available on PATH. Error: {e}"
            )
        })?;
        if !status.success() {
            return Err(anyhow!("mpv exited with non-zero status: {:?}", status.code()));
        }
        Ok(())
    }
    #[cfg(not(feature = "internal_player"))]
    {
        Err(anyhow!("compiled without internal_player feature"))
    }
}

fn main() {
    init_logging().ok();
    info!("Starting Relay Client");
    // If launched with a single file path argument, attempt to open with default app.
    if let Some(arg1) = std::env::args().nth(1) {
        let p = std::path::PathBuf::from(&arg1);
        if p.exists() {
            if let Err(e) = play_with_default_app(&p) {
                eprintln!("Failed to open {}: {e:#}", p.display());
            }
        }
    }
    let native_options = NativeOptions::default();
    let app = RelayClientApp::new();
    if let Err(e) = eframe::run_native(
        "Relay Client",
        native_options,
        Box::new(|_cc| Box::new(app)),
    ) {
        eprintln!("Failed to start UI: {e}");
    }
}
