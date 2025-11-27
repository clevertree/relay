use crate::errors::{Result, StreamingError};
use directories::ProjectDirs;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TorrentEntry {
    pub save_path: String,
    pub created_at: i64,
    pub last_seen: i64,
    pub name: Option<String>,
    pub size: Option<u64>,
    #[serde(default)]
    pub files: Option<Vec<FileEntry>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct FileEntry {
    pub path: String,
    pub length: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamingConfig {
    pub config_version: u32,
    pub download_dir: Option<String>,
    #[serde(default)]
    pub auto_play_confirmed: bool,
    #[serde(default)]
    pub seeding_default: bool,
    // Auto-open the player on allow (when thresholds met and autoplay consented)
    #[serde(default = "default_auto_open_player_on_allow")]
    pub auto_open_player_on_allow: bool,
    // Playback thresholds (per device)
    // Allow play when first N MB available OR when downloaded >= min(total MB, percent of file)
    #[serde(default = "default_play_min_first_bytes_mb")]
    pub play_min_first_bytes_mb: u32,
    #[serde(default = "default_play_min_total_mb")]
    pub play_min_total_mb: u32,
    #[serde(default = "default_play_min_total_percent")]
    pub play_min_total_percent: u32,
    // Resume-on-available polling controls
    #[serde(default = "default_resume_poll_interval_sec")]
    pub resume_poll_interval_sec: u32,
    #[serde(default = "default_resume_timeout_min")]
    pub resume_timeout_min: u32,
    // Preferred backend: "auto" | "qbt" | "transmission"
    #[serde(default = "default_preferred_backend")]
    pub preferred_backend: String,
    // Playback target: how to open media when allowed: auto | tauri | system
    #[serde(default = "default_playback_target")]
    pub playback_target: String,
    // Optional endpoint overrides
    #[serde(default)]
    pub qbt_host: Option<String>,
    #[serde(default)]
    pub qbt_port: Option<u16>,
    #[serde(default)]
    pub qbt_base: Option<String>,
    #[serde(default)]
    pub tr_host: Option<String>,
    #[serde(default)]
    pub tr_port: Option<u16>,
    #[serde(default)]
    pub tr_path: Option<String>,
    #[serde(default)]
    pub torrents: serde_json::Map<String, serde_json::Value>,
}

impl Default for StreamingConfig {
    fn default() -> Self {
        Self {
            config_version: 4,
            download_dir: None,
            auto_play_confirmed: false,
            seeding_default: true,
            auto_open_player_on_allow: default_auto_open_player_on_allow(),
            play_min_first_bytes_mb: default_play_min_first_bytes_mb(),
            play_min_total_mb: default_play_min_total_mb(),
            play_min_total_percent: default_play_min_total_percent(),
            resume_poll_interval_sec: default_resume_poll_interval_sec(),
            resume_timeout_min: default_resume_timeout_min(),
            preferred_backend: default_preferred_backend(),
            playback_target: default_playback_target(),
            qbt_host: None,
            qbt_port: None,
            qbt_base: None,
            tr_host: None,
            tr_port: None,
            tr_path: None,
            torrents: serde_json::Map::new(),
        }
    }
}

pub fn now_ts() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

pub struct ConfigPaths {
    pub dir: PathBuf,
    pub file: PathBuf,
}

pub fn config_paths() -> Result<ConfigPaths> {
    let proj = ProjectDirs::from("online", "relay", "relay").ok_or_else(|| {
        StreamingError::Config("unable to resolve config directory".into())
    })?;
    let dir = proj.config_dir().to_path_buf();
    let file = dir.join("streaming.json");
    Ok(ConfigPaths { dir, file })
}

pub fn load_or_default() -> Result<StreamingConfig> {
    let paths = config_paths()?;
    if paths.file.exists() {
        let text = fs::read_to_string(&paths.file)?;
        let mut cfg: StreamingConfig = serde_json::from_str(&text)?;
        migrate(&mut cfg);
        Ok(cfg)
    } else {
        Ok(StreamingConfig::default())
    }
}

pub fn save(cfg: &StreamingConfig) -> Result<()> {
    let paths = config_paths()?;
    if !paths.dir.exists() {
        fs::create_dir_all(&paths.dir)?;
    }
    let text = serde_json::to_string_pretty(cfg)?;
    fs::write(paths.file, text)?;
    Ok(())
}

fn migrate(cfg: &mut StreamingConfig) {
    if cfg.config_version == 0 {
        cfg.config_version = 1;
    }
    if cfg.config_version == 1 {
        // add new defaulted fields for v2
        if cfg.play_min_first_bytes_mb == 0 { cfg.play_min_first_bytes_mb = default_play_min_first_bytes_mb(); }
        if cfg.play_min_total_mb == 0 { cfg.play_min_total_mb = default_play_min_total_mb(); }
        if cfg.play_min_total_percent == 0 { cfg.play_min_total_percent = default_play_min_total_percent(); }
        if cfg.resume_poll_interval_sec == 0 { cfg.resume_poll_interval_sec = default_resume_poll_interval_sec(); }
        if cfg.resume_timeout_min == 0 { cfg.resume_timeout_min = default_resume_timeout_min(); }
        if cfg.preferred_backend.is_empty() { cfg.preferred_backend = default_preferred_backend(); }
        // endpoint overrides introduced in v2 default to None (use env)
        cfg.config_version = 2;
    }
    if cfg.config_version == 2 {
        // v3 introduces auto_open_player_on_allow defaulting to true
        if !cfg.auto_open_player_on_allow {
            // We only set it to true if the field wasn't present; serde default would leave it false here if missing.
            // To avoid flipping explicit false, check that it's effectively uninitialized by detecting absence is not trivial here.
            // Conservative: set true when upgrading to v3.
            cfg.auto_open_player_on_allow = default_auto_open_player_on_allow();
        }
        cfg.config_version = 3;
    }
    if cfg.config_version == 3 {
        // v4 introduces playback_target with default "auto"
        if cfg.playback_target.is_empty() {
            cfg.playback_target = default_playback_target();
        }
        cfg.config_version = 4;
    }
}

/// Public helper to migrate an in-memory config (useful for tests)
pub fn migrate_public(cfg: &mut StreamingConfig) {
    migrate(cfg)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrate_v1_to_v2_sets_defaults() {
        let json_v1 = serde_json::json!({
            "config_version": 1,
            "download_dir": null,
            "auto_play_confirmed": false,
            "seeding_default": true,
            "torrents": {}
        });
        let mut cfg: StreamingConfig = serde_json::from_value(json_v1).expect("deserialize v1");
        assert_eq!(cfg.config_version, 1);
        // fields may be zero/empty pre-migrate
        migrate_public(&mut cfg);
        assert_eq!(cfg.config_version, 4);
        assert!(cfg.play_min_first_bytes_mb > 0);
        assert!(cfg.play_min_total_mb > 0);
        assert!(cfg.play_min_total_percent > 0);
        assert!(cfg.resume_poll_interval_sec > 0);
        assert!(cfg.resume_timeout_min > 0);
        assert!(!cfg.preferred_backend.is_empty());
        assert!(cfg.auto_open_player_on_allow);
        assert_eq!(cfg.playback_target, "auto");
        // endpoint overrides remain None
        assert!(cfg.qbt_host.is_none());
        assert!(cfg.qbt_port.is_none());
        assert!(cfg.qbt_base.is_none());
        assert!(cfg.tr_host.is_none());
        assert!(cfg.tr_port.is_none());
        assert!(cfg.tr_path.is_none());
    }
}

pub fn default_download_dir() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        dirs::download_dir()
    }
    #[cfg(not(target_os = "windows"))]
    {
        dirs::download_dir()
    }
}

pub fn set_download_dir<P: AsRef<Path>>(cfg: &mut StreamingConfig, path: P) {
    cfg.download_dir = Some(path.as_ref().to_string_lossy().to_string());
}

// Defaults
fn default_auto_open_player_on_allow() -> bool { true }
fn default_play_min_first_bytes_mb() -> u32 { 16 }
fn default_play_min_total_mb() -> u32 { 64 }
fn default_play_min_total_percent() -> u32 { 1 }
fn default_resume_poll_interval_sec() -> u32 { 5 }
fn default_resume_timeout_min() -> u32 { 30 }
fn default_preferred_backend() -> String { "auto".to_string() }
fn default_playback_target() -> String { "auto".to_string() }
