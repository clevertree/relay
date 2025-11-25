use crate::errors::{Result, StreamingError};
use crate::model::{AddResult, TorrentFile, TorrentState, TorrentStatus};

#[async_trait::async_trait]
pub trait TorrentClient: Send + Sync {
    async fn healthy(&self) -> Result<bool>;
    async fn add_magnet(
        &self,
        magnet: &str,
        save_path: Option<&str>,
        seeding: Option<bool>,
    ) -> Result<AddResult>;
    async fn status(&self, info_hash: &str) -> Result<TorrentStatus>;
    async fn list_files(&self, info_hash: &str) -> Result<Vec<TorrentFile>>;
    async fn set_seeding(&self, info_hash: &str, on: bool) -> Result<()>;
    async fn save_path(&self, info_hash: &str) -> Result<Option<String>>;
    fn name(&self) -> &'static str {
        "unknown"
    }
}

// Placeholder no-op client used until real adapters (qBittorrent / Transmission) are wired
pub struct NullClient;

#[async_trait::async_trait]
impl TorrentClient for NullClient {
    async fn healthy(&self) -> Result<bool> {
        Ok(false)
    }

    async fn add_magnet(
        &self,
        _magnet: &str,
        _save_path: Option<&str>,
        _seeding: Option<bool>,
    ) -> Result<AddResult> {
        Err(StreamingError::RpcUnavailable(
            "no torrent backend configured".into(),
        ))
    }

    async fn status(&self, info_hash: &str) -> Result<TorrentStatus> {
        Ok(TorrentStatus {
            exists: false,
            state: TorrentState::Unknown,
            progress: 0.0,
            size: 0,
            downloaded: 0,
            upload: 0,
            download_rate: 0,
            upload_rate: 0,
            info_hash: info_hash.to_string(),
            name: None,
            save_path: None,
            files_known: false,
        })
    }

    async fn list_files(&self, _info_hash: &str) -> Result<Vec<TorrentFile>> {
        Ok(vec![])
    }

    async fn set_seeding(&self, _info_hash: &str, _on: bool) -> Result<()> {
        Ok(())
    }

    async fn save_path(&self, _info_hash: &str) -> Result<Option<String>> {
        Ok(None)
    }

    fn name(&self) -> &'static str {
        "none"
    }
}

pub mod qbit;
pub mod transmission;
