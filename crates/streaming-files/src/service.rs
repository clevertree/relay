use crate::config::{load_or_default, save, StreamingConfig};
use crate::env::load_env;
use crate::errors::{Result, StreamingError};
use crate::model::{AddResult, TorrentFile, TorrentStatus};
use crate::rpc::qbit::QBitClient;
use crate::rpc::transmission::TransmissionClient;
use crate::rpc::{NullClient, TorrentClient};

#[cfg(feature = "client")]
use crate::config::{default_download_dir, set_download_dir};
#[cfg(feature = "client")]
use crate::model::PlayDecision;
#[cfg(feature = "client")]
use crate::playback::is_playable_by_thresholds;
#[cfg(feature = "client")]
use crate::ui::UiPrompt;

use std::sync::Arc;

pub struct StreamingService {
    cfg: StreamingConfig,
    client: Arc<dyn TorrentClient>,
}

impl StreamingService {
    pub fn new_with_client(client: Arc<dyn TorrentClient>) -> Result<Self> {
        let cfg = load_or_default()?;
        Ok(Self { cfg, client })
    }

    pub fn new() -> Result<Self> {
        // Keep synchronous constructor: default to qBittorrent based on env.
        let env = load_env();
        let base = if env.qbt.host.starts_with("http://") || env.qbt.host.starts_with("https://") {
            let mut b = env.qbt.host.clone();
            if !b.ends_with('/') {
                b.push('/');
            }
            b
        } else {
            let base = env.qbt.base.trim_start_matches('/');
            format!("http://{}:{}/{}", env.qbt.host, env.qbt.port, base)
        };
        let client: Arc<dyn TorrentClient> = Arc::new(QBitClient::new(base));
        Self::new_with_client(client)
    }

    /// Create a service by probing available backends (qBittorrent, then Transmission)
    pub async fn new_auto() -> Result<Self> {
        let env = load_env();
        // Load persisted config to honor preferred backend and endpoint overrides
        let cfg = load_or_default()?;

        // Resolve qBittorrent base URL
        let qbt_host = cfg.qbt_host.clone().unwrap_or(env.qbt.host);
        let qbt_port = cfg.qbt_port.unwrap_or(env.qbt.port);
        let qbt_base_cfg = cfg.qbt_base.clone().unwrap_or(env.qbt.base);
        let qbt_base = if qbt_host.starts_with("http://") || qbt_host.starts_with("https://") {
            let mut b = qbt_host.clone();
            if !b.ends_with('/') {
                b.push('/');
            }
            b
        } else {
            let base = qbt_base_cfg.trim_start_matches('/');
            format!("http://{}:{}/{}", qbt_host, qbt_port, base)
        };
        // Resolve Transmission base URL (full endpoint path)
        let tr_host = cfg.tr_host.clone().unwrap_or(env.tr.host);
        let tr_port = cfg.tr_port.unwrap_or(env.tr.port);
        let tr_path = cfg.tr_path.clone().unwrap_or(env.tr.path);
        let tr_base = format!("http://{}:{}{}", tr_host, tr_port, tr_path);

        // Preferred order
        let pref = cfg.preferred_backend.as_str();
        let try_qbt_first = pref == "qbt" || pref == "auto";
        let try_tr_first = pref == "transmission";

        if try_qbt_first {
            let qbt = Arc::new(QBitClient::new(qbt_base.clone()));
            if qbt.healthy().await.unwrap_or(false) {
                return Ok(StreamingService { cfg, client: qbt });
            }
            let tr = Arc::new(TransmissionClient::new(tr_base.clone()));
            if tr.healthy().await.unwrap_or(false) {
                return Ok(StreamingService { cfg, client: tr });
            }
        } else if try_tr_first {
            let tr = Arc::new(TransmissionClient::new(tr_base.clone()));
            if tr.healthy().await.unwrap_or(false) {
                return Ok(StreamingService { cfg, client: tr });
            }
            let qbt = Arc::new(QBitClient::new(qbt_base.clone()));
            if qbt.healthy().await.unwrap_or(false) {
                return Ok(StreamingService { cfg, client: qbt });
            }
        }

        // None available
        let null = Arc::new(NullClient) as Arc<dyn TorrentClient>;
        let _svc = StreamingService { cfg, client: null };
        Err(StreamingError::RpcUnavailable("No torrent backend available. Ensure qBittorrent WebUI (http://127.0.0.1:8080) or Transmission RPC (http://127.0.0.1:9091/transmission/rpc) is running. On localhost, enable WebUI and bypass auth for 127.0.0.1 for development.".into()))
    }

    /// Attempt to switch to any healthy backend at runtime (qBittorrent preferred)
    pub async fn refresh_backend(&mut self) -> Result<()> {
        let env = load_env();
        // Prefer config overrides when present
        let qbt_host = self.cfg.qbt_host.clone().unwrap_or(env.qbt.host);
        let qbt_port = self.cfg.qbt_port.unwrap_or(env.qbt.port);
        let qbt_base_cfg = self.cfg.qbt_base.clone().unwrap_or(env.qbt.base);
        let qbt_base = if qbt_host.starts_with("http://") || qbt_host.starts_with("https://") {
            let mut b = qbt_host.clone();
            if !b.ends_with('/') {
                b.push('/');
            }
            b
        } else {
            let base = qbt_base_cfg.trim_start_matches('/');
            format!("http://{}:{}/{}", qbt_host, qbt_port, base)
        };
        let qbt = Arc::new(QBitClient::new(qbt_base));
        if qbt.healthy().await.unwrap_or(false) {
            self.client = qbt;
            return Ok(());
        }
        let tr_host = self.cfg.tr_host.clone().unwrap_or(env.tr.host);
        let tr_port = self.cfg.tr_port.unwrap_or(env.tr.port);
        let tr_path = self.cfg.tr_path.clone().unwrap_or(env.tr.path);
        let tr_base = format!("http://{}:{}{}", tr_host, tr_port, tr_path);
        let tr = Arc::new(TransmissionClient::new(tr_base));
        if tr.healthy().await.unwrap_or(false) {
            self.client = tr;
            return Ok(());
        }
        Err(StreamingError::RpcUnavailable(
            "no healthy torrent backend found".into(),
        ))
    }

    pub fn config(&self) -> &StreamingConfig {
        &self.cfg
    }

    pub fn get_config(&self) -> StreamingConfig {
        self.cfg.clone()
    }

    pub fn active_backend_name(&self) -> &'static str {
        self.client.name()
    }

    /// Apply a partial config patch from JSON with validation; persist to disk.
    /// Only known, safe keys are applied. Returns reference to updated config.
    pub fn apply_config_patch(&mut self, patch: serde_json::Value) -> Result<&StreamingConfig> {
        use serde_json::Value as V;
        let obj = match patch {
            V::Object(m) => m,
            _ => {
                return Err(StreamingError::Invalid(
                    "config patch must be an object".into(),
                ))
            }
        };

        // Helper to read u32 with clamping
        let u32_field = |key: &str, min: u32, max: u32, apply: &mut dyn FnMut(u32)| -> Result<()> {
            if let Some(v) = obj.get(key) {
                let n = match v {
                    V::Number(n) => n.as_u64().ok_or_else(|| {
                        StreamingError::Invalid(format!("{key} must be a non-negative integer"))
                    })? as u32,
                    V::String(s) => s.parse::<u32>().map_err(|_| {
                        StreamingError::Invalid(format!("{key} must be an integer"))
                    })?,
                    _ => return Err(StreamingError::Invalid(format!("{key} must be a number"))),
                };
                let clamped = n.clamp(min, max);
                apply(clamped);
            }
            Ok(())
        };

        // Booleans
        if let Some(v) = obj.get("auto_play_confirmed") {
            if v.is_boolean() {
                self.cfg.auto_play_confirmed = v.as_bool().unwrap_or(self.cfg.auto_play_confirmed);
            }
        }
        if let Some(v) = obj.get("seeding_default") {
            if v.is_boolean() {
                self.cfg.seeding_default = v.as_bool().unwrap_or(self.cfg.seeding_default);
            }
        }
        if let Some(v) = obj.get("auto_open_player_on_allow") {
            if v.is_boolean() {
                self.cfg.auto_open_player_on_allow =
                    v.as_bool().unwrap_or(self.cfg.auto_open_player_on_allow);
            }
        }

        // Thresholds
        u32_field("play_min_first_bytes_mb", 0, 16_384, &mut |n| {
            self.cfg.play_min_first_bytes_mb = n
        })?;
        u32_field("play_min_total_mb", 0, 65_536, &mut |n| {
            self.cfg.play_min_total_mb = n
        })?;
        u32_field("play_min_total_percent", 0, 100, &mut |n| {
            self.cfg.play_min_total_percent = n
        })?;
        // Resume controls
        u32_field("resume_poll_interval_sec", 1, 3_600, &mut |n| {
            self.cfg.resume_poll_interval_sec = n
        })?;
        u32_field("resume_timeout_min", 1, 10_080, &mut |n| {
            self.cfg.resume_timeout_min = n
        })?; // up to 7 days

        // Preferred backend
        if let Some(V::String(s)) = obj.get("preferred_backend") {
            let v = s.to_ascii_lowercase();
            if matches!(v.as_str(), "auto" | "qbt" | "transmission") {
                self.cfg.preferred_backend = v;
            } else {
                return Err(StreamingError::Invalid(
                    "preferred_backend must be one of: auto, qbt, transmission".into(),
                ));
            }
        }

        // Playback target: auto | tauri | system
        if let Some(V::String(s)) = obj.get("playback_target") {
            let v = s.to_ascii_lowercase();
            if matches!(v.as_str(), "auto" | "tauri" | "system") {
                self.cfg.playback_target = v;
            } else {
                return Err(StreamingError::Invalid(
                    "playback_target must be one of: auto, tauri, system".into(),
                ));
            }
        }

        // Endpoint overrides (optional). Sanitize lightly.
        if let Some(V::String(s)) = obj.get("qbt_host") {
            let t = s.trim();
            self.cfg.qbt_host = if t.is_empty() {
                None
            } else {
                Some(t.to_string())
            };
        }
        if let Some(v) = obj.get("qbt_port") {
            let n = match v {
                V::Number(n) => n.as_u64().unwrap_or(0) as u32,
                V::String(s) => s.parse::<u32>().unwrap_or(0),
                _ => 0,
            };
            if n > 0 && n <= 65535 {
                self.cfg.qbt_port = Some(n as u16);
            }
        }
        if let Some(V::String(s)) = obj.get("qbt_base") {
            let mut t = s.trim().to_string();
            if !t.starts_with('/') {
                t = format!("/{}", t);
            }
            self.cfg.qbt_base = if t == "/" { Some("/".into()) } else { Some(t) };
        }
        if let Some(V::String(s)) = obj.get("tr_host") {
            let t = s.trim();
            self.cfg.tr_host = if t.is_empty() {
                None
            } else {
                Some(t.to_string())
            };
        }
        if let Some(v) = obj.get("tr_port") {
            let n = match v {
                V::Number(n) => n.as_u64().unwrap_or(0) as u32,
                V::String(s) => s.parse::<u32>().unwrap_or(0),
                _ => 0,
            };
            if n > 0 && n <= 65535 {
                self.cfg.tr_port = Some(n as u16);
            }
        }
        if let Some(V::String(s)) = obj.get("tr_path") {
            let mut t = s.trim().to_string();
            if !t.starts_with('/') {
                t = format!("/{}", t);
            }
            self.cfg.tr_path = Some(t);
        }

        save(&self.cfg)?;
        Ok(&self.cfg)
    }

    pub fn env_defaults_download_dir() -> Option<String> {
        let env = load_env();
        env.download_dir
    }

    pub fn ensure_config(&mut self) -> Result<()> {
        // currently nothing to ensure besides having it loaded
        Ok(())
    }

    #[cfg(feature = "client")]
    pub async fn get_or_prompt_download_dir<P: UiPrompt>(&mut self, ui: &P) -> Result<String> {
        if let Some(dir) = &self.cfg.download_dir {
            return Ok(dir.clone());
        }
        let suggested = Self::env_defaults_download_dir()
            .or_else(|| default_download_dir().map(|p| p.to_string_lossy().to_string()));
        let chosen = ui.pick_download_dir(suggested.as_deref()).await?;
        let final_dir = chosen
            .or(suggested)
            .ok_or_else(|| StreamingError::Config("no download directory selected".into()))?;
        set_download_dir(&mut self.cfg, &final_dir);
        save(&self.cfg)?;
        Ok(final_dir)
    }

    pub async fn add_magnet(
        &self,
        magnet: &str,
        save_path: Option<&str>,
        seeding: Option<bool>,
    ) -> Result<AddResult> {
        if !magnet.starts_with("magnet:") {
            return Err(StreamingError::Invalid("expected a magnet URI".into()));
        }
        self.client.add_magnet(magnet, save_path, seeding).await
    }

    pub async fn get_status(&self, info_hash_or_magnet: &str) -> Result<TorrentStatus> {
        // If given a magnet, try to extract btih
        let ih = if let Some(h) = extract_btih(info_hash_or_magnet) {
            h
        } else {
            info_hash_or_magnet
        };
        self.client.status(ih).await
    }

    pub async fn list_files(&self, info_hash: &str) -> Result<Vec<TorrentFile>> {
        self.client.list_files(info_hash).await
    }

    pub async fn set_seeding(&self, info_hash: &str, on: bool) -> Result<()> {
        self.client.set_seeding(info_hash, on).await
    }

    #[cfg(feature = "client")]
    pub async fn request_play<P: UiPrompt>(
        &mut self,
        info_hash: &str,
        file_index: Option<usize>,
        ui: &P,
    ) -> Result<PlayDecision> {
        let files = self.client.list_files(info_hash).await?;
        let (_idx, file) = match pick_file(files, file_index) {
            Some(t) => t,
            None => {
                return Ok(PlayDecision {
                    allow: false,
                    path: None,
                    reason: Some("No files available".into()),
                    remember: false,
                });
            }
        };

        // Compute playability based on configured thresholds (centralized helper)
        let first_bytes = (self.cfg.play_min_first_bytes_mb as u64) * 1024 * 1024;
        let min_total_bytes = (self.cfg.play_min_total_mb as u64) * 1024 * 1024;
        let allow_now = is_playable_by_thresholds(
            file.downloaded,
            file.length,
            first_bytes,
            min_total_bytes,
            self.cfg.play_min_total_percent,
        );

        // OS-level confirmation unless user has opted into autoplay per device
        let mut remember = false;
        if !self.cfg.auto_play_confirmed {
            let title = file.path.rsplit('/').next().unwrap_or(&file.path);
            let confirm = ui.confirm_play(title, &file.path, file.length).await?;
            if !confirm.proceed {
                return Ok(PlayDecision {
                    allow: false,
                    path: None,
                    reason: Some("User canceled".into()),
                    remember: confirm.remember,
                });
            }
            if confirm.remember {
                self.cfg.auto_play_confirmed = true;
                save(&self.cfg)?;
            }
            remember = confirm.remember;
        }

        if allow_now {
            Ok(PlayDecision {
                allow: true,
                path: Some(file.path),
                reason: None,
                remember,
            })
        } else {
            Ok(PlayDecision {
                allow: false,
                path: None,
                reason: Some("Insufficient data yet".into()),
                remember,
            })
        }
    }
}

fn extract_btih(s: &str) -> Option<&str> {
    if let Some(idx) = s.find("urn:btih:") {
        let sub = &s[idx + 9..];
        let end = sub.find('&').unwrap_or(sub.len());
        return Some(&sub[..end]);
    }
    if s.len() == 40 && s.chars().all(|c| c.is_ascii_hexdigit()) {
        return Some(s);
    }
    None
}

#[cfg(feature = "client")]
fn pick_file(files: Vec<TorrentFile>, index: Option<usize>) -> Option<(usize, TorrentFile)> {
    if let Some(i) = index {
        files.into_iter().enumerate().find(|(idx, _)| *idx == i)
    } else {
        files
            .into_iter()
            .enumerate()
            .filter(|(_, f)| f.is_media)
            .max_by_key(|(_, f)| f.length)
    }
}
