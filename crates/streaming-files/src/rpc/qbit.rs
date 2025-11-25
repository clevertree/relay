use crate::errors::{Result, StreamingError};
use crate::model::{AddResult, TorrentFile, TorrentState, TorrentStatus};
use crate::rpc::TorrentClient;
use reqwest::{Client, StatusCode};
use serde::Deserialize;

pub struct QBitClient {
    pub base_url: String,
    client: Client,
}

impl QBitClient {
    pub fn new<S: Into<String>>(base_url: S) -> Self {
        let client = Client::builder()
            .cookie_store(true)
            .build()
            .expect("reqwest client");
        // normalize: ensure trailing slash
        let mut b = base_url.into();
        if !b.ends_with('/') {
            b.push('/');
        }
        Self {
            base_url: b,
            client,
        }
    }

    fn url(&self, path: &str) -> String {
        if path.starts_with('/') {
            format!("{}{}", self.base_url.trim_end_matches('/'), path)
        } else {
            format!("{}{}", self.base_url, path)
        }
    }
}

#[derive(Debug, Deserialize)]
struct QbtInfoItem {
    hash: Option<String>,
    name: Option<String>,
    state: Option<String>,
    progress: Option<f64>,
    dlspeed: Option<u64>,
    upspeed: Option<u64>,
    downloaded: Option<u64>,
    uploaded: Option<u64>,
    total_size: Option<u64>,
    size: Option<u64>,
    save_path: Option<String>,
}

#[derive(Debug, Deserialize)]
struct QbtFileItem {
    name: String,
    size: u64,
    progress: f64,
    priority: i32,
}

fn map_state(s: &str) -> TorrentState {
    // qBittorrent states (subset): "stalledDL", "downloading", "pausedDL", "queuedDL",
    // "checkingDL", "metaDL", "stalledUP", "uploading", "pausedUP", "queuedUP", "checkingUP", "error"
    let ls = s.to_ascii_lowercase();
    if ls.contains("error") {
        return TorrentState::Error;
    }
    if ls.contains("checking") {
        return TorrentState::Checking;
    }
    if ls.contains("upload") || ls.contains("up") {
        return TorrentState::Seeding;
    }
    if ls.contains("stalleddl") {
        return TorrentState::Stalled;
    }
    if ls.contains("down") || ls.contains("meta") {
        return TorrentState::Downloading;
    }
    if ls.contains("paused") {
        return TorrentState::Paused;
    }
    if ls.contains("complete") {
        return TorrentState::Completed;
    }
    TorrentState::Unknown
}

#[async_trait::async_trait]
impl TorrentClient for QBitClient {
    fn name(&self) -> &'static str {
        "qbt"
    }
    async fn healthy(&self) -> Result<bool> {
        let url = self.url("api/v2/app/version");
        let resp = self.client.get(url).send().await;
        match resp {
            Ok(r) => Ok(r.status().is_success()),
            Err(_) => Ok(false),
        }
    }

    async fn add_magnet(
        &self,
        magnet: &str,
        save_path: Option<&str>,
        seeding: Option<bool>,
    ) -> Result<AddResult> {
        let url = self.url("api/v2/torrents/add");
        let mut form = vec![("urls", magnet.to_string())];
        if let Some(p) = save_path {
            form.push(("savepath", p.to_string()));
        }
        // If seeding explicitly on, force start; if off, paused add
        if let Some(on) = seeding {
            if on {
                form.push(("autoTMM", "false".into()));
                form.push(("paused", "false".into()));
                form.push(("skip_checking", "true".into()));
                form.push(("sequentialDownload", "false".into()));
            } else {
                form.push(("paused", "true".into()));
            }
        }
        let resp = self
            .client
            .post(url)
            .form(&form)
            .send()
            .await
            .map_err(|e| StreamingError::RpcUnavailable(format!("qbt add failed: {}", e)))?;
        if !resp.status().is_success() {
            return Err(StreamingError::RpcUnavailable(format!(
                "qbt add failed: HTTP {}",
                resp.status()
            )));
        }
        // qBittorrent does not return info hash here; require caller to poll status by magnet/info hash if known.
        Ok(AddResult {
            info_hash: String::new(),
            name: None,
        })
    }

    async fn status(&self, info_hash: &str) -> Result<TorrentStatus> {
        let url = self.url(&format!("api/v2/torrents/info?hashes={}", info_hash));
        let resp = self
            .client
            .get(url)
            .send()
            .await
            .map_err(|e| StreamingError::RpcUnavailable(format!("qbt status: {}", e)))?;
        if resp.status() == StatusCode::NOT_FOUND {
            return Ok(TorrentStatus {
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
            });
        }
        if !resp.status().is_success() {
            return Err(StreamingError::RpcUnavailable(format!(
                "qbt status http {}",
                resp.status()
            )));
        }
        let list: Vec<QbtInfoItem> = resp
            .json()
            .await
            .map_err(|e| StreamingError::RpcUnavailable(format!("qbt status decode: {}", e)))?;
        let it = list.into_iter().find(|i| {
            i.hash
                .as_deref()
                .unwrap_or("")
                .eq_ignore_ascii_case(info_hash)
        });
        if let Some(i) = it {
            let size = i.total_size.or(i.size).unwrap_or(0);
            let downloaded = i.downloaded.unwrap_or(0);
            let state = i
                .state
                .as_deref()
                .map(map_state)
                .unwrap_or(TorrentState::Unknown);
            let progress = i.progress.unwrap_or(0.0) as f32;
            return Ok(TorrentStatus {
                exists: true,
                state,
                progress,
                size,
                downloaded,
                upload: i.uploaded.unwrap_or(0),
                download_rate: i.dlspeed.unwrap_or(0),
                upload_rate: i.upspeed.unwrap_or(0),
                info_hash: info_hash.to_string(),
                name: i.name,
                save_path: i.save_path,
                files_known: false,
            });
        }
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

    async fn list_files(&self, info_hash: &str) -> Result<Vec<TorrentFile>> {
        let url = self.url(&format!("api/v2/torrents/files?hash={}", info_hash));
        let resp = self
            .client
            .get(url)
            .send()
            .await
            .map_err(|e| StreamingError::RpcUnavailable(format!("qbt files: {}", e)))?;
        if !resp.status().is_success() {
            return Err(StreamingError::RpcUnavailable(format!(
                "qbt files http {}",
                resp.status()
            )));
        }
        let files: Vec<QbtFileItem> = resp
            .json()
            .await
            .map_err(|e| StreamingError::RpcUnavailable(format!("qbt files decode: {}", e)))?;
        let out = files
            .into_iter()
            .enumerate()
            .map(|(idx, f)| {
                let downloaded = (f.size as f64 * f.progress).round() as u64;
                let name = f.name;
                let is_media = crate::model::is_media_path(&name);
                TorrentFile {
                    index: idx,
                    path: name,
                    length: f.size,
                    downloaded,
                    priority: f.priority.max(0) as u8,
                    is_media,
                }
            })
            .collect();
        Ok(out)
    }

    async fn set_seeding(&self, info_hash: &str, on: bool) -> Result<()> {
        if on {
            // resume and force start
            let url1 = self.url(&format!("api/v2/torrents/resume?hashes={}", info_hash));
            let _ = self.client.post(url1).send().await;
            let url2 = self.url("api/v2/torrents/setForceStart");
            let _ = self
                .client
                .post(url2)
                .form(&[("hashes", info_hash), ("value", "true")])
                .send()
                .await;
            Ok(())
        } else {
            let url = self.url(&format!("api/v2/torrents/pause?hashes={}", info_hash));
            let resp = self
                .client
                .post(url)
                .send()
                .await
                .map_err(|e| StreamingError::RpcUnavailable(format!("qbt pause: {}", e)))?;
            if resp.status().is_success() {
                Ok(())
            } else {
                Err(StreamingError::RpcUnavailable(format!(
                    "qbt pause http {}",
                    resp.status()
                )))
            }
        }
    }

    async fn save_path(&self, info_hash: &str) -> Result<Option<String>> {
        let url = self.url(&format!("api/v2/torrents/info?hashes={}", info_hash));
        let resp = self
            .client
            .get(url)
            .send()
            .await
            .map_err(|e| StreamingError::RpcUnavailable(format!("qbt save_path: {}", e)))?;
        if !resp.status().is_success() {
            return Ok(None);
        }
        let list: Vec<QbtInfoItem> = resp.json().await.unwrap_or_default();
        Ok(list
            .into_iter()
            .find(|i| {
                i.hash
                    .as_deref()
                    .unwrap_or("")
                    .eq_ignore_ascii_case(info_hash)
            })
            .and_then(|i| i.save_path))
    }
}
