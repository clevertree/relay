use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum TorrentState {
    Checking,
    Downloading,
    Stalled,
    Completed,
    Seeding,
    Paused,
    Error,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TorrentStatus {
    pub exists: bool,
    pub state: TorrentState,
    pub progress: f32,        // 0.0..=1.0
    pub size: u64,            // bytes
    pub downloaded: u64,      // bytes
    pub upload: u64,          // bytes
    pub download_rate: u64,   // bytes/sec
    pub upload_rate: u64,     // bytes/sec
    pub info_hash: String,
    pub name: Option<String>,
    pub save_path: Option<String>,
    pub files_known: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TorrentFile {
    pub index: usize,
    pub path: String,
    pub length: u64,
    pub downloaded: u64,
    pub priority: u8,
    pub is_media: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AddResult {
    pub info_hash: String,
    pub name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PlayDecision {
    pub allow: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    pub remember: bool,
}

pub fn is_media_path(path: &str) -> bool {
    let p = path.to_ascii_lowercase();
    // Expanded set: common video containers + some audio containers (player support may vary)
    let exts = [
        // Video containers
        ".mp4", ".mkv", ".mov", ".avi", ".webm", ".m4v", ".mpg", ".mpeg",
        ".ts", ".m2ts", ".mts", ".flv", ".wmv",
        // Audio containers (allow attempting playback)
        ".mp3", ".aac", ".flac", ".ogg", ".wav",
    ];
    exts.iter().any(|ext| p.ends_with(ext))
}
